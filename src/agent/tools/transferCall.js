// Tool: transfer the live call to the CV owner's personal phone.
//
// We redirect the in-progress call via the Twilio REST API: we update the call (by its
// callSid) with TwiML <Dial> to the personal number. Doing so, Twilio ends the current
// <Connect><Stream> and dials the phone; our audio bridge closes on its own when Twilio
// closes the Media Streams WebSocket.
//
// If Álvaro doesn't pick up (no answer, busy/rejected, blocked...), <Dial> calls its
// `action` URL (/transfer-status), which reconnects the call to the agent so the
// conversation continues. Without an action URL Twilio would simply end the call.
//
// Before redirecting, the call is marked as "transferring" so the stream closing is not
// mistaken for the end of the call (the summary email is sent once, at the real end).

import twilio from 'twilio';
import { twilioClient } from '../../telephony/twilioClient.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

// Seconds to let the personal phone ring before giving up.
const DIAL_TIMEOUT_SECONDS = 25;

/**
 * Builds the transfer TwiML. Pure function (no network), so it can be unit tested.
 * @param {{personalNumber:string, callerId?:string, publicUrl?:string, language?:string}} opts
 * @returns {string}
 */
export function buildTransferTwiml({ personalNumber, callerId, publicUrl, language }) {
  const lang = language === 'es' ? 'es' : 'en';
  const vr = new VoiceResponse();
  const dialOpts = { callerId: callerId || undefined, timeout: DIAL_TIMEOUT_SECONDS };
  // The action URL must be absolute: TwiML pushed via the REST API has no document URL
  // that a relative one could resolve against.
  if (publicUrl) {
    dialOpts.action = `${publicUrl.replace(/\/$/, '')}/transfer-status?lang=${lang}`;
    dialOpts.method = 'POST';
  }
  const dial = vr.dial(dialOpts);
  dial.number(personalNumber);
  return vr.toString();
}

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
        language: {
          type: 'string',
          enum: ['en', 'es'],
          description:
            'Language you are speaking with the caller, so the conversation can continue ' +
            'in it if Álvaro does not pick up.',
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
      const twiml = buildTransferTwiml({
        personalNumber: config.twilio.myPersonalNumber,
        callerId: config.twilio.phoneNumber,
        publicUrl: config.publicUrl,
        language: args?.language,
      });

      // Mark first: Twilio closes our stream as soon as it processes the update.
      ctx.markTransferring?.();
      await twilioClient.calls(ctx.callSid).update({ twiml });
      logger.info(
        `[tool:transfer_call] ${ctx.callSid} -> mobile (reason: ${args?.reason ?? 'n/a'})`
      );
      return 'Transfer initiated. Connecting the caller to Álvaro now.';
    } catch (err) {
      ctx.cancelTransfer?.();
      logger.error('[tool:transfer_call] error:', err.message);
      return 'The transfer failed due to a technical issue. Offer to take their contact details instead.';
    }
  },
};
