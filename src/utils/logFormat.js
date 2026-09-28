// Log line formatting (Phase 6): pure, testable function (no console or network).
//
// Two formats:
//   - 'text' (default, readable in dev):  "<ISO> <LEVEL> <message>"
//   - 'json' (for production/aggregators): {"ts","level","msg"}
//
// Non-string arguments are serialized safely: Errors show their stack, objects are
// turned into JSON, and anything non-serializable falls back to String().

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
