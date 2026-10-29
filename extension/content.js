(() => {
  'use strict';
  const api = FreshsalesNameChecker;
  const watched = new WeakSet();
  const frames = new WeakSet();
  const controls = new Map();
  let timer;
  const visible = el => {
    if (!el || !el.getClientRects().length) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  function schedule() { clearTimeout(timer); timer = setTimeout(update, 180); }
  function watch(root) {
    if (!root || watched.has(root)) return;
    watched.add(root);
    root.addEventListener('input', schedule, true);
    root.addEventListener('change', schedule, true);
    root.addEventListener('click', schedule, true);
    new MutationObserver(records => {
      if (records.some(r => !r.target.closest?.('[data-name-checker-ui]'))) schedule();
    }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'hidden', 'value'] });
  }
  function shadow(host) { const root = host?.shadowRoot; watch(root); return root; }
  function isReply(composer) {
    const scope = composer.closest('.message, #compose-message-container, #aw-reply-section-wrapper') || composer.parentElement;
    const tabs = [...scope.querySelectorAll('[data-test-reply-tab], [data-test-private-note-tab]')].filter(visible);
    return api.allowsReply(tabs.map(tab => {
      const selected = tab.querySelector('[aria-selected]')?.getAttribute('aria-selected') ?? tab.getAttribute('aria-selected');
      return { mode: tab.hasAttribute('data-test-private-note-tab') ? 'note' : 'reply', selected: selected === null ? tab.classList.contains('active') : selected === 'true' };
    }));
  }
  function read(composer) {
    const root = shadow(composer);
    const header = shadow(root?.querySelector('fw-email-header'));
    const subjectHost = header?.querySelector('#subject-field');
    const subjectRoot = shadow(subjectHost);
    const subjectInput = subjectRoot?.querySelector('input:not([type="hidden"])');
    // Prefer the live native input. A serialized hidden input is only a fallback.
    let subject = subjectInput?.value ?? subjectHost?.value ?? subjectHost?.querySelector('input[type="hidden"]')?.value;
    if (!subjectHost) {
      // Replies inherit the subject of this expanded conversation, never a sidebar/history item.
      const conversation = composer.closest('.message.isExpanded') || composer.closest('.message');
      subject = conversation?.querySelector('.pivot-view-header [data-test-id="topic-name"]')?.textContent?.trim();
    }
    const editorRoot = shadow(root?.querySelector('fw-froala-editor'));
    const frame = editorRoot?.querySelector('iframe.fr-iframe');
    let body;
    if (frame) {
      if (!frames.has(frame)) { frames.add(frame); frame.addEventListener('load', schedule); }
      try {
        const doc = frame.contentDocument;
        watch(doc);
        const editor = doc?.querySelector('[contenteditable="true"], body[contenteditable]');
        // An uninitialised or inaccessible frame is uncertain, not a successful check.
        if (editor) body = editor.innerText ?? editor.textContent;
      } catch { /* No access: leave body unknown. */ }
    } else {
      const editor = editorRoot?.querySelector('.fr-element[contenteditable="true"]');
      if (editor) body = editor.innerText ?? editor.textContent;
    }
    const footer = shadow(root?.querySelector('fw-froala-footer'));
    const sendHost = footer?.querySelector('#btnSendEmail');
    const send = shadow(sendHost)?.querySelector('button');
    return { subject, body, sendHost, send };
  }
  function restore(control) {
    for (const [name, value, priority] of control.original) {
      if (value) control.send.style.setProperty(name, value, priority);
      else control.send.style.removeProperty(name);
    }
    clearTimeout(control.animationTimer);
    control.textStyle.remove();
    control.ui.remove();
  }
  function controlFor(host, send) {
    let control = controls.get(host);
    if (control?.send === send) return control;
    if (control) restore(control);
    const ui = document.createElement('span');
    ui.setAttribute('data-name-checker-ui', '');
    const sr = ui.attachShadow({ mode: 'open' });
    sr.innerHTML = `<style>:host{display:inline-flex;align-items:center;margin-right:8px;vertical-align:middle;font:12px/1.4 system-ui,sans-serif}button{font:inherit;border:1px solid #9aadb9;border-radius:5px;background:white;color:#163449;padding:6px 9px;cursor:pointer}button[aria-busy="true"]::before{content:"";display:inline-block;width:10px;height:10px;margin-right:6px;border:2px solid #b9cbd6;border-top-color:#163449;border-radius:50%;vertical-align:-2px;animation:checking .65s linear infinite}@keyframes checking{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){button[aria-busy="true"]::before{animation:none}}span{max-width:220px;margin-right:7px;color:#163449}span[data-state=mismatch]{color:#a12620}span[data-state=unknown]{color:#805500}</style><span role="status" aria-live="polite"></span><button type="button">Перевірити ім’я</button>`;
    const recheck = sr.querySelector('button');
    recheck.addEventListener('click', () => {
      update();
      // Keep visual feedback visible even when local checking finishes instantly.
      if (!ui.isConnected) return;
      clearTimeout(control.animationTimer);
      recheck.setAttribute('aria-busy', 'true');
      recheck.textContent = 'Перевіряю…';
      control.animationTimer = setTimeout(() => {
        recheck.setAttribute('aria-busy', 'false');
        recheck.textContent = 'Перевірити ім’я';
      }, 600);
    });
    const textStyle = document.createElement('style');
    textStyle.setAttribute('data-name-checker-ui', '');
    send.getRootNode().append(textStyle);
    control = { send, ui, textStyle, animationTimer: null, status: sr.querySelector('span'), original: ['background-color', 'background-image', 'border-color', 'color'].map(name => [name, send.style.getPropertyValue(name), send.style.getPropertyPriority(name)]) };
    controls.set(host, control);
    return control;
  }
  function update() {
    clearTimeout(timer);
    const used = new Set();
    const card = [...document.querySelectorAll('#data-contact-info .user-name-link, #data-contact-info [data-test-id="user-name-container"]')].find(visible)?.textContent?.trim() || '';
    for (const composer of document.querySelectorAll('fw-email-composer')) {
      if (!visible(composer) || !isReply(composer)) continue;
      const data = read(composer);
      if (!data.send || !data.sendHost) continue;
      const result = api.evaluate(card, data.subject, data.body);
      const control = controlFor(data.sendHost, data.send);
      used.add(data.sendHost);
      if (!control.ui.isConnected) data.sendHost.before(control.ui);
      const color = result.state === 'mismatch' ? '#c9342c' : result.state === 'unknown' ? '#f2c94c' : null;
      if (color) {
        data.send.style.setProperty('background-color', color, 'important');
        data.send.style.setProperty('background-image', 'none', 'important');
        data.send.style.setProperty('border-color', color, 'important');
        data.send.style.setProperty('color', result.state === 'mismatch' ? '#ffffff' : '#332800', 'important');
      } else {
        for (const [name, value, priority] of control.original) {
          if (value) data.send.style.setProperty(name, value, priority);
          else data.send.style.removeProperty(name);
        }
      }
      // Freshworks styles the internal label and slotted light-DOM text separately.
      const foreground = result.state === 'unknown' ? '#332800' : '#ffffff';
      const textCSS = `:host{color:${foreground}!important}button,button *{color:${foreground}!important}::slotted(span){color:${foreground}!important}`;
      if (control.textStyle.textContent !== textCSS) control.textStyle.textContent = textCSS;
      const text = result.state === 'ok' ? '✓ Subject і звертання збігаються' : result.state === 'mismatch' ? '⚠ Ім’я не збігається' : '? Потрібна перевірка';
      if (control.status.textContent !== text) control.status.textContent = text;
      control.status.dataset.state = result.state;
      control.ui.title = result.details;
      control.status.title = result.details;
    }
    for (const [host, control] of controls) if (!used.has(host)) { restore(control); controls.delete(host); }
  }
  watch(document);
  update();
})();
