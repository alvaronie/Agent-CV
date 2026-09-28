// Call teardown: summarize, send the email and record it.
//
// It is separate from the audio bridge (`mediaStream.js`) so it can be tested without a
// real call: the three external dependencies (summary, email and persistence) can be
// injected in tests.
//
// PRIVACY (D11): the transcript comes in as a parameter, is used to generate the summary
// and does not leave here. The persisted record contains ONLY the summary.
//
// NOTE (language): the email subject/body are in Spanish on purpose (recipient is the CV
// owner); see summary.js. These strings define that email's content.

import { generateSummary as defaultGenerateSummary, formatTranscript } from './summary.js';
import { sendSummaryEmail as defaultSendSummaryEmail } from './email.js';
import { saveCallRecord as defaultSaveCallRecord } from './storage.js';
import { logger } from '../utils/logger.js';

const DEFAULT_SUBJECT = 'Llamada al agente de CV';

/**
 * Builds the data header that precedes the summary in the email.
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
 * Summarizes the call, sends the email and saves the record.
 *
 * @param {object} call
 * @param {Array<{role:string, text:string}>} call.turns - Conversation turns.
 * @param {string} [call.callSid]
 * @param {string} [call.from]
 * @param {string} [call.startedAt] - ISO 8601.
 * @param {string} [call.endedAt] - ISO 8601.
 * @param {number|null} [call.durationSeconds]
 * @param {object} [deps] - Dependency injection (tests).
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

  // No conversation (scan, silence, immediate hangup): we don't send an email so we
  // don't clutter the inbox, but we still record that a call happened.
  if (turns.length === 0) {
    logger.info('[report] call with no turns, no summary generated');
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
    // If the summary fails we don't want to lose the call: we send the raw transcript by
    // email (which is not stored). On disk the summary stays null.
    logger.error('[report] failed to generate the summary:', err.message);
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

// Saving the record must never bring down the call teardown.
async function persist(saveCallRecord, record) {
  try {
    await saveCallRecord(record);
  } catch (err) {
    logger.error('[report] could not record the call:', err.message);
  }
}
