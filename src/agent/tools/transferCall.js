// Tool: transfer the live call to the CV owner's personal phone.
//
// We redirect the in-progress call via the Twilio REST API: we update the call (by its
// callSid) with TwiML <Dial> to the personal number. Doing so, Twilio ends the current
// <Connect><Stream> and dials the phone; our audio bridge closes on its own when Twilio
// closes the Media Streams WebSocket.

import twilio from 'twilio';
import { twilioClient } from '../../telephony/twilioClient.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export const transferCallTool = {
  definition: {
    type: 'function',
    name: 'transfer_call',
    description:
      "Transfer the current live call to Álvaro's personal phone. Use only when the caller " +
      'explicitly asks to speak with him, or when the conversation clearly needs him directly. ' +
      'Briefly tell the caller you are connecting them before calling this.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Short reason for the transfer, for logging.',
        },
      },
      required: [],
    },
  },

  async handler(args, ctx) {
    if (!twilioClient) return 'Transfer unavailable: telephony is not configured.';
    if (!config.twilio.myPersonalNumber) {
      return 'Transfer unavailable: no personal number is configured.';
    }
    if (!ctx?.callSid) return 'Transfer unavailable: missing the current call reference.';

    try {
      const vr = new VoiceResponse();
      const dial = vr.dial({ callerId: config.twilio.phoneNumber || undefined });
      dial.number(config.twilio.myPersonalNumber);

      await twilioClient.calls(ctx.callSid).update({ twiml: vr.toString() });
      logger.info(
        `[tool:transfer_call] ${ctx.callSid} -> mobile (reason: ${args?.reason ?? 'n/a'})`
      );
      return 'Transfer initiated. Connecting the caller to Álvaro now.';
    } catch (err) {
      logger.error('[tool:transfer_call] error:', err.message);
      return 'The transfer failed due to a technical issue. Offer to take their contact details instead.';
    }
  },
};
