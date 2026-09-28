// Persistencia de contactos y registros de llamada.
//
// Para empezar guardamos en ficheros JSONL (una línea JSON por registro) dentro de
// data/. Es simple, sin dependencias y fácil de inspeccionar. Más adelante se puede
// cambiar por DynamoDB / Postgres sin tocar los llamadores (misma firma de funciones).
//
// NOTA (PII): contacts.jsonl contiene datos personales de terceros. Está en .gitignore
// y no debe subirse al repositorio.

import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.jsonl');
const CALLS_FILE = path.join(DATA_DIR, 'calls.jsonl');

async function appendJson(file, obj) {
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(file, JSON.stringify(obj) + '\n', 'utf8');
}

/**
 * Guarda los datos de contacto de quien llama.
 * @param {{name?:string, company?:string, phone?:string, email?:string, reason?:string, callSid?:string}} contact
 */
export async function saveContact(contact) {
  const record = { ...contact, savedAt: new Date().toISOString() };
  await appendJson(CONTACTS_FILE, record);
  // No logueamos el nombre ni otros datos del contacto: son PII de terceros. Solo el
  // callSid (identificador interno) para poder correlacionar sin exponer datos.
  logger.info(`[storage] contacto guardado (callSid=${contact?.callSid ?? 's/callSid'})`);
  return record;
}

/**
 * Guarda un registro de la llamada (metadatos, duración, transcripción...).
 * @param {object} record
 */
export async function saveCallRecord(record) {
  const row = { ...record, savedAt: new Date().toISOString() };
  await appendJson(CALLS_FILE, row);
  logger.info(`[storage] registro de llamada guardado (${record?.callSid ?? 's/callSid'})`);
  return row;
}
