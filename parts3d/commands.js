// Tiny rule-based command parser for the parts3d viewer. No AI, no network.
// parse(text) -> { type, ... } | null.   Types:
//   length {target, value}      yaw {target, part: lug|busbar, deg}        cover {target, on}      gauge {target, value}
//   toggle {parts[], show}      reset {}                 undo {}
// target: 'pos' | 'neg' | 'both'.  yaw deg: positive = left = counter-clockwise seen from above (same sign as scene yaw).
export const EXAMPLES = ['plus cable 12 inches', 'minus busbar cover off', 'rotate plus lug left'];

const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// "twenty four" -> "24", "one hundred eighty" -> "180"; other words are kept
export function wordsToDigits(s) {
  const out = []; let cur = null;
  const flush = () => { if (cur !== null) { out.push(String(cur)); cur = null; } };
  for (const w of s.split(' ')) {
    if (w in UNITS) {
      if (cur !== null && cur >= 20 && cur % 10 === 0 && UNITS[w] < 10) cur += UNITS[w];
      else if (cur !== null && cur >= 100 && cur % 100 === 0 && UNITS[w] > 0) cur += UNITS[w];
      else { flush(); cur = UNITS[w]; }
    } else if (w in TENS) {
      if (cur !== null && cur >= 100 && cur % 100 === 0) cur += TENS[w]; else { flush(); cur = TENS[w]; }
    } else if (w === 'hundred' && cur !== null) cur *= 100;
    else { flush(); out.push(w); }
  }
  flush();
  return out.join(' ');
}

export function normalize(text) {
  const s = String(text || '').toLowerCase()
    .replace(/\+/g, ' plus ').replace(/[−–—]/g, ' minus ').replace(/(^|\s)-(\s|$)/g, ' minus ')
    .replace(/°/g, ' degrees ').replace(/"/g, ' inches ')
    .replace(/bus bars?/g, m => (m.endsWith('s') ? 'busbars' : 'busbar')).replace(/\bnuts?\b/g, 'nuts')
    .replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();
  return wordsToDigits(s);
}

const has = (s, re) => re.test(s);
function polarity(s) {
  const p = has(s, /\b(plus|positive|red)\b/), n = has(s, /\b(minus|negative|black)\b/);
  if (p && n) return 'both';
  if (p) return 'pos';
  if (n) return 'neg';
  return has(s, /\b(both|all|each)\b/) ? 'both' : null;
}
const firstNumber = s => { const m = s.match(/\b(\d+(?:\.\d+)?)\b/); return m ? Number(m[1]) : null; };
const OFF = /\b(off|remove|hide|without|no)\b/, ON = /\b(on|show|add|with)\b/;

export function parse(text) {
  const s = normalize(text);
  if (!s) return null;
  if (has(s, /^(please )?(reset|defaults?|start over)\b/)) return { type: 'reset' };
  if (has(s, /^(please )?(undo|go back|back)\b/)) return { type: 'undo' };
  const who = polarity(s), num = firstNumber(s);

  const gm = s.match(/\b(\d+) (gauge|awg)\b/) || s.match(/\b(gauge|awg) (\d+)\b/);
  if (gm) {
    const g = Number(gm[1] === 'gauge' || gm[1] === 'awg' ? gm[2] : gm[1]);
    if (g === 2 || g === 4) return { type: 'gauge', target: who || 'both', value: g + 'awg' };
    return null;
  }

  if (has(s, /\bcovers?\b/)) {
    const off = has(s, OFF), on = has(s, ON);
    if (off === on) return null;
    return { type: 'cover', target: who || 'both', on };
  }

  if (has(s, /\b(rotate|turn|spin|swing|yaw)\b/)) {
    if (!who) return null;
    const left = has(s, /\b(left|counter ?clockwise|anti ?clockwise)\b/);
    const right = has(s, /\b(right|clockwise)\b/) && !left;
    if (!left && !right && num === null) return null;
    const mag = num === null ? 15 : num;
    const part = has(s, /\bbusbars?\b/) && !has(s, /\b(lugs?|cable|wire|extension)\b/) ? 'busbar' : 'lug';
    return { type: 'yaw', target: who, part, deg: right ? -mag : mag };   // left = +, right = -
  }

  if (has(s, /\b(cable|wire|extension|inch|inches|in)\b/) && num !== null && who && !has(s, /\b(hide|show)\b/))
    return { type: 'length', target: who, value: num };

  const verb = has(s, /\b(hide|remove)\b/) ? false : has(s, /\bshow\b/) ? true : null;
  if (verb !== null) {
    const parts = [], pol = who && who !== 'both' ? [who] : ['pos', 'neg'];
    if (has(s, /\bnuts\b/)) parts.push(...pol.map(p => 'nut-38-' + p));
    if (has(s, /\bbusbars?\b/)) parts.push(...pol.map(p => 'blueseas-2340-' + p));
    if (has(s, /\blugs?\b/)) parts.push(...pol.map(p => 'lug-38-' + p));
    if (has(s, /\bbattery\b/)) parts.push('odyssey-odp-agm31');
    if (parts.length) return { type: 'toggle', parts, show: verb };
  }
  return null;
}
