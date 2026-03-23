# Changelog

## [Unreleased]

### Added
- **Real MP3 notification sounds**: `playSent` and `playReceived` now load and play `message sent sound.mp3` / `message received sound.mp3` from the project root via `fetch` + `decodeAudioData`. Buffers are decoded once and cached. Falls back silently if a file is missing.
- **Ken Burns controls**: When the Ken Burns checkbox is enabled, a sub-section now appears with two selects — Zoom (In / Out) and Pan (None / Right / Left / Down / Up). Options are passed as `kbZoom` and `kbPan` to the renderer.
- **Unified script syntax**: Parser now supports `[d:N,t:N]` bracket tokens where `d` = delay seconds and `t` = typing seconds. The `s` suffix is optional, and either key may be omitted (`[d:2]`, `[t:3]`, `[d:2,t:3]` all work). Legacy `[2s]` and `[typing:3s]` syntax is unchanged.
- Hint text in the script textarea now documents the new `[d:N]` / `[t:N]` / `[d:N,t:N]` format alongside the legacy formats.

## [1.0.0] - 2026-03-23

### Added
- Initial release: iMessage video overlay app with video/image background, Ken Burns effect, conversation script parser, real-time canvas renderer, and MP4 export via MediaRecorder.
