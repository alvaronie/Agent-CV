// Tool: finalizar la llamada de forma ordenada.
//
// El modelo debe despedirse ANTES de invocar esta tool. Al ejecutarla, delegamos el
// cierre real en el puente (ctx.endCall), que da un pequeño margen para que termine de
// sonar la despedida y luego cuelga en Twilio y cierra la sesión.
//
// triggerResponse=false: no queremos que el modelo genere otra respuesta tras esto.
// El resumen por email (Fase 5) se disparará desde el cierre del puente.

import { logger } from '../../utils/logger.js';

export const endCallTool = {
  triggerResponse: false,

  definition: {
    type: 'function',
    name: 'end_call',
    description:
      'End the call politely once the caller has what they need or says goodbye. ' +
      'Say a brief goodbye BEFORE calling this tool.',
    parameters: { type: 'object', properties: {}, required: [] },
  },

  async handler(_args, ctx) {
    logger.info('[tool:end_call] cierre solicitado por el agente');
    ctx?.endCall?.();
    return 'Ending the call now.';
  },
};
