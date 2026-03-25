# Changelog

## [Unreleased]

### Fixed
- **No audio in exported video**: Rewired `AudioEngine` to use the Web Audio API (`AudioContext` + `MediaElementSourceNode`). On export, `startRecording()` creates a `MediaStreamAudioDestinationNode`, routes all sounds (typing, sent, received) through it, and returns the resulting `MediaStream`. `Recorder` combines the canvas video tracks with the audio tracks via `new MediaStream([...videoTracks, ...audioTracks])` before passing to `MediaRecorder`. Audio context is stopped cleanly via `stopRecording()` when export finishes or is cancelled.
- **MIME type lacked audio codec**: `Recorder._pickMime()` now prefers `video/webm;codecs=vp9,opus` and `video/webm;codecs=vp8,opus` before falling back to video-only variants.
- **FFmpeg.wasm CORS error on GitHub Pages**: Downloaded all three FFmpeg.wasm files (`ffmpeg.js`, `ffmpeg-core.js`, `ffmpeg-core.wasm`) into `assets/ffmpeg/` and updated `index.html` and `recorder.js` to load them locally instead of from unpkg CDN.
- Added `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` meta tags to `index.html` for SharedArrayBuffer/FFmpeg.wasm compatibility.

### Added
- **True MP4 export via FFmpeg.wasm**: After MediaRecorder finishes capturing WebM, `recorder.js` automatically transcodes to H.264/AAC MP4 using `@ffmpeg/ffmpeg@0.12.6` and `@ffmpeg/core@0.12.6` (single-threaded, no SharedArrayBuffer required). The downloaded file is now `imessage-overlay.mp4`.
- **Two-phase export progress**: The status bar now shows "Exporting… X%" during recording, then "Converting to MP4… X%" during FFmpeg transcoding.
- **Graceful MP4 fallback**: If FFmpeg transcoding fails for any reason, the original WebM is downloaded instead and the user is notified via the status label.
- **Real MP3 notification sounds**: `playSent` and `playReceived` now load and play `message sent sound.mp3` / `message received sound.mp3` from the project root via `fetch` + `decodeAudioData`. Buffers are decoded once and cached. Falls back silently if a file is missing.
- **Ken Burns controls**: When the Ken Burns checkbox is enabled, a sub-section now appears with two selects — Zoom (In / Out) and Pan (None / Right / Left / Down / Up). Options are passed as `kbZoom` and `kbPan` to the renderer.
- **Unified script syntax**: Parser now supports `[d:N,t:N]` bracket tokens where `d` = delay seconds and `t` = typing seconds. The `s` suffix is optional, and either key may be omitted (`[d:2]`, `[t:3]`, `[d:2,t:3]` all work). Legacy `[2s]` and `[typing:3s]` syntax is unchanged.
- Hint text in the script textarea now documents the new `[d:N]` / `[t:N]` / `[d:N,t:N]` format alongside the legacy formats.

## [1.0.0] - 2026-03-23

### Added
- Initial release: iMessage video overlay app with video/image background, Ken Burns effect, conversation script parser, real-time canvas renderer, and MP4 export via MediaRecorder.
