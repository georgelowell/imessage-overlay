/**
 * renderer.js
 *
 * Manages the canvas render loop.
 * Composites: video frame → iMessage overlay → animated bubbles.
 *
 * Responsibilities:
 *   - Accept a parsed timeline (from Parser.parseScript)
 *   - Drive an rAF loop that advances a playhead (currentTime in seconds)
 *   - At each frame: draw video, draw chrome, draw visible bubbles/typing
 *   - Expose start(), stop(), reset(), seek()
 *   - Emit callbacks: onFrame(currentTime), onEnd()
 *
 * Usage:
 *   const r = new Renderer(canvas, video, timeline, options);
 *   r.onEnd = () => console.log('done');
 *   r.start();
 */

class Renderer {

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLVideoElement}  video
   * @param {Array<Object>}     timeline  output of Parser.parseScript()
   * @param {Object}            options
   *   options.scale           {number}   devicePixelRatio (default 1)
   *   options.statusTime      {string}   override status bar time
   *   options.showCounterparty {boolean}
   *   options.cpInitials      {string}
   *   options.cpName          {string}
   *   options.cpColor         {string}
   */
  constructor(canvas, video, timeline, options = {}) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.video    = video;
    this.timeline = timeline;
    this.options  = options;

    // Playback state
    this.currentTime  = 0;       // seconds into overlay timeline
    this._startedAt   = null;    // performance.now() when play began
    this._rafId       = null;
    this._running     = false;
    this._animPhase   = 0;       // 0–1 dot bounce phase

    // Which events have already fired
    this._firedEvents = new Set();

    // Accumulated list of bubbles to render (grow-only)
    this._visibleBubbles = [];

    // Currently active typing indicator: null | { speaker, endTime }
    this._typing = null;

    // Callbacks
    this.onFrame = null;   // (currentTime) => void
    this.onEnd   = null;   // () => void

    // Layout constants (computed in _computeLayout)
    this._layout = null;
  }

  // ── Layout ───────────────────────────────────────────────────────────

  _computeLayout() {
    const { canvas, options } = this;
    // Scale every pt value so the overlay matches an iPhone 16 Pro (393pt wide)
    // regardless of the video's native resolution.
    const s = canvas.width / 393;
    const W = canvas.width;
    const H = canvas.height;

    const statusBarH   = 44 * s;
    const navBarH      = 44 * s;
    const cpH          = options.showCounterparty ? 80 * s : 0;

    const headerH = options.showHeader ? (statusBarH + navBarH + cpH) : 0;

    this._layout = {
      s,
      W, H,
      statusBarH,
      navBarY: statusBarH,
      navBarH,
      cpY:     statusBarH + navBarH,
      cpH,
      headerH,
      bubblesTop:    headerH + (options.showHeader ? 8 : 48) * s,
      bubblesBottom: H - 16 * s,
    };
  }

  // ── Public control ───────────────────────────────────────────────────

  start() {
    if (this._running) return;
    this._computeLayout();
    this._running  = true;
    this._startedAt = performance.now();
    this.video.currentTime = 0;
    this.video.play().catch(() => {});
    this._rafId = requestAnimationFrame(this._loop.bind(this));
  }

  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this.video.pause();
  }

  reset() {
    this.stop();
    this.currentTime     = 0;
    this._startedAt      = null;
    this._firedEvents.clear();
    this._visibleBubbles = [];
    this._typing         = null;
    this._animPhase      = 0;
  }

  // ── Main loop ────────────────────────────────────────────────────────

  _loop(now) {
    if (!this._running) return;

    // Advance playhead (subtract initial delay so events fire later)
    this.currentTime = (now - this._startedAt) / 1000 - (this.options.initialDelay || 0);
    this._animPhase  = (this._animPhase + 0.016) % 1;

    // Fire timeline events
    this._processTimeline();

    // Render
    this._draw();

    // Emit frame callback
    if (this.onFrame) this.onFrame(this.currentTime);

    // Check if done
    const last = this.timeline[this.timeline.length - 1];
    if (last && this.currentTime > last.endTime + 2) {
      this.stop();
      if (this.onEnd) this.onEnd();
      return;
    }

    this._rafId = requestAnimationFrame(this._loop.bind(this));
  }

  // ── Event processing ─────────────────────────────────────────────────

  _processTimeline() {
    for (let i = 0; i < this.timeline.length; i++) {
      if (this._firedEvents.has(i)) continue;

      const ev = this.timeline[i];
      if (this.currentTime < ev.startTime) continue;

      // Fire the event
      this._firedEvents.add(i);
      this._fireEvent(ev);
    }

    // Clear expired typing indicator
    if (this._typing && this.currentTime >= this._typing.endTime) {
      this._typing = null;
    }
  }

  _fireEvent(ev) {
    switch (ev.type) {
      case 'message':
        if (ev.speaker === 'A') {
          // Auto-typing: ~50ms per character, min 0.5s, max 4s
          const typingDur = Math.min(4, Math.max(0.5, ev.text.length * 0.05));
          AudioEngine.playKeystrokeLoop(typingDur);
          setTimeout(() => {
            if (!this._running) return;
            this._visibleBubbles.push({ speaker: ev.speaker, text: ev.text });
            AudioEngine.playSent();
          }, (typingDur + 0.2) * 1000);
        } else {
          this._visibleBubbles.push({ speaker: ev.speaker, text: ev.text });
          AudioEngine.playReceived();
        }
        break;

      case 'typing':
        this._typing = {
          speaker: ev.speaker,
          endTime: ev.endTime,
        };
        if (ev.speaker === 'A') {
          AudioEngine.playKeystrokeLoop(ev.duration);
        }
        break;

      case 'delay':
        // No visual/audio action; just a time gap handled by startTime
        break;
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────

  _draw() {
    const { ctx, canvas, video, _layout: L, options } = this;
    if (!L) return;
    const { W, H, s } = L;

    // 1. Video background — center-crop source to match 9:16 canvas
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const canvasRatio = W / H;
    const videoRatio  = vw / vh;
    let sx, sy, sw, sh;
    if (videoRatio > canvasRatio) {
      sh = vh;
      sw = Math.round(vh * canvasRatio);
      sx = Math.round((vw - sw) / 2);
      sy = 0;
    } else {
      sw = vw;
      sh = Math.round(vw / canvasRatio);
      sx = 0;
      sy = Math.round((vh - sh) / 2);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, W, H);

    // 2. Black scrim — opacity controlled by user (0 = none, 1 = solid black)
    const scrim = options.scrimOpacity || 0;
    if (scrim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${scrim})`;
      ctx.fillRect(0, 0, W, H);
    }

    // 3. Header (status bar + nav bar + counterparty) — optional
    if (options.showHeader) {
      IMessageUI.drawStatusBar(ctx, {
        canvasW:      W,
        statusBarH:   L.statusBarH,
        timeOverride: options.statusTime || null,
        scale:        s,
      });

      IMessageUI.drawNavBar(ctx, {
        canvasW:     W,
        navBarY:     L.navBarY,
        navBarH:     L.navBarH,
        contactName: options.contactName || options.cpName || 'iPhone',
        scale:       s,
      });

      if (options.showCounterparty) {
        IMessageUI.drawCounterparty(ctx, {
          canvasW:  W,
          topY:     L.cpY,
          initials: options.cpInitials || '?',
          name:     options.cpName || '',
          color:    options.cpColor || '#34C759',
          scale:    s,
        });
      }
    }

    // 4. Message bubbles + typing indicator
    this._drawBubbles();
  }

  _drawBubbles() {
    const { ctx, _layout: L } = this;
    const cfg = { canvasW: L.W, scale: L.s };

    // Top-anchored: first bubble starts just below the header, each
    // subsequent bubble flows downward from the bottom of the previous one.
    let y = L.bubblesTop;

    for (const b of this._visibleBubbles) {
      y = IMessageUI.drawMessageBubble(ctx, b, { ...cfg, y });
    }

    // Typing indicator appears below the last bubble
    if (this._typing) {
      IMessageUI.drawTypingIndicator(
        ctx,
        this._typing.speaker,
        this._animPhase,
        { ...cfg, y }
      );
    }
  }
}
