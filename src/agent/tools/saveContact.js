// Tool: save the caller's contact details so we can call them back.
//
// Collects name, company, phone, email and reason, and persists them with storage.js.
// The model must confirm the details with the caller before calling this tool.
//
// `use_caller_number`: when the caller wants to be called back on the number they are
// calling from, the server fills it in from the call itself. The model never needs to
// know or read out the number.

import { saveContact as persistContact } from '../../services/storage.js';
import { isCallableNumber } from '../../telephony/callerNumber.js';
import { logger } from '../../utils/logger.js';

/**
 * Builds the contact record to persist. Pure function (unit tested).
 * @param {object} args - tool arguments
 * @param {{callSid?:string, callerNumber?:string}} [ctx]
 */
export function buildContactRecord(args = {}, ctx = {}) {
  const { use_caller_number: useCallerNumber, ...fields } = args;
  const record = { ...fields, callSid: ctx.callSid };
  if (!record.phone && useCallerNumber && isCallableNumber(ctx.callerNumber)) {
    record.phone = ctx.callerNumber;
    record.phoneSource = 'caller_id';
  }
  return record;
}

export const saveContactTool = {
  definition: {
    type: 'function',
    name: 'save_contact',
    description:
      "Save the caller's contact details so Álvaro can call them back. Use when the caller " +
      'wants a callback, or when you cannot fully help them. Read the details back to confirm ' +
      'them with the caller before calling this.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "Caller's full name, if they gave it." },
        company: { type: 'string', description: 'Company or organization the caller represents.' },
        phone: {
          type: 'string',
          description: 'Callback phone number, only if it is different from the one they are calling from.',
        },
        use_caller_number: {
          type: 'boolean',
          description:
            'true if the caller wants to be called back on the number they are calling from. ' +
            'The system fills it in; do not ask for it or read it out.',
        },
        email: { type: 'string', description: 'Contact email address.' },
        reason: { type: 'string', description: 'Reason for the call or message for Álvaro.' },
      },
      required: [],
    },
  },

  async handler(args, ctx) {
    try {
      const record = buildContactRecord(args, ctx);
      if (args?.use_caller_number && !record.phone && !record.email) {
        return (
          "The caller's number is not available (it may be withheld). Ask for a phone " +
          'number or an email address, read it back, and call save_contact again with it.'
        );
      }
      await persistContact(record);
      return 'Contact details saved. Álvaro will get back to them.';
    } catch (err) {
      logger.error('[tool:save_contact] error:', err.message);
      return 'Could not save the contact details due to a technical issue.';
    }
  },
};
