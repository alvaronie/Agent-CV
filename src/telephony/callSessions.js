// Per-call state that must survive the Media Streams WebSocket closing.
//
// A transfer replaces the <Connect><Stream> with a <Dial>, so Twilio closes our
// WebSocket — but the CALL is not over: if Álvaro doesn't pick up, /transfer-status
// reconnects a new stream and the conversation continues. The transcript, caller data
// and limiter slot therefore live here, keyed by callSid (the same SID for every leg of
// one inbound call), and the summary email is sent ONCE, when the call really ends.
//
// PRIVACY (D11): in memory only; dropped as soon as the call is summarized.

import { reportCall as defaultReportCall } from '../services/callReport.js';
import {
  registerCallStart as defaultRegisterStart,
  registerCallEnd as defaultRegisterEnd,
} from './callLimiter.js';
import { createTranscriptLog } from './transcriptLog.js';
import { logger } from '../utils/logger.js';

// Safety net: if Twilio never calls /transfer-status, summarize anyway after this long.
const TRANSFER_GRACE_MS = 60 * 60 * 1000;

// Spanish on purpose: these lines go into the transcript of the (Spanish) summary email.
const TRANSFER_OUTCOME = {
  completed: 'Se transfirió la llamada a Álvaro y hablaron directamente.',
  answered: 'Se transfirió la llamada a Álvaro y hablaron directamente.',
  'no-answer': 'Se intentó transferir la llamada a Álvaro, pero no contestó.',
  busy: 'Se intentó transferir la llamada a Álvaro, pero estaba comunicando o rechazó la llamada.',
  failed: 'Se intentó transferir la llamada a Álvaro, pero la llamada no pudo establecerse.',
  canceled: 'Se intentó transferir la llamada a Álvaro, pero se canceló antes de que contestara.',
};

export function transferOutcomeText(dialCallStatus) {
  return (
    TRANSFER_OUTCOME[dialCallStatus] ||
    'Se intentó transferir la llamada a Álvaro, pero no fue posible contactar con él.'
  );
}

export function createCallSessions({
  reportCall = defaultReportCall,
  registerCallStart = defaultRegisterStart,
  registerCallEnd = defaultRegisterEnd,
  graceMs = TRANSFER_GRACE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const sessions = new Map();

  async function finalize(callSid, now = new Date()) {
    const s = sessions.get(callSid);
    if (!s) return; // already summarized (idempotent)
    sessions.delete(callSid);
    if (s.graceTimer) clearTimer(s.graceTimer);
    registerCallEnd();

    // Take the turns and drop them right away: from here on the transcript only lives
    // as an argument to reportCall.
    const turns = s.transcript.toTurns();
    s.transcript.clear();

    await reportCall({
      turns,
      callSid,
      from: s.from,
      startedAt: s.startedAt.toISOString(),
      endedAt: now.toISOString(),
      durationSeconds: Math.round((now.getTime() - s.startedAt.getTime()) / 1000),
    });
  }

  function finalizeLater(callSid) {
    finalize(callSid).catch((err) =>
      logger.error('[sessions] error during call teardown:', err.message)
    );
  }

  return {
    get(callSid) {
      return sessions.get(callSid) || null;
    },

    /**
     * Starts a stream leg. Creates the session on the first leg (counting the call once)
     * or returns the existing one when the call resumes after a transfer attempt.
     */
    begin(callSid, { from = '', now = new Date() } = {}) {
      const existing = sessions.get(callSid);
      if (existing) {
        if (existing.graceTimer) clearTimer(existing.graceTimer);
        existing.graceTimer = null;
        existing.state = 'active';
        return { session: existing, resumed: true };
      }
      registerCallStart(now);
      const session = {
        callSid,
        from,
        startedAt: now,
        transcript: createTranscriptLog(),
        callerTurns: 0,
        state: 'active',
        graceTimer: null,
      };
      sessions.set(callSid, session);
      return { session, resumed: false };
    },

    /** The agent is about to transfer: the next stream close is not the end of the call. */
    markTransferring(callSid) {
      const s = sessions.get(callSid);
      if (s) s.state = 'transferring';
    },

    /** The transfer request itself failed: the call stays with the agent. */
    cancelTransfer(callSid) {
      const s = sessions.get(callSid);
      if (s && s.state === 'transferring') s.state = 'active';
    },

    /** A stream leg closed. Summarizes unless the call is now ringing Álvaro. */
    legClosed(callSid) {
      const s = sessions.get(callSid);
      if (!s) return;
      if (s.state === 'transferring') {
        if (!s.graceTimer) s.graceTimer = setTimer(() => finalizeLater(callSid), graceMs);
        return;
      }
      finalizeLater(callSid);
    },

    /** Notes the transfer result in the transcript (it ends up in the summary). */
    recordTransferOutcome(callSid, dialCallStatus) {
      sessions.get(callSid)?.transcript.add('event', transferOutcomeText(dialCallStatus));
    },

    finalize,
    finalizeLater,
    _size: () => sessions.size,
  };
}

// Shared instance used by the server.
export const callSessions = createCallSessions();
