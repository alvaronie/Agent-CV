// Carga y expone la configuración desde variables de entorno.
//
// Cargamos el .env de la raíz del proyecto con process.loadEnvFile (Node 20.6+),
// ANTES de leer process.env. Así funciona tanto con `npm run dev` como con
// `node src/index.js` directamente, sin depender de flags ni de la librería dotenv.

import process from 'node:process';
import { fileURLToPath } from 'node:url';

try {
  const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
  process.loadEnvFile(envPath);
} catch {
  // Si no hay .env (p. ej. en producción con variables ya inyectadas), seguimos.
}

// Lee una variable numérica respetando el 0 (a diferencia de `Number(x) || def`, que
// trataría 0 como "sin valor"). Útil para límites donde 0 significa "sin límite".
function numEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  // Interfaz en la que escucha el servidor. Por defecto SOLO la máquina local
  // (127.0.0.1): en desarrollo nadie más de la red debe poder alcanzarnos. En el
  // despliegue a la nube (Fase 7) hay que poner HOST=0.0.0.0 para aceptar tráfico
  // externo, que es donde sí tiene sentido.
  host: process.env.HOST || '127.0.0.1',
  // URL pública del backend. En Render, si no se define PUBLIC_URL, usamos la que la
  // plataforma inyecta automáticamente (RENDER_EXTERNAL_URL). Se usa para construir la
  // URL wss:// del <Stream> y para validar la firma de Twilio.
  publicUrl: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '',

  // Formato de los logs: 'text' (legible, dev) o 'json' (agregadores, producción).
  logFormat: (process.env.LOG_FORMAT || 'text').toLowerCase() === 'json' ? 'json' : 'text',

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini',
    voice: process.env.OPENAI_VOICE || 'alloy',
    // Modelo que transcribe el audio del llamante (subtítulos de la conversación).
    transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1',
    // Modelo de texto que redacta el resumen al colgar (Fase 5).
    summaryModel: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
    // Reintentos de reconexión si el WebSocket de OpenAI se cae a media llamada (Fase 6).
    reconnectMaxAttempts: numEnv('OPENAI_RECONNECT_MAX_ATTEMPTS', 3),
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    myPersonalNumber: process.env.MY_PERSONAL_NUMBER || '',
  },

  email: {
    provider: process.env.EMAIL_PROVIDER || 'resend',
    apiKey: process.env.EMAIL_API_KEY || '',
    from: process.env.EMAIL_FROM || '',
    to: process.env.EMAIL_TO || '',
  },

  // Guardarraíles de seguridad (Fase 6).
  security: {
    // Validar la firma `X-Twilio-Signature` en /incoming-call. Activada por defecto;
    // ponla a "false" SOLO para pruebas locales manuales (curl/navegador), donde no hay
    // firma. En producción debe quedar activada.
    validateTwilioSignature:
      (process.env.VALIDATE_TWILIO_SIGNATURE || 'true').toLowerCase() !== 'false',
    // Secreto para firmar el token de un solo uso que autentica el WebSocket
    // /media-stream. Si está vacío, la verificación queda DESACTIVADA (solo dev): en
    // producción hay que definirlo para que solo Twilio pueda abrir el stream.
    streamTokenSecret: process.env.STREAM_TOKEN_SECRET || '',
    // Validez (segundos) del token del stream. Twilio abre el WebSocket casi de
    // inmediato tras el webhook, así que un margen corto sobra.
    streamTokenTtlSeconds: Number(process.env.STREAM_TOKEN_TTL_SECONDS) || 300,
  },

  // Límites de admisión de llamadas (Fase 6): guardarraíl de coste frente a picos o
  // abuso. 0 en cualquiera de ellos = sin límite.
  limits: {
    // Máximo de llamadas ACTIVAS a la vez (concurrencia).
    maxConcurrentCalls: numEnv('MAX_CONCURRENT_CALLS', 2),
    // Máximo de llamadas aceptadas por día (se reinicia a medianoche UTC).
    maxCallsPerDay: numEnv('MAX_CALLS_PER_DAY', 50),
  },

  maxCallSeconds: Number(process.env.MAX_CALL_SECONDS) || 600,
  // Cierra la llamada si no hay actividad (silencio total) durante este tiempo. 0 = off.
  silenceTimeoutSeconds: numEnv('SILENCE_TIMEOUT_SECONDS', 20),
  // Máximo de turnos del llamante antes de cerrar (guardarraíl anti-bucle). 0 = off.
  maxCallerTurns: numEnv('MAX_CALLER_TURNS', 40),
};
