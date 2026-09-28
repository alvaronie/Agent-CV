// Lightweight structured logger (Phase 6). Adds a timestamp and level to each line, in
// a readable text format by default or JSON (LOG_FORMAT=json) for production.
// No dependencies: uses console underneath. Formatting lives in logFormat.js (testable).

import { config } from '../config/index.js';
import { formatLog } from './logFormat.js';

const fmt = (level, args) => formatLog(level, args, { format: config.logFormat });

export const logger = {
  info: (...args) => console.log(fmt('info', args)),
  warn: (...args) => console.warn(fmt('warn', args)),
  error: (...args) => console.error(fmt('error', args)),
};
