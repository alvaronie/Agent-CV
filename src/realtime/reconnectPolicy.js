// Política de reconexión del WebSocket de OpenAI (Fase 6).
//
// Función pura (sin red ni estado): dado el número de intentos ya realizados y el
// máximo permitido, decide si reintentar y con cuánto retardo (backoff exponencial
// acotado). Se aísla aquí para poder probarla sin abrir ninguna conexión.

/**
 * @param {object} opts
 * @param {number} opts.attempt - intentos de reconexión ya consumidos (0 = ninguno aún)
 * @param {number} opts.maxAttempts - máximo de reintentos permitidos
 * @param {number} [opts.baseDelayMs] - retardo base
 * @param {number} [opts.maxDelayMs] - retardo máximo (tope del backoff)
 * @returns {{shouldReconnect: boolean, delayMs: number}}
 */
export function nextReconnect({
  attempt,
  maxAttempts,
  baseDelayMs = 500,
  maxDelayMs = 4000,
}) {
  if (attempt >= maxAttempts) {
    return { shouldReconnect: false, delayMs: 0 };
  }
  const delayMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  return { shouldReconnect: true, delayMs };
}
