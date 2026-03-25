/**
 * parser.js
 *
 * Parses the bracket-notation conversation script into a flat timeline
 * of events that the renderer can execute in order.
 *
 * Input format (one token per line, whitespace-flexible):
 *   A: message text   → sender bubble  (blue, right)
 *   B: message text   → receiver bubble (gray, left)
 *
 * Bracket tokens (inline or standalone):
 *   [d:2]             → delay 2 s        (s suffix optional)
 *   [t:3]             → typing 3 s       (s suffix optional)
 *   [d:2,t:3]         → delay 2 s + typing 3 s (either key may be omitted)
 *
 * Legacy syntax (still supported):
 *   [2s]              → delay 2 s
 *   [typing:3s]       → typing 3 s
 *
 * Output — array of event objects (in chronological order):
 *
 *   { type: 'message', speaker: 'A'|'B', text: string }
 *   { type: 'delay',   duration: number }   // seconds
 *   { type: 'typing',  speaker: 'A'|'B', duration: number }
 */

const Parser = (() => {

  // Regex patterns
  const RE_MESSAGE = /^([AB]):\s*(.+)/;
  const RE_DELAY   = /\[(\d+(?:\.\d+)?)s\]/g;
  const RE_TYPING  = /\[typing:(\d+(?:\.\d+)?)s\]/g;

  // New unified syntax: [d:N] [t:N] [d:N,t:N] [t:N,d:N] — 's' suffix optional
  const RE_UNIFIED = /\[[dt]:\d+(?:\.\d+)?s?(?:,\s*[dt]:\d+(?:\.\d+)?s?)?\]/g;

  /**
   * Parse a unified token's content (e.g. "d:2,t:3s") into {d, t} numbers.
   * Unknown or absent keys are null.
   */
  function _parseUnifiedToken(raw) {
    // raw is the full bracket, e.g. "[d:2,t:3s]"
    const inner = raw.slice(1, -1); // strip [ ]
    const result = { d: null, t: null };
    for (const part of inner.split(',')) {
      const m = part.trim().match(/^([dt]):(\d+(?:\.\d+)?)s?$/);
      if (m) result[m[1]] = parseFloat(m[2]);
    }
    return result;
  }

  /**
   * Parse raw script text → array of event objects.
   * @param {string} script
   * @returns {Array<Object>}
   */
  function parse(script) {
    const events = [];

    // Split into lines; filter blanks and comments (#)
    const lines = script
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));

    for (const line of lines) {
      _parseLine(line, events);
    }

    return events;
  }

  /**
   * Parse a single line and push events into the array.
   * A line may contain a message and inline bracket tokens.
   */
  function _parseLine(line, events) {
    const msgMatch = line.match(RE_MESSAGE);

    if (msgMatch) {
      const speaker = msgMatch[1];          // 'A' or 'B'
      const rest    = msgMatch[2];          // everything after "A: "

      // Strip timing bracket tokens to get the clean message text.
      // [emoji:name] tags are intentionally preserved — none of the regexes
      // below match them, so they pass through as literal text for the renderer.
      const text = rest
        .replace(/\[typing:\d+(?:\.\d+)?s\]/g, '')
        .replace(/\[\d+(?:\.\d+)?s\]/g, '')
        .replace(/\[[dt]:\d+(?:\.\d+)?s?(?:,\s*[dt]:\d+(?:\.\d+)?s?)?\]/g, '')
        .replace(/\s+/g, ' ')   // collapse any double-spaces left by stripping
        .trim();

      // ── Typing events (appear before the message) ──

      // Legacy [typing:Ns]
      RE_TYPING.lastIndex = 0;
      const typingMatch = RE_TYPING.exec(rest);
      if (typingMatch) {
        events.push({ type: 'typing', speaker, duration: parseFloat(typingMatch[1]) });
      }

      // Unified [t:N] / [d:N,t:N]
      RE_UNIFIED.lastIndex = 0;
      let uMatch;
      while ((uMatch = RE_UNIFIED.exec(rest)) !== null) {
        const { t } = _parseUnifiedToken(uMatch[0]);
        if (t !== null) {
          events.push({ type: 'typing', speaker, duration: t });
        }
      }

      if (text) {
        events.push({ type: 'message', speaker, text });
      }

      // ── Delay events (appear after the message) ──

      // Legacy [Ns]
      RE_DELAY.lastIndex = 0;
      let delayMatch;
      while ((delayMatch = RE_DELAY.exec(rest)) !== null) {
        if (!delayMatch[0].includes('typing')) {
          events.push({ type: 'delay', duration: parseFloat(delayMatch[1]) });
        }
      }

      // Unified [d:N] / [d:N,t:N]
      RE_UNIFIED.lastIndex = 0;
      while ((uMatch = RE_UNIFIED.exec(rest)) !== null) {
        const { d } = _parseUnifiedToken(uMatch[0]);
        if (d !== null) {
          events.push({ type: 'delay', duration: d });
        }
      }

    } else {
      // Line has no message — look for bare delay/typing tokens
      _parseTokensOnly(line, events, null);
    }
  }

  /**
   * Parse a line that contains only bracket tokens (no A:/B: prefix).
   */
  function _parseTokensOnly(line, events, speaker) {
    RE_TYPING.lastIndex = 0;
    let m;
    while ((m = RE_TYPING.exec(line)) !== null) {
      events.push({ type: 'typing', speaker: speaker || 'B', duration: parseFloat(m[1]) });
    }

    RE_DELAY.lastIndex = 0;
    while ((m = RE_DELAY.exec(line)) !== null) {
      if (!m[0].includes('typing')) {
        events.push({ type: 'delay', duration: parseFloat(m[1]) });
      }
    }

    // Unified [d:N] / [t:N] / [d:N,t:N]
    RE_UNIFIED.lastIndex = 0;
    while ((m = RE_UNIFIED.exec(line)) !== null) {
      const { d, t } = _parseUnifiedToken(m[0]);
      if (t !== null) {
        events.push({ type: 'typing', speaker: speaker || 'B', duration: t });
      }
      if (d !== null) {
        events.push({ type: 'delay', duration: d });
      }
    }
  }

  /**
   * Convert the event list into a timeline where each event has an
   * absolute start time (in seconds from t=0).
   *
   * Duration rules:
   *   message  → instant (0 s display time; sound plays, bubble appears)
   *   delay    → hold for duration seconds
   *   typing   → show dots for duration seconds, then continue
   *
   * @param {Array<Object>} events
   * @returns {Array<Object>}  same events with { startTime, endTime } added
   */
  function buildTimeline(events) {
    let t = 0;
    return events.map(ev => {
      const startTime = t;
      let dur = 0;

      if (ev.type === 'delay' || ev.type === 'typing') {
        dur = ev.duration;
      }
      // messages are instant — sound will have its own short animation

      t += dur;
      return { ...ev, startTime, endTime: t };
    });
  }

  /**
   * Convenience: parse + build timeline in one call.
   * @param {string} script
   * @returns {Array<Object>}
   */
  function parseScript(script) {
    const events = parse(script);
    return buildTimeline(events);
  }

  // Public API
  return { parse, buildTimeline, parseScript };

})();
