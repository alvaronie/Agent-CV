// OpenAI WebSocket reconnection policy (Phase 6).
//
// Pure function (no network or state): given the number of attempts already made and
// the maximum allowed, decides whether to retry and with how much delay (bounded
// exponential backoff). Isolated here so it can be tested without opening any connection.

/**
 * @param {object} opts
 * @param {number} opts.attempt - reconnection attempts already consumed (0 = none yet)
 * @param {number} opts.maxAttempts - maximum retries allowed
 * @param {number} [opts.baseDelayMs] - base delay
 * @param {number} [opts.maxDelayMs] - maximum delay (backoff cap)
 * @returns {{shouldReconnect: boolean, delayMs: number}}
 */
export function nextReconnect({
  attempt,
  maxAttempts,
  baseDelayMs = 500,
  maxDelayMs = 4000,
}) {
  if (attempt >= maxAttempts) {
    return { shouldReconnect: false, delayMs: 0 };
  }
  const delayMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  return { shouldReconnect: true, delayMs };
}
