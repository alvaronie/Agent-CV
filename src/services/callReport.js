// Cierre de una llamada: resumir, enviar el email y dejar constancia.
//
// Está separado del puente de audio (`mediaStream.js`) para poder probarlo sin necesidad
// de una llamada real: las tres dependencias externas (resumen, email y persistencia) se
// pueden inyectar en los tests.
//
// PRIVACIDAD (D11): la transcripción entra por parámetro, se usa para generar el resumen
// y no sale de aquí. El registro que se persiste contiene SOLO el resumen.

import { generateSummary as defaultGenerateSummary, formatTranscript } from './summary.js';
import { sendSummaryEmail as defaultSendSummaryEmail } from './email.js';
import { saveCallRecord as defaultSaveCallRecord } from './storage.js';
import { logger } from '../utils/logger.js';

const DEFAULT_SUBJECT = 'Llamada al agente de CV';

/**
 * Construye la cabecera de datos que precede al resumen en el email.
 */
function buildHeader({ from, startedAt, durationSeconds }) {
  return [
    from ? `Llamante: ${from}` : null,
    startedAt ? `Fecha: ${new Date(startedAt).toLocaleString('es-ES')}` : null,
    typeof durationSeconds === 'number' ? `Duración: ${durationSeconds}s` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Resume la llamada, envía el email y guarda el registro.
 *
 * @param {object} call
 * @param {Array<{role:string, text:string}>} call.turns - Turnos de la conversación.
 * @param {string} [call.callSid]
 * @param {string} [call.from]
 * @param {string} [call.startedAt] - ISO 8601.
 * @param {string} [call.endedAt] - ISO 8601.
 * @param {number|null} [call.durationSeconds]
 * @param {object} [deps] - Inyección de dependencias (tests).
 * @returns {Promise<{summary:string|null, emailSent:boolean, record:object}>}
 */
export async function reportCall(call, deps = {}) {
  const {
    generateSummary = defaultGenerateSummary,
    sendSummaryEmail = defaultSendSummaryEmail,
    saveCallRecord = defaultSaveCallRecord,
  } = deps;

  const {
    turns = [],
    callSid = null,
    from = '',
    startedAt = null,
    endedAt = new Date().toISOString(),
    durationSeconds = null,
  } = call;

  const baseRecord = {
    callSid,
    from: from || null,
    startedAt,
    endedAt,
    durationSeconds,
    turnCount: turns.length,
  };

  // Sin conversación (escaneo, silencio, cuelgue inmediato): no mandamos email para no
  // llenar la bandeja, pero dejamos constancia de que hubo una llamada.
  if (turns.length === 0) {
    logger.info('[report] llamada sin turnos, no se genera resumen');
    const record = { ...baseRecord, summary: null, emailSent: false };
    await persist(saveCallRecord, record);
    return { summary: null, emailSent: false, record };
  }

  let summary = null;
  let subject = DEFAULT_SUBJECT;
  let body = '';

  try {
    const result = await generateSummary(turns, { callSid, from, startedAt, durationSeconds });
    subject = result.subject || DEFAULT_SUBJECT;
    body = result.body;
    summary = result.body;
  } catch (err) {
    // Si el resumen falla no queremos perder la llamada: enviamos la transcripción en
    // bruto por email (que no se almacena). En disco el resumen queda a null.
    logger.error('[report] fallo al generar el resumen:', err.message);
    subject = `${DEFAULT_SUBJECT} (resumen no disponible)`;
    body =
      'No se pudo generar el resumen automático de la llamada.\n' +
      `Motivo: ${err.message}\n\n` +
      'Transcripción de la llamada:\n\n' +
      formatTranscript(turns);
  }

  const header = buildHeader({ from, startedAt, durationSeconds });
  const emailSent = await sendSummaryEmail({
    subject,
    body: header ? `${header}\n\n${body}` : body,
  });

  const record = { ...baseRecord, summary, emailSent };
  await persist(saveCallRecord, record);
  return { summary, emailSent, record };
}

// Guardar el registro nunca debe tumbar el cierre de la llamada.
async function persist(saveCallRecord, record) {
  try {
    await saveCallRecord(record);
  } catch (err) {
    logger.error('[report] no se pudo registrar la llamada:', err.message);
  }
}
