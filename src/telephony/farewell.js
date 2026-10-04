// Spoken farewell before a limit-triggered hangup (max duration, silence, max turns).
//
// Instead of cutting the call dead, we ask the model to say goodbye and explain why, and
// hang up once Twilio confirms that audio has finished playing:
//
//   begin(reason) ─▶ clear queued audio ─▶ say(farewell instructions, FAREWELL_TAG)
//   tagged response.done (completed) ─▶ send a Twilio `mark` after the farewell audio
//   Twilio echoes the `mark` when playback ends ─▶ hangUp()
//
// A fallback timer hangs up anyway if any of that does not happen (OpenAI down, response
// failed, mark never returned). Dependencies and timers are injected so this is unit
// testable without WebSockets.

export const FAREWELL_TAG = 'farewell';
export const FAREWELL_MARK = 'farewell-done';

// Response-level instructions replace the session instructions for that response, so
// the persona and the language rule are restated here.
const STYLE =
  "Stay in your role as Álvaro's voice assistant. Speak in the same language you have " +
  'been using with the caller (if Spanish, European Spanish from Spain). Keep it to one ' +
  'or two short, warm sentences. Do not ask any questions and do not call any tools.';

export const FAREWELL_INSTRUCTIONS = {
  max_duration:
    'The call has reached its maximum allowed length. Tell the caller that you have to ' +
    'end the call now because the maximum call time has been reached, thank them, and ' +
    `let them know they can call again anytime. ${STYLE}`,
  silence:
    'You have not heard anything from the caller for a while. Tell them that, since you ' +
    "haven't heard from them, you are going to end the call, and that they can call back " +
    `anytime. ${STYLE}`,
  max_turns:
    'The conversation has reached the maximum length allowed for a single call. Tell the ' +
    'caller that you have to end the call for that reason, thank them, and let them know ' +
    `they can call again anytime. ${STYLE}`,
};

/**
 * @param {object} deps
 * @param {(instructions:string, tag:string) => boolean} deps.say - asks the model to speak;
 *   returns false if it cannot (e.g. OpenAI not connected).
 * @param {(msg:object) => void} deps.sendToTwilio - sends a Media Streams message (the
 *   caller adds the streamSid).
 * @param {() => void} deps.hangUp - ends the call.
 * @param {number} [deps.timeoutMs] - fallback before hanging up regardless.
 * @param {typeof setTimeout} [deps.setTimer]
 * @param {typeof clearTimeout} [deps.clearTimer]
 */
export function createFarewell({
  say,
  sendToTwilio,
  hangUp,
  timeoutMs = 15000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let ending = false;
  let done = false;
  let timer = null;

  function finish() {
    if (done) return;
    done = true;
    if (timer) clearTimer(timer);
    timer = null;
    hangUp();
  }

  return {
    /** Starts the farewell. Returns false if one is already in progress. */
    begin(reason) {
      if (ending) return false;
      ending = true;
      sendToTwilio({ event: 'clear' }); // drop any half-played answer
      const instructions = FAREWELL_INSTRUCTIONS[reason];
      if (!instructions || !say(instructions, FAREWELL_TAG)) {
        finish(); // cannot speak: hang up straight away
        return true;
      }
      timer = setTimer(finish, timeoutMs);
      return true;
    },
    /** Realtime `response.done`, with the tag the response was created with (if any). */
    onResponseDone(response, tag) {
      if (!ending || done || tag !== FAREWELL_TAG) return;
      if (response?.status === 'completed') {
        // Twilio echoes this mark once the farewell audio queued before it has played.
        sendToTwilio({ event: 'mark', mark: { name: FAREWELL_MARK } });
      } else {
        finish();
      }
    },
    /** Twilio `mark` message. */
    onMark(name) {
      if (ending && name === FAREWELL_MARK) finish();
    },
    isEnding: () => ending,
    /** Cancels the fallback timer without hanging up (the call already closed). */
    stop() {
      done = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}
