// Twilio REST client, shared by the tools that act on the live call (transfer, hang up).
// Built once from the credentials in .env.
//
// If credentials are missing (e.g. in a test environment), we export null and the tools
// detect it and return a "not available" message instead of crashing.

import twilio from 'twilio';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let client = null;

if (config.twilio.accountSid && config.twilio.authToken) {
  client = twilio(config.twilio.accountSid, config.twilio.authToken);
} else {
  logger.warn('[twilio] missing credentials: the transfer/hang-up tools will not operate');
}

export const twilioClient = client;
