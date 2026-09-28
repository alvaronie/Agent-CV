// Persistence of contacts and call records.
//
// To start with we save to JSONL files (one JSON line per record) inside data/. It is
// simple, dependency-free and easy to inspect. Later it can be swapped for
// DynamoDB / Postgres without touching the callers (same function signatures).
//
// NOTE (PII): contacts.jsonl contains third-party personal data. It is in .gitignore and
// must not be pushed to the repository.

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
 * Saves the caller's contact details.
 * @param {{name?:string, company?:string, phone?:string, email?:string, reason?:string, callSid?:string}} contact
 */
export async function saveContact(contact) {
  const record = { ...contact, savedAt: new Date().toISOString() };
  await appendJson(CONTACTS_FILE, record);
  // We do not log the name or other contact fields: they are third-party PII. Only the
  // callSid (internal identifier), so we can correlate without exposing data.
  logger.info(`[storage] contact saved (callSid=${contact?.callSid ?? 'no-callSid'})`);
  return record;
}

/**
 * Saves a call record (metadata, duration, summary...).
 * @param {object} record
 */
export async function saveCallRecord(record) {
  const row = { ...record, savedAt: new Date().toISOString() };
  await appendJson(CALLS_FILE, row);
  logger.info(`[storage] call record saved (${record?.callSid ?? 'no-callSid'})`);
  return row;
}
