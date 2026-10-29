const { test } = require('node:test');
const assert = require('node:assert/strict');
const { check, names } = require('../extension/checker.js');
const card = 'Oscar omasterman1@gmail.com Clarke';
test('email is excluded from the client name', () => assert.deepEqual(names(card), ['Oscar', 'Clarke']));
for (const [label, text, state] of [
  ['correct greeting', 'Hello Oscar,\nRobin here.', 'ok'],
  ['typo', 'Hello Oskar,', 'mismatch'],
  ['other client', 'Hi James,', 'mismatch'],
  ['case insensitive', 'HELLO OSCAR,', 'ok'],
  ['full name', 'Dear Oscar Clarke,', 'ok'],
  ['wrong surname', 'Dear Oscar Smith,', 'mismatch'],
  ['generic greeting', 'Hi there,', 'unchecked'],
  ['signature ignored', 'Thanks for your message.\nRobin', 'unchecked'],
  ['quoted history ignored', 'Hi Oscar,\n> Hello James,', 'ok'],
  ['empty draft', '', 'unchecked']
]) test(label, () => assert.equal(check(card, text).state, state));
test('subject', () => assert.equal(check(card, 'Oskar, Special bonus', true).state, 'mismatch'));
test('missing card fails explicitly', () => assert.equal(check('', 'Hello Oscar,').state, 'unknown'));
test('unicode and apostrophes', () => assert.equal(check('Élodie O’Neil', "Dear Élodie O'Neil,").state, 'ok'));
