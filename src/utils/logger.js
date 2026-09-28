// Logger estructurado ligero (Fase 6). Añade timestamp y nivel a cada línea, con
// formato de texto legible por defecto o JSON (LOG_FORMAT=json) para producción.
// Sin dependencias: usa console por debajo. El formateo vive en logFormat.js (testeable).

import { config } from '../config/index.js';
import { formatLog } from './logFormat.js';

const fmt = (level, args) => formatLog(level, args, { format: config.logFormat });

export const logger = {
  info: (...args) => console.log(fmt('info', args)),
  warn: (...args) => console.warn(fmt('warn', args)),
  error: (...args) => console.error(fmt('error', args)),
};
