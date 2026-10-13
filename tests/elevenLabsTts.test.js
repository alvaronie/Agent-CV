// Tests for src/voice/elevenLabsTts.js — ElevenLabs multi-context TTS client.
// The WebSocket factory and timers are injected: no network, no real socket.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  createElevenLabsTts,
  splitSpeakable,
  buildTtsUrl,
} from '../src/voice/elevenLabsTts.js';

function fakeSockets() {
  const sockets = [];
  const create = (url, options) => {
    const s = new EventEmitter();
    s.url = url;
    s.options = options;
    s.sent = [];
    s.send = (data) => s.sent.push(JSON.parse(data));
    s.close = () => s.emit('close');
    sockets.push(s);
    return s;
  };
  return { sockets, create };
}

function serverSays(socket, msg) {
  socket.emit('message', Buffer.from(JSON.stringify(msg)));
}

describe('splitSpeakable', () => {
  test('releases whole sentences and keeps the unfinished tail', () => {
    assert.deepEqual(splitSpeakable('Hola, soy el asistente. Te cuento'), {
      ready: 'Hola, soy el asistente. ',
      rest: 'Te cuento',
    });
  });

  test('holds a short fragment without punctuation', () => {
    assert.deepEqual(splitSpeakable('Hola, soy'), { ready: '', rest: 'Hola, soy' });
  });

  test('cuts a long run without sentence end at the last comma', () => {
    const text = `${'palabra '.repeat(15)}y otra cosa, y sigue`;
    const { ready, rest } = splitSpeakable(text, { maxChars: 50 });
    assert.ok(ready.endsWith(', '));
    assert.equal(rest, 'y sigue');
  });
});

describe('buildTtsUrl', () => {
  test('targets the multi-context endpoint in Twilio format', () => {
    const url = buildTtsUrl({ voiceId: 'voice 1', modelId: 'eleven_flash_v2_5' });
    assert.match(url, /^wss:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/voice%201\/multi-stream-input\?/);
    assert.match(url, /model_id=eleven_flash_v2_5/);
    assert.match(url, /output_format=ulaw_8000/);
  });
});

describe('createElevenLabsTts', () => {
  let net;
  let audio;
  let done;
  let timerFn;

  function makeTts() {
    return createElevenLabsTts({
      apiKey: 'key',
      voiceId: 'v',
      modelId: 'm',
      onAudio: (b64, id) => audio.push({ b64, id }),
      onUtteranceDone: (id) => done.push(id),
      createSocket: net.create,
      setTimer: (fn) => {
        timerFn = fn;
        return 1;
      },
      clearTimer: () => {
        timerFn = null;
      },
    });
  }

  beforeEach(() => {
    net = fakeSockets();
    audio = [];
    done = [];
    timerFn = null;
  });

  test('authenticates with the xi-api-key header and queues messages until open', () => {
    const tts = makeTts();
    tts.append('r1', 'Hola. ');
    const s = net.sockets[0];
    assert.equal(s.options.headers['xi-api-key'], 'key');
    assert.equal(s.sent.length, 0, 'nothing sent before open');
    s.emit('open');
    assert.deepEqual(s.sent, [
      { text: ' ', context_id: 'u1' },
      { text: 'Hola. ', context_id: 'u1', flush: true },
    ]);
  });

  test('full answer: sentences flushed, rest flushed on end, audio out, done on isFinal', () => {
    const tts = makeTts();
    tts.connect();
    const s = net.sockets[0];
    s.emit('open');
    tts.append('r1', 'Claro, te ');
    tts.append('r1', 'cuento. Álvaro es analista');
    assert.equal(tts.end('r1'), true);

    assert.deepEqual(s.sent, [
      { text: ' ', context_id: 'u1' },
      { text: 'Claro, te cuento. ', context_id: 'u1', flush: true },
      { text: 'Álvaro es analista ', context_id: 'u1', flush: true },
      { context_id: 'u1', close_context: true },
    ]);

    serverSays(s, { audio: 'AAA', contextId: 'u1' });
    serverSays(s, { isFinal: true, contextId: 'u1' });
    assert.deepEqual(audio, [{ b64: 'AAA', id: 'r1' }]);
    assert.deepEqual(done, ['r1']);
  });

  test('answers never interleave: audio of the next one waits for the previous', () => {
    const tts = makeTts();
    tts.connect();
    const s = net.sockets[0];
    s.emit('open');
    tts.append('r1', 'Uno. ');
    tts.end('r1');
    tts.append('r2', 'Dos. ');
    tts.end('r2');

    serverSays(s, { audio: 'B1', contextId: 'u2' }); // second answer arrives first
    assert.deepEqual(audio, [], 'held while the first is still playing');
    serverSays(s, { audio: 'A1', contextId: 'u1' });
    serverSays(s, { isFinal: true, contextId: 'u1' });
    assert.deepEqual(audio.map((a) => a.b64), ['A1', 'B1']);
    assert.deepEqual(done, ['r1']);
  });

  test('cancel (barge-in) closes open contexts and drops their audio and text', () => {
    const tts = makeTts();
    tts.connect();
    const s = net.sockets[0];
    s.emit('open');
    tts.append('r1', 'Una respuesta larga. ');
    tts.cancel();
    assert.deepEqual(s.sent.at(-1), { context_id: 'u1', close_context: true });

    serverSays(s, { audio: 'LATE', contextId: 'u1' });
    serverSays(s, { isFinal: true, contextId: 'u1' });
    tts.append('r1', 'más texto. ');
    assert.deepEqual(audio, []);
    assert.deepEqual(done, [], 'a cancelled answer is not reported as played');
    assert.equal(s.sent.at(-1).close_context, true, 'no more text sent for it');
    assert.equal(tts.end('r1'), false);
  });

  test('if isFinal never arrives, the answer is reported done after the timeout', () => {
    const tts = makeTts();
    tts.connect();
    net.sockets[0].emit('open');
    tts.append('r1', 'Hola. ');
    tts.end('r1');
    assert.ok(timerFn);
    timerFn();
    assert.deepEqual(done, ['r1']);
  });

  test('an unexpected disconnection reports in-flight answers as done', () => {
    const tts = makeTts();
    tts.connect();
    const s = net.sockets[0];
    s.emit('open');
    tts.append('r1', 'Hola. ');
    s.emit('close');
    assert.deepEqual(done, ['r1']);
    tts.append('r1', 'otra. '); // lost answer: ignored
    tts.append('r2', 'Nueva. '); // a new answer opens a new socket
    assert.equal(net.sockets.length, 2);
  });

  test('end() of an answer with no text returns false (nothing to wait for)', () => {
    const tts = makeTts();
    assert.equal(tts.end('unknown'), false);
  });

  test('close() does not report answers as done', () => {
    const tts = makeTts();
    tts.connect();
    net.sockets[0].emit('open');
    tts.append('r1', 'Hola. ');
    tts.close();
    assert.deepEqual(done, []);
  });
});
