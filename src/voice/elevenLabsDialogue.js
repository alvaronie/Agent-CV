// ElevenLabs v4 / v3 voices over the Text to Dialogue WebSocket.
//
// Why a second client: Eleven v4 Turbo is the only model that, with our voice, speaks
// each language with its own accent (English with an English accent, Spanish with a
// Spain accent) without being told the language. ElevenLabs offers v4/v3 in real time
// only through the Text to Dialogue WebSocket, which works differently from the
// multi-context TTS WebSocket used for Flash (see elevenLabsTts.js):
//   - one audio stream per connection, no per-answer contexts;
//   - no way to cancel an answer: barge-in closes the connection and opens a fresh one;
//   - first message must register the voice; text goes in `inputs` frames;
//   - the connection closes after 20 s of inactivity unless we send keep_alive.
//
// Same interface as elevenLabsTts.js (connect/append/end/cancel/close + onAudio and
// onUtteranceDone), so the audio bridge doesn't care which one is in use.
//
// "Answer finished" signal: the protocol's per-turn final flag isn't documented clearly
// enough to rely on alone, so an answer counts as done once all its text was sent AND
// no more audio has arrived for a short while (shorter if the final flag arrives), with
// a hard cap in case nothing comes back.
//
// WebSocket factory and timers are injectable so this is unit testable offline.

import WebSocket from 'ws';
import { logger } from '../utils/logger.js';
import { splitSpeakable } from './elevenLabsTts.js';

const KEEP_ALIVE_MS = 15000; // server closes idle connections after 20 s
const IDLE_DONE_MS = 800; // no audio for this long after the last text -> answer done
const FINAL_DONE_MS = 150; // same, once the server flags the final audio of the turn
const CAP_DONE_MS = 10000; // give up waiting for audio

/** Models served by the Text to Dialogue WebSocket. */
export function isDialogueModel(modelId) {
  return /^eleven_v[34]/.test(modelId || '');
}

export function buildDialogueUrl({ modelId }) {
  return (
    'wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input' +
    `?model_id=${encodeURIComponent(modelId)}&output_format=ulaw_8000`
  );
}

export function createElevenLabsDialogue({
  apiKey,
  voiceId,
  modelId,
  onAudio,
  onUtteranceDone,
  createSocket = (url, options) => new WebSocket(url, options),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const url = buildDialogueUrl({ modelId });
  let ws = null;
  let open = false;
  let outbox = [];
  let keepAliveTimer = null;

  const queue = []; // answers in order; queue[0] is the one whose audio is arriving
  const byId = new Map();
  const dead = new Set(); // cancelled or lost answers: ignore any further text

  function send(msg) {
    if (ws && open) ws.send(JSON.stringify(msg));
    else outbox.push(msg);
  }

  function clearUtteranceTimers(u) {
    if (u.idleTimer) clearTimer(u.idleTimer);
    if (u.capTimer) clearTimer(u.capTimer);
    u.idleTimer = null;
    u.capTimer = null;
  }

  function finish(u) {
    if (queue[0] !== u) return;
    queue.shift();
    clearUtteranceTimers(u);
    byId.delete(u.id);
    onUtteranceDone?.(u.id);
    // The next answer may already have audio flowing.
    const next = queue[0];
    if (next?.ended && next.gotAudio) armIdle(next, IDLE_DONE_MS);
  }

  function armIdle(u, ms) {
    if (u.idleTimer) clearTimer(u.idleTimer);
    u.idleTimer = setTimer(() => {
      u.idleTimer = null;
      finish(u);
    }, ms);
  }

  function scheduleKeepAlive() {
    if (keepAliveTimer) clearTimer(keepAliveTimer);
    keepAliveTimer = setTimer(() => {
      keepAliveTimer = null;
      if (ws && open) ws.send(JSON.stringify({ keep_alive: true }));
      if (ws) scheduleKeepAlive();
    }, KEEP_ALIVE_MS);
  }

  function dropSocket() {
    if (keepAliveTimer) clearTimer(keepAliveTimer);
    keepAliveTimer = null;
    const old = ws;
    ws = null;
    open = false;
    outbox = [];
    if (old) {
      old.ownedClose = true;
      try {
        old.close();
      } catch {
        /* noop */
      }
    }
  }

  function ensureSocket() {
    if (ws) return;
    const socket = createSocket(url, { headers: { 'xi-api-key': apiKey } });
    ws = socket;
    open = false;
    socket.on('open', () => {
      if (ws !== socket) return;
      open = true;
      socket.send(JSON.stringify({ voices: [voiceId] })); // must be the first message
      const pending = outbox;
      outbox = [];
      for (const m of pending) socket.send(JSON.stringify(m));
      scheduleKeepAlive();
    });
    socket.on('message', (raw) => {
      if (ws !== socket) return; // audio from a connection we already dropped
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.error) {
        logger.warn('[tts] ElevenLabs dialogue error:', msg.error, msg.message || '');
        return;
      }
      const u = queue[0];
      if (!u) return;
      if (msg.audio) {
        onAudio?.(msg.audio, u.id);
        u.gotAudio = true;
        if (u.ended) armIdle(u, IDLE_DONE_MS);
      }
      if ((msg.is_final_audio_for_turn || msg.is_final) && u.ended && u.gotAudio) {
        armIdle(u, FINAL_DONE_MS);
      }
    });
    socket.on('close', () => {
      if (socket.ownedClose || ws !== socket) return;
      ws = null;
      open = false;
      outbox = [];
      if (keepAliveTimer) clearTimer(keepAliveTimer);
      keepAliveTimer = null;
      logger.warn('[tts] ElevenLabs dialogue connection closed; the current answer is lost');
      // Whatever was in flight is gone: report it done so the call doesn't wait forever.
      for (const u of queue.splice(0)) {
        dead.add(u.id);
        clearUtteranceTimers(u);
        byId.delete(u.id);
        onUtteranceDone?.(u.id);
      }
    });
    socket.on('error', (err) => logger.error('[tts] ElevenLabs dialogue ws error:', err.message));
  }

  function sendText(u, text) {
    send({
      inputs: [{ text, voice_id: voiceId, new_turn: !u.started }],
      flush: true, // don't wait for the server's ~40-character buffer
    });
    u.started = true;
  }

  return {
    /** Opens the connection ahead of time, so the first answer doesn't pay the handshake. */
    connect() {
      ensureSocket();
    },

    /** Appends text of answer `id`; whole sentences are sent for synthesis right away. */
    append(id, text) {
      if (!text || dead.has(id)) return;
      let u = byId.get(id);
      if (!u) {
        ensureSocket();
        u = { id, buffer: '', started: false, ended: false, gotAudio: false, idleTimer: null, capTimer: null };
        queue.push(u);
        byId.set(id, u);
      }
      if (u.ended) return;
      u.buffer += text;
      const { ready, rest } = splitSpeakable(u.buffer);
      if (ready.trim()) {
        sendText(u, `${ready.trim()} `);
        u.buffer = rest;
      }
    },

    /** The answer is complete. Returns true if it produced speech to wait for. */
    end(id) {
      const u = byId.get(id);
      if (!u) return false;
      if (u.ended) return true;
      u.ended = true;
      const rest = u.buffer.trim();
      u.buffer = '';
      if (rest) sendText(u, `${rest} `);
      if (u.gotAudio && queue[0] === u) armIdle(u, IDLE_DONE_MS);
      u.capTimer = setTimer(() => {
        u.capTimer = null;
        // Nothing (more) came back: release this answer and anything queued before it.
        while (queue.length && queue[0] !== u) finish(queue[0]);
        finish(u);
      }, CAP_DONE_MS);
      return true;
    },

    /**
     * Stops everything being spoken or queued (barge-in, farewell). The protocol can't
     * cancel an answer, so the connection is dropped and a fresh one is opened for the
     * next answer.
     */
    cancel() {
      if (!queue.length) return;
      for (const u of queue.splice(0)) {
        dead.add(u.id);
        clearUtteranceTimers(u);
        byId.delete(u.id);
      }
      dropSocket();
      ensureSocket();
    },

    close() {
      for (const u of queue.splice(0)) clearUtteranceTimers(u);
      byId.clear();
      dropSocket();
    },
  };
}
