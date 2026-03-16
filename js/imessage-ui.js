/**
 * imessage-ui.js
 *
 * Pure canvas drawing utilities for the iMessage overlay.
 * All functions accept a CanvasRenderingContext2D and a config object.
 * Nothing here touches the DOM or manages state — that's the renderer's job.
 *
 * Coordinate system: (0, 0) is top-left of the canvas.
 * The overlay is drawn at full canvas width/height.
 *
 * Public API (all on the IMessageUI namespace):
 *   IMessageUI.drawStatusBar(ctx, cfg)
 *   IMessageUI.drawNavBar(ctx, cfg)
 *   IMessageUI.drawCounterparty(ctx, cfg)
 *   IMessageUI.drawInputBar(ctx, cfg)
 *   IMessageUI.drawMessageBubble(ctx, msg, cfg)
 *   IMessageUI.drawTypingIndicator(ctx, speaker, animPhase, cfg)
 *   IMessageUI.measureBubble(ctx, text, cfg)  → { w, h }
 */

const IMessageUI = (() => {

  // ── Colour constants ─────────────────────────────────────────────────
  const BLUE   = '#1B84FF';   // sender (A)
  const GRAY   = '#3A3A3C';   // receiver (B)
  const WHITE  = '#FFFFFF';
  const STATUS_BG = 'rgba(0,0,0,0.55)';
  const NAV_BG    = 'rgba(28,28,30,0.85)';
  const INPUT_BG  = 'rgba(28,28,30,0.90)';
  const TEXT_PRIMARY   = '#FFFFFF';
  const TEXT_SECONDARY = 'rgba(255,255,255,0.55)';

  // ── Helpers ──────────────────────────────────────────────────────────

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /** Draw a signal-bars icon (4 bars, fill ratio 0–1). */
  function _drawSignalBars(ctx, x, y, scale, fill = 1) {
    const bars = 4;
    const bw   = 3  * scale;
    const gap  = 2  * scale;
    const maxH = 10 * scale;
    for (let i = 0; i < bars; i++) {
      const h = maxH * ((i + 1) / bars);
      const bx = x + i * (bw + gap);
      const by = y + (maxH - h);
      ctx.fillStyle = i < Math.ceil(fill * bars)
        ? TEXT_PRIMARY
        : 'rgba(255,255,255,0.3)';
      _roundRect(ctx, bx, by, bw, h, 1 * scale);
      ctx.fill();
    }
  }

  /** Draw a wifi icon (3 arcs). */
  function _drawWifi(ctx, x, y, scale) {
    const cx = x + 7 * scale;
    const cy = y + 10 * scale;
    const radii = [9, 6, 3].map(r => r * scale);
    for (let i = 0; i < radii.length; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, radii[i], Math.PI * 1.25, Math.PI * 1.75, false);
      ctx.strokeStyle = TEXT_PRIMARY;
      ctx.lineWidth   = 1.5 * scale;
      ctx.lineCap     = 'round';
      ctx.stroke();
    }
    // dot
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5 * scale, 0, Math.PI * 2);
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.fill();
  }

  /** Draw a battery icon. */
  function _drawBattery(ctx, x, y, scale, level = 1) {
    const bw = 22 * scale;
    const bh = 11 * scale;
    const nw =  2 * scale;
    const nh =  5 * scale;

    // Body
    ctx.strokeStyle = TEXT_PRIMARY;
    ctx.lineWidth   = 1.2 * scale;
    _roundRect(ctx, x, y, bw, bh, 2 * scale);
    ctx.stroke();

    // Nub
    ctx.fillStyle = TEXT_PRIMARY;
    _roundRect(ctx, x + bw + 1 * scale, y + (bh - nh) / 2, nw, nh, 1 * scale);
    ctx.fill();

    // Fill level
    const padding = 2 * scale;
    const fw = (bw - padding * 2) * Math.min(1, Math.max(0, level));
    ctx.fillStyle = level < 0.2 ? '#FF3B30' : '#30D158';
    _roundRect(ctx, x + padding, y + padding, fw, bh - padding * 2, 1.5 * scale);
    ctx.fill();
  }

  // ── Status Bar ───────────────────────────────────────────────────────

  /**
   * Draw the iOS status bar at the top of the canvas.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} cfg
   *   cfg.canvasW        {number}
   *   cfg.statusBarH     {number}   height of bar (default 44)
   *   cfg.timeOverride   {string}   e.g. "9:41" (optional)
   *   cfg.scale          {number}   DPR-aware scale (default 1)
   */
  function drawStatusBar(ctx, cfg) {
    const { canvasW, statusBarH = 44, timeOverride, scale = 1 } = cfg;
    const h = statusBarH;

    // Background
    ctx.fillStyle = STATUS_BG;
    ctx.fillRect(0, 0, canvasW, h);

    // Time (center)
    const timeStr = timeOverride || _currentTimeString();
    ctx.font        = `600 ${15 * scale}px -apple-system, SF Pro Text, sans-serif`;
    ctx.fillStyle   = TEXT_PRIMARY;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(timeStr, canvasW / 2, h / 2);

    // Right side: signal + wifi + battery
    const rightX = canvasW - 8 * scale;
    const midY   = h / 2 - 5 * scale;

    _drawBattery(ctx, rightX - 26 * scale, midY, scale);
    _drawWifi(ctx, rightX - 54 * scale, midY - 2 * scale, scale * 0.85);
    _drawSignalBars(ctx, rightX - 80 * scale, midY, scale * 0.9, 0.75);

    // Left side: "No SIM" or carrier text
    ctx.font        = `500 ${13 * scale}px -apple-system, SF Pro Text, sans-serif`;
    ctx.textAlign   = 'left';
    ctx.fillStyle   = TEXT_PRIMARY;
    ctx.fillText('Verizon', 12 * scale, h / 2);
  }

  function _currentTimeString() {
    const d = new Date();
    let h = d.getHours(), m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  // ── Nav Bar ─────────────────────────────────────────────────────────

  /**
   * Draw the Messages nav bar (back arrow, contact name, icons).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} cfg
   *   cfg.canvasW      {number}
   *   cfg.navBarY      {number}   top Y of nav bar
   *   cfg.navBarH      {number}   height (default 44)
   *   cfg.contactName  {string}
   *   cfg.scale        {number}
   */
  function drawNavBar(ctx, cfg) {
    const { canvasW, navBarY, navBarH = 44, contactName = 'iPhone', scale = 1 } = cfg;

    // Background
    ctx.fillStyle = NAV_BG;
    ctx.fillRect(0, navBarY, canvasW, navBarH);

    // Thin separator
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, navBarY + navBarH - 0.5, canvasW, 0.5);

    const midY = navBarY + navBarH / 2;

    // Back chevron (<)
    const chevX = 14 * scale;
    const chevS = 9  * scale;
    ctx.beginPath();
    ctx.moveTo(chevX + chevS, midY - chevS);
    ctx.lineTo(chevX,         midY);
    ctx.lineTo(chevX + chevS, midY + chevS);
    ctx.strokeStyle = '#0A84FF';
    ctx.lineWidth   = 2.2 * scale;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();

    // Contact name (center)
    ctx.font        = `600 ${17 * scale}px -apple-system, SF Pro Text, sans-serif`;
    ctx.fillStyle   = TEXT_PRIMARY;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(contactName, canvasW / 2, midY);

    // Right: video + audio icons (simplified glyphs)
    const iconY  = midY;
    const iconR  = canvasW - 14 * scale;

    // Phone icon (circle with glyph)
    _drawCircleIcon(ctx, iconR - 20 * scale, iconY, 15 * scale, '📞', scale);
    _drawCircleIcon(ctx, iconR,              iconY, 15 * scale, '📹', scale);
  }

  function _drawCircleIcon(ctx, cx, cy, r, emoji, scale) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${r * 1.0}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, cx, cy + 1);
  }

  // ── Counterparty indicator ───────────────────────────────────────────

  /**
   * Draw the counterparty avatar + name below the nav bar.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} cfg
   *   cfg.canvasW     {number}
   *   cfg.topY        {number}  top of the area
   *   cfg.initials    {string}
   *   cfg.name        {string}
   *   cfg.color       {string}  circle fill color
   *   cfg.scale       {number}
   */
  function drawCounterparty(ctx, cfg) {
    const {
      canvasW,
      topY,
      initials  = '?',
      name      = '',
      color     = '#34C759',
      scale     = 1,
    } = cfg;

    const cx     = canvasW / 2;
    const r      = 26 * scale;
    const cy     = topY + r + 8 * scale;

    // Circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Initials
    ctx.font        = `600 ${16 * scale}px -apple-system, SF Pro Text, sans-serif`;
    ctx.fillStyle   = WHITE;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials.toUpperCase().slice(0, 2), cx, cy);

    // Name below circle
    if (name) {
      ctx.font        = `400 ${13 * scale}px -apple-system, SF Pro Text, sans-serif`;
      ctx.fillStyle   = TEXT_PRIMARY;
      ctx.textBaseline = 'top';
      ctx.fillText(name, cx, cy + r + 6 * scale);
    }
  }

  // ── Input bar ───────────────────────────────────────────────────────

  /**
   * Draw the fake keyboard input bar at the bottom.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} cfg
   *   cfg.canvasW   {number}
   *   cfg.canvasH   {number}
   *   cfg.inputBarH {number}
   *   cfg.scale     {number}
   */
  function drawInputBar(ctx, cfg) {
    const { canvasW, canvasH, inputBarH = 56, scale = 1 } = cfg;
    const y = canvasH - inputBarH;

    // Background
    ctx.fillStyle = INPUT_BG;
    ctx.fillRect(0, y, canvasW, inputBarH);

    // Top separator
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, y, canvasW, 0.5);

    // Text field pill
    const fieldH  = 36 * scale;
    const fieldY  = y + (inputBarH - fieldH) / 2;
    const fieldX  = 46 * scale;
    const fieldW  = canvasW - fieldX - 46 * scale;

    ctx.fillStyle   = 'rgba(255,255,255,0.08)';
    _roundRect(ctx, fieldX, fieldY, fieldW, fieldH, 18 * scale);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = 0.8;
    ctx.stroke();

    // Placeholder text
    ctx.font        = `400 ${15 * scale}px -apple-system, SF Pro Text, sans-serif`;
    ctx.fillStyle   = 'rgba(255,255,255,0.3)';
    ctx.textAlign   = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('iMessage', fieldX + 12 * scale, fieldY + fieldH / 2);

    // + button (left)
    ctx.font      = `300 ${22 * scale}px -apple-system`;
    ctx.fillStyle = '#0A84FF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', 22 * scale, y + inputBarH / 2);

    // Send button (right, grayed since no text)
    ctx.font      = `600 ${14 * scale}px -apple-system`;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText('⬆', canvasW - 22 * scale, y + inputBarH / 2);
  }

  // ── Message bubble ──────────────────────────────────────────────────

  const BUBBLE_MAX_WIDTH_RATIO = 0.72;  // fraction of canvas width
  const BUBBLE_PADDING_X       = 14;
  const BUBBLE_PADDING_Y       = 7;    // tighter vertical padding
  const BUBBLE_FONT_SIZE       = 16;
  const BUBBLE_LINE_HEIGHT     = 20;   // closer to font size for tighter fit
  const BUBBLE_RADIUS          = 18;
  const TAIL_SIZE              = 8;

  /**
   * Measure how wide/tall a bubble would be for the given text.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} text
   * @param {Object} cfg  { canvasW, scale }
   * @returns {{ w: number, h: number, lines: string[] }}
   */
  function measureBubble(ctx, text, cfg) {
    const { canvasW, scale = 1 } = cfg;
    const maxW  = canvasW * BUBBLE_MAX_WIDTH_RATIO - BUBBLE_PADDING_X * 2 * scale;
    const fs    = BUBBLE_FONT_SIZE * scale;
    const lh    = BUBBLE_LINE_HEIGHT * scale;
    const px    = BUBBLE_PADDING_X * scale;
    const py    = BUBBLE_PADDING_Y * scale;

    ctx.font = `400 ${fs}px -apple-system, SF Pro Text, sans-serif`;
    const lines = _wrapText(ctx, text, maxW);
    const w = Math.min(
      _maxLineWidth(ctx, lines) + px * 2,
      canvasW * BUBBLE_MAX_WIDTH_RATIO
    );
    const h = lines.length * lh + py * 2;
    return { w, h, lines };
  }

  /**
   * Draw a single message bubble.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} msg   { speaker: 'A'|'B', text: string }
   * @param {Object} cfg   { canvasW, y, scale }
   *   cfg.y  = top Y of the bubble
   * @returns {number}  bottom Y of the drawn bubble (for stacking)
   */
  function drawMessageBubble(ctx, msg, cfg) {
    const { canvasW, y, scale = 1 } = cfg;
    const isSender = msg.speaker === 'A';
    const color    = isSender ? BLUE : GRAY;
    const { w, h, lines } = measureBubble(ctx, msg.text, cfg);

    const margin = 12 * scale;
    const r      = Math.min(BUBBLE_RADIUS * scale, h / 2);
    const fs     = BUBBLE_FONT_SIZE * scale;
    const lh     = BUBBLE_LINE_HEIGHT * scale;
    const px     = BUBBLE_PADDING_X * scale;
    const py     = BUBBLE_PADDING_Y * scale;

    // X position
    const bx = isSender
      ? canvasW - w - margin - TAIL_SIZE * scale
      : margin + TAIL_SIZE * scale;

    // Bubble body
    ctx.fillStyle = color;
    _roundRect(ctx, bx, y, w, h, r);
    ctx.fill();

    // Tail
    _drawTail(ctx, bx, y, w, h, r, isSender, color, scale);

    // Text — each line centered vertically within its lh slot
    ctx.fillStyle    = WHITE;
    ctx.font         = `400 ${fs}px -apple-system, SF Pro Text, sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bx + px, y + py + (i + 0.5) * lh);
    }

    return y + h + 8 * scale;  // return bottom Y
  }

  /** Draw the little speech tail on a bubble. */
  function _drawTail(ctx, bx, by, bw, bh, r, isSender, color, scale) {
    const ts = TAIL_SIZE * scale;
    const ty = by + bh - r - ts * 0.5;

    ctx.fillStyle = color;
    ctx.beginPath();

    if (isSender) {
      const tx = bx + bw;
      ctx.moveTo(tx - ts * 0.2, ty);
      ctx.quadraticCurveTo(tx + ts * 1.2, ty + ts * 0.5, tx - ts * 0.1, ty + ts);
      ctx.lineTo(tx - ts * 0.5, ty + ts * 0.2);
    } else {
      const tx = bx;
      ctx.moveTo(tx + ts * 0.2, ty);
      ctx.quadraticCurveTo(tx - ts * 1.2, ty + ts * 0.5, tx + ts * 0.1, ty + ts);
      ctx.lineTo(tx + ts * 0.5, ty + ts * 0.2);
    }
    ctx.fill();
  }

  // ── Typing indicator ─────────────────────────────────────────────────

  /**
   * Draw the animated "…" typing indicator bubble.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} speaker  'A' | 'B'
   * @param {number} animPhase  0–1 animation progress (from renderer)
   * @param {Object} cfg  { canvasW, y, scale }
   * @returns {number}  bottom Y
   */
  function drawTypingIndicator(ctx, speaker, animPhase, cfg) {
    const { canvasW, y, scale = 1 } = cfg;
    const isSender = speaker === 'A';
    const color    = isSender ? BLUE : GRAY;
    const bw = 60 * scale;
    const bh = 36 * scale;
    const r  = bh / 2;
    const margin = 12 * scale;
    const bx = isSender ? canvasW - bw - margin - TAIL_SIZE * scale : margin + TAIL_SIZE * scale;

    // Bubble
    ctx.fillStyle = color;
    _roundRect(ctx, bx, y, bw, bh, r);
    ctx.fill();

    _drawTail(ctx, bx, y, bw, bh, r, isSender, color, scale);

    // Three dots with bouncing animation
    const dotR   = 5  * scale;
    const dotGap = 14 * scale;
    const dotY0  = y + bh / 2;
    const dotsStartX = bx + bw / 2 - dotGap;

    for (let i = 0; i < 3; i++) {
      // Each dot is offset in phase by 1/3
      const phase   = (animPhase + i / 3) % 1;
      const bounce  = Math.sin(phase * Math.PI) * 5 * scale;
      const dotX    = dotsStartX + i * dotGap;
      const dotY    = dotY0 - bounce;
      const opacity = 0.5 + 0.5 * Math.sin(phase * Math.PI);

      ctx.fillStyle = `rgba(255,255,255,${opacity.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    return y + bh + 8 * scale;
  }

  // ── Text wrapping util ───────────────────────────────────────────────

  function _wrapText(ctx, text, maxW) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';

    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function _maxLineWidth(ctx, lines) {
    return lines.reduce((max, l) => Math.max(max, ctx.measureText(l).width), 0);
  }

  // Public API
  return {
    drawStatusBar,
    drawNavBar,
    drawCounterparty,
    drawInputBar,
    drawMessageBubble,
    drawTypingIndicator,
    measureBubble,
  };

})();
