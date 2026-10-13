// Tests for the "Álvaro didn't pick up" pieces: callback on the caller's own number
// (save_contact + isCallableNumber) and what the agent is told when the call resumes.
// Pure functions: no network, no WebSocket, no disk.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildContactRecord } from '../src/agent/tools/saveContact.js';
import { isCallableNumber } from '../src/telephony/callerNumber.js';
import { buildResumeGreeting, buildResumeContext } from '../src/telephony/mediaStream.js';

describe('isCallableNumber', () => {
  test('accepts E.164 numbers, rejects withheld caller IDs', () => {
    assert.equal(isCallableNumber('+34611111111'), true);
    assert.equal(isCallableNumber('anonymous'), false);
    assert.equal(isCallableNumber('Restricted'), false);
    assert.equal(isCallableNumber('+266696687'), false);
    assert.equal(isCallableNumber(''), false);
    assert.equal(isCallableNumber(undefined), false);
  });
});

describe('buildContactRecord', () => {
  test('use_caller_number fills the phone from the call', () => {
    const record = buildContactRecord(
      { name: 'Sara', use_caller_number: true },
      { callSid: 'CA1', callerNumber: '+34611111111' }
    );
    assert.deepEqual(record, {
      name: 'Sara',
      callSid: 'CA1',
      phone: '+34611111111',
      phoneSource: 'caller_id',
    });
  });

  test('an explicit phone wins over the caller number', () => {
    const record = buildContactRecord(
      { phone: '+34622222222', use_caller_number: true },
      { callerNumber: '+34611111111' }
    );
    assert.equal(record.phone, '+34622222222');
    assert.equal(record.phoneSource, undefined);
  });

  test('a withheld caller number is not used', () => {
    const record = buildContactRecord({ use_caller_number: true }, { callerNumber: 'anonymous' });
    assert.equal(record.phone, undefined);
  });
});

describe('resume after an unanswered transfer', () => {
  test('the agent says Álvaro could not be reached, offers a callback and stays on', () => {
    const text = buildResumeGreeting({ language: 'es', callerNumberKnown: true });
    assert.match(text, /could not reach Álvaro/);
    assert.match(text, /let him know by email/);
    assert.match(text, /same number they are calling from/);
    assert.match(text, /European Spanish from Spain/);
    assert.match(text, /Do not greet again/);
  });

  test('with a withheld number it asks for a phone or email instead', () => {
    const text = buildResumeGreeting({ language: 'en', callerNumberKnown: false });
    assert.match(text, /ask for a phone number or an email address/);
    assert.doesNotMatch(text, /same number/);
  });

  test('the resumed session gets the conversation so far and the next steps', () => {
    const ctx = buildResumeContext(
      [
        { role: 'caller', text: 'Quiero hablar con Álvaro' },
        { role: 'event', text: 'Se intentó transferir la llamada a Álvaro, pero no contestó.' },
      ],
      { callerNumberKnown: true }
    );
    assert.match(ctx, /Caller: Quiero hablar con Álvaro/);
    assert.match(ctx, /Event: Se intentó transferir/);
    assert.match(ctx, /use_caller_number=true/);
    assert.match(ctx, /anything else you can help with/);
  });
});
