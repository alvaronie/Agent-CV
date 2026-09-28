// Cliente REST de Twilio, compartido por las tools que actúan sobre la llamada viva
// (transferir, colgar). Se construye una sola vez a partir de las credenciales del .env.
//
// Si faltan credenciales (p. ej. en un entorno de pruebas), exportamos null y las tools
// lo detectan y devuelven un mensaje de "no disponible" en lugar de reventar.

import twilio from 'twilio';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let client = null;

if (config.twilio.accountSid && config.twilio.authToken) {
  client = twilio(config.twilio.accountSid, config.twilio.authToken);
} else {
  logger.warn('[twilio] credenciales ausentes: las tools de transferir/colgar no operarán');
}

export const twilioClient = client;
