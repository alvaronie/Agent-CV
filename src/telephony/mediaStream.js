// Puente de audio entre Twilio Media Streams y OpenAI Realtime.
//
// Twilio abre un WebSocket con nosotros y nos envía el audio de la llamada en
// mensajes JSON (eventos: start, media, stop). El audio va en base64, formato
// G.711 μ-law 8kHz. Como configuramos OpenAI con audio/pcmu (el mismo formato),
// reenviamos el audio en ambos sentidos SIN reconvertir.
//
// Flujo:
//   Twilio media  ─▶ realtime.sendAudio()            (audio del que llama -> modelo)
//   OpenAI delta  ─▶ twilio { event:'media', ... }   (voz del modelo -> llamada)
//   barge-in      ─▶ twilio { event:'clear', ... }   (el usuario interrumpe)
//   function call ─▶ dispatchToolCall(...)           (tools: transferir/contacto/fin)
//   transcripción ─▶ turns[]                         (subtítulos, solo en memoria)
//   al colgar     ─▶ resumen (LLM) -> email -> registro   (Fase 5)
//
// PRIVACIDAD (D11): la transcripción vive únicamente en memoria durante la llamada. Se
// usa para generar el resumen y se descarta al terminar; nunca se escribe en disco.

import { connectRealtime } from '../realtime/openaiRealtime.js';
import { buildInstructions } from '../agent/prompt.js';
import { toolDefinitions, dispatchToolCall } from '../agent/tools/index.js';
import { twilioClient } from './twilioClient.js';
import { reportCall } from '../services/callReport.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const GREETING =
  'Greet in English, briefly and warmly. Introduce yourself as the CV owner\'s voice ' +
  'assistant, and mention the call may be recorded and transcribed. Also let the caller ' +
  'know you can continue in other languages, such as Spanish, if they prefer. Then ask ' +
  'how you can help. Keep it to one or two short sentences. If the caller replies in ' +
  'another language, switch to it for the rest of the call.';

// Margen (ms) antes de colgar tras end_call, para que suene la despedida ya emitida.
const HANGUP_DELAY_MS = 2000;

export async function handleMediaStream(twilioWs) {
  let streamSid = null;
  let callSid = null;
  let closing = false;

  // Estado para el resumen (Fase 5). `turns` solo existe en memoria: ver nota D11.
  let callerNumber = '';
  let startedAt = null;
  let turns = [];
  let finalized = false;

  const instructions = await buildInstructions();

  // Cierre ordenado de la llamada: cuelga en Twilio (si hay cliente y callSid) y cierra
  // el WebSocket. Idempotente gracias a `closing`.
  function endCall() {
    if (closing) return;
    closing = true;
    setTimeout(async () => {
      try {
        if (twilioClient && callSid) {
          await twilioClient.calls(callSid).update({ status: 'completed' });
          logger.info(`[media] llamada ${callSid} colgada por end_call`);
        }
      } catch (err) {
        logger.error('[media] error al colgar la llamada:', err.message);
      } finally {
        try {
          twilioWs.close();
        } catch {
          /* noop */
        }
      }
    }, HANGUP_DELAY_MS);
  }

  // Cierre de la llamada a efectos de negocio: resumir, avisar por email y registrar.
  // Se ejecuta una sola vez (`finalized`), sea cual sea la causa del cierre: el agente
  // se despidió, el llamante colgó, o se agotó MAX_CALL_SECONDS.
  async function finalizeCall() {
    if (finalized) return;
    finalized = true;

    const endedAt = new Date();
    const durationSeconds = startedAt
      ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
      : null;

    // Nos quedamos con los turnos y vaciamos el estado de inmediato: a partir de aquí la
    // transcripción solo vive como argumento de reportCall.
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

  const realtime = connectRealtime({
    instructions,
    tools: toolDefinitions,
    greeting: GREETING,
    handlers: {
      onAudioDelta(base64) {
        // Voz del modelo -> Twilio (hacia el llamante).
        if (streamSid) {
          twilioWs.send(
            JSON.stringify({ event: 'media', streamSid, media: { payload: base64 } })
          );
        }
      },
      onSpeechStarted() {
        // El usuario interrumpe: vaciamos el audio en cola en Twilio (barge-in).
        if (streamSid) {
          twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
        }
      },
      onTranscript(role, text) {
        // Subtítulo de un turno (llamante o agente). Solo en memoria, y no lo volcamos
        // en los logs: es contenido personal de terceros.
        turns.push({ role, text });
      },
      async onFunctionCall(event) {
        // El modelo quiere ejecutar una tool. La ejecutamos y devolvemos el resultado.
        const ctx = { callSid, streamSid, twilioWs, realtime, endCall };
        try {
          const { output, triggerResponse } = await dispatchToolCall(event, ctx);
          realtime.sendFunctionResult(event.call_id, output, { triggerResponse });
        } catch (err) {
          logger.error('[media] error ejecutando tool:', err.message);
          realtime.sendFunctionResult(
            event.call_id,
            'The tool failed due to a technical issue.',
            { triggerResponse: true }
          );
        }
      },
    },
  });

  // Guardarraíl de coste: cerrar la llamada al superar la duración máxima.
  const maxTimer = setTimeout(() => {
    logger.warn(`[media] duración máxima (${config.maxCallSeconds}s) alcanzada, cerrando`);
    try {
      twilioWs.close();
    } catch {
      /* noop */
    }
  }, config.maxCallSeconds * 1000);

  twilioWs.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      case 'start':
        streamSid = msg.start?.streamSid;
        callSid = msg.start?.callSid;
        callerNumber = msg.start?.customParameters?.from || '';
        startedAt = new Date();
        logger.info(`[media] stream iniciado (streamSid=${streamSid}, callSid=${callSid})`);
        break;
      case 'media':
        // Audio del llamante -> modelo.
        realtime.sendAudio(msg.media.payload);
        break;
      case 'stop':
        logger.info('[media] stream detenido por Twilio');
        break;
      default:
        break;
    }
  });

  twilioWs.on('close', () => {
    clearTimeout(maxTimer);
    realtime.close();
    logger.info('[media] conexión Twilio cerrada');
    // Resumen + email + registro. No esperamos aquí (el callback es síncrono), pero
    // capturamos cualquier fallo para que no quede una promesa sin manejar.
    finalizeCall().catch((err) =>
      logger.error('[media] error en el cierre de la llamada:', err.message)
    );
  });

  twilioWs.on('error', (err) => {
    logger.error('[media] error websocket Twilio:', err.message);
  });
}
