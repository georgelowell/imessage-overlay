# iMessage Video Overlay — CLAUDE.md

Vanilla JS static web app. No build step. Open `index.html` directly.

## Architecture

| File | Role |
|------|------|
| `js/parser.js` | Parses conversation scripts into a flat event timeline |
| `js/renderer.js` | `Renderer` class — rAF loop, draws canvas frames (background + UI + bubbles) |
| `js/app.js` | Wires DOM → Parser → Renderer → Recorder |
| `js/imessage-ui.js` | Pure canvas drawing helpers (status bar, nav bar, bubbles, typing dots) |
| `js/audio.js` | `AudioEngine` — Web Audio API, keystroke loop + sent/received sounds |
| `js/recorder.js` | `Recorder` class — MediaRecorder wrapper, exports MP4 |
| `css/style.css` | All styles; uses CSS variables for colors |

## Script syntax (parser.js)

```
A: message text [d:2]         # sender + 2s delay
B: message text [t:3]         # receiver + typing 3s before message
B: message text [d:1,t:2]     # typing 2s + message + delay 1s
# Legacy (still supported)
A: Hey! [2s]
B: Hey back! [typing:3s]
```

Bracket token rules:
- `[d:N]` or `[d:Ns]` → delay N seconds
- `[t:N]` or `[t:Ns]` → typing indicator N seconds (shown before message on same line)
- `[d:N,t:N]` — combined; either key may be omitted
- Legacy `[Ns]` and `[typing:Ns]` still work

## Ken Burns options (renderer.js)

`options.kenBurns` — boolean, enables effect
`options.kbZoom` — `'in'` (default, 1.0→1.15) | `'out'` (1.15→1.0)
`options.kbPan`  — `'none'` | `'right'` | `'left'` | `'down'` | `'up'`

Pan is always constrained to available headroom so edges are never exposed.

## Canvas sizing

- Video mode: canvas = center-cropped 9:16 from video resolution
- Image mode: canvas = center-cropped 9:16 from image, capped at 1080×1920

## Key conventions

- All pt values in renderer are scaled by `canvas.width / 393` (iPhone 16 Pro reference width)
- CSS variables for all colors; dark theme only
