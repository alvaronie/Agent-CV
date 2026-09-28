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

import WebSocket from 'ws';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.openai.model)}`;

/**
 * Abre una sesión Realtime.
 * @param {object} opts
 * @param {string} opts.instructions - System prompt (personalidad + CV).
 * @param {Array}  [opts.tools] - Definiciones de tools (Fase 4).
 * @param {string} [opts.greeting] - Instrucción para el saludo inicial (que hable primero).
 * @param {object} [opts.handlers] - Callbacks: onAudioDelta(base64), onSpeechStarted(),
 *                                    onFunctionCall(event), onTranscript(role, text),
 *                                    onClose().
 * @returns {{ sendAudio: (b64:string)=>void, sendFunctionResult: (callId:string, output:string)=>void, close: ()=>void }}
 */
export function connectRealtime({ instructions, tools = [], greeting, handlers = {} }) {
  const ws = new WebSocket(REALTIME_URL, {
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

    switch (event.type) {
      case 'session.created':
        // Configuramos la sesión en cuanto está lista.
        ws.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              type: 'realtime',
              instructions,
              audio: {
                input: {
                  format: { type: 'audio/pcmu' },
                  turn_detection: { type: 'server_vad' },
                  // Subtítulos del audio del llamante. Sin esto no hay forma de saber
                  // qué dijo: el modelo es speech-to-speech y no devuelve texto del
                  // lado de entrada. Necesario para el resumen de la Fase 5.
                  transcription: { model: config.openai.transcribeModel },
                },
                output: {
                  format: { type: 'audio/pcmu' },
                  voice: config.openai.voice,
                },
              },
              ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
            },
          })
        );
        break;

      case 'session.updated':
        // La sesión ya está configurada. Si queremos que el agente hable primero,
        // lanzamos una respuesta inicial (saludo).
        if (greeting) {
          ws.send(
            JSON.stringify({
              type: 'response.create',
              response: { instructions: greeting },
            })
          );
        }
        break;

      case 'response.output_audio.delta':
        // Fragmento de audio de la respuesta del modelo (base64, μ-law).
        handlers.onAudioDelta?.(event.delta);
        break;

      case 'input_audio_buffer.speech_started':
        // El usuario ha empezado a hablar: interrupción (barge-in).
        handlers.onSpeechStarted?.();
        break;

      case 'conversation.item.input_audio_transcription.completed':
        // Transcripción de un turno del llamante (ya completo).
        if (event.transcript) handlers.onTranscript?.('caller', event.transcript);
        break;

      // Transcripción de un turno del agente. El nombre del evento cambió entre la
      // versión beta y la GA de la Realtime API, así que aceptamos ambos.
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (event.transcript) handlers.onTranscript?.('agent', event.transcript);
        break;

      case 'response.function_call_arguments.done':
        // El modelo quiere ejecutar una tool (se maneja en la Fase 4).
        handlers.onFunctionCall?.(event);
        break;

      case 'error':
        logger.error('[realtime] error:', event.error || event);
        break;

      default:
        // Otros eventos de ciclo de vida no son necesarios para el puente básico.
        break;
    }
  });

  ws.on('close', () => {
    logger.info('[realtime] desconectado');
    handlers.onClose?.();
  });
  ws.on('error', (err) => logger.error('[realtime] ws error:', err.message));

  return {
    /** Envía un fragmento de audio entrante (base64 μ-law) al modelo. */
    sendAudio(base64) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
      }
    },
    /** Devuelve al modelo el resultado de una tool (Fase 4). */
    sendFunctionResult(callId, output, { triggerResponse = true } = {}) {
      if (ws.readyState !== WebSocket.OPEN) return;
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
      try {
        ws.close();
      } catch {
        /* noop */
      }
    },
  };
}
