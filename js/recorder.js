/**
 * recorder.js
 *
 * Wraps the MediaRecorder API to capture the canvas output, then transcodes
 * the resulting WebM to MP4 (H.264 / AAC) via FFmpeg.wasm.
 *
 * Flow:
 *   1. Caller creates a Recorder, passing the canvas.
 *   2. Call recorder.start() to begin capture.
 *   3. Call recorder.stop() — MediaRecorder stops, then FFmpeg transcodes.
 *   4. onStop(url, ext, blob) fires with the final MP4 (or WebM fallback).
 *
 * Callbacks in options:
 *   onProgress(ratio 0–1)        — fires during MediaRecorder capture phase
 *   onConvertProgress(ratio 0–1) — fires during FFmpeg transcoding phase
 *   onConvertError(err)          — fires if FFmpeg fails (fallback to WebM)
 *
 * FFmpeg globals (loaded via CDN in index.html):
 *   FFmpegWASM.FFmpeg  — the FFmpeg class (@ffmpeg/ffmpeg UMD build)
 *
 * @ffmpeg/util is NOT loaded from CDN; the two helpers we need are inlined
 * below to avoid an extra script dependency and global-name fragility.
 */

// ── Inlined @ffmpeg/util helpers ──────────────────────────────────────────────

/** Fetch a URL and return it as a same-origin blob URL (bypasses WASM CORS). */
async function _toBlobURL(url, mimeType) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
  const blob = new Blob([await resp.arrayBuffer()], { type: mimeType });
  return URL.createObjectURL(blob);
}

/** Convert a Blob to a Uint8Array for FFmpeg's virtual filesystem. */
async function _fetchFile(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

// ── FFmpeg singleton ──────────────────────────────────────────────────────────
// Loaded once on first export; reused on subsequent exports.

let _ffmpegInstance = null;
let _ffmpegLoadPromise = null;

async function _loadFFmpeg() {
  if (_ffmpegInstance) return _ffmpegInstance;

  // Coalesce concurrent calls into a single load
  if (!_ffmpegLoadPromise) {
    _ffmpegLoadPromise = (async () => {
      // Guard: CDN script must have loaded
      if (typeof FFmpegWASM === 'undefined') {
        throw new Error('FFmpeg.wasm CDN script failed to load. Check your network connection.');
      }

      const { FFmpeg } = FFmpegWASM;

      console.log('[Recorder] Downloading FFmpeg core (~25 MB, first export only)…');
      const ffmpeg = new FFmpeg();

      // Load the single-threaded core (no SharedArrayBuffer / COOP headers required)
      await ffmpeg.load({
        coreURL: await _toBlobURL(
          'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
          'text/javascript'
        ),
        wasmURL: await _toBlobURL(
          'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
          'application/wasm'
        ),
      });

      _ffmpegInstance = ffmpeg;
      console.log('[Recorder] FFmpeg.wasm loaded.');
      return ffmpeg;
    })();

    // Reset on failure so the next export can retry
    _ffmpegLoadPromise.catch(() => { _ffmpegLoadPromise = null; });
  }

  return _ffmpegLoadPromise;
}

// ── Recorder class ────────────────────────────────────────────────────────────

class Recorder {

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object}            options
   *   options.fps              {number}   target framerate (default 30)
   *   options.videoBitrate     {number}   bps (default 8_000_000)
   *   options.duration         {number}   expected duration in seconds (for progress)
   *   options.onProgress       {Function} (ratio 0–1) recording phase progress
   *   options.onConvertProgress{Function} (ratio 0–1) FFmpeg transcoding progress
   *   options.onConvertError   {Function} (err) called if transcoding fails
   */
  constructor(canvas, options = {}) {
    this.canvas  = canvas;
    this.options = {
      fps:               options.fps               || 30,
      videoBitrate:      options.videoBitrate       || 8_000_000,
      duration:          options.duration           || 0,
      onProgress:        options.onProgress         || null,
      onConvertStart:    options.onConvertStart      || null,
      onConvertProgress: options.onConvertProgress  || null,
      onConvertError:    options.onConvertError      || null,
    };

    this._mediaRecorder = null;
    this._chunks        = [];
    this._stream        = null;
    this._startTime     = null;
    this._progressTimer = null;

    this.onStop = null;  // (blobUrl: string, ext: string, blob: Blob) => void
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

    // Drive recording-phase progress bar
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
   * Stop recording; triggers _finalize → FFmpeg transcoding → onStop.
   */
  stop() {
    if (!this._mediaRecorder || this._mediaRecorder.state === 'inactive') return;
    this._mediaRecorder.stop();
    clearInterval(this._progressTimer);
  }

  // ── Internal ─────────────────────────────────────────────────────────

  /**
   * Called when MediaRecorder finishes. Builds the WebM blob, then hands it
   * to FFmpeg for transcoding to MP4. Falls back to WebM on any error.
   */
  async _finalize() {
    const mime     = this._mediaRecorder.mimeType || 'video/webm';
    const webmBlob = new Blob(this._chunks, { type: mime });

    console.log(`[Recorder] WebM captured. Size: ${(webmBlob.size / 1024 / 1024).toFixed(2)} MB`);

    // Recording phase complete
    if (this.options.onProgress) this.options.onProgress(1);

    // Attempt FFmpeg transcoding → MP4
    try {
      const mp4Blob = await this._transcodeToMp4(webmBlob);
      const url     = URL.createObjectURL(mp4Blob);
      if (this.onStop) this.onStop(url, 'mp4', mp4Blob);
    } catch (err) {
      // Non-fatal: fall back to the original WebM
      console.error('[Recorder] FFmpeg transcoding failed; falling back to WebM.', err);
      if (this.options.onConvertError) this.options.onConvertError(err);
      const url = URL.createObjectURL(webmBlob);
      if (this.onStop) this.onStop(url, 'webm', webmBlob);
    }

    this._cleanup();
  }

  /**
   * Transcode a WebM Blob to MP4 (H.264 / AAC) using FFmpeg.wasm.
   * @param   {Blob}   webmBlob
   * @returns {Promise<Blob>} MP4 blob
   */
  async _transcodeToMp4(webmBlob) {
    // Signal "loading" phase before the potentially slow WASM download
    if (this.options.onConvertStart) this.options.onConvertStart();

    const ffmpeg = await _loadFFmpeg();

    // Wire up transcoding-phase progress
    const onProgress = ({ progress }) => {
      if (this.options.onConvertProgress) {
        this.options.onConvertProgress(Math.min(1, Math.max(0, progress)));
      }
    };
    ffmpeg.on('progress', onProgress);

    try {
      // Write input
      await ffmpeg.writeFile('input.webm', await _fetchFile(webmBlob));

      // Transcode: H.264 video + AAC audio, web-optimised
      await ffmpeg.exec([
        '-i',        'input.webm',
        '-c:v',      'libx264',
        '-preset',   'fast',
        '-crf',      '18',
        '-c:a',      'aac',
        '-b:a',      '128k',
        '-pix_fmt',  'yuv420p',   // broadest player compatibility
        '-movflags', '+faststart', // moov atom at front for streaming
        'output.mp4',
      ]);

      // Read output
      const data = await ffmpeg.readFile('output.mp4');
      console.log(`[Recorder] MP4 transcoded. Size: ${(data.byteLength / 1024 / 1024).toFixed(2)} MB`);
      return new Blob([data], { type: 'video/mp4' });

    } finally {
      ffmpeg.off('progress', onProgress);
      // Clean up virtual FS to free memory for next export
      try { await ffmpeg.deleteFile('input.webm');  } catch (_) {}
      try { await ffmpeg.deleteFile('output.mp4');  } catch (_) {}
    }
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
   * Trigger a browser download.
   * @param {string} url   Blob URL from onStop
   * @param {string} ext   'mp4' or 'webm'
   * @param {string} name  base filename (without extension)
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
