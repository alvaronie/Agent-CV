// Generates the summary of a call from its turns, using a text model.
//
// The transcript is transient material: it comes in here, is turned into a summary, and
// the bridge discards it (decision D11). This module does NOT store it anywhere.
//
// We use the Chat Completions API with `fetch` (native in Node 18+), without adding the
// OpenAI SDK as a dependency: it is a single request, keeping the project lightweight.
//
// NOTE (language): the summary email is written in Spanish ON PURPOSE, because its
// recipient is the CV owner. This is the only intentionally non-English text in the code
// (the strings below define that email's content). The rest of the codebase is English.

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// Cap on transcript characters we send to the model. A 10-minute call rarely exceeds
// ~8 KB, so this limit only acts as a cost guardrail.
const MAX_TRANSCRIPT_CHARS = 20000;

// How long we wait for the model before giving up. The call has already hung up, but we
// don't want to leave the request open indefinitely.
const REQUEST_TIMEOUT_MS = 30000;

// Spanish by design (see note at the top of the file): the summary email is for the CV owner.
const SYSTEM_PROMPT = `Eres un asistente que resume llamadas telefónicas recibidas por el
agente de voz del CV de Álvaro. Escribe SIEMPRE en español, aunque la llamada haya sido en
otro idioma.

Devuelve un JSON con dos campos, y los dos deben ser cadenas de texto (string), nunca
objetos ni listas:
- "asunto": una línea de menos de 70 caracteres que identifique la llamada (quién llamó y
  para qué). Sin comillas ni prefijos.
- "resumen": el cuerpo del email, en texto plano dentro de UNA sola cadena, con estas
  secciones (una por línea, separadas con \\n), omitiendo las que no apliquen:
  Quién llamó: nombre, empresa y cargo si se mencionaron.
  Motivo: qué buscaba.
  Puntos tratados: lista breve de lo que se preguntó y lo que se respondió.
  Datos de contacto: los que dejara.
  Acción para Álvaro: qué conviene hacer, o "ninguna" si no hace falta nada.

Sé breve y concreto. No inventes nada: si un dato no aparece en la conversación, di que no
se facilitó. Si la llamada no tuvo contenido real (silencio, error, colgaron al momento),
dilo en una línea y no rellenes secciones.`;

/**
 * Flattens whatever the model put in a JSON field into plain text. Despite the
 * instructions, the model sometimes returns "resumen" as an object of sections (or an
 * array) instead of a string; calling .trim() on that crashed the summary in production.
 * @param {unknown} value
 * @returns {string}
 */
export function toPlainText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(toPlainText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, v]) => {
        const text = toPlainText(v);
        if (!text) return '';
        return text.includes('\n') ? `${key}:\n${text}` : `${key}: ${text}`;
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(value).trim();
}

/**
 * Turns the accumulated turns into readable text for the model.
 * @param {Array<{role:string, text:string}>} turns
 * @returns {string}
 */
export function formatTranscript(turns = []) {
  const text = turns
    .filter((t) => t?.text)
    .map((t) => `${t.role === 'caller' ? 'LLAMANTE' : 'AGENTE'}: ${t.text.trim()}`)
    .join('\n');

  // If we must trim, keep the end: the end of the call (contact, next steps) is usually
  // more valuable than the beginning.
  return text.length > MAX_TRANSCRIPT_CHARS ? text.slice(-MAX_TRANSCRIPT_CHARS) : text;
}

/**
 * Asks the model for a summary of the call.
 *
 * @param {Array<{role:string, text:string}>} turns - Conversation turns.
 * @param {{callSid?:string, from?:string, startedAt?:string, durationSeconds?:number}} [meta]
 * @returns {Promise<{subject:string, body:string}>}
 * @throws If the API key is missing or the request fails (the caller decides how to degrade).
 */
export async function generateSummary(turns, meta = {}) {
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const transcript = formatTranscript(turns);
  if (!transcript) {
    throw new Error('no transcript to summarize');
  }

  // Context lines are sent to the model in Spanish, to match the Spanish summary.
  const context = [
    meta.from ? `Número del llamante: ${meta.from}` : null,
    meta.startedAt ? `Inicio: ${meta.startedAt}` : null,
    typeof meta.durationSeconds === 'number'
      ? `Duración: ${meta.durationSeconds} segundos`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  const userContent = context
    ? `${context}\n\nTranscripción:\n${transcript}`
    : `Transcripción:\n${transcript}`;

  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openai.summaryModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Chat Completions returned ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // The model did not return a JSON object: use its text as-is for the body.
    logger.warn('[summary] response was not a JSON object, using it as plain text');
    parsed = { asunto: '', resumen: raw };
  }

  const subject = toPlainText(parsed.asunto) || 'Llamada al agente de CV';
  const body = toPlainText(parsed.resumen) || raw.trim();

  logger.info(`[summary] summary generated (${body.length} chars)`);
  return { subject, body };
}
