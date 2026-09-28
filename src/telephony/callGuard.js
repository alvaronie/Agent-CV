// Guard de llamada (Fase 6): dos guardarraíles de coste/UX durante la conversación.
//
//   - Timeout por silencio: si no hay NINGUNA actividad (ni habla del llamante ni voz
//     del agente) durante `silenceMs`, se considera llamada muerta y se cierra.
//   - Máximo de turnos del llamante: si la conversación se alarga sin avanzar, se
//     cierra al superar `maxCallerTurns`.
//
// La lógica se aísla aquí, con los temporizadores INYECTABLES (setTimer/clearTimer),
// para poder probarla sin abrir WebSockets ni esperar en tiempo real. `0` en cualquiera
// de los límites lo desactiva.

/**
 * @param {object} opts
 * @param {number} opts.silenceMs - ms de inactividad antes de cerrar (0 = desactivado)
 * @param {number} opts.maxCallerTurns - turnos del llamante máximos (0 = desactivado)
 * @param {() => void} [opts.onSilence] - se invoca al agotarse el silencio
 * @param {() => void} [opts.onMaxTurns] - se invoca al superar el máximo de turnos
 * @param {typeof setTimeout} [opts.setTimer]
 * @param {typeof clearTimeout} [opts.clearTimer]
 */
export function createCallGuard({
  silenceMs,
  maxCallerTurns,
  onSilence,
  onMaxTurns,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  let callerTurns = 0;
  let stopped = false;

  function armSilence() {
    if (stopped || !silenceMs || silenceMs <= 0) return;
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      if (!stopped) onSilence?.();
    }, silenceMs);
  }

  return {
    /** Arranca el guard (arma el timer de silencio). */
    start() {
      armSilence();
    },
    /** Marca actividad (habla de cualquiera / audio del agente): reinicia el silencio. */
    activity() {
      armSilence();
    },
    /**
     * Contabiliza un turno del llamante. Devuelve true (y avisa) si se supera el máximo.
     * @returns {boolean}
     */
    countCallerTurn() {
      callerTurns += 1;
      if (maxCallerTurns > 0 && callerTurns >= maxCallerTurns) {
        onMaxTurns?.();
        return true;
      }
      return false;
    },
    /** Detiene el guard: no más disparos ni timers. */
    stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
    _state() {
      return { callerTurns, armed: timer !== null, stopped };
    },
  };
}
