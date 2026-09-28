// Tool: guardar los datos de contacto de quien llama para devolverle la llamada.
//
// Recoge nombre, empresa, teléfono, email y motivo, y los persiste con storage.js.
// El modelo debe confirmar los datos con el llamante antes de invocar esta tool.

import { saveContact as persistContact } from '../../services/storage.js';
import { logger } from '../../utils/logger.js';

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
        name: { type: 'string', description: "Caller's full name." },
        company: { type: 'string', description: 'Company or organization the caller represents.' },
        phone: { type: 'string', description: 'Callback phone number.' },
        email: { type: 'string', description: 'Contact email address.' },
        reason: { type: 'string', description: 'Reason for the call or message for Álvaro.' },
      },
      required: ['name'],
    },
  },

  async handler(args, ctx) {
    try {
      await persistContact({ ...args, callSid: ctx?.callSid });
      return 'Contact details saved. Álvaro will get back to them.';
    } catch (err) {
      logger.error('[tool:save_contact] error:', err.message);
      return 'Could not save the contact details due to a technical issue.';
    }
  },
};
