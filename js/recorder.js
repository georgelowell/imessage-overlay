/**
 * recorder.js
 *
 * Wraps the MediaRecorder API to capture the canvas output as an MP4/WebM.
 *
 * Flow:
 *   1. Caller creates a Recorder, passing the canvas and an AudioContext
 *      destination (optional — for baking in audio).
 *   2. Call recorder.start() to begin capture.
 *   3. Call recorder.stop() → returns a Blob URL for the exported video.
 *
 * Note on format:
 *   MediaRecorder support varies by browser:
 *     Chrome  → video/webm;codecs=vp9 (best quality)
 *     Firefox → video/webm;codecs=vp8
 *   We try VP9 → VP8 → default in order.
 *   After download, the file is a .webm; rename to .mp4 works in most players,
 *   or users can convert with ffmpeg.
 */

class Recorder {

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object}            options
   *   options.fps          {number}   target framerate (default 30)
   *   options.videoBitrate {number}   bps (default 8_000_000)
   *   options.onProgress   {Function} (ratio 0–1) → void, called periodically
   *   options.duration     {number}   expected duration in seconds (for progress)
   */
  constructor(canvas, options = {}) {
    this.canvas  = canvas;
    this.options = {
      fps:          options.fps          || 30,
      videoBitrate: options.videoBitrate || 8_000_000,
      onProgress:   options.onProgress   || null,
      duration:     options.duration     || 0,
    };

    this._mediaRecorder = null;
    this._chunks        = [];
    this._stream        = null;
    this._startTime     = null;
    this._progressTimer = null;

    this.onStop = null;  // (blobUrl: string) => void
  }

  // ── MIME type selection ───────────────────────────────────────────────

  static _pickMime() {
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return '';  // browser default
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Begin recording the canvas.
   * @returns {void}
   */
  start() {
    if (this._mediaRecorder) this._cleanup();

    this._chunks = [];
    this._stream = this.canvas.captureStream(this.options.fps);

    const mime    = Recorder._pickMime();
    const recOpts = { mimeType: mime || undefined };
    if (this.options.videoBitrate) {
      recOpts.videoBitsPerSecond = this.options.videoBitrate;
    }

    this._mediaRecorder = new MediaRecorder(this._stream, recOpts);
    this._mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) this._chunks.push(e.data);
    };
    this._mediaRecorder.onstop = () => this._finalize();

    this._mediaRecorder.start(100);  // collect data every 100 ms
    this._startTime = performance.now();

    // Drive progress updates
    if (this.options.onProgress && this.options.duration > 0) {
      this._progressTimer = setInterval(() => {
        const elapsed = (performance.now() - this._startTime) / 1000;
        const ratio   = Math.min(1, elapsed / this.options.duration);
        this.options.onProgress(ratio);
      }, 200);
    }

    console.log('[Recorder] Started. MIME:', mime || 'browser default');
  }

  /**
   * Stop recording and trigger finalization.
   */
  stop() {
    if (!this._mediaRecorder || this._mediaRecorder.state === 'inactive') return;
    this._mediaRecorder.stop();
    clearInterval(this._progressTimer);
  }

  // ── Internal ─────────────────────────────────────────────────────────

  _finalize() {
    const mime    = this._mediaRecorder.mimeType || 'video/webm';
    const blob    = new Blob(this._chunks, { type: mime });
    const url     = URL.createObjectURL(blob);
    const ext     = mime.includes('mp4') ? 'mp4' : 'webm';

    console.log(`[Recorder] Done. Size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);

    if (this.options.onProgress) this.options.onProgress(1);
    if (this.onStop) this.onStop(url, ext, blob);

    this._cleanup();
  }

  _cleanup() {
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    this._mediaRecorder = null;
    clearInterval(this._progressTimer);
  }

  // ── Static helper ─────────────────────────────────────────────────────

  /**
   * Trigger a browser download of the recorded file.
   * @param {string} url    Blob URL from onStop
   * @param {string} ext    'webm' or 'mp4'
   * @param {string} name   base filename (without extension)
   */
  static download(url, ext, name = 'imessage-overlay') {
    const a = document.createElement('a');
    a.href     = url;
    a.download = `${name}.${ext}`;
    a.click();
    // Revoke after a delay so the download can start
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
