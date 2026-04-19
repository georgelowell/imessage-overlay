# Changelog

## [Unreleased]

### Changed
- **Mobile-first tab-based UI**: Replaced the desktop sidebar + panel layout with a full-screen three-tab interface — Build (conversation builder), Preview (canvas fullscreen with Play/Stop), Export (background upload, settings, export button). Bottom tab bar on mobile; vertical tab bar on desktop (≥900px) with the side panel and preview visible simultaneously. Canvas sizing now uses `_fitCanvas()` based on viewport dimensions, called on tab switch and window resize.
- **CSS rewritten for mobile**: Dark theme deepened (`--bg: #000`), `100dvh` for iOS viewport, safe-area insets for home indicator, large tap targets throughout. Desktop layout preserved via `@media (min-width: 900px)`.

### Added
- **Server-side MP4 export (`server/`)**: Node.js/Express backend that accepts `POST /export` with JPEG frame blobs + audio blob, stitches them into H.264/AAC MP4 via FFmpeg, and returns the file. Includes `Dockerfile` (node:20-alpine + ffmpeg), `cloudbuild.yaml` for Cloud Run deployment, and `.dockerignore`.
- **iOS Safari export routing**: `_isIOSSafari()` detects iOS Safari at runtime. On iOS, export captures canvas frames as JPEG blobs + audio via MediaRecorder, then POSTs to `CLOUD_RUN_URL`. Other browsers use the existing FFmpeg.wasm path. Set `CLOUD_RUN_URL` at the top of `app.js` before deploying.

### Changed
- **Visual bubble builder replaces text script editor**: The raw `<textarea>` script input has been replaced with a card-based conversation builder. Two buttons ("+ Near" = blue/right, "+ Far" = gray/left) add message cards to a vertical list. Each card has a text input, typing-duration field, delay-after field, delete button, and a drag handle for reorder via pointer events (mouse and touch). The card list is serialized to the existing `A:`/`B:` script format before parsing, so `parser.js`, `renderer.js`, and all other modules are unchanged.
- Emoji pickers (🖼 and 😊) now insert into whichever bubble textarea was last focused.

### Added
- **Custom avatar image for counterparty**: A new "Avatar image" file input appears in the Counterparty settings. When a image is set, it is drawn as a circular-cropped image (using `ctx.arc` + `ctx.clip`) in place of the initials bubble. The color circle remains as a background in case the image has transparency.
- **Inline custom emoji in bubbles**: Message text can include `[emoji:bull_chef]` tags. The parser preserves these tags (none of the timing-token regexes match them). `IMessageUI.drawMessageBubble` tokenizes text around `[emoji:name]` tags and draws the corresponding image inline, scaled to match the line height, with correct word-wrapping.
- **Custom emoji picker**: A 🖼 button next to the existing emoji picker opens a panel showing all registered custom emoji images. Clicking one inserts `[emoji:name]` at the cursor position. The two pickers are mutually exclusive.
- **`assets/images/bull_chef.png`**: Added the bull chef custom emoji image.

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
