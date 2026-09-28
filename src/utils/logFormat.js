// Formateo de líneas de log (Fase 6): función pura y testeable (sin consola ni red).
//
// Dos formatos:
//   - 'text' (por defecto, legible en dev):  "<ISO> <LEVEL> <mensaje>"
//   - 'json' (para producción/agregadores):  {"ts","level","msg"}
//
// Los argumentos no-string se serializan de forma segura: los Error muestran su stack,
// los objetos se pasan a JSON, y si algo no es serializable se cae a String().

function stringifyArg(a) {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

/**
 * @param {'info'|'warn'|'error'} level
 * @param {unknown[]} args
 * @param {{format?: 'text'|'json', now?: Date}} [opts]
 * @returns {string}
 */
export function formatLog(level, args, { format = 'text', now = new Date() } = {}) {
  const msg = args.map(stringifyArg).join(' ');
  const ts = now.toISOString();
  if (format === 'json') {
    return JSON.stringify({ ts, level, msg });
  }
  return `${ts} ${level.toUpperCase().padEnd(5)} ${msg}`;
}
