// Jumper = a cable between two stud outlets (straight route for now). Pure: no DOM, no three.js. Lengths in inches.
// jumper = { id, a, b, gauge, color, endA, endB }   a, b = outlet keys "hostId.connId"   ends = ring lug size '3/8' | '5/16'
export const GAUGES = ['4', '2', '1/0', '12', '10'], COLORS = ['red', 'black'], ENDS = ['3/8', '5/16', 'mc4'];
// Solar MC4 cables (2026-11-18): a jumper whose ends are 'mc4' plugs between two MC4 outlets (threads mc4+ / mc4-). Gauge = PV wire AWG (12 = 4 mm2, 10 = 6 mm2).
export const SOLAR_GAUGES = ['12', '10'], LUG_GAUGES = ['4', '2', '1/0'];
export const isMc4 = j => !!j && j.endA === 'mc4';
export const isMc4Thread = t => /^mc4[+-]$/.test(t || '');
export const gaugesFor = j => isMc4(j) ? SOLAR_GAUGES : LUG_GAUGES;
export const M_IN = 1 / 0.0254, CABLE_ROUND_M = 0.1, CABLE_MIN_M = 0.3;
export const DEFAULT_GAUGE = '1/0';
// jacket diameter in inches (estimates, battery cable)
export const OD_IN = { '4': 0.38, '2': 0.45, '1/0': 0.56, '12': 0.236, '10': 0.26 };   // 12 and 10: PV wire, about 6 mm over the jacket
// ring centre to the cable entry of the lug barrel, inches (estimates)
export const LUG_REACH_IN = { '4': 1.8, '2': 2.0, '1/0': 2.2, '12': 0, '10': 0 };
export const SLACK = 0.10, ROUND_IN = 0.5;
const ENDS_BY_THREAD = { '3/8-16': '3/8', '5/16-18': '5/16' };

export const endForThread = th => isMc4Thread(th) ? 'mc4' : (ENDS_BY_THREAD[th] || null);
// a ring lug end must match the stud thread
export function checkEnd(end, thread) {
  if (isMc4Thread(thread) || end === 'mc4') return end === 'mc4' && isMc4Thread(thread) ? { ok: true, why: '' } : { ok: false, why: isMc4Thread(thread) ? 'MC4 outlet needs an MC4 cable' : 'An MC4 cable does not fit a ' + (thread || 'unknown') + ' outlet' };
  const want = endForThread(thread);
  if (!want) return { ok: false, why: 'No ring lug for a ' + (thread || 'unknown') + ' outlet' };
  if (end !== want) return { ok: false, why: end + ' lug does not fit a ' + want + ' stud' };
  return { ok: true, why: '' };
}
export const defaultColor = polarity => polarity === '-' ? 'black' : 'red';

// make a jumper between two outlet connections (catalog connection objects with accepts.thread). -> { ok, why, jumper }
export function makeJumper(id, a, connA, b, connB, o = {}) {
  if (a === b) return { ok: false, why: 'Pick a second stud' };
  const ma = connA && connA.accepts && isMc4Thread(connA.accepts.thread), mb = connB && connB.accepts && isMc4Thread(connB.accepts.thread);
  if (ma || mb) {   // MC4: both ends MC4, same polarity (+ to +, - to -), PV wire, red for + and black for -
    if (!(ma && mb)) return { ok: false, why: 'An MC4 cable fits MC4 outlets only' };
    if (connA.accepts.thread !== connB.accepts.thread) return { ok: false, why: 'Polarity mismatch: ' + connA.accepts.thread.slice(3) + ' to ' + connB.accepts.thread.slice(3) };
    return { ok: true, why: '', jumper: { id, a, b, gauge: SOLAR_GAUGES.includes(o.gauge) ? o.gauge : '12', color: COLORS.includes(o.color) ? o.color : (connA.accepts.thread === 'mc4+' ? 'red' : 'black'), endA: 'mc4', endB: 'mc4' } };
  }
  const ta = connA && connA.accepts && connA.accepts.thread, tb = connB && connB.accepts && connB.accepts.thread;
  const endA = o.endA || endForThread(ta), endB = o.endB || endForThread(tb);
  for (const [e, t] of [[endA, ta], [endB, tb]]) { const c = checkEnd(e, t); if (!c.ok) return { ok: false, why: c.why }; }
  const gauge = GAUGES.includes(o.gauge) ? o.gauge : DEFAULT_GAUGE, color = COLORS.includes(o.color) ? o.color : defaultColor(connA.polarity);
  return { ok: true, why: '', jumper: { id, a, b, gauge, color, endA, endB } };
}
// change one end of a jumper; thread = the stud thread at that end
export function setEnd(j, side, end, thread) {
  const c = checkEnd(end, thread); if (!c.ok) return { ok: false, why: c.why, jumper: j };
  return { ok: true, why: '', jumper: { ...j, [side === 'a' ? 'endA' : 'endB']: end } };
}
export const nextOf = (list, v) => list[(list.indexOf(v) + 1) % list.length];

const horiz = (p, q) => { const dx = q[0] - p[0], dz = q[2] - p[2], h = Math.hypot(dx, dz); return h < 1e-9 ? [1, 0] : [dx / h, dz / h]; };
// seatA, seatB = ring centres [x,y,z] in inches. The lug barrel entry sits LUG_REACH out from the ring, toward the other end (horizontal).
export function barrels(seatA, seatB, gauge = DEFAULT_GAUGE) {
  const r = LUG_REACH_IN[gauge] || LUG_REACH_IN[DEFAULT_GAUGE], ha = horiz(seatA, seatB), hb = horiz(seatB, seatA);
  return [[seatA[0] + ha[0] * r, seatA[1], seatA[2] + ha[1] * r], [seatB[0] + hb[0] * r, seatB[1], seatB[2] + hb[1] * r]];
}
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
// straight distance between the barrels, plus 10 % slack rounded up to 0.5 in
export function cutLength(pa, pb) {
  const straight = dist(pa, pb), cut = 0 + Math.ceil(straight * (1 + SLACK) / ROUND_IN - 1e-9) * ROUND_IN + 0;
  return { straight, cut };
}
// MC4 cable: straight distance between the plug seats plus 10 % slack, up to 0.1 m, at least 0.3 m (inches)
export function solarLength(a, b) {
  const straight = dist(a, b), m = Math.max(CABLE_MIN_M, Math.ceil(straight / M_IN * (1 + SLACK) / CABLE_ROUND_M - 1e-9) * CABLE_ROUND_M);
  return { pa: a, pb: b, straight, cut: m * M_IN, metres: Math.round(m * 10) / 10 };
}
export function lengthFor(j, seatA, seatB) { if (isMc4(j)) return solarLength(seatA, seatB); const [pa, pb] = barrels(seatA, seatB, j.gauge); return { pa, pb, ...cutLength(pa, pb) }; }
export const jumperText = (j, lenText) => isMc4(j) ? 'MC4 cable ' + j.gauge + ' AWG · ' + lenText + ' · ' + (j.color === 'red' ? '+' : '−') : 'Jumper ' + j.gauge + ' · ' + lenText + ' · ' + j.endA + '–' + j.endB;

// ---- hash: j=a:b:gauge:color:endA:endB~...   (gauge "1/0" and ends "3/8" are URL safe) ----
export const serialize = js => (js || []).map(j => [j.a, j.b, j.gauge, j.color, j.endA, j.endB].join(':')).join('~');
export function parse(str) {
  const out = [];
  for (const t of (str || '').split('~')) {
    const [a, b, gauge, color, endA, endB] = t.split(':');
    if (!a || !b || a === b || !GAUGES.includes(gauge) || !COLORS.includes(color) || !ENDS.includes(endA) || !ENDS.includes(endB)) continue;
    out.push({ id: 'j' + (out.length + 1), a, b, gauge, color, endA, endB });
  }
  return out.slice(0, 8);
}
export const nextId = js => { for (let n = 1; ; n++) if (!js.some(j => j.id === 'j' + n)) return 'j' + n; };
