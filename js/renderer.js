/**
 * renderer.js
 *
 * Manages the canvas render loop.
 * Composites: background (video or image) → iMessage overlay → animated bubbles.
 *
 * Responsibilities:
 *   - Accept a parsed timeline (from Parser.parseScript)
 *   - Drive an rAF loop that advances a playhead (currentTime in seconds)
 *   - At each frame: draw background, draw chrome, draw visible bubbles/typing
 *   - Expose start(), stop(), reset(), seek()
 *   - Emit callbacks: onFrame(currentTime), onEnd()
 *
 * Background modes:
 *   options.bgMode === 'video'  → draws video frame (center-cropped)
 *   options.bgMode === 'image'  → draws static image (object-fit: cover)
 *                                 + optional Ken Burns zoom/pan when options.kenBurns is true
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
   *   options.scale            {number}   devicePixelRatio (default 1)
   *   options.statusTime       {string}   override status bar time
   *   options.showCounterparty {boolean}
   *   options.cpInitials       {string}
   *   options.cpName           {string}
   *   options.cpColor          {string}
   *   options.bgMode           {'video'|'image'}  default 'video'
   *   options.bgImage          {HTMLImageElement} required when bgMode === 'image'
   *   options.kenBurns         {boolean}  animate zoom+pan on image background
   *   options.imageDuration    {number}   composition length in seconds (image mode)
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

  // ── Total composition duration ────────────────────────────────────────

  _totalDuration() {
    // Image mode: user-specified duration
    if (this.options.bgMode === 'image' && this.options.imageDuration) {
      return this.options.imageDuration;
    }
    // Video mode: derive from timeline (last event end + 2s buffer)
    const last = this.timeline[this.timeline.length - 1];
    return last ? last.endTime + 2 : 10;
  }

  // ── Public control ───────────────────────────────────────────────────

  start() {
    if (this._running) return;
    this._computeLayout();
    this._running   = true;
    this._startedAt = performance.now();

    // Only play video in video mode
    if (this.options.bgMode !== 'image') {
      this.video.currentTime = 0;
      this.video.play().catch(() => {});
    }

    this._rafId = requestAnimationFrame(this._loop.bind(this));
  }

  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;

    if (this.options.bgMode !== 'image') {
      this.video.pause();
    }
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
    if (this.currentTime > this._totalDuration()) {
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
    // Audio elements have ~250ms startup latency; play sounds this many ms
    // before the bubble appears so they land together visually.
    const SOUND_LEAD_MS = 240;

    switch (ev.type) {
      case 'message':
        if (ev.speaker === 'A') {
          // Auto-typing: ~50ms per character, min 0.5s, max 4s
          const typingDur = Math.min(4, Math.max(0.5, ev.text.length * 0.05));
          AudioEngine.playKeystrokeLoop(typingDur);
          const bubbleDelay = (typingDur + 0.2) * 1000;
          setTimeout(() => AudioEngine.playSent(), bubbleDelay - SOUND_LEAD_MS);
          setTimeout(() => {
            if (!this._running) return;
            this._visibleBubbles.push({ speaker: ev.speaker, text: ev.text });
          }, bubbleDelay);
        } else {
          AudioEngine.playReceived();
          setTimeout(() => {
            if (!this._running) return;
            this._visibleBubbles.push({ speaker: ev.speaker, text: ev.text });
          }, SOUND_LEAD_MS);
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
    const { ctx, canvas, _layout: L, options } = this;
    if (!L) return;
    const { W, H, s } = L;

    // 1. Background (video or image)
    this._drawBackground(W, H);

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
          canvasW:     W,
          topY:        L.cpY,
          initials:    options.cpInitials || '?',
          name:        options.cpName || '',
          color:       options.cpColor || '#34C759',
          avatarImage: options.cpAvatarImage || null,
          scale:       s,
        });
      }
    }

    // 4. Message bubbles + typing indicator
    this._drawBubbles();
  }

  // ── Background rendering ──────────────────────────────────────────────

  _drawBackground(W, H) {
    const { options } = this;

    if (options.bgMode === 'image') {
      const img = options.bgImage;
      if (!img || !img.complete || !img.naturalWidth) return;

      if (options.kenBurns) {
        this._drawImageKenBurns(img, W, H);
      } else {
        this._drawImageCover(img, W, H);
      }
    } else {
      // Video background — center-crop source to match canvas aspect ratio
      const { video } = this;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;

      const { ctx } = this;
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
    }
  }

  /**
   * Draw an image scaled to cover the full canvas (object-fit: cover behavior).
   * Centers the crop on the image.
   */
  _drawImageCover(img, W, H) {
    const { ctx } = this;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const canvasRatio = W / H;
    const imgRatio    = iw / ih;

    let sx, sy, sw, sh;
    if (imgRatio > canvasRatio) {
      // Image is wider — use full height, crop width
      sh = ih;
      sw = Math.round(ih * canvasRatio);
      sx = Math.round((iw - sw) / 2);
      sy = 0;
    } else {
      // Image is taller — use full width, crop height
      sw = iw;
      sh = Math.round(iw / canvasRatio);
      sx = 0;
      sy = Math.round((ih - sh) / 2);
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  }

  /**
   * Draw an image with the Ken Burns effect: a slow cinematic zoom (100%↔115%)
   * combined with an optional pan, animated over the full composition duration.
   *
   * options.kbZoom — 'in' (default): 1.0→1.15 | 'out': 1.15→1.0
   * options.kbPan  — 'none' (default) | 'right' | 'left' | 'down' | 'up'
   *
   * Pan uses up to 80% of the available headroom at each frame, so edges
   * are never exposed regardless of zoom direction.
   */
  _drawImageKenBurns(img, W, H) {
    const { ctx, options } = this;
    const duration = options.imageDuration || 30;
    const kbZoom   = options.kbZoom || 'in';
    const kbPan    = options.kbPan  || 'none';

    // Progress 0→1 over the full duration (clamped)
    const progress = Math.min(Math.max(this.currentTime, 0) / duration, 1);

    // Scale: zoom in (1.0→1.15) or zoom out (1.15→1.0)
    const scale = kbZoom === 'out'
      ? 1.15 - 0.15 * progress
      : 1 + 0.15 * progress;

    // Available headroom at current scale — the safe translation per side
    const headroomX = (scale - 1) * W / 2;
    const headroomY = (scale - 1) * H / 2;
    const PAN = 0.8; // fraction of headroom to use

    // panX/panY: positive moves canvas origin left/up → viewport sees right/bottom side
    let panX = 0, panY = 0;
    switch (kbPan) {
      case 'right': panX =  headroomX * PAN; break;
      case 'left':  panX = -headroomX * PAN; break;
      case 'down':  panY =  headroomY * PAN; break;
      case 'up':    panY = -headroomY * PAN; break;
    }

    ctx.save();
    ctx.translate(W / 2 - panX, H / 2 - panY);
    ctx.scale(scale, scale);
    ctx.translate(-W / 2, -H / 2);
    this._drawImageCover(img, W, H);
    ctx.restore();
  }

  // ── Bubble rendering ──────────────────────────────────────────────────

  _drawBubbles() {
    const { ctx, _layout: L } = this;
    const cfg = { canvasW: L.W, scale: L.s, emojiImages: this.options.emojiImages || {} };

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
