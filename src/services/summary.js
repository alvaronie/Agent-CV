// Genera el resumen de una llamada a partir de sus turnos, usando un modelo de texto.
//
// La transcripción es material de paso: entra aquí, se convierte en resumen y el puente
// la descarta (decisión D11). Este módulo NO la guarda en ningún sitio.
//
// Usamos la API de Chat Completions con `fetch` (nativo en Node 18+), sin añadir el SDK
// de OpenAI como dependencia: es una sola petición y así el proyecto sigue ligero.

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const CHAT_URL = 'https://api.openai.com/v1/chat/completions';

// Tope de caracteres de transcripción que enviamos al modelo. Una llamada de 10 minutos
// rara vez pasa de ~8 KB, así que este límite solo actúa como guardarraíl de coste.
const MAX_TRANSCRIPT_CHARS = 20000;

// Cuánto esperamos al modelo antes de rendirnos. La llamada ya ha colgado, pero no
// queremos dejar la petición abierta indefinidamente.
const REQUEST_TIMEOUT_MS = 30000;

const SYSTEM_PROMPT = `Eres un asistente que resume llamadas telefónicas recibidas por el
agente de voz del CV de Álvaro. Escribe SIEMPRE en español, aunque la llamada haya sido en
otro idioma.

Devuelve un JSON con dos campos:
- "asunto": una línea de menos de 70 caracteres que identifique la llamada (quién llamó y
  para qué). Sin comillas ni prefijos.
- "resumen": el cuerpo del email, en texto plano con estas secciones, omitiendo las que no
  apliquen:
  Quién llamó: nombre, empresa y cargo si se mencionaron.
  Motivo: qué buscaba.
  Puntos tratados: lista breve de lo que se preguntó y lo que se respondió.
  Datos de contacto: los que dejara.
  Acción para Álvaro: qué conviene hacer, o "ninguna" si no hace falta nada.

Sé breve y concreto. No inventes nada: si un dato no aparece en la conversación, di que no
se facilitó. Si la llamada no tuvo contenido real (silencio, error, colgaron al momento),
dilo en una línea y no rellenes secciones.`;

/**
 * Convierte los turnos acumulados en un texto legible para el modelo.
 * @param {Array<{role:string, text:string}>} turns
 * @returns {string}
 */
export function formatTranscript(turns = []) {
  const text = turns
    .filter((t) => t?.text)
    .map((t) => `${t.role === 'caller' ? 'LLAMANTE' : 'AGENTE'}: ${t.text.trim()}`)
    .join('\n');

  // Si hay que recortar, nos quedamos con el final: el cierre de la llamada (contacto,
  // siguientes pasos) suele ser más valioso que el principio.
  return text.length > MAX_TRANSCRIPT_CHARS ? text.slice(-MAX_TRANSCRIPT_CHARS) : text;
}

/**
 * Pide al modelo un resumen de la llamada.
 *
 * @param {Array<{role:string, text:string}>} turns - Turnos de la conversación.
 * @param {{callSid?:string, from?:string, startedAt?:string, durationSeconds?:number}} [meta]
 * @returns {Promise<{subject:string, body:string}>}
 * @throws Si falta la API key o la petición falla (el llamador decide cómo degradar).
 */
export async function generateSummary(turns, meta = {}) {
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY no configurada');
  }

  const transcript = formatTranscript(turns);
  if (!transcript) {
    throw new Error('no hay transcripción que resumir');
  }

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
    throw new Error(`Chat Completions devolvió ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // El modelo no devolvió JSON válido: usamos su texto tal cual como cuerpo.
    logger.warn('[summary] respuesta no era JSON válido, se usa como texto plano');
    parsed = { asunto: '', resumen: raw };
  }

  const subject = (parsed.asunto || '').trim() || 'Llamada al agente de CV';
  const body = (parsed.resumen || '').trim() || raw.trim();

  logger.info(`[summary] resumen generado (${body.length} caracteres)`);
  return { subject, body };
}
