/* cardona.boffice.site:
 *  1. tints the whole page red when the player card shows a restricted status;
 *  2. publishes the open player (email, name, site, statuses) to chrome.storage.local so the
 *     Freshsales tab can verify its contact against it. Nothing leaves the browser. */
(() => {
  'use strict';
  const restricted = /suspend\w*|cooling[\s_-]?off|self[\s_-]?exclu\w*/i;
  const PREFIX = 'bo:';
  const HEARTBEAT = 30000;
  let timer, overlay, label, published = null, publishedSig = '';

  const visible = el => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

  // Returns null when the page is not a player card.
  function scan() {
    const title = document.querySelector('.breadcrumb-title');
    if (!title || title.textContent.trim() !== 'Player card') return null;
    // Status pills: <span data-test-id="status-field">Suspended: Other</span>
    const statuses = [...document.querySelectorAll('[data-test-id="status-field"]')]
      .filter(visible).map(c => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    // Header: <h5>email</h5><p>Full name</p>
    const h5 = [...document.querySelectorAll('h5.text-h5')].find(h => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(h.textContent.trim()));
    const email = h5?.textContent.trim().toLowerCase() || '';
    const name = h5?.nextElementSibling?.tagName === 'P' ? h5.nextElementSibling.textContent.trim() : '';
    const site = document.querySelector('.project-selected-label')?.textContent.trim() || '';
    return { statuses: [...new Set(statuses)], email, name, site };
  }

  function publish(data) {
    if (!globalThis.chrome?.storage?.local) return;
    const email = data?.email || '';
    if (published && published !== email) { chrome.storage.local.remove(PREFIX + published).catch(() => {}); published = null; publishedSig = ''; }
    if (!email) return;
    published = email;
    const sig = JSON.stringify([data.name, data.site, data.statuses]);
    if (sig === publishedSig) return;
    publishedSig = sig;
    chrome.storage.local.set({ [PREFIX + email]: { ...data, restricted: data.statuses.filter(s => restricted.test(s)), ts: Date.now() } }).catch(() => {});
  }
  // The Freshsales side only trusts fresh data, so a closed tab stops being used after a few minutes.
  function heartbeat() {
    if (!published) return;
    const data = scan();
    if (data?.email === published) {
      publishedSig = '';
      publish(data);
    }
  }

  function ensureUi() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.setAttribute('data-name-checker-ui', '');
    // multiply keeps text readable: white becomes red, dark text stays dark.
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;background:rgba(255,0,0,.3);mix-blend-mode:multiply';
    label = document.createElement('div');
    label.setAttribute('data-name-checker-ui', '');
    label.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;background:#c9342c;color:#fff;font:700 18px/1.3 system-ui,sans-serif;padding:6px 16px;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.3)';
  }

  function update() {
    clearTimeout(timer);
    const data = scan();
    publish(data);
    const flagged = data ? data.statuses.filter(s => restricted.test(s)) : [];
    if (!flagged.length) {
      overlay?.remove(); label?.remove();
      return;
    }
    ensureUi();
    label.textContent = '⚠ ' + flagged.join(' · ');
    if (!overlay.isConnected) document.documentElement.append(overlay, label);
  }

  const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 200); };
  // Our UI lives on <html>, outside <body>, so it never triggers the observer.
  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, characterData: true });
  setInterval(heartbeat, HEARTBEAT);
  addEventListener('pagehide', () => { if (published) chrome.storage?.local?.remove(PREFIX + published); });
  update();
})();
