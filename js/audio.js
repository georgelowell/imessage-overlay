/**
 * audio.js
 *
 * All sounds are loaded from MP3 files in the project root.
 *
 * Sounds produced:
 *   AudioEngine.playKeystrokeLoop(duration, onDone)  – loops "Typing.mp3" for duration seconds
 *   AudioEngine.playSent()                           – plays "message sent sound.mp3"
 *   AudioEngine.playReceived()                       – plays "message received sound.mp3"
 *
 * Recording support:
 *   AudioEngine.startRecording() → MediaStream   – routes all sounds into a capture stream
 *   AudioEngine.stopRecording()                  – disconnects the capture stream
 *
 * The AudioContext and MediaElementSourceNodes are created lazily on the first
 * startRecording() call and reused for all subsequent exports.
 * (createMediaElementSource() can only be called once per element — the nodes
 * are permanently tied to the AudioContext they were created in.)
 */

const AudioEngine = (() => {

  // ── MP3 elements ─────────────────────────────────────────────────────
  const _sentAudio     = new Audio('message sent sound.mp3');
  const _receivedAudio = new Audio('message received sound.mp3');
  const _typingAudio   = new Audio('Typing.mp3');
  _sentAudio.load();
  _receivedAudio.load();
  _typingAudio.loop = true;
  _typingAudio.load();

  // ── Web Audio state ───────────────────────────────────────────────────
  // Created once on first startRecording(); reused for every subsequent export.
  let _ctx     = null;
  let _sources = null;  // { sent, received, typing } MediaElementSourceNodes
  let _recDest = null;  // MediaStreamAudioDestinationNode for the active recording

  /**
   * Create the AudioContext and wire each Audio element into it.
   * After this runs all audio is routed through the Web Audio graph.
   * Connects each source → ctx.destination so sounds remain audible.
   */
  function _init() {
    if (_ctx) return;
    _ctx = new AudioContext();
    const sent     = _ctx.createMediaElementSource(_sentAudio);
    const received = _ctx.createMediaElementSource(_receivedAudio);
    const typing   = _ctx.createMediaElementSource(_typingAudio);
    // Monitor path — keeps sounds audible during export
    sent.connect(_ctx.destination);
    received.connect(_ctx.destination);
    typing.connect(_ctx.destination);
    _sources = { sent, received, typing };
  }

  // ── Recording API ─────────────────────────────────────────────────────

  /**
   * Set up audio capture for a recording session.
   * Creates a MediaStreamAudioDestinationNode in the shared AudioContext,
   * connects all sound sources to it, and returns the resulting MediaStream.
   * Pass the returned stream to Recorder's `audioStream` option.
   */
  function startRecording() {
    _init();
    _ctx.resume();  // resume in case the context was suspended
    _recDest = _ctx.createMediaStreamDestination();
    _sources.sent.connect(_recDest);
    _sources.received.connect(_recDest);
    _sources.typing.connect(_recDest);
    return _recDest.stream;
  }

  /**
   * Tear down the capture routing after recording ends.
   * Safe to call multiple times (idempotent).
   */
  function stopRecording() {
    if (!_recDest || !_sources) return;
    try { _sources.sent.disconnect(_recDest); }     catch (_) {}
    try { _sources.received.disconnect(_recDest); } catch (_) {}
    try { _sources.typing.disconnect(_recDest); }   catch (_) {}
    _recDest = null;
  }

  // ── Public sounds ─────────────────────────────────────────────────────

  /**
   * Play Typing.mp3 in a loop for `duration` seconds, then stop.
   */
  function playKeystrokeLoop(duration, onDone) {
    _typingAudio.currentTime = 0;
    _typingAudio.play().catch(() => {});
    setTimeout(() => {
      _typingAudio.pause();
      _typingAudio.currentTime = 0;
      if (typeof onDone === 'function') onDone();
    }, duration * 1000);
  }

  /**
   * Play "message sent sound.mp3".
   */
  function playSent() {
    _sentAudio.currentTime = 0;
    _sentAudio.play().catch(() => {});
  }

  /**
   * Play "message received sound.mp3".
   */
  function playReceived() {
    _receivedAudio.currentTime = 0;
    _receivedAudio.play().catch(() => {});
  }

  /**
   * Prime all audio so the first real play has no startup delay.
   * Call once on the first user gesture (Preview / Export click).
   * If the Web Audio context is already running, just resume it.
   */
  function warmUp() {
    if (_ctx) {
      // Web Audio already initialised — ensure context is running
      _ctx.resume();
      return;
    }
    // Pre-Web-Audio path: briefly play at zero volume to unlock elements
    [_typingAudio, _sentAudio, _receivedAudio].forEach(a => {
      const vol = a.volume;
      a.volume = 0;
      a.play().then(() => { a.pause(); a.currentTime = 0; a.volume = vol; }).catch(() => {});
    });
  }

  // Public API
  return { warmUp, playKeystrokeLoop, playSent, playReceived, startRecording, stopRecording };

})();
