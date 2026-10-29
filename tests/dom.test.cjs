const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setTimeout(resolve, 260));
function setup(reply = false) {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'fixtures/composer.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window;
  // jsdom has no layout; model visibility, while retaining real DOM/shadow/event behavior.
  w.Element.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };
  function hydrate(root) {
    for (const template of [...root.querySelectorAll('template[shadowrootmode]')]) {
      if (!template.parentElement) continue;
      const sr = template.parentElement.attachShadow({ mode: 'open' });
      sr.append(template.content); template.remove(); hydrate(sr);
    }
  }
  hydrate(w.document);
  const composer = w.document.querySelector('fw-email-composer');
  const header = composer.shadowRoot.querySelector('fw-email-header').shadowRoot;
  if (reply) header.querySelector('#subject-field').remove();
  const input = header.querySelector('#subject-field')?.shadowRoot.querySelector('input');
  const frame = composer.shadowRoot.querySelector('fw-froala-editor').shadowRoot.querySelector('iframe');
  frame.contentDocument.body.setAttribute('contenteditable', 'true');
  frame.contentDocument.body.innerHTML = '<p>Hello Oscar,</p><p>From Agent</p>';
  // jsdom doesn't implement innerText line breaks; model its rendered text behavior.
  Object.defineProperty(frame.contentDocument.body, 'innerText', { get() { return [...this.children].map(el => el.textContent).join('\n'); } });
  const sendHost = composer.shadowRoot.querySelector('fw-froala-footer').shadowRoot.querySelector('#btnSendEmail');
  const send = sendHost.shadowRoot.querySelector('button');
  for (const file of ['checker.js', 'content.js']) w.eval(fs.readFileSync(path.join(base, 'extension', file), 'utf8'));
  const type = (el, text) => { el.value = text; el.dispatchEvent(new w.Event('input', { bubbles: true, composed: true })); };
  const body = text => { frame.contentDocument.body.innerHTML = `<p>${text}</p><p>From Agent</p>`; frame.contentDocument.body.dispatchEvent(new w.Event('input', { bubbles: true })); };
  return { dom, w, composer, input, send, sendHost, type, body, status: () => sendHost.previousElementSibling?.shadowRoot?.querySelector('[role=status]') };
}
test('new email: both fields, native Subject, iframe events, uncertain state, manual recheck', async () => {
  const c = setup();
  try {
    assert.equal(c.send.style.backgroundColor, 'rgb(22, 52, 73)');
    c.type(c.input, 'James, Special Bonus'); await tick();
    assert.equal(c.send.style.backgroundColor, 'rgb(201, 52, 44)');
    assert.match(c.status().title, /James/);
    c.type(c.input, 'Oscar, Special Bonus'); c.body('Hello James,'); await tick();
    assert.equal(c.send.style.backgroundColor, 'rgb(201, 52, 44)');
    c.body('Thanks for your message'); await tick();
    assert.equal(c.send.style.backgroundColor, 'rgb(242, 201, 76)');
    c.body('Hello Oscar,'); await tick();
    assert.equal(c.send.style.backgroundColor, 'rgb(22, 52, 73)');
    // Programmatic changes with no input event must still be caught by the explicit button.
    c.input.value = 'James, Bonus';
    c.sendHost.previousElementSibling.shadowRoot.querySelector('button').click();
    assert.equal(c.send.style.backgroundColor, 'rgb(201, 52, 44)');
    c.w.document.querySelector('.user-name-link').textContent = ''; await tick();
    assert.equal(c.send.style.backgroundColor, 'rgb(242, 201, 76)');
  } finally { c.dom.window.close(); }
});
test('existing Reply reads its own conversation subject; Note restores Send and hides controls', async () => {
  const c = setup(true);
  try {
    assert.equal(c.send.style.backgroundColor, 'rgb(22, 52, 73)');
    c.body('Hello Wrong,'); await tick();
    assert.equal(c.send.style.backgroundColor, 'rgb(201, 52, 44)');
    const reply = c.w.document.querySelector('[data-test-reply-tab] a');
    const note = c.w.document.querySelector('[data-test-private-note-tab] a');
    reply.setAttribute('aria-selected', 'false'); note.setAttribute('aria-selected', 'true'); await tick();
    assert.equal(c.send.style.backgroundColor, 'rgb(22, 52, 73)');
    assert.equal(c.sendHost.previousElementSibling, null);
    reply.setAttribute('aria-selected', 'true'); note.setAttribute('aria-selected', 'false'); await tick();
    assert.equal(c.send.style.backgroundColor, 'rgb(201, 52, 44)');
    c.body('Hello Oscar,');
    c.w.document.querySelector('[data-test-id="topic-name"]').textContent = 'VIP Success Team - James, Bonus'; await tick();
    assert.equal(c.send.style.backgroundColor, 'rgb(201, 52, 44)');
    // Removed composers must not retain extension changes.
    c.composer.remove(); await tick();
    assert.equal(c.send.style.backgroundColor, 'rgb(22, 52, 73)');
  } finally { c.dom.window.close(); }
});
