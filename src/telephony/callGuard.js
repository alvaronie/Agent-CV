// Call guard (Phase 6): two cost/UX guardrails during the conversation.
//
//   - Silence timeout: if there is NO activity at all (neither caller speech nor agent
//     voice) for `silenceMs`, the call is considered dead and is closed.
//   - Max caller turns: if the conversation drags on without progress, it is closed
//     once `maxCallerTurns` is exceeded.
//
// The logic is isolated here, with INJECTABLE timers (setTimer/clearTimer), so it can be
// tested without opening WebSockets or waiting in real time. `0` in either limit
// disables it.

/**
 * @param {object} opts
 * @param {number} opts.silenceMs - ms of inactivity before closing (0 = disabled)
 * @param {number} opts.maxCallerTurns - maximum caller turns (0 = disabled)
 * @param {() => void} [opts.onSilence] - invoked when the silence timeout fires
 * @param {() => void} [opts.onMaxTurns] - invoked when the max turns is exceeded
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

  function armSilence() {
    if (stopped || !silenceMs || silenceMs <= 0) return;
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      if (!stopped) onSilence?.();
    }, silenceMs);
  }

  return {
    /** Starts the guard (arms the silence timer). */
    start() {
      armSilence();
    },
    /** Marks activity (anyone speaking / agent audio): resets the silence timer. */
    activity() {
      armSilence();
    },
    /**
     * Counts a caller turn. Returns true (and notifies) if the maximum is exceeded.
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
      if (timer) clearTimer(timer);
      timer = null;
    },
    _state() {
      return { callerTurns, armed: timer !== null, stopped };
    },
  };
}
