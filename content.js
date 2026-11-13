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
    let body, editor;
    if (frame) {
      if (!frames.has(frame)) { frames.add(frame); frame.addEventListener('load', schedule); }
      try {
        const doc = frame.contentDocument;
        watch(doc);
        editor = doc?.querySelector('[contenteditable="true"], body[contenteditable]');
        // An uninitialised or inaccessible frame is uncertain, not a successful check.
        if (editor) body = editor.innerText ?? editor.textContent;
      } catch { /* No access: leave body unknown. */ }
    } else {
      editor = editorRoot?.querySelector('.fr-element[contenteditable="true"]');
      if (editor) body = editor.innerText ?? editor.textContent;
    }
    const footer = shadow(root?.querySelector('fw-froala-footer'));
    const sendHost = footer?.querySelector('#btnSendEmail');
    const send = shadow(sendHost)?.querySelector('button');
    // New emails have a Subject field and a From selector; replies have neither.
    let sender = '';
    if (subjectHost) {
      const fromHost = header?.querySelector('#from-field, #from, [id*="from" i], [name*="from" i]');
      const fromRoot = shadow(fromHost);
      const raw = fromHost?.value ?? fromRoot?.querySelector('input:not([type="hidden"])')?.value ?? '';
      sender = String(raw || fromRoot?.textContent || fromHost?.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return { subject, body, editor, sender, isNew: !!subjectHost, sendHost, send };
  }

  // ---- Player data published by the cardona.boffice.site tab (see boffice.js) -----------
  const BO_PREFIX = 'bo:';
  const BO_FRESH = 3 * 60 * 1000;
  const bo = {};
  if (globalThis.chrome?.storage?.local) {
    chrome.storage.local.get(null).then(all => {
      for (const [k, v] of Object.entries(all)) if (k.startsWith(BO_PREFIX)) bo[k] = v;
      schedule();
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [k, c] of Object.entries(changes)) if (k.startsWith(BO_PREFIX)) { if (c.newValue) bo[k] = c.newValue; else delete bo[k]; }
      schedule();
    });
  }
  const emailRe = /[^\s@<>"',;()]+@[^\s@<>"',;()]+\.[^\s@<>"',;()]+/g;
  // Emails visible in the contact card and in the composer header (recipient).
  function emailsOf(control) {
    const found = new Set();
    const add = s => (s?.match(emailRe) || []).forEach(e => found.add(e.toLowerCase()));
    const card = document.querySelector('#data-contact-info');
    add(card?.textContent);
    card?.querySelectorAll('a[href^="mailto:"]').forEach(a => add(a.getAttribute('href').slice(7)));
    const header = shadow(shadow(control.composer)?.querySelector('fw-email-header'));
    add(header?.textContent);
    header?.querySelectorAll('input').forEach(i => add(i.value));
    return found;
  }
  // The back-office player whose email matches this contact (fresh data only), else null.
  function boMatch(control) {
    const now = Date.now();
    for (const email of emailsOf(control)) {
      const d = bo[BO_PREFIX + email];
      if (d && now - d.ts < BO_FRESH) return d;
    }
    return null;
  }

  // ---- Pre-send checklist: project -> banner -> links -------------------------------
  // Shown on Send. Each step shows what is really in the draft and is skipped when
  // its content is unchanged since the last confirmation, so it never nags twice.
  let bypass = false;
  let wizard = null;
  const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  function snapshot(control) {
    const data = read(control.composer);
    const card = control.card || '';
    const project = api.projectOf(data.subject);
    const imgs = [...(data.editor?.querySelectorAll('img') || [])]
      .filter(i => !i.complete || i.naturalWidth === 0 || i.naturalWidth >= 120)
      .map(i => ({ src: i.currentSrc || i.getAttribute('src') || '', alt: i.alt || '' }));
    const links = api.analyzeLinks([...(data.editor?.querySelectorAll('a[href]') || [])]
      .map(a => ({ text: a.textContent, href: a.getAttribute('href') })));
    const missing = api.missingLinks(data.body || '', links);
    const sites = api.sitesIn(data.subject || '', data.body || '', ...links.map(l => l.href));
    // Back-office data for this contact, when the player card is open in another tab.
    const player = boMatch(control);
    const boSite = player ? (api.sitesIn(player.site)[0] || player.site) : '';
    return { project, card, imgs, links, missing, sites, player, boSite, isNew: data.isNew, sender: data.sender, name: control.result?.state };
  }
  function stepsFor(snap, confirmed) {
    const steps = [{ key: 'project', title: snap.isNew ? '' : 'Проєкт', sig: snap.isNew ? 'new|' + snap.sender + '|' + snap.project + '|' + snap.card : snap.project + '|' + snap.card }];
    // Manual check done in another window; only for new emails. Remembered per player.
    // With matching back-office data the check is automatic: a clean status is skipped,
    // a restricted one is shown with its real text.
    if (snap.isNew && !snap.player) steps.push({ key: 'status', title: '', sig: 'status|' + snap.card });
    else if (snap.isNew && snap.player.restricted.length) steps.push({ key: 'status', title: '', sig: 'status|auto|' + snap.player.restricted.join(',') });
    // Known site named in the subject, body or a link. Back-office data decides automatically:
    // equal sites are skipped, a different site is flagged.
    if (snap.sites.length && !(snap.player && snap.sites.every(s => s === snap.boSite))) steps.push({ key: 'site', title: 'Сайт', sig: 'site|' + snap.sites.join(',') + '|' + snap.boSite });
    if (snap.imgs.length) steps.push({ key: 'banner', title: 'Банер', sig: JSON.stringify(snap.imgs.map(i => i.src)) });
    // Links are always asked: an empty list is itself something to confirm ("should there be one?").
    steps.push({ key: 'links', title: 'Посилання', sig: JSON.stringify([snap.links.map(l => [l.text, l.href]), snap.missing]) });
    return steps.filter(s => confirmed[s.key] !== s.sig);
  }
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids);
    return n;
  };
  function closeWizard() {
    if (!wizard) return;
    window.removeEventListener('keydown', wizard.onKey, true);
    window.removeEventListener('pointerdown', wizard.onOutside, true);
    wizard.ui.remove();
    wizard = null;
  }
  function renderStep(snap, step, index, total) {
    const body = el('div', { className: 'body' });
    if (step.key === 'project' && snap.isNew) {
      body.append(el('div', { className: 'flag from', textContent: 'Перевір поле From' }));
      if (snap.player) body.append(el('div', { className: 'chips', textContent: `Бек-офіс: ${snap.player.statuses.join(', ') || 'статус невідомий'} · сайт ${snap.boSite || '—'}` }));
    } else if (step.key === 'project') {
      if (snap.player) body.append(el('div', { className: 'chips', textContent: `Бек-офіс: ${snap.player.statuses.join(', ') || 'статус невідомий'} · сайт ${snap.boSite || '—'}` }));
      body.append(el('div', { className: 'big', textContent: snap.project || 'Проєкт не визначено автоматично' }));
      body.append(el('div', { className: 'muted', textContent: 'Клієнт: ' + (snap.card || '—') }));
      if (snap.name === 'mismatch') body.append(el('div', { className: 'warn', textContent: '⚠ Ім’я не збігається з карткою' }));
      body.append(el('div', { className: 'chips', textContent: `Банер: ${snap.imgs.length ? snap.imgs.length + ' шт.' : 'немає'} · Посилання: ${snap.links.length || 'немає'}` }));
    } else if (step.key === 'status') {
      body.append(el('div', { className: 'flag red', textContent: snap.player ? snap.player.restricted.join(' · ') : 'SUSPENDED???' }));
    } else if (step.key === 'site') {
      body.append(el('div', { className: 'big', textContent: snap.sites.join(' · ') }));
      if (snap.player) body.append(el('div', { className: 'warn', textContent: `⚠ Гравець у бек-офісі: ${snap.boSite || '—'}` }));
      else body.append(el('div', { className: 'muted', textContent: 'Це правильний сайт для цього гравця?' }));
      if (snap.sites.length > 1) body.append(el('div', { className: 'warn', textContent: '⚠ У листі згадано кілька сайтів' }));
    } else if (step.key === 'banner') {
      const row = el('div', { className: 'thumbs' });
      for (const i of snap.imgs.slice(0, 4)) row.append(el('img', { src: i.src, alt: i.alt }));
      body.append(row);
      if (snap.imgs.length > 4) body.append(el('div', { className: 'muted', textContent: `…і ще ${snap.imgs.length - 4}` }));
    } else {
      for (const p of snap.missing) body.append(el('div', { className: 'warn', textContent: `⚠ «${p}» згадано без посилання` }));
      if (!snap.links.length) body.append(el('div', { className: 'muted', textContent: 'Посилань у листі немає. Чи не варто додати?' }));
      const list = el('ul');
      for (const l of snap.links.slice(0, 8)) {
        const li = el('li', {}, el('b', { textContent: clip(l.text || '(без тексту)', 40) }), el('div', { className: 'url', textContent: clip(l.href || '—', 70) }));
        if (l.issues.length) li.append(el('div', { className: 'warn', textContent: '⚠ ' + l.issues.join(', ') }));
        list.append(li);
      }
      body.append(list);
      if (snap.links.length > 8) body.append(el('div', { className: 'muted', textContent: `…і ще ${snap.links.length - 8}` }));
    }
    return [el('div', { className: 'head', textContent: `${index + 1}/${total}${step.title ? ' · ' + step.title : ''}` }), body];
  }
  function runWizard(control, snap, steps) {
    closeWizard();
    const ui = el('div');
    ui.setAttribute('data-name-checker-ui', '');
    const sr = ui.attachShadow({ mode: 'open' });
    sr.innerHTML = `<style>
      :host{position:fixed;z-index:2147483647;font:16px/1.45 system-ui,sans-serif;color:#163449}
      .card{width:380px;max-height:70vh;overflow:auto;background:#fff;border:1px solid #9aadb9;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.25);padding:14px}
      .head{font-weight:600;font-size:14px;color:#5b7385;margin-bottom:8px}
      .big{font-size:22px;font-weight:600;margin-bottom:2px}.muted,.chips{color:#5b7385;font-size:15px;margin-top:4px}
      .warn{color:#a12620;font-size:15px;margin-top:4px}
      .flag{font-size:26px;font-weight:700;text-align:center;padding:14px 8px;border-radius:6px}
      .flag.from{background:#fff3c4;color:#5a4300;border:2px solid #f2c94c}
      .flag.red{color:#c9342c;border:2px solid #c9342c;background:#fdeceb}
      .thumbs{display:flex;gap:6px;flex-wrap:wrap}.thumbs img{max-width:170px;max-height:110px;border:1px solid #cdd8df;border-radius:4px;object-fit:contain}
      ul{margin:0;padding:0;list-style:none}li{padding:6px 0;border-bottom:1px solid #eef2f5}.url{color:#5b7385;font-size:13px;word-break:break-all}
      .actions{display:flex;gap:8px;margin-top:12px}
      button{font:inherit;border-radius:5px;padding:8px 12px;cursor:pointer;border:1px solid #9aadb9;background:#fff;color:#163449}
      button.ok{background:#163449;color:#fff;border-color:#163449;flex:1}
    </style><div class="card" role="dialog" aria-label="Перевірка перед відправкою"><div class="content"></div><div class="actions"><button class="ok" type="button"></button><button class="no" type="button">Скасувати</button></div></div>`;
    const content = sr.querySelector('.content');
    const ok = sr.querySelector('.ok');
    let i = 0;
    const show = () => {
      content.replaceChildren(...renderStep(snap, steps[i], i, steps.length));
      ok.textContent = i === steps.length - 1 ? 'Так, відправити (Enter)' : 'Так, далі (Enter)';
      ok.focus({ preventScroll: true });
    };
    const confirm = () => {
      control.confirmed[steps[i].key] = steps[i].sig;
      if (++i < steps.length) return show();
      closeWizard();
      bypass = true;
      try { control.send.click(); } finally { bypass = false; }
    };
    const onKey = e => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      // The editor must not see these keys while the checklist is open.
      e.preventDefault(); e.stopPropagation();
      e.key === 'Enter' ? confirm() : closeWizard();
    };
    const onOutside = e => { if (!e.composedPath().includes(ui)) closeWizard(); };
    ok.addEventListener('click', confirm);
    sr.querySelector('.no').addEventListener('click', closeWizard);
    document.body.append(ui);
    const rect = control.send.getBoundingClientRect();
    ui.style.right = Math.max(8, innerWidth - rect.right) + 'px';
    ui.style.bottom = Math.max(8, innerHeight - rect.top + 8) + 'px';
    wizard = { ui, onKey, onOutside };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onOutside, true);
    show();
  }
  function onSendClick(e) {
    if (bypass || !e.isTrusted) return;
    const path = e.composedPath();
    for (const control of controls.values()) {
      if (!path.includes(control.send) && !path.includes(control.sendHost)) continue;
      const snap = snapshot(control);
      const steps = stepsFor(snap, control.confirmed);
      if (!steps.length) return;
      e.preventDefault(); e.stopImmediatePropagation();
      runWizard(control, snap, steps);
      return;
    }
  }
  window.addEventListener('click', onSendClick, true);
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
    control = { send, sendHost: host, composer: null, card: '', result: null, confirmed: {}, ui, textStyle, animationTimer: null, status: sr.querySelector('span'), original: ['background-color', 'background-image', 'border-color', 'color'].map(name => [name, send.style.getPropertyValue(name), send.style.getPropertyPriority(name)]) };
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
      const result = api.evaluate(card, data.subject, data.body, data.isNew);
      const control = controlFor(data.sendHost, data.send);
      used.add(data.sendHost);
      Object.assign(control, { composer, card, result });
      if (!control.ui.isConnected) data.sendHost.before(control.ui);
      const color = result.state === 'mismatch' ? '#c9342c' : result.state === 'unknown' ? '#f2c94c' : '#2e9e5b';
      data.send.style.setProperty('background-color', color, 'important');
      data.send.style.setProperty('background-image', 'none', 'important');
      data.send.style.setProperty('border-color', color, 'important');
      data.send.style.setProperty('color', result.state === 'unknown' ? '#332800' : '#ffffff', 'important');
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
    for (const [host, control] of controls) if (!used.has(host)) { restore(control); controls.delete(host); if (wizard) closeWizard(); }
  }
  watch(document);
  update();
})();
