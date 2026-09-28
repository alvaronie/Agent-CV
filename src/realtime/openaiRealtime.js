// Conexión con la OpenAI Realtime API (GA) por WebSocket.
//
// Este módulo abre un WebSocket contra la Realtime API y hace de "cerebro" de voz:
// recibe audio (μ-law/8kHz, formato audio/pcmu, el mismo de Twilio -> sin reconvertir),
// lo entiende, razona y devuelve audio de respuesta.
//
// Referencia GA (agosto 2025+):
//  - URL: wss://api.openai.com/v1/realtime?model=...
//  - Auth: cabecera Authorization: Bearer <key>  (SIN la cabecera beta)
//  - Config de sesión: session.type="realtime", audio anidado en audio.input/output,
//    formato { type: "audio/pcmu" } para casar con Twilio (G.711 μ-law 8kHz).
//  - Audio de salida del modelo: evento response.output_audio.delta (base64).
//  - Interrupción (barge-in): input_audio_buffer.speech_started.
//
// ROBUSTEZ (Fase 6): si el WebSocket se cae de forma inesperada a media llamada,
// reintentamos reconectar con backoff (ver reconnectPolicy.js). Al reconectar se
// reconfigura la sesión (instrucciones + tools), pero NO se repite el saludo. Si se
// agotan los reintentos, avisamos vía handlers.onClose para que el puente cierre la
// llamada y no quede audio muerto. Nota: una sesión Realtime nueva no conserva el
// historial de la conversación; el agente mantiene su identidad (system prompt) pero
// pierde el contexto de los turnos previos, lo cual es aceptable como último recurso.

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
            // Subtítulos del audio del llamante. Sin esto no hay forma de saber qué
            // dijo: el modelo es speech-to-speech y no devuelve texto del lado de
            // entrada. Necesario para el resumen de la Fase 5.
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
        // Conexión establecida: reseteamos el contador de reintentos y configuramos.
        reconnectAttempts = 0;
        ws.send(JSON.stringify(buildSessionUpdate()));
        break;

      case 'session.updated':
        // Sesión lista. Si queremos que el agente hable primero, lanzamos el saludo,
        // pero SOLO la primera vez (no tras una reconexión).
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

      // El nombre del evento de transcripción del agente cambió entre beta y GA.
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
      logger.error('[realtime] reconexión agotada; se cierra la sesión');
      handlers.onClose?.();
      return;
    }
    reconnectAttempts += 1;
    logger.warn(
      `[realtime] desconexión inesperada; reconectando en ${delayMs}ms ` +
        `(intento ${reconnectAttempts}/${config.openai.reconnectMaxAttempts})`
    );
    reconnectTimer = setTimeout(connect, delayMs);
  }

  function connect() {
    ws = new WebSocket(REALTIME_URL, {
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
    });

    ws.on('open', () => logger.info('[realtime] conectado a OpenAI'));

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
        logger.info('[realtime] desconectado (cierre intencionado)');
        return;
      }
      handleUnexpectedClose();
    });

    ws.on('error', (err) => logger.error('[realtime] ws error:', err.message));
  }

  connect();

  return {
    /** Envía un fragmento de audio entrante (base64 μ-law) al modelo. */
    sendAudio(base64) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
      }
    },
    /** Devuelve al modelo el resultado de una tool (Fase 4). */
    sendFunctionResult(callId, output, { triggerResponse = true } = {}) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: callId, output },
        })
      );
      // Tras entregar el resultado, pedimos al modelo que continúe (salvo que la tool
      // pida lo contrario, p. ej. end_call, donde no queremos más locución).
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
