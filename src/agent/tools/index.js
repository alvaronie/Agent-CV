// Central registry of the agent's tools.
//
// - toolDefinitions: array of definitions (JSON schema) sent to OpenAI in the
//   session.update so the model knows which tools it can call.
// - dispatchToolCall: receives the Realtime API function-call event and its context
//   (callSid, streamSid, twilioWs, realtime, endCall), runs the right handler and
//   returns { output, triggerResponse } so the bridge can reply to the model.

import { transferCallTool } from './transferCall.js';
import { saveContactTool } from './saveContact.js';
import { endCallTool } from './endCall.js';

const tools = [transferCallTool, saveContactTool, endCallTool];

export const toolDefinitions = tools.map((t) => t.definition);

const byName = new Map(tools.map((t) => [t.definition.name, t]));

/**
 * Runs the tool indicated by a `response.function_call_arguments.done` event.
 * @param {{name:string, call_id:string, arguments?:string}} event
 * @param {object} ctx - Live call context.
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
      // Malformed arguments: continue with an empty object; the handler will decide.
    }
  }

  const output = await tool.handler(args, ctx);
  const triggerResponse = tool.triggerResponse !== false;
  return { output, triggerResponse };
}
