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
  function evaluate(card, subject, body) {
    // In replies the UI can prepend the mailbox label and Re:/Fwd:.
    const cleanSubject = subject?.replace(/^(?:(?:re|fw|fwd):\s*)+/ig, '').replace(/^[^,\n]+\s[-–—]\s(?=[^,]+,)/u, '');
    const fields = [
      { label: 'Subject', result: check(card, cleanSubject || '', true) },
      { label: 'Перший рядок', result: check(card, body || '') }
    ];
    const state = fields.some(f => f.result.state === 'mismatch') ? 'mismatch' : fields.every(f => f.result.state === 'ok') ? 'ok' : 'unknown';
    const details = fields.map(({ label, result: r }) => `${label}: ${r.state === 'ok' ? `«${r.actual}» — збіг` : r.state === 'mismatch' ? `«${r.actual}», очікується «${r.expected}»` : 'не вдалося визначити ім’я'}`).join('\n');
    return { state, details };
  }
  const api = { check, names, allowsReply, evaluate };
  if (typeof module !== 'undefined') module.exports = api;
  else root.FreshsalesNameChecker = api;
})(globalThis);
