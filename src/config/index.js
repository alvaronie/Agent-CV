// Loads and exposes configuration from environment variables.
//
// We load the project-root .env with process.loadEnvFile (Node 20.6+) BEFORE reading
// process.env. This works both with `npm run dev` and with `node src/index.js`
// directly, without depending on flags or the dotenv library.

import process from 'node:process';
import { fileURLToPath } from 'node:url';

try {
  const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
  process.loadEnvFile(envPath);
} catch {
  // If there is no .env (e.g. in production with variables already injected), continue.
}

// Reads a numeric variable while respecting 0 (unlike `Number(x) || def`, which would
// treat 0 as "no value"). Useful for limits where 0 means "no limit".
function numEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  // Interface the server listens on. By default ONLY the local machine (127.0.0.1):
  // in development nobody else on the network should be able to reach us. For the cloud
  // deployment (Phase 7) set HOST=0.0.0.0 to accept external traffic, which is where it
  // actually makes sense.
  host: process.env.HOST || '127.0.0.1',
  // Public URL of the backend. On Render, if PUBLIC_URL is not set, we use the one the
  // platform injects automatically (RENDER_EXTERNAL_URL). Used to build the wss:// URL
  // of the <Stream> and to validate the Twilio signature.
  publicUrl: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '',

  // Log format: 'text' (readable, dev) or 'json' (aggregators, production).
  logFormat: (process.env.LOG_FORMAT || 'text').toLowerCase() === 'json' ? 'json' : 'text',

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini',
    voice: process.env.OPENAI_VOICE || 'alloy',
    // Model that transcribes the caller's audio (conversation subtitles). whisper-1
    // invents text on silence/noise (the classic phantom "Thank you."), so we use
    // gpt-4o-mini-transcribe.
    transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
    // Text model that writes the summary when the call ends (Phase 5).
    summaryModel: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
    // Reconnection attempts if the OpenAI WebSocket drops mid-call (Phase 6).
    reconnectMaxAttempts: numEnv('OPENAI_RECONNECT_MAX_ATTEMPTS', 3),
  },

  // Who produces the agent's voice:
  //   'openai'     -> OpenAI Realtime speech-to-speech (default, what has been tested).
  //   'elevenlabs' -> OpenAI Realtime replies in TEXT and ElevenLabs speaks it.
  // With 'elevenlabs' but no key or voice id, the code falls back to 'openai'.
  voiceProvider:
    (process.env.VOICE_PROVIDER || 'openai').toLowerCase() === 'elevenlabs' ? 'elevenlabs' : 'openai',

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || '',
    voiceId: process.env.ELEVENLABS_VOICE_ID || '',
    // v4 Turbo: the only model that, with our voice, gives each language its own accent
    // without being told the language (tested). Served over the Text to Dialogue
    // WebSocket. Set eleven_flash_v2_5 to go back to the multi-context TTS WebSocket.
    modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_v4_turbo',
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

  // Security guardrails (Phase 6).
  security: {
    // Validate the `X-Twilio-Signature` header on /incoming-call. Enabled by default;
    // set it to "false" ONLY for manual local testing (curl/browser), where there is no
    // signature. In production it must stay enabled.
    validateTwilioSignature:
      (process.env.VALIDATE_TWILIO_SIGNATURE || 'true').toLowerCase() !== 'false',
    // Secret used to sign the single-use token that authenticates the /media-stream
    // WebSocket. If empty, verification is DISABLED (dev only): in production it must be
    // set so that only Twilio can open the stream.
    streamTokenSecret: process.env.STREAM_TOKEN_SECRET || '',
    // Validity (seconds) of the stream token. Twilio opens the WebSocket almost
    // immediately after the webhook, so a short window is plenty.
    streamTokenTtlSeconds: Number(process.env.STREAM_TOKEN_TTL_SECONDS) || 300,
  },

  // Call admission limits (Phase 6): cost guardrail against spikes or abuse. 0 in any of
  // them = no limit.
  limits: {
    // Maximum number of ACTIVE calls at once (concurrency).
    maxConcurrentCalls: numEnv('MAX_CONCURRENT_CALLS', 2),
    // Maximum number of calls accepted per day (resets at midnight UTC).
    maxCallsPerDay: numEnv('MAX_CALLS_PER_DAY', 50),
  },

  maxCallSeconds: Number(process.env.MAX_CALL_SECONDS) || 600,
  // Close the call if there is no activity (total silence) for this long. 0 = off.
  silenceTimeoutSeconds: numEnv('SILENCE_TIMEOUT_SECONDS', 20),
  // Maximum caller turns before closing (anti-loop guardrail). 0 = off.
  maxCallerTurns: numEnv('MAX_CALLER_TURNS', 40),
};
