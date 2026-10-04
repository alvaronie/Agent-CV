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
//   transcript    ─▶ turns[]                         (subtitles, in memory only)
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
import { verifyStreamToken } from '../security/streamToken.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const GREETING =
  'Greet in English, briefly and warmly. Introduce yourself as the CV owner\'s voice ' +
  'assistant, and mention the call may be recorded and transcribed. Also let the caller ' +
  'know you can continue in other languages, such as Spanish, if they prefer. Then ask ' +
  'how you can help. Keep it to one or two short sentences. If the caller replies in ' +
  'another language, switch to it for the rest of the call.';

// Margin (ms) before hanging up after end_call, so the already-emitted goodbye can play.
const HANGUP_DELAY_MS = 2000;

// Max time (ms) to wait for an authorized `start` event after the WebSocket opens.
const START_TIMEOUT_MS = 5000;

export function handleMediaStream(twilioWs) {
  let streamSid = null;
  let callSid = null;
  let closing = false;
  let closed = false;
  let authorized = false;
  let counted = false; // have we counted this call in the limiter?

  // State for the summary (Phase 5). `turns` only exists in memory: see note D11.
  let callerNumber = '';
  let startedAt = null;
  let turns = [];
  let finalized = false;

  // Created only after the token verifies.
  let realtime = null;
  let guard = null;
  let maxTimer = null;

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

  // Orderly call teardown: hang up on Twilio (if there is a client and callSid) and
  // close the WebSocket. Idempotent thanks to `closing`.
  function endCall() {
    if (closing) return;
    closing = true;
    setTimeout(async () => {
      try {
        if (twilioClient && callSid) {
          await twilioClient.calls(callSid).update({ status: 'completed' });
          logger.info(`[media] call ${callSid} hung up by end_call`);
        }
      } catch (err) {
        logger.error('[media] error hanging up the call:', err.message);
      } finally {
        safeClose();
      }
    }, HANGUP_DELAY_MS);
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

    // Take the turns and clear the state immediately: from here on the transcript only
    // lives as an argument to reportCall.
    const callTurns = turns;
    turns = [];

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

    // Silence and max-caller-turns guard. Closing the Twilio WebSocket ends the call
    // (the <Connect><Stream> completes) and triggers the summary.
    guard = createCallGuard({
      silenceMs: config.silenceTimeoutSeconds * 1000,
      maxCallerTurns: config.maxCallerTurns,
      onSilence() {
        logger.warn('[media] prolonged silence; closing the call');
        safeClose();
      },
      onMaxTurns() {
        logger.warn('[media] max turns reached; closing the call');
        safeClose();
      },
    });

    realtime = connectRealtime({
      instructions,
      tools: toolDefinitions,
      greeting: GREETING,
      handlers: {
        onAudioDelta(base64) {
          // Model voice -> Twilio (towards the caller).
          guard.activity();
          if (streamSid) {
            twilioWs.send(
              JSON.stringify({ event: 'media', streamSid, media: { payload: base64 } })
            );
          }
        },
        onSpeechStarted() {
          // The user interrupts: flush the audio queued in Twilio (barge-in).
          guard.activity();
          if (streamSid) {
            twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
          }
        },
        onTranscript(role, text) {
          // Subtitle of a turn (caller or agent). In memory only, and we do not dump it
          // into the logs: it is third-party personal content.
          turns.push({ role, text });
          guard.activity();
          if (role === 'caller') guard.countCallerTurn();
        },
        onClose() {
          // OpenAI dropped and retries were exhausted: close the call so we don't leave
          // dead air. Closing the Twilio WebSocket triggers the summary.
          logger.warn('[media] OpenAI unavailable; closing the call');
          safeClose();
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

    // Cost guardrail: close the call when the maximum duration is exceeded.
    maxTimer = setTimeout(() => {
      logger.warn(`[media] max duration (${config.maxCallSeconds}s) reached, closing`);
      safeClose();
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
        // Caller audio -> model (dropped until the AI session is up).
        if (authorized) realtime?.sendAudio(msg.media.payload);
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
