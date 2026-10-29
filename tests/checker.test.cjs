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

const { allowsReply } = require('../extension/checker.js');
test('Reply tab enables checking', () => assert.equal(allowsReply([
  { mode: 'reply', selected: true }, { mode: 'note', selected: false }
]), true));
test('Private Note disables checking even with a greeting', () => assert.equal(allowsReply([
  { mode: 'reply', selected: false }, { mode: 'note', selected: true }
]), false));
test('switch from note back to reply enables checking again', () => {
  const tabs = [{ mode: 'reply', selected: false }, { mode: 'note', selected: true }];
  assert.equal(allowsReply(tabs), false);
  tabs[0].selected = true; tabs[1].selected = false;
  assert.equal(allowsReply(tabs), true);
});
test('new email without mode tabs remains enabled', () => assert.equal(allowsReply([]), true));
test('ambiguous transition does not check a note', () => {
  assert.equal(allowsReply([{ mode: 'reply', selected: true }, { mode: 'note', selected: true }]), false);
  assert.equal(allowsReply([{ mode: 'reply', selected: false }, { mode: 'note', selected: false }]), false);
});

const { evaluate } = require('../extension/checker.js');
test('both fields must match before Send keeps its default color', () => {
  assert.equal(evaluate(card, 'Oscar, Bonus', 'Hello Oscar,').state, 'ok');
  assert.equal(evaluate(card, 'Oscar, Bonus', '').state, 'unknown');
  assert.equal(evaluate(card, '', 'Hello Oscar,').state, 'unknown');
});
test('a mismatch wins over an unknown field', () => {
  assert.equal(evaluate(card, 'James, Bonus', '').state, 'mismatch');
  assert.equal(evaluate(card, undefined, 'Hello James,').state, 'mismatch');
});
test('reply subject supports mailbox prefix and Re', () => {
  assert.equal(evaluate(card, 'Re: VIP Success Team - Oscar, Special Bonus', 'Hello Oscar,').state, 'ok');
});
test('missing card and inaccessible body stay uncertain', () => {
  assert.equal(evaluate('', 'Oscar, Bonus', 'Hello Oscar,').state, 'unknown');
  assert.equal(evaluate(card, 'Oscar, Bonus', undefined).state, 'unknown');
});
test('screenshot regression: mailbox before Re and matching Hey Kirsty', () => {
  assert.equal(evaluate('Kirsty kirsty@example.com', 'VIP Success Team - Re: Kirsty, Welcome To The Bronze Club ⭐', 'Hey Kirsty,\nThe bonus is waiting.').state, 'ok');
  assert.equal(evaluate('Kirsty', 'Re: VIP Success Team - Fwd: Re: Kirsty, Welcome', 'Hey Kirsty,').state, 'ok');
  assert.equal(evaluate('Kirsty', 'VIP Success Team - Re: Oscar, Welcome', 'Hey Kirsty,').state, 'mismatch');
});
