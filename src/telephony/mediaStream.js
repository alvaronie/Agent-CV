// Audio bridge between Twilio Media Streams and OpenAI Realtime.
//
// Twilio opens a WebSocket with us and sends the call audio in JSON messages (events:
// start, media, stop). The audio is base64, G.711 μ-law 8kHz format. Since we configure
// OpenAI with audio/pcmu (the same format), we forward the audio in both directions
// WITHOUT re-encoding.
//
// Flow:
//   start event   ─▶ verify token, then connect to OpenAI   (auth gate, Phase 6)
//   Twilio media  ─▶ realtime.sendAudio()            (caller audio -> model)
//   OpenAI delta  ─▶ twilio { event:'media', ... }   (model voice -> call)
//   barge-in      ─▶ twilio { event:'clear', ... }   (the user interrupts)
//   function call ─▶ dispatchToolCall(...)           (tools: transfer/contact/end)
//   transcript    ─▶ transcriptLog (conversation order, in memory only)
//   limit reached ─▶ spoken farewell with the reason ─▶ Twilio mark ─▶ hang up
//   on hangup     ─▶ summary (LLM) -> email -> record   (Phase 5)
//
// AUTH (Phase 6): Twilio's <Stream> url does not support query strings, so the signed
// token arrives as a Custom Parameter in the `start` event. Nothing is sent to OpenAI
// until that token verifies; a connection that doesn't present a valid `start` within
// START_TIMEOUT_MS is closed.
//
// PRIVACY (D11): the transcript lives only in memory during the call. It is used to
// generate the summary and discarded when the call ends; it is never written to disk.

import { connectRealtime } from '../realtime/openaiRealtime.js';
import { buildInstructions } from '../agent/prompt.js';
import { toolDefinitions, dispatchToolCall } from '../agent/tools/index.js';
import { twilioClient } from './twilioClient.js';
import { reportCall } from '../services/callReport.js';
import { registerCallStart, registerCallEnd } from './callLimiter.js';
import { createCallGuard } from './callGuard.js';
import { createFarewell, FAREWELL_TAG } from './farewell.js';
import { createTranscriptLog } from './transcriptLog.js';
import { verifyStreamToken } from '../security/streamToken.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export const GREETING =
  'Greet in English, briefly and warmly. Introduce yourself as Álvaro Nieto\'s voice ' +
  'assistant (say his first name and first surname, "Álvaro Nieto"), and mention the ' +
  'call may be recorded and transcribed. Also let the caller know you can continue in ' +
  'other languages, such as Spanish, if they prefer. Then ask how you can help. Keep it ' +
  'to one or two short sentences. If the caller replies in another language, switch to ' +
  'it for the rest of the call.';

// Margin (ms) before hanging up after end_call, so the already-emitted goodbye can play.
const HANGUP_DELAY_MS = 2000;

// Max time (ms) to wait for an authorized `start` event after the WebSocket opens.
const START_TIMEOUT_MS = 5000;

// Max time (ms) for the limit-triggered farewell to play before hanging up anyway.
const FAREWELL_TIMEOUT_MS = 15000;

export function handleMediaStream(twilioWs) {
  let streamSid = null;
  let callSid = null;
  let closing = false;
  let closed = false;
  let authorized = false;
  let counted = false; // have we counted this call in the limiter?

  // State for the summary (Phase 5). The transcript only exists in memory: see note D11.
  let callerNumber = '';
  let startedAt = null;
  const transcript = createTranscriptLog();
  let finalized = false;

  // Created only after the token verifies.
  let realtime = null;
  let guard = null;
  let maxTimer = null;

  // End-of-answer marks: only the latest one means "the agent has finished speaking".
  let agentMarkSeq = 0;
  let pendingAgentMark = null;

  function safeClose(code, reason) {
    try {
      twilioWs.close(code, reason);
    } catch {
      /* noop */
    }
  }

  // Unauthenticated connections never reach OpenAI: close if no valid `start` arrives.
  const startTimer = setTimeout(() => {
    if (!authorized) {
      logger.warn('[media] no authorized start event in time; closing');
      safeClose(1008, 'unauthorized');
    }
  }, START_TIMEOUT_MS);

  // Hangs up on Twilio (if there is a client and callSid) and closes the WebSocket.
  // Idempotent thanks to `closing`.
  function hangUp() {
    if (closing) return;
    closing = true;
    (async () => {
      try {
        if (twilioClient && callSid) {
          await twilioClient.calls(callSid).update({ status: 'completed' });
          logger.info(`[media] call ${callSid} hung up`);
        }
      } catch (err) {
        logger.error('[media] error hanging up the call:', err.message);
      } finally {
        safeClose();
      }
    })();
  }

  // end_call tool: the agent has already said goodbye; leave a margin for it to play.
  let hangupScheduled = false;
  function endCall() {
    if (closing || hangupScheduled) return;
    hangupScheduled = true;
    setTimeout(hangUp, HANGUP_DELAY_MS);
  }

  // Limit-triggered farewell (max duration, silence, max turns): the agent explains why
  // it is hanging up, and we hang up once Twilio confirms the audio has played.
  const farewell = createFarewell({
    say: (instructions, tag) => realtime?.say(instructions, tag) ?? false,
    sendToTwilio: (msg) => {
      if (streamSid) twilioWs.send(JSON.stringify({ ...msg, streamSid }));
    },
    hangUp,
    timeoutMs: FAREWELL_TIMEOUT_MS,
  });

  function endWithFarewell(reason) {
    if (closing || !farewell.begin(reason)) return;
    logger.warn(`[media] limit reached (${reason}); saying goodbye before hanging up`);
    guard?.stop();
    clearTimeout(maxTimer);
  }

  // Business-level call teardown: summarize, notify by email and record. Runs exactly
  // once (`finalized`), whatever the cause of the close: the agent said goodbye, the
  // caller hung up, or MAX_CALL_SECONDS elapsed.
  async function finalizeCall() {
    if (finalized) return;
    finalized = true;

    const endedAt = new Date();
    const durationSeconds = startedAt
      ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
      : null;

    // Take the turns (in conversation order) and clear the state immediately: from here
    // on the transcript only lives as an argument to reportCall.
    const callTurns = transcript.toTurns();
    transcript.clear();

    await reportCall({
      turns: callTurns,
      callSid,
      from: callerNumber,
      startedAt: startedAt?.toISOString() ?? null,
      endedAt: endedAt.toISOString(),
      durationSeconds,
    });
  }

  // Starts the AI side of the call. Only called after the token has verified.
  async function startSession() {
    const instructions = await buildInstructions();
    if (closed) return; // the caller hung up while we were loading the prompt

    // Silence and max-caller-turns guard: both end the call with a spoken farewell.
    guard = createCallGuard({
      silenceMs: config.silenceTimeoutSeconds * 1000,
      maxCallerTurns: config.maxCallerTurns,
      onSilence() {
        endWithFarewell('silence');
      },
      onMaxTurns() {
        endWithFarewell('max_turns');
      },
    });

    realtime = connectRealtime({
      instructions,
      tools: toolDefinitions,
      greeting: GREETING,
      handlers: {
        onAudioDelta(base64) {
          // Model voice -> Twilio (towards the caller). New audio means the agent is
          // speaking again, so any earlier end-of-turn mark is no longer the last one.
          guard.agentAudio();
          pendingAgentMark = null;
          if (streamSid) {
            twilioWs.send(
              JSON.stringify({ event: 'media', streamSid, media: { payload: base64 } })
            );
          }
        },
        onSpeechStarted() {
          // The user interrupts: flush the audio queued in Twilio (barge-in).
          guard.callerSpeechStarted();
          if (streamSid) {
            twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
          }
        },
        onSpeechStopped() {
          guard.callerSpeechStopped();
        },
        onItemOrder(itemId, role) {
          // A conversation item was created: reserve its place so late transcripts land
          // in the order people actually spoke.
          transcript.reserve(itemId, role);
        },
        onTranscript(role, text, itemId) {
          // Subtitle of a turn (caller or agent). In memory only, and we do not dump it
          // into the logs: it is third-party personal content. Transcripts arrive late
          // and say nothing about who is speaking now, so they don't touch the silence
          // timer; they only count caller turns.
          transcript.add(role, text, itemId);
          if (role === 'caller' && text?.trim()) guard.countCallerTurn();
        },
        onClose() {
          // OpenAI dropped and retries were exhausted: close the call so we don't leave
          // dead air (no farewell possible: the model is gone).
          logger.warn('[media] OpenAI unavailable; closing the call');
          safeClose();
        },
        onResponseDone(response, tag) {
          farewell.onResponseDone(response, tag);
          if (tag === FAREWELL_TAG) return; // the farewell places its own mark
          // Mark the end of this answer's audio: Twilio echoes it once playback is done,
          // and only then does the silence countdown start.
          if (!streamSid) {
            guard.agentDone();
            return;
          }
          agentMarkSeq += 1;
          pendingAgentMark = `agent-turn-${agentMarkSeq}`;
          twilioWs.send(
            JSON.stringify({ event: 'mark', streamSid, mark: { name: pendingAgentMark } })
          );
        },
        async onFunctionCall(event) {
          // The model wants to run a tool. We run it and return the result.
          const ctx = { callSid, streamSid, twilioWs, realtime, endCall };
          try {
            const { output, triggerResponse } = await dispatchToolCall(event, ctx);
            realtime.sendFunctionResult(event.call_id, output, { triggerResponse });
          } catch (err) {
            logger.error('[media] error running tool:', err.message);
            realtime.sendFunctionResult(
              event.call_id,
              'The tool failed due to a technical issue.',
              { triggerResponse: true }
            );
          }
        },
      },
    });

    // Cost guardrail: at the maximum duration, say goodbye (with the reason) and hang up.
    // The farewell has its own fallback timer, so the call can't outlive this by much.
    maxTimer = setTimeout(() => {
      endWithFarewell('max_duration');
    }, config.maxCallSeconds * 1000);

    guard.start();
  }

  twilioWs.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      case 'start': {
        if (authorized) break; // ignore duplicates
        const params = msg.start?.customParameters || {};
        const result = verifyStreamToken(params.token);
        if (!result.valid) {
          logger.warn(`[media] stream rejected (token ${result.reason})`);
          safeClose(1008, 'unauthorized');
          break;
        }
        authorized = true;
        clearTimeout(startTimer);

        streamSid = msg.start?.streamSid;
        callSid = msg.start?.callSid;
        callerNumber = params.from || '';
        startedAt = new Date();
        registerCallStart();
        counted = true;
        logger.info(`[media] stream started (streamSid=${streamSid}, callSid=${callSid})`);

        startSession().catch((err) => {
          logger.error('[media] could not start the AI session:', err.message);
          safeClose();
        });
        break;
      }
      case 'media':
        // Caller audio -> model. Dropped until the AI session is up, and during the
        // farewell (so the caller can't interrupt it or trigger a new answer).
        if (authorized && !farewell.isEnding()) realtime?.sendAudio(msg.media.payload);
        break;
      case 'mark':
        // Twilio confirms that audio queued before one of our marks has finished playing.
        farewell.onMark(msg.mark?.name);
        if (pendingAgentMark && msg.mark?.name === pendingAgentMark) {
          pendingAgentMark = null;
          guard?.agentDone();
        }
        break;
      case 'stop':
        logger.info('[media] stream stopped by Twilio');
        break;
      default:
        break;
    }
  });

  twilioWs.on('close', () => {
    closed = true;
    clearTimeout(startTimer);
    clearTimeout(maxTimer);
    farewell.stop();
    guard?.stop();
    realtime?.close();
    if (counted) {
      registerCallEnd();
      counted = false;
    }
    logger.info('[media] Twilio connection closed');

    // Unauthorized connections are not calls: nothing to summarize or record.
    if (!authorized) return;

    // Summary + email + record. We don't await here (the callback is synchronous), but
    // we catch any failure so no promise is left unhandled.
    finalizeCall().catch((err) =>
      logger.error('[media] error during call teardown:', err.message)
    );
  });

  twilioWs.on('error', (err) => {
    logger.error('[media] Twilio websocket error:', err.message);
  });
}
