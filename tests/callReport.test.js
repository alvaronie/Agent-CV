// Tests de src/services/callReport.js — el cierre de llamada de la Fase 5.
//
// Las tres dependencias (resumen, email, persistencia) se inyectan, así que esto prueba
// el flujo completo sin llamada real, sin OpenAI, sin Resend y sin escribir en disco.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { reportCall } from '../src/services/callReport.js';

const TURNS = [
  { role: 'agent', text: 'Hello, this is the voice assistant.' },
  { role: 'caller', text: 'Hi, I am Marta from Acme. My email is marta@acme.com.' },
];

const CALL = {
  turns: TURNS,
  callSid: 'CA123',
  from: '+15550001111',
  startedAt: '2026-09-23T18:00:00.000Z',
  endedAt: '2026-09-23T18:01:30.000Z',
  durationSeconds: 90,
};

/** Dobles que registran lo que reciben. */
function makeDeps({ summaryImpl } = {}) {
  const calls = { summary: [], email: [], saved: [] };
  const deps = {
    generateSummary:
      summaryImpl ??
      (async (turns, meta) => {
        calls.summary.push({ turns, meta });
        return { subject: 'Marta (Acme) deja contacto', body: 'Quién llamó: Marta.' };
      }),
    sendSummaryEmail: async (message) => {
      calls.email.push(message);
      return true;
    },
    saveCallRecord: async (record) => {
      calls.saved.push(record);
      return record;
    },
  };
  return { deps, calls };
}

describe('reportCall', () => {
  test('resume, envía el email y guarda el registro', async () => {
    const { deps, calls } = makeDeps();
    const result = await reportCall(CALL, deps);

    assert.equal(calls.summary.length, 1);
    assert.equal(calls.email.length, 1);
    assert.equal(calls.saved.length, 1);

    assert.equal(result.emailSent, true);
    assert.equal(result.summary, 'Quién llamó: Marta.');
    assert.equal(calls.email[0].subject, 'Marta (Acme) deja contacto');
  });

  test('el email lleva una cabecera con llamante, fecha y duración', async () => {
    const { deps, calls } = makeDeps();
    await reportCall(CALL, deps);

    const { body } = calls.email[0];
    assert.match(body, /Llamante: \+15550001111/);
    assert.match(body, /Duración: 90s/);
    assert.match(body, /Quién llamó: Marta\./);
  });

  test('el registro guardado NO contiene la transcripción (D11)', async () => {
    const { deps, calls } = makeDeps();
    await reportCall(CALL, deps);

    const record = calls.saved[0];
    const serialized = JSON.stringify(record);

    // Ni el texto de los turnos ni ningún campo que lo transporte.
    assert.doesNotMatch(serialized, /marta@acme\.com/);
    assert.doesNotMatch(serialized, /voice assistant/);
    assert.equal(record.turns, undefined);
    assert.equal(record.transcript, undefined);

    // Y sí contiene los metadatos y el resumen.
    assert.deepEqual(Object.keys(record).sort(), [
      'callSid',
      'durationSeconds',
      'emailSent',
      'endedAt',
      'from',
      'startedAt',
      'summary',
      'turnCount',
    ]);
    assert.equal(record.turnCount, 2);
    assert.equal(record.summary, 'Quién llamó: Marta.');
  });

  test('sin turnos: registra la llamada pero no manda email', async () => {
    const { deps, calls } = makeDeps();
    const result = await reportCall({ ...CALL, turns: [] }, deps);

    assert.equal(calls.summary.length, 0);
    assert.equal(calls.email.length, 0);
    assert.equal(calls.saved.length, 1);
    assert.equal(result.emailSent, false);
    assert.equal(result.summary, null);
    assert.equal(calls.saved[0].turnCount, 0);
  });

  test('si el resumen falla, manda la transcripción y guarda summary=null', async () => {
    const { deps, calls } = makeDeps({
      summaryImpl: async () => {
        throw new Error('OpenAI caído');
      },
    });

    const result = await reportCall(CALL, deps);

    assert.equal(calls.email.length, 1);
    assert.match(calls.email[0].subject, /resumen no disponible/);
    assert.match(calls.email[0].body, /OpenAI caído/);
    assert.match(calls.email[0].body, /LLAMANTE: Hi, I am Marta from Acme\./);

    // En disco no queda resumen, y tampoco la transcripción.
    assert.equal(result.summary, null);
    assert.doesNotMatch(JSON.stringify(calls.saved[0]), /marta@acme\.com/);
  });

  test('un fallo al persistir no rompe el cierre', async () => {
    const { deps, calls } = makeDeps();
    deps.saveCallRecord = async () => {
      throw new Error('disco lleno');
    };

    const result = await reportCall(CALL, deps);
    assert.equal(result.emailSent, true);
    assert.equal(calls.email.length, 1);
  });
});
