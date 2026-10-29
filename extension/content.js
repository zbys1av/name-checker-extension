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
  const indicator = document.createElement('div');
  indicator.id = 'freshsales-name-checker-send';
  const indicatorShadow = indicator.attachShadow({ mode: 'open' });
  indicatorShadow.innerHTML = `<style>:host{all:initial;position:fixed;z-index:2147483646;transform:translate(-100%,-50%);font:12px/1.4 system-ui,sans-serif;pointer-events:auto}span{display:block;white-space:nowrap;border:1px solid #b8c9d4;border-radius:20px;padding:5px 9px;background:#f1f4f6;color:#405466;box-shadow:0 1px 4px #0001}span[data-state=ok]{color:#146c3e;background:#e8f7ee;border-color:#83cba0}span[data-state=mismatch]{color:#a72c20;background:#fff0ed;border-color:#e6a197}</style><span role="status" aria-live="polite" aria-atomic="true"></span>`;
  const badge = indicatorShadow.querySelector('span');
  let sendButton = null;
  let positionFrame;
  function positionIndicator() {
    if (!sendButton?.isConnected || !visible(sendButton)) { indicator.remove(); return; }
    const rect = sendButton.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) { indicator.remove(); return; }
    if (!indicator.isConnected) document.body.append(indicator);
    indicator.style.left = `${Math.max(150, rect.left - 8)}px`;
    indicator.style.top = `${rect.top + rect.height / 2}px`;
  }
  function schedulePosition() {
    cancelAnimationFrame(positionFrame);
    positionFrame = requestAnimationFrame(positionIndicator);
  }
  window.addEventListener('resize', schedulePosition, { passive: true });
  document.addEventListener('scroll', schedulePosition, { passive: true, capture: true });
  function updateIndicator(result, chosen) {
    const candidates = [...(chosen ? replyContext(chosen).root : document).querySelectorAll('[data-test-fc-send-button="root"], .send-message .send, button, [role="button"], fw-button')]
      .filter(el => visible(el) && (el.matches('[data-test-fc-send-button="root"], .send-message .send') || el.textContent.trim() === 'Send'));
    const anchor = chosen?.ownerDocument.defaultView.frameElement || chosen;
    const bounds = anchor?.getBoundingClientRect();
    if (bounds) candidates.sort((a, b) => Math.abs(a.getBoundingClientRect().top - bounds.bottom) - Math.abs(b.getBoundingClientRect().top - bounds.bottom));
    sendButton = candidates[0] || null;
    const label = result.state === 'ok' ? '✓ Ім’я співпадає' : result.state === 'mismatch' ? '⚠ Ім’я не співпадає' : result.state === 'unknown' ? '? Немає картки' : '— Ім’я не перевірено';
    if (badge.textContent !== label) badge.textContent = label;
    badge.dataset.state = result.state;
    indicator.title = message.textContent;
    positionIndicator();
  }
  let timer;
  const documents = new WeakSet();
  const frames = new WeakSet();
  let active = null;
  const visible = el => !!el.getClientRects().length;
  function replyContext(editor) {
    // The actual email editor can live in an about:blank Froala iframe.
    const anchor = editor.ownerDocument.defaultView.frameElement || editor;
    for (let root = anchor.parentElement; root; root = root.parentElement) {
      const tabs = [...root.querySelectorAll('[data-test-reply-tab], [data-test-private-note-tab], .reply-tab, .private-note-tab')].filter(visible);
      if (!tabs.length) continue;
      const modes = tabs.map(tab => {
        const link = tab.querySelector('[aria-selected]');
        const selected = link?.getAttribute('aria-selected') ?? tab.getAttribute('aria-selected');
        return {
          mode: tab.matches('[data-test-private-note-tab], .private-note-tab') ? 'note' : 'reply',
          selected: selected === null ? tab.classList.contains('active') : selected === 'true'
        };
      });
      return { root, allowed: FreshsalesNameChecker.allowsReply(modes) };
    }
    return { root: document.body, allowed: true };
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(update, 250); }
  function bind(doc) {
    if (documents.has(doc)) return;
    documents.add(doc);
    doc.addEventListener('input', schedule, true);
    doc.addEventListener('focusin', e => { if (e.target.matches?.('[contenteditable="true"],input')) active = e.target; schedule(); }, true);
    // Recheck synchronously before a send action, without blocking or changing the draft.
    doc.addEventListener('click', e => { if (e.target.closest?.('button,[role="button"],[role="tab"]')) { update(); schedule(); } }, true);
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
    const replyEditors = editors.filter(editor => replyContext(editor).allowed);
    const subjects = [...document.querySelectorAll(subjectSelector)].filter(el => visible(el) && replyContext(el).allowed);
    if (!replyEditors.length && !subjects.length) { host.remove(); indicator.remove(); sendButton = null; return; }
    if (!host.isConnected) document.body.append(host);
    const card = [...document.querySelectorAll('#data-contact-info .user-name-link, #data-contact-info [data-test-id="user-name-container"]')].find(visible);
    const name = card?.textContent?.trim() || '';
    const chosen = active && replyEditors.includes(active) ? active : replyEditors[0];
    const results = [];
    if (chosen) results.push(FreshsalesNameChecker.check(name, chosen.innerText || chosen.textContent || ''));
    for (const subject of subjects) results.push(FreshsalesNameChecker.check(name, subject.value, true));
    const result = results.find(r => r.state === 'mismatch') || results.find(r => r.state === 'ok') || results[0] || { state: 'unknown' };
    panel.dataset.state = result.state;
    message.textContent = result.state === 'mismatch' ? `Можлива помилка: «${result.actual}». Ім’я з картки: «${result.expected}». Перевірте перед надсиланням.` : result.state === 'ok' ? `Звертання відповідає картці: ${result.expected}.` : result.state === 'unknown' ? 'Не бачу імені в картці. Відкрийте Contact info.' : `Ім’я з картки: ${result.expected}. Не знайдено звертання для перевірки.`;
    updateIndicator(result, chosen);
  }
  shadow.querySelector('button').addEventListener('click', update);
  bind(document);
  // Observe structural changes only: no interval, no full-page text scan.
  new MutationObserver(records => {
    if (records.some(r => r.target !== host && !host.contains(r.target) && r.target !== indicator && !indicator.contains(r.target))) schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-selected', 'class'] });
  update();
})();
