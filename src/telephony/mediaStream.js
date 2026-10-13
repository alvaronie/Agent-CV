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
//   OpenAI text   ─▶ ElevenLabs ─▶ twilio media      (VOICE_PROVIDER=elevenlabs)
//   barge-in      ─▶ twilio { event:'clear', ... }   (the user interrupts)
//   function call ─▶ dispatchToolCall(...)           (tools: transfer/contact/end)
//   transcript    ─▶ session transcript (conversation order, in memory only)
//   limit reached ─▶ spoken farewell with the reason ─▶ Twilio mark ─▶ hang up
//   call over     ─▶ summary (LLM) -> email -> record   (Phase 5, once per call)
//
// One call can span several stream "legs": a transfer replaces the stream with a <Dial>,
// and if Álvaro doesn't pick up, /transfer-status reconnects a new stream (`resume`).
// Per-call state lives in callSessions (keyed by callSid), so the resumed leg keeps the
// transcript, the limiter slot and the call clock, and the agent is given what was said
// so far (a new OpenAI session starts with no memory).
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
import { callSessions } from './callSessions.js';
import { isCallableNumber } from './callerNumber.js';
import { createCallGuard } from './callGuard.js';
import { createFarewell, FAREWELL_TAG } from './farewell.js';
import { createLatencyMeter } from './latencyMeter.js';
import { createElevenLabsTts } from '../voice/elevenLabsTts.js';
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

/**
 * What the agent says when the call comes back after Álvaro didn't pick up. These are
 * response-level instructions (they replace the session instructions for this reply),
 * so they restate the persona and the language.
 * @param {{language?:string, callerNumberKnown:boolean}} opts
 */
export function buildResumeGreeting({ language, callerNumberKnown }) {
  const lang =
    language === 'es'
      ? 'Speak in European Spanish from Spain (Castilian accent and vocabulary).'
      : 'Speak in English, unless the caller had been speaking another language.';
  const callback = callerNumberKnown
    ? 'Then ask whether they would like Álvaro to call them back on the same number they ' +
      'are calling from.'
    : 'Their number is not available, so ask for a phone number or an email address so ' +
      'Álvaro can get back to them.';
  return (
    "You are Álvaro Nieto's voice assistant. You just tried to transfer this call to " +
    'Álvaro, but he could not be reached right now. Tell the caller that you could not ' +
    'reach Álvaro at the moment, and that you will let him know by email what you talked ' +
    `about. ${callback} ${lang} Keep it to two or three short sentences. Do not greet ` +
    'again, do not read out any phone number, and do not call any tools in this reply.'
  );
}

const HISTORY_MAX_CHARS = 12000;

/** Session-instruction addendum for a resumed leg: what happened before the transfer. */
export function buildResumeContext(turns, { callerNumberKnown }) {
  const lines = turns
    .map((t) => {
      const who = t.role === 'caller' ? 'Caller' : t.role === 'event' ? 'Event' : 'Agent';
      return `${who}: ${t.text}`;
    })
    .join('\n');
  const history = lines.length > HISTORY_MAX_CHARS ? lines.slice(-HISTORY_MAX_CHARS) : lines;
  const callback = callerNumberKnown
    ? '- If they want a callback on the number they are calling from, call save_contact ' +
      'with use_caller_number=true (do not ask for the number or read it out). If they ' +
      'prefer another phone or an email, take it, read it back and save it.'
    : '- Their number is not available: ask for a phone or email, read it back and save it ' +
      'with save_contact.';
  return [
    '',
    '## This call so far (it resumed after a transfer attempt)',
    'You tried to transfer the call to Álvaro and he did not pick up; you have just told',
    'the caller. Continue the conversation in the same language used so far. Do not greet',
    'again and do not try to transfer again unless the caller explicitly insists.',
    callback,
    '- Then ask whether there is anything else you can help with.',
    '',
    'Conversation before the transfer:',
    history || '(no transcript available)',
  ].join('\n');
}

/** Whether the ElevenLabs voice is selected AND configured (otherwise OpenAI's voice). */
export function isElevenLabsEnabled(cfg = config) {
  return (
    cfg.voiceProvider === 'elevenlabs' && Boolean(cfg.elevenlabs.apiKey && cfg.elevenlabs.voiceId)
  );
}

// Margin (ms) before hanging up after end_call, so the already-emitted goodbye can play.
const HANGUP_DELAY_MS = 2000;

// Max time (ms) to wait for an authorized `start` event after the WebSocket opens.
const START_TIMEOUT_MS = 5000;

// Max time (ms) for the limit-triggered farewell to play before hanging up anyway.
const FAREWELL_TIMEOUT_MS = 15000;

// Minimum time (ms) a resumed leg gets, so a call that resumes near its time limit can
// still deliver the "couldn't reach Álvaro" message and the farewell.
const MIN_RESUMED_LEG_MS = 30000;

export function handleMediaStream(twilioWs, { sessions = callSessions } = {}) {
  let streamSid = null;
  let callSid = null;
  let closing = false;
  let closed = false;
  let authorized = false;

  // Per-call state (transcript, caller number, start time): shared across legs.
  let session = null;
  let resumed = false;
  let resumeLang = 'en';

  // Created only after the token verifies.
  let realtime = null;
  let guard = null;
  let maxTimer = null;

  // End-of-answer marks: only the latest one means "the agent has finished speaking".
  let agentMarkSeq = 0;
  let pendingAgentMark = null;

  // Voice: OpenAI speech-to-speech, or OpenAI text + ElevenLabs voice.
  const useTts = isElevenLabsEnabled();
  let tts = null;
  // ElevenLabs mode: response.done arrives before its audio is generated, so the "answer
  // finished" handling waits for the utterance to be done.
  const deferredDone = new Map();
  const latency = createLatencyMeter();

  // Agent audio towards the caller, whichever engine produced it.
  function playAgentAudio(base64) {
    guard?.agentAudio();
    pendingAgentMark = null;
    const sample = latency.firstAudio();
    if (sample) {
      logger.info(
        `[latency] voice=${useTts ? 'elevenlabs' : 'openai'} first_audio_ms=${sample.audioMs}` +
          (sample.textMs === null ? '' : ` first_text_ms=${sample.textMs}`)
      );
    }
    if (streamSid) {
      twilioWs.send(JSON.stringify({ event: 'media', streamSid, media: { payload: base64 } }));
    }
  }

  // One agent answer has been fully queued to Twilio: hand it to the farewell, or place an
  // end-of-answer mark (Twilio echoes it once playback is done; only then does the
  // silence countdown start).
  function answerFinished(response, tag) {
    farewell.onResponseDone(response, tag);
    if (tag === FAREWELL_TAG) return; // the farewell places its own mark
    if (!streamSid) {
      guard?.agentDone();
      return;
    }
    agentMarkSeq += 1;
    pendingAgentMark = `agent-turn-${agentMarkSeq}`;
    twilioWs.send(
      JSON.stringify({ event: 'mark', streamSid, mark: { name: pendingAgentMark } })
    );
  }

  // Stops the ElevenLabs voice (barge-in, farewell). Its cancelled answers never produce
  // a mark, so the agent is marked as no longer speaking here.
  function stopTtsSpeech() {
    if (!tts) return;
    tts.cancel();
    deferredDone.clear();
    pendingAgentMark = null;
    guard?.agentDone();
  }

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
    if (closing) return;
    // Silence whatever the ElevenLabs voice was still saying before the goodbye.
    stopTtsSpeech();
    latency.reset();
    if (!farewell.begin(reason)) return;
    logger.warn(`[media] limit reached (${reason}); saying goodbye before hanging up`);
    guard?.stop();
    clearTimeout(maxTimer);
  }

  // Starts the AI side of the call. Only called after the token has verified.
  async function startSession() {
    const callerNumberKnown = isCallableNumber(session.from);
    let instructions = await buildInstructions();
    if (resumed) {
      instructions += buildResumeContext(session.transcript.toTurns(), { callerNumberKnown });
    }
    if (closed) return; // the caller hung up while we were loading the prompt

    // Silence and max-caller-turns guard: both end the call with a spoken farewell.
    // Caller turns carry over from earlier legs of the same call.
    guard = createCallGuard({
      silenceMs: config.silenceTimeoutSeconds * 1000,
      maxCallerTurns: config.maxCallerTurns,
      initialCallerTurns: session.callerTurns,
      onSilence() {
        endWithFarewell('silence');
      },
      onMaxTurns() {
        endWithFarewell('max_turns');
      },
    });

    // ElevenLabs voice: OpenAI replies in text and this turns it into speech.
    if (useTts) {
      tts = createElevenLabsTts({
        apiKey: config.elevenlabs.apiKey,
        voiceId: config.elevenlabs.voiceId,
        modelId: config.elevenlabs.modelId,
        onAudio: (base64) => playAgentAudio(base64),
        onUtteranceDone: (responseId) => {
          const deferred = deferredDone.get(responseId);
          deferredDone.delete(responseId);
          if (deferred) answerFinished(deferred.response, deferred.tag);
        },
      });
      tts.connect(); // open early so the greeting doesn't pay the handshake
    }

    realtime = connectRealtime({
      instructions,
      tools: toolDefinitions,
      outputMode: useTts ? 'text' : 'audio',
      greeting: resumed
        ? buildResumeGreeting({ language: resumeLang, callerNumberKnown })
        : GREETING,
      handlers: {
        onAudioDelta(base64) {
          // OpenAI voice -> Twilio (towards the caller).
          playAgentAudio(base64);
        },
        onTextDelta(delta, responseId) {
          // ElevenLabs mode: OpenAI's text goes to ElevenLabs, sentence by sentence.
          if (!tts || !responseId) return;
          latency.firstText();
          tts.append(responseId, delta);
        },
        onSpeechStarted() {
          // The user interrupts: flush the audio queued in Twilio (barge-in).
          guard.callerSpeechStarted();
          latency.reset();
          if (streamSid) {
            twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
          }
          stopTtsSpeech();
        },
        onSpeechStopped() {
          guard.callerSpeechStopped();
          latency.callerStopped();
        },
        onItemOrder(itemId, role) {
          // A conversation item was created: reserve its place so late transcripts land
          // in the order people actually spoke.
          session.transcript.reserve(itemId, role);
        },
        onTranscript(role, text, itemId) {
          // Subtitle of a turn (caller or agent). In memory only, and we do not dump it
          // into the logs: it is third-party personal content. Transcripts arrive late
          // and say nothing about who is speaking now, so they don't touch the silence
          // timer; they only count caller turns.
          session.transcript.add(role, text, itemId);
          if (role === 'caller' && text?.trim()) {
            session.callerTurns += 1;
            guard.countCallerTurn();
          }
        },
        onClose() {
          // OpenAI dropped and retries were exhausted: close the call so we don't leave
          // dead air (no farewell possible: the model is gone).
          logger.warn('[media] OpenAI unavailable; closing the call');
          safeClose();
        },
        onResponseDone(response, tag) {
          // ElevenLabs mode: the audio of this answer is still being generated, so wait
          // for it before marking the end of the answer.
          if (tts?.end(response?.id)) {
            deferredDone.set(response.id, { response, tag });
            return;
          }
          answerFinished(response, tag);
        },
        async onFunctionCall(event) {
          // The model wants to run a tool. We run it and return the result.
          const ctx = {
            callSid,
            streamSid,
            twilioWs,
            realtime,
            endCall,
            callerNumber: session.from,
            markTransferring: () => sessions.markTransferring(callSid),
            cancelTransfer: () => sessions.cancelTransfer(callSid),
          };
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

    // Cost guardrail: at the maximum duration of the WHOLE call (all legs), say goodbye
    // (with the reason) and hang up. The farewell has its own fallback timer.
    const elapsedMs = Date.now() - session.startedAt.getTime();
    const remainingMs = config.maxCallSeconds * 1000 - elapsedMs;
    maxTimer = setTimeout(() => {
      endWithFarewell('max_duration');
    }, resumed ? Math.max(remainingMs, MIN_RESUMED_LEG_MS) : remainingMs);

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
        const begun = sessions.begin(callSid, { from: params.from || '' });
        session = begun.session;
        resumed = begun.resumed || params.resume === '1';
        resumeLang = params.lang === 'es' ? 'es' : 'en';
        logger.info(
          `[media] stream ${resumed ? 'resumed' : 'started'} ` +
            `(streamSid=${streamSid}, callSid=${callSid})`
        );

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
    tts?.close();
    const lat = latency.summary();
    if (lat) {
      logger.info(
        `[latency] voice=${useTts ? 'elevenlabs' : 'openai'} answers=${lat.answers} ` +
          `avg_ms=${lat.avgMs} median_ms=${lat.medianMs} min_ms=${lat.minMs} max_ms=${lat.maxMs}`
      );
    }
    logger.info('[media] Twilio connection closed');

    // Unauthorized connections are not calls: nothing to summarize or record.
    if (!authorized || !callSid) return;

    // Summary + email + record once the call is really over. If the stream closed
    // because the call is being transferred, the session waits for /transfer-status.
    sessions.legClosed(callSid);
  });

  twilioWs.on('error', (err) => {
    logger.error('[media] Twilio websocket error:', err.message);
  });
}
