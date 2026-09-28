// Limitador de admisión de llamadas (Fase 6): guardarraíl de coste.
//
// Lleva la cuenta de:
//   - llamadas ACTIVAS a la vez (concurrencia), y
//   - llamadas aceptadas en el día (se reinicia a medianoche UTC).
//
// Se consulta en el webhook /incoming-call ANTES de aceptar la llamada (así rechazamos
// sin abrir el WebSocket ni conectar con OpenAI). El recuento de activas sube al empezar
// el stream y baja al cerrarse. Un valor de 0 en la config significa "sin límite".
//
// El estado vive en memoria del proceso: suficiente para un despliegue de una sola
// instancia (nuestro caso). Con varias instancias haría falta un contador compartido.

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let activeCalls = 0;
let callsToday = 0;
let dayKey = todayKey();

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD en UTC
}

function rolloverIfNeeded(now) {
  const key = todayKey(now);
  if (key !== dayKey) {
    dayKey = key;
    callsToday = 0;
  }
}

/**
 * ¿Podemos aceptar una nueva llamada ahora mismo?
 * @param {Date} [now]
 * @returns {{ok: boolean, reason?: 'concurrency'|'daily'}}
 */
export function canAcceptCall(now = new Date()) {
  rolloverIfNeeded(now);
  const { maxConcurrentCalls, maxCallsPerDay } = config.limits;

  if (maxConcurrentCalls > 0 && activeCalls >= maxConcurrentCalls) {
    return { ok: false, reason: 'concurrency' };
  }
  if (maxCallsPerDay > 0 && callsToday >= maxCallsPerDay) {
    return { ok: false, reason: 'daily' };
  }
  return { ok: true };
}

/** Registra el inicio de una llamada (sube concurrencia y cuenta diaria). */
export function registerCallStart(now = new Date()) {
  rolloverIfNeeded(now);
  activeCalls += 1;
  callsToday += 1;
  logger.info(`[limiter] llamada iniciada (activas=${activeCalls}, hoy=${callsToday})`);
}

/** Registra el fin de una llamada (baja concurrencia). */
export function registerCallEnd() {
  if (activeCalls > 0) activeCalls -= 1;
  logger.info(`[limiter] llamada finalizada (activas=${activeCalls})`);
}

// --- Utilidades para tests (no usar en producción) ---
export function _reset() {
  activeCalls = 0;
  callsToday = 0;
  dayKey = todayKey();
}
export function _snapshot() {
  return { activeCalls, callsToday, dayKey };
}
