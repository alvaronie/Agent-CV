// ElevenLabs text-to-speech over the multi-context WebSocket.
//
// Used when VOICE_PROVIDER=elevenlabs: OpenAI Realtime replies in text, and this module
// turns that text into speech in Twilio's format (ulaw_8000, so no re-encoding).
//
// One "utterance" per agent response, mapped to one ElevenLabs context:
//   append(id, text) -> creates the context on first text; complete sentences are sent
//                       with flush:true so audio starts before the answer is finished
//   end(id)          -> flushes the rest and closes the context; ElevenLabs then sends
//                       isFinal, which reports the utterance as done
//   cancel()         -> barge-in / farewell: closes every open context, drops its audio
// Utterances play strictly in order: audio of a later one is held until the earlier one
// is final, so two answers never interleave.
//
// The WebSocket factory and timers are injectable so this is unit testable offline.

import WebSocket from 'ws';
import { logger } from '../utils/logger.js';

// If ElevenLabs never confirms the end of an utterance, treat it as done after this.
const FINAL_TIMEOUT_MS = 10000;

/**
 * Splits buffered text into what can be spoken now (whole sentences) and the rest.
 * Long runs without punctuation are cut at a comma or space so speech doesn't stall.
 * @param {string} buffer
 * @param {{maxChars?:number}} [opts]
 * @returns {{ready:string, rest:string}}
 */
export function splitSpeakable(buffer, { maxChars = 160 } = {}) {
  let cut = -1;
  const boundary = /[.!?…:;]+["»”')\]]*\s+/g;
  let m;
  while ((m = boundary.exec(buffer))) cut = m.index + m[0].length;
  if (cut === -1 && buffer.length >= maxChars) {
    const comma = buffer.lastIndexOf(', ');
    const at = comma > 0 ? comma + 1 : buffer.lastIndexOf(' ');
    if (at > 0) cut = at + 1;
  }
  if (cut <= 0) return { ready: '', rest: buffer };
  return { ready: buffer.slice(0, cut), rest: buffer.slice(cut) };
}

export function buildTtsUrl({ voiceId, modelId }) {
  return (
    `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/multi-stream-input` +
    `?model_id=${encodeURIComponent(modelId)}&output_format=ulaw_8000&inactivity_timeout=180`
  );
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.voiceId
 * @param {string} opts.modelId
 * @param {(base64:string, utteranceId:string) => void} opts.onAudio
 * @param {(utteranceId:string) => void} opts.onUtteranceDone
 */
export function createElevenLabsTts({
  apiKey,
  voiceId,
  modelId,
  onAudio,
  onUtteranceDone,
  createSocket = (url, options) => new WebSocket(url, options),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  finalTimeoutMs = FINAL_TIMEOUT_MS,
}) {
  const url = buildTtsUrl({ voiceId, modelId });
  let ws = null;
  let open = false;
  let closedByUs = false;
  let outbox = [];
  let seq = 0;

  const queue = []; // ordered utterances; queue[0] is the one being played
  const byId = new Map();
  const byCtx = new Map();
  const dead = new Set(); // cancelled or lost utterances: ignore any further text

  function send(msg) {
    if (ws && open) ws.send(JSON.stringify(msg));
    else outbox.push(msg);
  }

  function forget(u) {
    if (u.timer) clearTimer(u.timer);
    u.timer = null;
    byCtx.delete(u.ctx);
    byId.delete(u.id);
  }

  // Reports finished utterances in order and releases the held audio of the next one.
  function drain() {
    while (queue.length && queue[0].final) {
      const done = queue.shift();
      forget(done);
      onUtteranceDone?.(done.id);
      const next = queue[0];
      if (next) {
        for (const audio of next.pending) onAudio?.(audio, next.id);
        next.pending = [];
      }
    }
  }

  function handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.error || msg.message) logger.warn('[tts] ElevenLabs message:', msg.error || msg.message);
    const u = byCtx.get(msg.contextId ?? msg.context_id);
    if (!u) return; // cancelled or unknown context
    if (msg.audio) {
      if (u === queue[0]) onAudio?.(msg.audio, u.id);
      else u.pending.push(msg.audio);
    }
    if (msg.isFinal || msg.is_final) {
      u.final = true;
      drain();
    }
  }

  function ensureSocket() {
    if (ws) return;
    open = false;
    closedByUs = false;
    ws = createSocket(url, { headers: { 'xi-api-key': apiKey } });
    ws.on('open', () => {
      open = true;
      const pending = outbox;
      outbox = [];
      for (const m of pending) ws.send(JSON.stringify(m));
    });
    ws.on('message', handleMessage);
    ws.on('close', () => {
      const ours = closedByUs;
      ws = null;
      open = false;
      outbox = [];
      if (ours) return;
      logger.warn('[tts] ElevenLabs connection closed; the current answer is lost');
      // Whatever was in flight is gone: report it done so the call doesn't wait forever.
      for (const u of queue) {
        dead.add(u.id);
        forget(u);
        onUtteranceDone?.(u.id);
      }
      queue.length = 0;
    });
    ws.on('error', (err) => logger.error('[tts] ElevenLabs ws error:', err.message));
  }

  function start(id) {
    ensureSocket();
    seq += 1;
    const u = { id, ctx: `u${seq}`, buffer: '', ended: false, final: false, pending: [], timer: null };
    queue.push(u);
    byId.set(id, u);
    byCtx.set(u.ctx, u);
    send({ text: ' ', context_id: u.ctx });
    return u;
  }

  return {
    /** Opens the connection ahead of time, so the first answer doesn't pay the handshake. */
    connect() {
      ensureSocket();
    },

    /** Appends text of response `id`; whole sentences are sent for synthesis right away. */
    append(id, text) {
      if (!text || dead.has(id)) return;
      const u = byId.get(id) || start(id);
      if (u.ended) return;
      u.buffer += text;
      const { ready, rest } = splitSpeakable(u.buffer);
      if (ready.trim()) {
        send({ text: `${ready.trim()} `, context_id: u.ctx, flush: true });
        u.buffer = rest;
      }
    },

    /**
     * The response is complete. Returns true if it produced speech (done will be reported
     * via onUtteranceDone once the audio has been generated), false otherwise.
     */
    end(id) {
      const u = byId.get(id);
      if (!u) return false;
      if (u.ended) return true;
      u.ended = true;
      const rest = u.buffer.trim();
      u.buffer = '';
      send({ text: rest ? `${rest} ` : '', context_id: u.ctx, flush: true });
      send({ context_id: u.ctx, close_context: true });
      u.timer = setTimer(() => {
        u.final = true;
        drain();
      }, finalTimeoutMs);
      return true;
    },

    /** Stops everything being spoken or queued (barge-in, farewell). */
    cancel() {
      for (const u of queue) {
        send({ context_id: u.ctx, close_context: true });
        dead.add(u.id);
        forget(u);
      }
      queue.length = 0;
    },

    close() {
      closedByUs = true;
      for (const u of queue) forget(u);
      queue.length = 0;
      try {
        ws?.close();
      } catch {
        /* noop */
      }
      ws = null;
      open = false;
      outbox = [];
    },
  };
}
