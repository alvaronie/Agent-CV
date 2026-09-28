// Punto de entrada: servidor HTTP + WebSocket con Fastify.
//
// Rutas:
//  - GET  /health          -> comprobación de estado.
//  - POST|GET /incoming-call -> webhook de Twilio (devuelve TwiML <Connect><Stream>).
//  - WS   /media-stream     -> audio en tiempo real (Twilio Media Streams <-> OpenAI).

import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';

import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { handleIncomingCall } from './telephony/twilioWebhook.js';
import { handleMediaStream } from './telephony/mediaStream.js';
import { verifyStreamToken } from './security/streamToken.js';

const app = Fastify({ logger: false });

// Plugins: parseo de formularios (Twilio) y soporte WebSocket.
await app.register(formbody);
await app.register(websocket);

// Estado del servicio.
app.get('/health', async () => ({ status: 'ok', service: 'agent-cv' }));

// Webhook de llamada entrante (Twilio usa POST; aceptamos GET para pruebas manuales).
app.post('/incoming-call', handleIncomingCall);
app.get('/incoming-call', handleIncomingCall);

// Endpoint WebSocket para el audio en tiempo real.
app.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, (socket /* WebSocket */, req) => {
    // Autenticación (Fase 6): solo Twilio conoce el token que incrustamos en el TwiML.
    // Rechazamos la conexión ANTES de conectar con OpenAI para no gastar tokens.
    const result = verifyStreamToken(req.query?.token);
    if (!result.valid) {
      logger.warn(`[media] conexión WebSocket rechazada (token ${result.reason})`);
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
    logger.warn('[seguridad] validación de firma de Twilio DESACTIVADA (solo para pruebas locales)');
  }
  if (!config.security.streamTokenSecret) {
    logger.warn('[seguridad] STREAM_TOKEN_SECRET vacío: /media-stream SIN autenticar (solo dev)');
  }
  await app.listen({ port: config.port, host: config.host });
  logger.info(`Agent CV escuchando en http://${config.host}:${config.port}`);
  logger.info('  - Salud:   GET  /health');
  logger.info('  - Webhook: POST /incoming-call');
  logger.info('  - Audio:   WS   /media-stream');
} catch (err) {
  logger.error('No se pudo arrancar el servidor:', err);
  process.exit(1);
}
