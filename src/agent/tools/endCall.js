// Tool: end the call in an orderly way.
//
// The model must say goodbye BEFORE calling this tool. When run, we delegate the actual
// teardown to the bridge (ctx.endCall), which gives a small margin for the goodbye to
// finish playing and then hangs up on Twilio and closes the session.
//
// triggerResponse=false: we don't want the model to generate another response after this.
// The email summary (Phase 5) will be triggered from the bridge teardown.

import { logger } from '../../utils/logger.js';

export const endCallTool = {
  triggerResponse: false,

  definition: {
    type: 'function',
    name: 'end_call',
    description:
      'End the call. Only use it after the caller clearly says goodbye or confirms they ' +
      'need nothing else (ask first whether there is anything else you can help with). ' +
      'Say a brief goodbye BEFORE calling this tool.',
    parameters: { type: 'object', properties: {}, required: [] },
  },

  async handler(_args, ctx) {
    logger.info('[tool:end_call] teardown requested by the agent');
    ctx?.endCall?.();
    return 'Ending the call now.';
  },
};
