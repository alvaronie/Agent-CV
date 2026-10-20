// Entry point: HTTP + WebSocket server with Fastify.
//
// Routes:
//  - GET  /health           -> health check.
//  - POST|GET /incoming-call -> Twilio webhook (returns TwiML <Connect><Stream>).
//  - POST /transfer-status   -> transfer <Dial> outcome (apology if it didn't connect).
//  - WS   /media-stream      -> real-time audio (Twilio Media Streams <-> OpenAI).

import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';

import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { handleIncomingCall } from './telephony/twilioWebhook.js';
import { handleTransferStatus } from './telephony/transferStatus.js';
import { handleMediaStream, isElevenLabsEnabled } from './telephony/mediaStream.js';

const app = Fastify({ logger: false });

// Plugins: form parsing (Twilio) and WebSocket support.
await app.register(formbody);
await app.register(websocket);

// Service status.
app.get('/health', async () => ({ status: 'ok', service: 'agent-cv' }));

// Incoming-call webhook (Twilio uses POST; we accept GET for manual testing).
app.post('/incoming-call', handleIncomingCall);
app.get('/incoming-call', handleIncomingCall);

// Transfer outcome callback (<Dial action>): apologizes if the transfer did not connect.
app.post('/transfer-status', handleTransferStatus);

// WebSocket endpoint for real-time audio.
// Authentication (Phase 6) happens inside handleMediaStream on the `start` event: Twilio's
// <Stream> url does not support query strings, so the signed token arrives as a Custom
// Parameter. Nothing is sent to OpenAI until it verifies.
app.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, (socket /* WebSocket */) => {
    handleMediaStream(socket);
  });
});

try {
  if (!config.security.validateTwilioSignature) {
    logger.warn('[security] Twilio signature validation DISABLED (local testing only)');
  }
  if (!config.security.streamTokenSecret) {
    logger.warn('[security] STREAM_TOKEN_SECRET empty: /media-stream NOT authenticated (dev only)');
  }
  if (config.voiceProvider === 'elevenlabs' && !isElevenLabsEnabled()) {
    logger.warn(
      '[voice] VOICE_PROVIDER=elevenlabs but ELEVENLABS_API_KEY/ELEVENLABS_VOICE_ID missing; using OpenAI voice'
    );
  }
  logger.info(
    `[voice] agent voice: ${isElevenLabsEnabled() ? `elevenlabs (${config.elevenlabs.modelId})` : 'openai'}`
  );
  await app.listen({ port: config.port, host: config.host });
  logger.info(`Agent CV listening on http://${config.host}:${config.port}`);
  logger.info('  - Health:  GET  /health');
  logger.info('  - Webhook: POST /incoming-call');
  logger.info('  - Audio:   WS   /media-stream');
} catch (err) {
  logger.error('Could not start the server:', err);
  process.exit(1);
}
