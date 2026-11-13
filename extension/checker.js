/* Shared pure matching logic; no network or persistent storage. */
(function (root) {
  const word = "[\\p{L}\\p{M}]+(?:[’'‑-][\\p{L}\\p{M}]+)*";
  const greeting = new RegExp(`^(?:hello|hi|hey|dear|good morning|good afternoon|good evening|вітаю|привіт|шановний|шановна)[,!: \\t]+(${word}(?:[ \\t]+${word}){0,3})(?=[,!.:\\n]|$)`, 'iu');
  const normal = s => s.normalize('NFC').toLocaleLowerCase().replace(/[’]/g, "'").replace(/[‑]/g, '-');
  function names(card) {
    return (card.replace(/\S*@\S+/g, '').match(new RegExp(word, 'gu')) || []).filter(x => !/^(mr|mrs|ms|dr)$/i.test(x));
  }
  function check(card, text, subject = false) {
    const parts = names(card);
    if (!parts.length) return { state: 'unknown' };
    const first = text.trim().split(/\n/).find(s => s.trim()) || '';
    let match = first.match(greeting);
    if (!match && subject) match = first.match(new RegExp(`^(${word}(?:[ \\t]+${word}){0,2}),`, 'u'));
    if (!match) return { state: 'unchecked', expected: parts[0] };
    const actual = match[1].trim();
    if (/^(all|team|there|everyone|customer|sir|madam|друзі|колеги)$/iu.test(actual)) return { state: 'unchecked', expected: parts[0] };
    const given = normal(actual).split(/\s+/);
    const expected = parts.map(normal);
    const valid = given[0] === expected[0] && given.every((x, i) => i === 0 || expected.slice(1).includes(x));
    return { state: valid ? 'ok' : 'mismatch', actual, expected: parts[0] };
  }
  function allowsReply(tabs) {
    // No mode tabs: a standalone new-email composer.
    if (!tabs.length) return true;
    if (tabs.some(t => t.mode === 'note' && t.selected)) return false;
    return tabs.some(t => t.mode === 'reply' && t.selected);
  }
  // Phrases that must always be a link when mentioned in the body.
  const linkPhrases = ['bonus tab', 'limits section', 'bonus section', 'account limits', 'limits tab'];
  function missingLinks(body, links) {
    const flat = s => (s || '').toLowerCase().replace(/\s+/g, ' ');
    const text = flat(body), anchors = links.map(l => flat(l.text));
    return linkPhrases.filter(p => text.includes(p) && !anchors.some(a => a.includes(p)));
  }
  // checkSubject is true only for new emails; replies inherit the subject.
  function evaluate(card, subject, body, checkSubject = true) {
    // In replies the UI can prepend the mailbox label and Re:/Fwd:.
    let cleanSubject = subject?.trim();
    // Mailbox labels and reply prefixes may occur in either order, or repeat.
    let previous;
    do {
      previous = cleanSubject;
      cleanSubject = cleanSubject?.replace(/^(?:(?:re|fw|fwd):\s*)+/ig, '').replace(/^[^,\n]+\s[-–—]\s(?=[^,]+,)/u, '').trim();
    } while (cleanSubject !== previous);
    const fields = [
      ...(checkSubject ? [{ label: 'Subject', result: check(card, cleanSubject || '', true) }] : []),
      { label: 'Перший рядок', result: check(card, body || '') }
    ];
    const state = fields.some(f => f.result.state === 'mismatch') ? 'mismatch' : fields.every(f => f.result.state === 'ok') ? 'ok' : 'unknown';
    const details = fields.map(({ label, result: r }) => `${label}: ${r.state === 'ok' ? `«${r.actual}» — збіг` : r.state === 'mismatch' ? `«${r.actual}», очікується «${r.expected}»` : 'не вдалося визначити ім’я'}`).join('\n');
    return { state, details };
  }
  // Mailbox/project label that Freshsales puts in front of the subject: "VIP Success Team - Re: Kirsty, ...".
  function projectOf(subject) {
    let s = (subject || '').trim(), previous;
    do { previous = s; s = s.replace(/^(?:(?:re|fw|fwd):\s*)+/ig, '').trim(); } while (s !== previous);
    const m = s.match(/^([^,\n]+?)\s[-–—]\s(?=[^,]+,)/u);
    return m ? m[1].trim() : '';
  }
  const hostOf = href => { try { return new URL(href).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; } };
  // links: [{text, href}] -> same items plus `issues` (empty array when nothing suspicious).
  function analyzeLinks(links) {
    return links.map(({ text, href }) => {
      const issues = [];
      const h = (href || '').trim();
      if (!h || h === '#' || /^javascript:/i.test(h)) issues.push('порожнє посилання');
      else if (/^http:\/\//i.test(h)) issues.push('не https');
      const shown = (text || '').trim();
      if (/^(?:https?:\/\/|www\.)\S+$/i.test(shown) && hostOf(/^www\./i.test(shown) ? 'https://' + shown : shown) !== hostOf(h)) issues.push('текст і адреса різні');
      return { text: shown, href: h, issues };
    });
  }
  const sites = [['WinSpirit', /win[\s_-]?spirit/i], ['LuckyHills', /lucky[\s_-]?hills/i], ['Charmius', /charmius/i]];
  // Canonical names of known sites mentioned anywhere in the given strings.
  function sitesIn(...texts) {
    const all = texts.join('\n');
    return sites.filter(([, re]) => re.test(all)).map(([name]) => name);
  }
  const api = { check, names, allowsReply, evaluate, projectOf, analyzeLinks, missingLinks, sitesIn };
  if (typeof module !== 'undefined') module.exports = api;
  else root.FreshsalesNameChecker = api;
})(globalThis);
