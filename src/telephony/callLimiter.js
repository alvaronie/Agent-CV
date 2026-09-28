// Call admission limiter (Phase 6): cost guardrail.
//
// Tracks:
//   - ACTIVE calls at once (concurrency), and
//   - calls accepted during the day (resets at midnight UTC).
//
// It is consulted in the /incoming-call webhook BEFORE accepting the call (so we reject
// without opening the WebSocket or connecting to OpenAI). The active count goes up when
// the stream starts and down when it closes. A value of 0 in the config means "no limit".
//
// State lives in the process memory: enough for a single-instance deployment (our case).
// With multiple instances a shared counter would be needed.

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let activeCalls = 0;
let callsToday = 0;
let dayKey = todayKey();

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD in UTC
}

function rolloverIfNeeded(now) {
  const key = todayKey(now);
  if (key !== dayKey) {
    dayKey = key;
    callsToday = 0;
  }
}

/**
 * Can we accept a new call right now?
 * @param {Date} [now]
 * @returns {{ok: boolean, reason?: 'concurrency'|'daily'}}
 */
export function canAcceptCall(now = new Date()) {
  rolloverIfNeeded(now);
  const { maxConcurrentCalls, maxCallsPerDay } = config.limits;

  if (maxConcurrentCalls > 0 && activeCalls >= maxConcurrentCalls) {
    return { ok: false, reason: 'concurrency' };
  }
  if (maxCallsPerDay > 0 && callsToday >= maxCallsPerDay) {
    return { ok: false, reason: 'daily' };
  }
  return { ok: true };
}

/** Registers the start of a call (increments concurrency and the daily count). */
export function registerCallStart(now = new Date()) {
  rolloverIfNeeded(now);
  activeCalls += 1;
  callsToday += 1;
  logger.info(`[limiter] call started (active=${activeCalls}, today=${callsToday})`);
}

/** Registers the end of a call (decrements concurrency). */
export function registerCallEnd() {
  if (activeCalls > 0) activeCalls -= 1;
  logger.info(`[limiter] call ended (active=${activeCalls})`);
}

// --- Test helpers (do not use in production) ---
export function _reset() {
  activeCalls = 0;
  callsToday = 0;
  dayKey = todayKey();
}
export function _snapshot() {
  return { activeCalls, callsToday, dayKey };
}
