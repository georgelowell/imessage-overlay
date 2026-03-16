/**
 * audio.js
 *
 * Synthesizes iOS-style notification and keyboard sounds using the
 * Web Audio API. No external audio files required.
 *
 * Sounds produced:
 *   AudioEngine.playKeyboardClick()  – single key tap (used while "typing")
 *   AudioEngine.playKeystrokeLoop(duration, onDone)  – rapid taps for `duration` seconds
 *   AudioEngine.playSent()           – iMessage "whoosh" sent sound
 *   AudioEngine.playReceived()       – iMessage "pop" received sound
 */

const AudioEngine = (() => {

  let ctx = null;

  function _getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ── Low-level primitives ────────────────────────────────────────────

  /**
   * Generate a short noise burst (simulates key click).
   * @param {number} startTime  AudioContext time
   * @param {number} duration   seconds
   * @param {number} gain
   */
  function _noiseBurst(startTime, duration = 0.012, gain = 0.18) {
    const ac = _getCtx();
    const bufferSize = Math.ceil(ac.sampleRate * duration);
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data   = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }

    const src = ac.createBufferSource();
    src.buffer = buffer;

    // High-pass + bandpass filter to sound like key plastic
    const hp = ac.createBiquadFilter();
    hp.type            = 'highpass';
    hp.frequency.value = 1800;

    const bp = ac.createBiquadFilter();
    bp.type            = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value         = 0.8;

    const gainNode = ac.createGain();
    gainNode.gain.setValueAtTime(gain, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    src.connect(hp);
    hp.connect(bp);
    bp.connect(gainNode);
    gainNode.connect(ac.destination);

    src.start(startTime);
    src.stop(startTime + duration + 0.01);
  }

  /**
   * Short pitched tone for UI sounds.
   * @param {number} startTime
   * @param {number} freq      Hz
   * @param {number} duration  seconds
   * @param {number} gain
   * @param {string} type      oscillator type
   */
  function _tone(startTime, freq, duration, gain = 0.3, type = 'sine') {
    const ac  = _getCtx();
    const osc = ac.createOscillator();
    const g   = ac.createGain();

    osc.type            = type;
    osc.frequency.value = freq;

    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(gain, startTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(g);
    g.connect(ac.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  // ── Public sounds ───────────────────────────────────────────────────

  /**
   * Single keyboard click (one tap).
   */
  function playKeyboardClick() {
    const ac = _getCtx();
    _noiseBurst(ac.currentTime, 0.010, 0.15);
  }

  /**
   * Rapid keyboard clicks for `duration` seconds, then calls onDone.
   * Used when speaker A is "typing" before their bubble appears.
   * @param {number}   duration  seconds
   * @param {Function} onDone
   */
  function playKeystrokeLoop(duration, onDone) {
    const ac         = _getCtx();
    const now        = ac.currentTime;
    const interval   = 0.07;   // ~14 taps/sec
    const count      = Math.max(1, Math.floor(duration / interval));
    const gainFactor = 0.12;

    for (let i = 0; i < count; i++) {
      const t = now + i * interval;
      if (t < now + duration) {
        _noiseBurst(t, 0.010 + Math.random() * 0.004, gainFactor + Math.random() * 0.05);
      }
    }

    if (typeof onDone === 'function') {
      setTimeout(onDone, duration * 1000);
    }
  }

  /**
   * iMessage "sent" whoosh — rising sweep.
   */
  function playSent() {
    const ac  = _getCtx();
    const now = ac.currentTime;

    // Pitch sweep up
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.type  = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.18);

    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.25, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(g);
    g.connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.25);

    // Subtle noise component for texture
    _noiseBurst(now, 0.04, 0.06);
  }

  /**
   * iMessage "received" pop — short descending double-tone.
   */
  function playReceived() {
    const ac  = _getCtx();
    const now = ac.currentTime;

    _tone(now,        1046, 0.08, 0.22, 'sine');   // C6
    _tone(now + 0.05,  880, 0.10, 0.18, 'sine');   // A5
  }

  // Public API
  return {
    playKeyboardClick,
    playKeystrokeLoop,
    playSent,
    playReceived,
  };

})();
