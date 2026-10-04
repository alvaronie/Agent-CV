// Call guard (Phase 6): two cost/UX guardrails during the conversation.
//
//   - Silence timeout: fires after `silenceMs` during which NOBODY is speaking — neither
//     the caller nor the agent. The countdown only runs while both are quiet, and starts
//     from scratch every time both go quiet again.
//   - Max caller turns: if the conversation drags on without progress, it is closed
//     once `maxCallerTurns` is reached.
//
// Why "speaking" is tracked explicitly: OpenAI streams the agent's audio much faster than
// real time (a 20 s answer arrives in a couple of seconds), so "last audio received" is
// NOT "agent finished talking". The bridge reports agentAudio() when audio is queued and
// agentDone() when Twilio confirms that playback actually finished (Media Streams mark).
//
// The logic is isolated here, with INJECTABLE timers (setTimer/clearTimer), so it can be
// tested without opening WebSockets or waiting in real time. `0` in either limit
// disables it.

/**
 * @param {object} opts
 * @param {number} opts.silenceMs - ms of mutual silence before firing (0 = disabled)
 * @param {number} opts.maxCallerTurns - maximum caller turns (0 = disabled)
 * @param {() => void} [opts.onSilence] - invoked when the silence timeout fires
 * @param {() => void} [opts.onMaxTurns] - invoked when the max turns is reached
 * @param {typeof setTimeout} [opts.setTimer]
 * @param {typeof clearTimeout} [opts.clearTimer]
 */
export function createCallGuard({
  silenceMs,
  maxCallerTurns,
  onSilence,
  onMaxTurns,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let callerTurns = 0;
  let stopped = false;
  let started = false;
  let callerSpeaking = false;
  let agentSpeaking = false;

  function disarm() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  // Re-evaluates the timer: running (from zero) only while both parties are quiet.
  function update({ restart = false } = {}) {
    const quiet = started && !stopped && !callerSpeaking && !agentSpeaking;
    if (!quiet || !silenceMs || silenceMs <= 0) {
      disarm();
      return;
    }
    if (timer && !restart) return; // already counting this quiet period
    disarm();
    timer = setTimer(() => {
      timer = null;
      if (!stopped) onSilence?.();
    }, silenceMs);
  }

  return {
    /** Starts the guard: nobody is speaking yet, so the countdown begins. */
    start() {
      started = true;
      update({ restart: true });
    },
    /** The caller started talking (server VAD speech_started). */
    callerSpeechStarted() {
      callerSpeaking = true;
      update();
    },
    /** The caller stopped talking (server VAD speech_stopped). */
    callerSpeechStopped() {
      callerSpeaking = false;
      update({ restart: true });
    },
    /** Agent audio was queued for playback: the agent is (about to be) speaking. */
    agentAudio() {
      agentSpeaking = true;
      update();
    },
    /** Twilio confirmed that all queued agent audio has finished playing. */
    agentDone() {
      agentSpeaking = false;
      update({ restart: true });
    },
    /**
     * Counts a caller turn. Returns true (and notifies) if the maximum is reached.
     * @returns {boolean}
     */
    countCallerTurn() {
      callerTurns += 1;
      if (maxCallerTurns > 0 && callerTurns >= maxCallerTurns) {
        onMaxTurns?.();
        return true;
      }
      return false;
    },
    /** Stops the guard: no more triggers or timers. */
    stop() {
      stopped = true;
      disarm();
    },
    _state() {
      return { callerTurns, armed: timer !== null, stopped, callerSpeaking, agentSpeaking };
    },
  };
}
