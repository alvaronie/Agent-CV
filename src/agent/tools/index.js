// Registro central de tools del agente.
//
// - toolDefinitions: array de definiciones (JSON schema) que se envía a OpenAI en la
//   session.update para que el modelo sepa qué tools puede invocar.
// - dispatchToolCall: recibe el evento de function call de la Realtime API y su contexto
//   (callSid, streamSid, twilioWs, realtime, endCall), ejecuta el handler adecuado y
//   devuelve { output, triggerResponse } para que el puente responda al modelo.

import { transferCallTool } from './transferCall.js';
import { saveContactTool } from './saveContact.js';
import { endCallTool } from './endCall.js';

const tools = [transferCallTool, saveContactTool, endCallTool];

export const toolDefinitions = tools.map((t) => t.definition);

const byName = new Map(tools.map((t) => [t.definition.name, t]));

/**
 * Ejecuta la tool indicada por un evento `response.function_call_arguments.done`.
 * @param {{name:string, call_id:string, arguments?:string}} event
 * @param {object} ctx - Contexto de la llamada viva.
 * @returns {Promise<{output:string, triggerResponse:boolean}>}
 */
export async function dispatchToolCall(event, ctx) {
  const tool = byName.get(event?.name);
  if (!tool) {
    return { output: `Unknown tool: ${event?.name}`, triggerResponse: true };
  }

  let args = {};
  if (event.arguments) {
    try {
      args = JSON.parse(event.arguments);
    } catch {
      // Argumentos malformados: seguimos con objeto vacío; el handler decidirá.
    }
  }

  const output = await tool.handler(args, ctx);
  const triggerResponse = tool.triggerResponse !== false;
  return { output, triggerResponse };
}
