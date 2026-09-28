// Entry point: HTTP + WebSocket server with Fastify.
//
// Routes:
//  - GET  /health           -> health check.
//  - POST|GET /incoming-call -> Twilio webhook (returns TwiML <Connect><Stream>).
//  - WS   /media-stream      -> real-time audio (Twilio Media Streams <-> OpenAI).

import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';

import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { handleIncomingCall } from './telephony/twilioWebhook.js';
import { handleMediaStream } from './telephony/mediaStream.js';
import { verifyStreamToken } from './security/streamToken.js';

const app = Fastify({ logger: false });

// Plugins: form parsing (Twilio) and WebSocket support.
await app.register(formbody);
await app.register(websocket);

// Service status.
app.get('/health', async () => ({ status: 'ok', service: 'agent-cv' }));

// Incoming-call webhook (Twilio uses POST; we accept GET for manual testing).
app.post('/incoming-call', handleIncomingCall);
app.get('/incoming-call', handleIncomingCall);

// WebSocket endpoint for real-time audio.
app.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, (socket /* WebSocket */, req) => {
    // Authentication (Phase 6): only Twilio knows the token we embed in the TwiML.
    // We reject the connection BEFORE connecting to OpenAI so we don't burn tokens.
    const result = verifyStreamToken(req.query?.token);
    if (!result.valid) {
      logger.warn(`[media] WebSocket connection rejected (token ${result.reason})`);
      try {
        socket.close(1008, 'unauthorized');
      } catch {
        /* noop */
      }
      return;
    }
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
  await app.listen({ port: config.port, host: config.host });
  logger.info(`Agent CV listening on http://${config.host}:${config.port}`);
  logger.info('  - Health:  GET  /health');
  logger.info('  - Webhook: POST /incoming-call');
  logger.info('  - Audio:   WS   /media-stream');
} catch (err) {
  logger.error('Could not start the server:', err);
  process.exit(1);
}
