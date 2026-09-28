// Connection to the OpenAI Realtime API (GA) over WebSocket.
//
// This module opens a WebSocket against the Realtime API and acts as the voice "brain":
// it receives audio (μ-law/8kHz, audio/pcmu format, the same as Twilio -> no re-encoding),
// understands it, reasons, and returns response audio.
//
// GA reference (August 2025+):
//  - URL: wss://api.openai.com/v1/realtime?model=...
//  - Auth: header Authorization: Bearer <key>  (WITHOUT the beta header)
//  - Session config: session.type="realtime", audio nested under audio.input/output,
//    format { type: "audio/pcmu" } to match Twilio (G.711 μ-law 8kHz).
//  - Model output audio: response.output_audio.delta event (base64).
//  - Interruption (barge-in): input_audio_buffer.speech_started.
//
// ROBUSTNESS (Phase 6): if the WebSocket drops unexpectedly mid-call, we retry the
// connection with backoff (see reconnectPolicy.js). On reconnect the session is
// reconfigured (instructions + tools), but the greeting is NOT replayed. If retries are
// exhausted, we notify via handlers.onClose so the bridge closes the call and no dead
// air is left. Note: a fresh Realtime session does not keep the conversation history;
// the agent keeps its identity (system prompt) but loses the context of previous turns,
// which is acceptable as a last resort.

import WebSocket from 'ws';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { nextReconnect } from './reconnectPolicy.js';

const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.openai.model)}`;

export function connectRealtime({ instructions, tools = [], greeting, handlers = {} }) {
  let ws = null;
  let intentionalClose = false;
  let hasGreeted = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;

  function buildSessionUpdate() {
    return {
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions,
        audio: {
          input: {
            format: { type: 'audio/pcmu' },
            turn_detection: { type: 'server_vad' },
            // Subtitles of the caller's audio. Without this there is no way to know what
            // they said: the model is speech-to-speech and returns no text on the input
            // side. Needed for the Phase 5 summary.
            transcription: { model: config.openai.transcribeModel },
          },
          output: {
            format: { type: 'audio/pcmu' },
            voice: config.openai.voice,
          },
        },
        ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
      },
    };
  }

  function handleEvent(event) {
    switch (event.type) {
      case 'session.created':
        // Connection established: reset the retry counter and configure the session.
        reconnectAttempts = 0;
        ws.send(JSON.stringify(buildSessionUpdate()));
        break;

      case 'session.updated':
        // Session ready. If we want the agent to speak first, fire the greeting, but
        // ONLY the first time (not after a reconnection).
        if (greeting && !hasGreeted) {
          hasGreeted = true;
          ws.send(
            JSON.stringify({ type: 'response.create', response: { instructions: greeting } })
          );
        }
        break;

      case 'response.output_audio.delta':
        handlers.onAudioDelta?.(event.delta);
        break;

      case 'input_audio_buffer.speech_started':
        handlers.onSpeechStarted?.();
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript) handlers.onTranscript?.('caller', event.transcript);
        break;

      // The agent transcription event name changed between beta and GA.
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (event.transcript) handlers.onTranscript?.('agent', event.transcript);
        break;

      case 'response.function_call_arguments.done':
        handlers.onFunctionCall?.(event);
        break;

      case 'error':
        logger.error('[realtime] error:', event.error || event);
        break;

      default:
        break;
    }
  }

  function handleUnexpectedClose() {
    const { shouldReconnect, delayMs } = nextReconnect({
      attempt: reconnectAttempts,
      maxAttempts: config.openai.reconnectMaxAttempts,
    });
    if (!shouldReconnect) {
      logger.error('[realtime] reconnection exhausted; closing the session');
      handlers.onClose?.();
      return;
    }
    reconnectAttempts += 1;
    logger.warn(
      `[realtime] unexpected disconnection; reconnecting in ${delayMs}ms ` +
        `(attempt ${reconnectAttempts}/${config.openai.reconnectMaxAttempts})`
    );
    reconnectTimer = setTimeout(connect, delayMs);
  }

  function connect() {
    ws = new WebSocket(REALTIME_URL, {
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
    });

    ws.on('open', () => logger.info('[realtime] connected to OpenAI'));

    ws.on('message', (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }
      handleEvent(event);
    });

    ws.on('close', () => {
      if (intentionalClose) {
        logger.info('[realtime] disconnected (intentional close)');
        return;
      }
      handleUnexpectedClose();
    });

    ws.on('error', (err) => logger.error('[realtime] ws error:', err.message));
  }

  connect();

  return {
    /** Sends an incoming audio chunk (base64 μ-law) to the model. */
    sendAudio(base64) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
      }
    },
    /** Returns a tool result to the model (Phase 4). */
    sendFunctionResult(callId, output, { triggerResponse = true } = {}) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: callId, output },
        })
      );
      // After delivering the result, ask the model to continue (unless the tool asks
      // otherwise, e.g. end_call, where we don't want any more speech).
      if (triggerResponse) {
        ws.send(JSON.stringify({ type: 'response.create' }));
      }
    },
    close() {
      intentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    },
  };
}
