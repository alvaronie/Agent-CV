// Tests for src/voice/elevenLabsDialogue.js — ElevenLabs v4/v3 over the Text to Dialogue
// WebSocket. Socket factory and timers are injected: no network, no real socket.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  createElevenLabsDialogue,
  isDialogueModel,
  buildDialogueUrl,
} from '../src/voice/elevenLabsDialogue.js';

function fakeSockets() {
  const sockets = [];
  const create = (url, options) => {
    const s = new EventEmitter();
    s.url = url;
    s.options = options;
    s.sent = [];
    s.closed = false;
    s.send = (data) => s.sent.push(JSON.parse(data));
    s.close = () => {
      s.closed = true;
      s.emit('close');
    };
    sockets.push(s);
    return s;
  };
  return { sockets, create };
}

// Fake timers that can hold several pending callbacks.
function fakeTimers() {
  let seq = 0;
  const pending = new Map();
  return {
    set: (fn, ms) => {
      seq += 1;
      pending.set(seq, { fn, ms });
      return seq;
    },
    clear: (id) => pending.delete(id),
    // Fires every pending timer scheduled with this delay.
    fire(ms) {
      for (const [id, t] of [...pending]) {
        if (t.ms === ms) {
          pending.delete(id);
          t.fn();
        }
      }
    },
    has: (ms) => [...pending.values()].some((t) => t.ms === ms),
  };
}

const say = (socket, msg) => socket.emit('message', Buffer.from(JSON.stringify(msg)));
const inputsOf = (socket) => socket.sent.filter((m) => m.inputs);

describe('isDialogueModel / buildDialogueUrl', () => {
  test('v3 and v4 models go through the dialogue WebSocket, Flash does not', () => {
    assert.equal(isDialogueModel('eleven_v4_turbo'), true);
    assert.equal(isDialogueModel('eleven_v3_conversational'), true);
    assert.equal(isDialogueModel('eleven_flash_v2_5'), false);
    assert.equal(isDialogueModel(''), false);
  });

  test('targets the dialogue endpoint in Twilio audio format', () => {
    const url = buildDialogueUrl({ modelId: 'eleven_v4_turbo' });
    assert.match(url, /^wss:\/\/api\.elevenlabs\.io\/v1\/text-to-dialogue\/stream-input\?/);
    assert.match(url, /model_id=eleven_v4_turbo/);
    assert.match(url, /output_format=ulaw_8000/);
    assert.doesNotMatch(url, /language_code/, 'the model detects the language itself');
  });
});

describe('createElevenLabsDialogue', () => {
  let net;
  let timers;
  let audio;
  let done;

  function make() {
    return createElevenLabsDialogue({
      apiKey: 'key',
      voiceId: 'V1',
      modelId: 'eleven_v4_turbo',
      onAudio: (b64, id) => audio.push({ b64, id }),
      onUtteranceDone: (id) => done.push(id),
      createSocket: net.create,
      setTimer: timers.set,
      clearTimer: timers.clear,
    });
  }

  beforeEach(() => {
    net = fakeSockets();
    timers = fakeTimers();
    audio = [];
    done = [];
  });

  test('registers the voice first, then sends queued text', () => {
    const v = make();
    v.append('r1', 'Hola. ');
    const s = net.sockets[0];
    assert.equal(s.options.headers['xi-api-key'], 'key');
    assert.equal(s.sent.length, 0, 'nothing sent before open');
    s.emit('open');
    assert.deepEqual(s.sent[0], { voices: ['V1'] });
    assert.deepEqual(s.sent[1], {
      inputs: [{ text: 'Hola. ', voice_id: 'V1', new_turn: true }],
      flush: true,
    });
  });

  test('only the first chunk of an answer starts a new turn', () => {
    const v = make();
    v.connect();
    net.sockets[0].emit('open');
    v.append('r1', 'Claro, te cuento. Álvaro es');
    v.append('r1', ' analista.');
    v.end('r1');
    const turns = inputsOf(net.sockets[0]).map((m) => [m.inputs[0].text, m.inputs[0].new_turn]);
    assert.deepEqual(turns, [
      ['Claro, te cuento. ', true],
      ['Álvaro es analista. ', false],
    ]);
  });

  test('audio is forwarded; the answer is done after the audio stops', () => {
    const v = make();
    v.connect();
    const s = net.sockets[0];
    s.emit('open');
    v.append('r1', 'Hola. ');
    assert.equal(v.end('r1'), true);
    say(s, { audio: 'A1' });
    say(s, { audio: 'A2' });
    assert.deepEqual(audio.map((a) => a.b64), ['A1', 'A2']);
    assert.deepEqual(done, [], 'not done while audio may still come');
    timers.fire(800);
    assert.deepEqual(done, ['r1']);
  });

  test('the final-of-turn flag shortens the wait, but only after all text was sent', () => {
    const v = make();
    v.connect();
    const s = net.sockets[0];
    s.emit('open');
    v.append('r1', 'Una frase. ');
    say(s, { audio: 'A1' });
    say(s, { is_final_audio_for_turn: true }); // mid-answer: ignored
    timers.fire(150);
    assert.deepEqual(done, []);
    v.end('r1');
    say(s, { audio: 'A2' });
    say(s, { is_final_audio_for_turn: true });
    timers.fire(150);
    assert.deepEqual(done, ['r1']);
  });

  test('if no audio ever comes back, the answer is released by the cap', () => {
    const v = make();
    v.connect();
    net.sockets[0].emit('open');
    v.append('r1', 'Hola. ');
    v.end('r1');
    timers.fire(800);
    assert.deepEqual(done, [], 'the idle wait needs some audio first');
    timers.fire(10000);
    assert.deepEqual(done, ['r1']);
  });

  test('barge-in drops the connection, ignores its late audio and reopens', () => {
    const v = make();
    v.connect();
    const s1 = net.sockets[0];
    s1.emit('open');
    v.append('r1', 'Una respuesta larga. ');
    v.cancel();
    assert.equal(s1.closed, true);
    assert.equal(net.sockets.length, 2, 'a fresh connection is ready for the next answer');

    say(s1, { audio: 'LATE' });
    v.append('r1', 'más texto. ');
    assert.deepEqual(audio, []);
    assert.deepEqual(done, [], 'a cancelled answer is not reported as played');

    const s2 = net.sockets[1];
    s2.emit('open');
    v.append('r2', 'Nueva. ');
    assert.deepEqual(s2.sent[0], { voices: ['V1'] });
    assert.equal(inputsOf(s2)[0].inputs[0].text, 'Nueva. ');
  });

  test('cancel with nothing playing keeps the connection', () => {
    const v = make();
    v.connect();
    v.cancel();
    assert.equal(net.sockets.length, 1);
    assert.equal(net.sockets[0].closed, false);
  });

  test('sends keep_alive so the server does not close an idle connection', () => {
    const v = make();
    v.connect();
    const s = net.sockets[0];
    s.emit('open');
    timers.fire(15000);
    assert.deepEqual(s.sent.at(-1), { keep_alive: true });
    assert.ok(timers.has(15000), 'and keeps doing it');
  });

  test('an unexpected disconnection reports in-flight answers as done', () => {
    const v = make();
    v.connect();
    const s = net.sockets[0];
    s.emit('open');
    v.append('r1', 'Hola. ');
    s.emit('close');
    assert.deepEqual(done, ['r1']);
    v.append('r2', 'Otra. ');
    assert.equal(net.sockets.length, 2, 'the next answer opens a new connection');
  });

  test('close() does not report answers as done', () => {
    const v = make();
    v.connect();
    net.sockets[0].emit('open');
    v.append('r1', 'Hola. ');
    v.close();
    assert.deepEqual(done, []);
  });

  test('end() of an unknown answer returns false', () => {
    assert.equal(make().end('nope'), false);
  });
});
