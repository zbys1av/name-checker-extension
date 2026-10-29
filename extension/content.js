(() => {
  'use strict';
  const editorSelector = '.fr-element[contenteditable="true"], .msg-reply-box[contenteditable="true"], [data-test-medium-editor-disable-wrapper] [contenteditable="true"]';
  const subjectSelector = 'input[name="subject"], input[data-test-id*="subject"], input[placeholder="Subject"], input[aria-label="Subject"]';
  const host = document.createElement('div');
  host.id = 'freshsales-name-checker';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>:host{all:initial;position:fixed;bottom:65px;right:355px;z-index:2147483646;font:13px/1.5 system-ui,sans-serif;max-width:340px}section{background:#fff;color:#163449;border:1px solid #b8c9d4;border-left:4px solid #637b8a;border-radius:7px;padding:10px 13px;box-shadow:0 3px 14px #0002}section[data-state=mismatch]{border-left-color:#d14836;background:#fff5f3}section[data-state=ok]{border-left-color:#24935b}button{font:inherit;cursor:pointer;margin-top:6px}p{margin:3px 0;overflow-wrap:anywhere}</style><section role="status" aria-live="polite"><strong>Перевірка імені</strong><p></p><button type="button">Перевірити зараз</button></section>`;
  const panel = shadow.querySelector('section');
  const message = shadow.querySelector('p');
  let timer;
  const documents = new WeakSet();
  const frames = new WeakSet();
  let active = null;
  const visible = el => !!el.getClientRects().length;
  function schedule() { clearTimeout(timer); timer = setTimeout(update, 250); }
  function bind(doc) {
    if (documents.has(doc)) return;
    documents.add(doc);
    doc.addEventListener('input', schedule, true);
    doc.addEventListener('focusin', e => { if (e.target.matches?.('[contenteditable="true"],input')) active = e.target; schedule(); }, true);
    // Recheck synchronously before a send action, without blocking or changing the draft.
    doc.addEventListener('click', e => { if (e.target.closest?.('button,[role="button"]')) update(); }, true);
  }
  function update() {
    clearTimeout(timer);
    const editors = [...document.querySelectorAll(editorSelector)].filter(visible);
    for (const frame of document.querySelectorAll('iframe.fr-iframe')) {
      if (!frames.has(frame)) { frames.add(frame); frame.addEventListener('load', schedule); }
      try {
        const doc = frame.contentDocument;
        if (!doc) continue;
        bind(doc);
        if (visible(frame)) editors.push(...doc.querySelectorAll('[contenteditable="true"],body[contenteditable]'));
      } catch { /* Cross-origin frames cannot be inspected. */ }
    }
    const subjects = [...document.querySelectorAll(subjectSelector)].filter(visible);
    if (!editors.length && !subjects.length) { host.remove(); return; }
    if (!host.isConnected) document.body.append(host);
    const card = [...document.querySelectorAll('#data-contact-info .user-name-link, #data-contact-info [data-test-id="user-name-container"]')].find(visible);
    const name = card?.textContent?.trim() || '';
    const chosen = active && editors.includes(active) ? active : editors[0];
    const results = [];
    if (chosen) results.push(FreshsalesNameChecker.check(name, chosen.innerText || chosen.textContent || ''));
    for (const subject of subjects) results.push(FreshsalesNameChecker.check(name, subject.value, true));
    const result = results.find(r => r.state === 'mismatch') || results.find(r => r.state === 'ok') || results[0] || { state: 'unknown' };
    panel.dataset.state = result.state;
    message.textContent = result.state === 'mismatch' ? `Можлива помилка: «${result.actual}». Ім’я з картки: «${result.expected}». Перевірте перед надсиланням.` : result.state === 'ok' ? `Звертання відповідає картці: ${result.expected}.` : result.state === 'unknown' ? 'Не бачу імені в картці. Відкрийте Contact info.' : `Ім’я з картки: ${result.expected}. Не знайдено звертання для перевірки.`;
  }
  shadow.querySelector('button').addEventListener('click', update);
  bind(document);
  // Observe structural changes only: no interval, no full-page text scan.
  new MutationObserver(records => {
    if (records.some(r => r.target !== host && !host.contains(r.target))) schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  update();
})();
