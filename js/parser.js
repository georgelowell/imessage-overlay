/**
 * parser.js
 *
 * Parses the bracket-notation conversation script into a flat timeline
 * of events that the renderer can execute in order.
 *
 * Input format (one token per line, whitespace-flexible):
 *   A: message text   → sender bubble  (blue, right)
 *   B: message text   → receiver bubble (gray, left)
 *   [2s]              → wait 2 seconds before next event
 *   [typing:3s]       → show typing indicator for 3 seconds, then next event
 *
 * Tokens on the same line are processed left-to-right, so:
 *   A: Hey! [2s]
 * means: show "Hey!" bubble, then wait 2 s before the next line's event.
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

      // Strip all bracket tokens to get the clean message text
      const text = rest
        .replace(/\[typing:\d+(?:\.\d+)?s\]/g, '')
        .replace(/\[\d+(?:\.\d+)?s\]/g, '')
        .replace(/\s+/g, ' ')   // collapse any double-spaces left by stripping
        .trim();

      // Determine if there is a typing indicator preceding this message
      // Reset lastIndex before exec loop
      RE_TYPING.lastIndex = 0;
      const typingMatch = RE_TYPING.exec(rest);
      if (typingMatch) {
        events.push({
          type:     'typing',
          speaker,
          duration: parseFloat(typingMatch[1]),
        });
      }

      if (text) {
        events.push({ type: 'message', speaker, text });
      }

      // Collect any plain delay tokens (non-typing) after the message
      RE_DELAY.lastIndex = 0;
      let delayMatch;
      while ((delayMatch = RE_DELAY.exec(rest)) !== null) {
        // Make sure this match isn't inside a [typing:…] bracket
        const raw = delayMatch[0];
        if (!raw.includes('typing')) {
          events.push({
            type:     'delay',
            duration: parseFloat(delayMatch[1]),
          });
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
      events.push({
        type:     'typing',
        speaker:  speaker || 'B',
        duration: parseFloat(m[1]),
      });
    }

    RE_DELAY.lastIndex = 0;
    while ((m = RE_DELAY.exec(line)) !== null) {
      if (!m[0].includes('typing')) {
        events.push({
          type:     'delay',
          duration: parseFloat(m[1]),
        });
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
