// Solar scene numbers (2026-11-18). Pure: no DOM, no three.js.
// Panel numbers from the catalog entry (`electrical`), scaled with the area when the panel size is changed. The station check unions the electrical nets
// (parts marked `through` pass the net on, jumpers join two outlets) and sums the panels that reach both of the station's solar inputs.
import { connPos } from './match.js';
export const r1 = v => Math.round(v * 10) / 10;

// numbers of one panel instance: { w, vmp, imp, voc, isc, ratio }
export function panelNums(part, opts = {}) {
  const e = part.electrical; if (!e) return null;
  const ratio = ((opts.width || e.width_mm) * (opts.length || e.length_mm)) / (e.width_mm * e.length_mm);
  return { w: e.w * ratio, vmp: e.vmp, imp: e.imp * ratio, voc: e.voc, isc: e.isc * ratio, ratio };
}
const f0 = v => String(Math.round(v)), f1 = v => String(r1(v)), f2 = v => String(Math.round(v * 100) / 100);
// "100 W · Vmp 19 V · Imp 5.26 A · Voc 22.42 V · Isc 5.79 A" (area scaled numbers get a ~ in front of W / A)
export function panelText(part, opts) {
  const n = panelNums(part, opts); if (!n) return '';
  const s = Math.abs(n.ratio - 1) > 0.005;
  return (s ? '~' : '') + f0(n.w) + ' W · Vmp ' + f0(n.vmp) + ' V · Imp ' + (s ? '~' : '') + f2(n.imp) + ' A · Voc ' + f2(n.voc) + ' V · Isc ' + (s ? '~' : '') + f2(n.isc) + ' A';
}

// net id per outlet key. insts = [{ id, part, on }], jumpers = [{ a, b }], partOf = id -> catalog entry
export function nets(insts, jumpers, partOf) {
  const up = new Map(), find = k => { if (!up.has(k)) up.set(k, k); let r = k; while (up.get(r) !== r) r = up.get(r); up.set(k, r); return r; }, join = (a, b) => { const x = find(a), y = find(b); if (x !== y) up.set(x, y); };
  for (const i of insts) {
    const p = partOf(i.part); if (!p) continue;
    for (const c of p.connections || []) find(i.id + '.' + c.id);
    if (p.through && i.on) for (const c of p.connections || []) join(i.id + '.' + c.id, i.on);
  }
  for (const j of jumpers || []) join(j.a, j.b);
  return find;
}

// Parallel check at one station. -> null when there is no station, else
// { n, voc, isc, vocOk, iscOk, limited, text, panels: [ids] }
export function stationCheck(insts, jumpers, partOf) {
  const st = insts.find(i => { const p = partOf(i.part); return p && p.electrical && p.electrical.vmax; });
  if (!st) return null;
  const sp = partOf(st.part), lim = sp.electrical, find = nets(insts, jumpers, partOf), pos = find(st.id + '.pv_pos'), neg = find(st.id + '.pv_neg');
  const panels = insts.filter(i => { const p = partOf(i.part); return p && p.electrical && p.electrical.imp && find(i.id + '.lead_pos') === pos && find(i.id + '.lead_neg') === neg; });
  if (!panels.length) return { n: 0, voc: 0, isc: 0, vocOk: true, iscOk: true, limited: false, panels: [], text: 'No panel is wired to the station yet' };
  const nums = panels.map(i => panelNums(partOf(i.part), i.opts)), voc = Math.max(...nums.map(n => n.voc)), isc = nums.reduce((a, n) => a + n.isc, 0);
  const vocOk = voc <= lim.vmax && voc >= lim.vmin, iscOk = isc <= lim.imax;
  const vtxt = vocOk ? 'OK, max ' + lim.vmax : voc > lim.vmax ? 'over the ' + lim.vmax + ' V max' : 'below the ' + lim.vmin + ' V min';
  const itxt = iscOk ? 'OK, max ' + lim.imax : 'limited to ' + lim.imax + ' A';
  const text = (panels.length > 1 ? 'Parallel' : '1 panel') + ': Voc ' + f1(voc) + ' V (' + vtxt + '), Isc ' + f1(isc) + ' A (' + itxt + ')';
  return { n: panels.length, voc, isc, vocOk, iscOk, limited: !iscOk, panels: panels.map(i => i.id), text };
}

// ---- grommet holes over the bars ----
export const HOLE_END_MM = 25, HOLE_TOL_MM = 10;
// bar centres along the car (mm, rack frame) for a rack instance
export function barsX(rack) {
  const o = rack.opts || {};
  if (o.rack === 'platform') return Array.from({ length: 9 }, (_, k) => -1100 + 40 + k * (2200 - 80) / 8);
  const n = +o.bars || 3, gap = +o.gap || 400;
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap);
}
// Does each row of holes (end, middle, end) sit over a bar? Panel inst on a rack slot. -> { ok, pitch, text }
// The rows run across the panel width, so the panel must lie with its length along the car (yaw 90 or 270).
export function holesCheck(inst, rack, partOf) {
  if (!inst.on || inst.on.split('.')[0] !== rack.id) return { ok: true, text: '' };
  const rp = partOf(rack.part), conn = (rp.connections || []).find(c => c.id === inst.on.split('.')[1]);
  if (!conn) return { ok: true, text: '' };
  const pitch = ((inst.opts.length || 855) / 2 - HOLE_END_MM), pr = Math.round(pitch);
  if (Math.round(inst.yaw) % 180 !== 90) return { ok: false, pitch, text: 'Turn the panel 90° so its hole rows lie across the bars' };
  if (rack.opts && rack.opts.rack === 'platform') return { ok: true, pitch, text: '' };
  const x0 = connPos(conn, rack.opts || {})[0] * 25.4, bars = barsX(rack);
  const off = [-pitch, 0, pitch].map(d => Math.min(...bars.map(b => Math.abs(b - (x0 + d)))));
  const ok = off.every(d => d <= HOLE_TOL_MM);
  return { ok, pitch, text: ok ? '' : "Holes don't line up with the bars: set bar spacing to " + pr + ' mm' + (Math.abs(x0) < 1 && bars.length % 2 === 0 ? ' (and use an odd bar count)' : '') };
}
