/**
 * audio.js
 *
 * All sounds are loaded from MP3 files in the project root.
 *
 * Sounds produced:
 *   AudioEngine.playKeystrokeLoop(duration, onDone)  – loops "Typing.mp3" for duration seconds
 *   AudioEngine.playSent()                           – plays "message sent sound.mp3"
 *   AudioEngine.playReceived()                       – plays "message received sound.mp3"
 */

const AudioEngine = (() => {

  // ── MP3 sounds ───────────────────────────────────────────────────────
  // Use the Audio constructor (works on file:// and http://)

  const _sentAudio     = new Audio('message sent sound.mp3');
  const _receivedAudio = new Audio('message received sound.mp3');
  const _typingAudio   = new Audio('Typing.mp3');
  _sentAudio.load();
  _receivedAudio.load();
  _typingAudio.loop = true;
  _typingAudio.load();

  // ── Public sounds ───────────────────────────────────────────────────

  /**
   * Play Typing.mp3 in a loop for `duration` seconds, then stop.
   * @param {number}   duration  seconds
   * @param {Function} onDone
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

  // Public API
  return { playKeystrokeLoop, playSent, playReceived };

})();
