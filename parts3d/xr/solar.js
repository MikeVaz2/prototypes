// Solar scene numbers (2026-11-18). Pure: no DOM, no three.js.
// Panel numbers from the catalog entry (`electrical`), scaled with the area when the panel size is changed. The station check unions the electrical nets
// (parts marked `through` pass the net on, jumpers join two outlets) and sums the panels that reach both of the station's solar inputs.
import { connPos } from './match.js';
export const r1 = v => Math.round(v * 10) / 10;

// numbers of one panel instance: { w, vmp, imp, voc, isc, ratio }
export function panelNums(part, opts = {}) {
  let e = part.electrical; if (!e) return null;
  if (e.models && opts.model && e.models[opts.model]) e = { ...e, ...e.models[opts.model] };   // Model option (Yinleader / Renogy): its own label numbers and own size
  const ratio = ((opts.width || e.width_mm) * (opts.length || e.length_mm)) / (e.width_mm * e.length_mm);
  return { w: e.w * ratio, vmp: e.vmp, imp: e.imp * ratio, voc: e.voc, isc: e.isc * ratio, ratio };
}
const f0 = v => String(Math.round(v)), f1 = v => String(r1(v)), f2 = v => String(Math.round(v * 100) / 100);
// "100 W · Vmp 19 V · Imp 5.26 A · Voc 22.42 V · Isc 5.79 A" (area scaled numbers get a ~ in front of W / A)
export function panelText(part, opts) {
  const n = panelNums(part, opts); if (!n) return '';
  const s = Math.abs(n.ratio - 1) > 0.005;
  return (s ? '~' : '') + f0(n.w) + ' W · Vmp ' + f1(n.vmp) + ' V · Imp ' + (s ? '~' : '') + f2(n.imp) + ' A · Voc ' + f2(n.voc) + ' V · Isc ' + (s ? '~' : '') + f2(n.isc) + ' A';
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

// Station check (series aware, 2026-11-18). Every panel is an edge from its - net to its + net; a string is a chain of panels from the station's - net to its + net
// (series links are cables or direct plugs joining a + lead to the next panel's - lead). Strings in parallel add current.
// Voc of a string = sum of the panel Voc; cold Voc = Voc x COLD (note "cold ~"); string current = the weakest panel's; power ~ min(Vmp_string x I_total, imax x Vmp_string, station watts).
// -> null when there is no station, else { n, strings, label, voc, cold, isc, imp, w, vocOk, iscOk, limited, level: 'ok' | 'limited' | 'over', text, panels: [ids] }
export const COLD = 1.10;
function stringsOf(panels, find, pos, neg) {
  const byNeg = new Map(); for (const p of panels) { const k = find(p.id + '.lead_neg'); if (!byNeg.has(k)) byNeg.set(k, []); byNeg.get(k).push(p); }
  const out = [];
  const walk = (net, chain, seen) => {
    if (net === pos) { out.push(chain); return; }
    if (chain.length > 12) return;
    for (const p of byNeg.get(net) || []) { const nx = find(p.id + '.lead_pos'); if (!chain.includes(p) && !seen.has(nx)) walk(nx, [...chain, p], new Set([...seen, nx])); }
  };
  if (pos !== neg) walk(neg, [], new Set([neg]));
  return out;
}
const labelOf = lens => {
  const k = lens[0], s = lens.length;
  if (!lens.every(l => l === k)) return lens.length + ' strings (' + lens.join('+') + ' panels)';
  return s === 1 ? (k === 1 ? '1 panel' : k + 'S') : k === 1 ? s + 'P' : k + 'S' + s + 'P';
};
export function stationCheck(insts, jumpers, partOf) {
  const st = insts.find(i => { const p = partOf(i.part); return p && p.electrical && p.electrical.vmax; });
  if (!st) return null;
  const sp = partOf(st.part), lim = sp.electrical, nick = lim.nick || sp.short || 'station', find = nets(insts, jumpers, partOf);
  const pos = find(st.id + '.pv_pos'), neg = find(st.id + '.pv_neg');
  const all = insts.filter(i => { const p = partOf(i.part); return p && p.electrical && p.electrical.imp; });
  const chains = stringsOf(all, find, pos, neg).filter(c => c.length);
  const used = [...new Set(chains.flat())];
  if (!used.length) return { n: 0, strings: 0, voc: 0, isc: 0, vocOk: true, iscOk: true, limited: false, level: 'ok', panels: [], text: 'No panel is wired to the station yet' };
  const num = i => panelNums(partOf(i.part), i.opts);
  const strs = chains.map(c => { const ns = c.map(num); return { n: c.length, voc: ns.reduce((a, x) => a + x.voc, 0), vmp: ns.reduce((a, x) => a + x.vmp, 0), isc: Math.min(...ns.map(x => x.isc)), imp: Math.min(...ns.map(x => x.imp)) }; });
  const voc = Math.max(...strs.map(x => x.voc)), vmp = strs.length > 1 ? Math.min(...strs.map(x => x.vmp)) : strs[0].vmp, cold = voc * COLD;   // strings in parallel sit at one voltage: the lower one pulls the higher down
  const isc = strs.reduce((a, x) => a + x.isc, 0), imp = strs.reduce((a, x) => a + x.imp, 0);
  const label = labelOf(strs.map(x => x.n));
  const vocOver = cold > lim.vmax, vocLow = voc < lim.vmin, iscOk = isc <= lim.imax;
  const wRaw = Math.min(vmp * imp, lim.imax * vmp, lim.w || Infinity), wLim = wRaw < vmp * imp - 0.5;
  // mixed panels (2026-11-19): a series string carries the weakest panel's current; parallel strings must have similar voltage
  const warns = [], diff = (a, b) => (Math.max(a, b) - Math.min(a, b)) / Math.max(a, b);
  for (const c of chains) { const ims = c.map(i => num(i).imp); if (c.length > 1 && diff(Math.max(...ims), Math.min(...ims)) > 0.05) { warns.push('series: limited by the weakest panel, ' + f1(Math.min(...ims)) + ' A'); break; } }
  if (strs.length > 1 && diff(Math.max(...strs.map(x => x.vmp)), Math.min(...strs.map(x => x.vmp))) > 0.10) warns.push('parallel: voltage mismatch, the higher string is pulled down');
  const r = { warns, n: used.length, strings: strs.length, label, voc, cold, isc, imp, w: wRaw, vocOk: !vocOver && !vocLow, iscOk, limited: !iscOk || wLim, panels: used.map(i => i.id) };
  if (vocOver) {
    r.level = 'over';
    r.text = label + ' Voc ' + f1(voc) + ' V' + (voc > lim.vmax ? '' : ' (cold ~' + f1(cold) + ' V)') + ' — over the ' + nick + ' max ' + lim.vmax + ' V: do not connect';
  } else if (vocLow) {
    r.level = 'over'; r.text = label + ' Voc ' + f1(voc) + ' V — below the ' + nick + ' min ' + lim.vmin + ' V: it will not start';
  } else {
    r.level = r.limited || warns.length ? 'limited' : 'ok';
    r.text = label + ': Voc ' + f1(voc) + ' V (cold ~' + f1(cold) + ' V, OK, max ' + lim.vmax + ') · Isc ' + f1(isc) + ' A (' + (iscOk ? 'OK, max ' + lim.imax : 'limited to ' + lim.imax + ' A') + ') · ~' + f0(wRaw) + ' W' + (wLim ? ' (limited by ' + (lim.imax * vmp < (lim.w || Infinity) ? lim.imax + ' A' : lim.w + ' W') + ')' : ' (OK)') + warns.map(w => ' · ' + w).join('');
  }
  return r;
}

// ---- grommet holes over the bars ----
// POFENZE: first crossbar centre PLAT_FRONT_MM from the front tip (-X, the deflector end), last bar PLAT_REAR_MM from the rear end (estimates, same numbers as make_solar.py)
export const PLAT_FRONT_MM = 205, PLAT_REAR_MM = 80, PLAT_SPACING_MM = 0;   // 0 = bars spread evenly from the first (behind the deflector) to the last (PLAT_REAR_MM from the rear end); set 254 for the maker-diagram spacing (anchored behind the deflector, up to 9 bars)
export const HOLE_END_MM = 25, HOLE_EDGE_MM = 15, HOLE_TOL_MM = 10;
const rackKind = rack => (rack.opts && rack.opts.rack) || 'diy';
// platform size in mm and its crossbar count (options plat_len / plat_wid in cm, plat_bars)
export function platformDims(rack) {
  const o = rack.opts || {};
  return { len: (+o.plat_len || 232.4) * 10, wid: (+o.plat_wid || 120.7) * 10, n: +o.plat_bars || 7 };
}
// bar centres along the car (mm, rack frame) for a rack instance
export function barsX(rack) {
  const o = rack.opts || {};
  if (rackKind(rack) === 'platform') { const { len, n } = platformDims(rack), sp = PLAT_SPACING_MM && (n - 1) * PLAT_SPACING_MM <= 2324 - PLAT_FRONT_MM - PLAT_REAR_MM + 1 ? PLAT_SPACING_MM : (len - PLAT_FRONT_MM - PLAT_REAR_MM) / (n - 1); return Array.from({ length: n }, (_, k) => -len / 2 + PLAT_FRONT_MM + k * sp); }
  const n = +o.bars || 3, gap = +o.gap || 400;
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap);
}
// panel geometry in the rack frame for its yaw: lengths along / across the car and the hole lines (car-X offsets from the panel centre, mm).
// Length along the car (yaw 90 / 270): three hole rows (end, middle, end), each row across the width. Turned (0 / 180): the two long sides run across the car, one bar each.
export function panelGeom(inst) {
  const L = +inst.opts.length || 855, W = +inst.opts.width || 690, alongL = Math.round(inst.yaw) % 180 === 90;
  const pitch = L / 2 - HOLE_END_MM, side = W / 2 - HOLE_EDGE_MM;
  return { alongL, along: alongL ? L : W, across: alongL ? W : L, pitch, side, lines: alongL ? [-pitch, 0, pitch] : [-side, side] };
}
const rad = d => d * Math.PI / 180;
// where the panel centre is in the rack frame (mm): slot + Move offsets + the old own-axis Slide (cm)
export function panelCentre(inst, rack, partOf) {
  const rp = partOf(rack.part), conn = (rp.connections || []).find(c => c.id === inst.on.split('.')[1]);
  const sp = conn ? connPos(conn, rack.opts || {}) : [0, 0, 0], sl = (+inst.opts.slide || 0) * 10;
  return { x: sp[0] * 25.4 + (+inst.opts.px || 0) + sl * Math.cos(rad(inst.yaw)), z: sp[2] * 25.4 + (+inst.opts.pz || 0) - sl * Math.sin(rad(inst.yaw)), slotX: sp[0] * 25.4, slotZ: sp[2] * 25.4 };
}
const onRack = (inst, rack) => !!inst.on && inst.on.split('.')[0] === rack.id;
// bar-aligned centre positions (mm along the car) for the panel's hole lines, nearest to `want` first; [] when none exists
export function snapCandidates(inst, rack, want) {
  const bars = barsX(rack), g = panelGeom(inst), out = new Set();
  for (const b of bars) for (const d of g.lines) {
    const c = b - d;
    if (g.lines.every(e => Math.min(...bars.map(x => Math.abs(x - (c + e)))) <= HOLE_TOL_MM)) out.add(Math.round(c * 10) / 10);
  }
  return [...out].sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
}
// Does each hole line sit over a bar? Panel inst on a rack slot. -> { ok, pitch, text }
export function holesCheck(inst, rack, partOf) {
  if (!onRack(inst, rack)) return { ok: true, text: '' };
  const g = panelGeom(inst);
  if (rackKind(rack) === 'platform') return { ok: true, pitch: g.pitch, text: '' };
  const c = panelCentre(inst, rack, partOf), bars = barsX(rack);
  const ok = g.lines.every(d => Math.min(...bars.map(b => Math.abs(b - (c.x + d)))) <= HOLE_TOL_MM);
  if (ok) return { ok, pitch: g.pitch, text: '' };
  if (snapCandidates(inst, rack, c.x).length) return { ok, pitch: g.pitch, text: 'Holes are between the bars: tap Move to snap the panel onto them' };
  const need = g.alongL ? Math.round(g.pitch) : Math.round(2 * g.side);
  return { ok, pitch: g.pitch, text: "Holes don't line up with the bars: set bar spacing to " + need + ' mm' + (g.alongL ? (Math.abs(c.x) < 1 && bars.length % 2 === 0 ? ' (and use an odd bar count)' : '') : ' (two bars)') };
}
// ---- fit check (2026-11-20): how far a panel sticks out past the rack's outer edge ----
export const FIT_MM = 150;   // more than this past a rail (or the platform edge) = "doesn't fit the rack"
// size of the rack footprint in mm: rails (factory rails: length x rail-to-rail) or the platform
export function rackDims(rack) {
  if (rackKind(rack) === 'platform') { const d = platformDims(rack); return { len: d.len, wid: d.wid, edge: 'the platform' }; }
  const o = rack.opts || {}; return { len: (+o.rail_len || 135) * 10, wid: (+o.rail_sp || 110) * 10, edge: 'the rails' };
}
// -> { ok, over: { x, z } (mm past the edge, 0 when inside), text } ; text is "doesn't fit the rack: reason; reason" or ''
export function fitCheck(inst, rack, partOf, insts) {
  if (!onRack(inst, rack)) return { ok: true, over: { x: 0, z: 0 }, text: '' };
  const g = panelGeom(inst), c = panelCentre(inst, rack, partOf), d = rackDims(rack);
  const ox = Math.max(0, Math.round(Math.abs(c.x) + g.along / 2 - d.len / 2)), oz = Math.max(0, Math.round(Math.abs(c.z) + g.across / 2 - d.wid / 2));
  const why = [];
  if (oz > FIT_MM) why.push(oz + ' mm past the side of ' + d.edge + ' (max ' + FIT_MM + ')');
  if (ox > FIT_MM) why.push(ox + ' mm past the end of ' + d.edge + ' (max ' + FIT_MM + ')');
  if (rackKind(rack) !== 'platform' && insts) {
    const mine = insts.filter(i => i.part === inst.part && onRack(i, rack));
    if (mine.length >= 4) {
      const ex = mine.map(i => { const gi = panelGeom(i), ci = panelCentre(i, rack, partOf); return [ci.x - gi.along / 2, ci.x + gi.along / 2]; }), need = Math.round(Math.max(...ex.map(e => e[1])) - Math.min(...ex.map(e => e[0])));
      if (need > d.len + 2 * FIT_MM) why.push(mine.length + ' panels need ' + need + ' mm along the car, the factory rails are ' + Math.round(d.len) + ' mm: use the platform');
    }
  }
  return { ok: !why.length, over: { x: ox, z: oz }, text: why.length ? "doesn't fit the rack: " + why.join('; ') : '' };
}

// ---- GX470 roof outline for scale (2026-11-20), rack frame, x along the car (front = -X), centred on the rack. Roof area [E] estimate; the windshield base arc is drawn ahead of the roof ----
export const ROOF = { len: 1900, wid: 1450, r: 220, glassGap: 90, glassBow: 70 };
// closed outline of the roof, [[x, z]] in mm (rounded rectangle)
export function roofPoly(n = 10) {
  const { len, wid, r } = ROOF, hx = len / 2 - r, hz = wid / 2 - r, pts = [];
  for (const [cx, cz, a0] of [[hx, hz, 0], [-hx, hz, 90], [-hx, -hz, 180], [hx, -hz, 270]])
    for (let k = 0; k <= n; k++) { const a = rad(a0 + 90 * k / n); pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return pts;
}
// windshield edge: an arc across the car just ahead of the roof front, [[x, z]] in mm
export function windshieldLine(n = 24) {
  const hw = ROOF.wid / 2 - ROOF.r, x0 = -ROOF.len / 2 - ROOF.glassGap;
  return Array.from({ length: n + 1 }, (_, k) => { const t = k / n * 2 - 1; return [x0 - ROOF.glassBow * (1 - t * t), t * hw]; });
}
// half sizes the panel centre may move over (mm): platform = the whole panel stays on it; bars = the centre stays over the rails / bars
export function moveLimits(inst, rack) {
  const g = panelGeom(inst), o = rack.opts || {};
  if (rackKind(rack) === 'platform') { const d = platformDims(rack); return { hx: Math.max(0, d.len / 2 - g.along / 2), hz: Math.max(0, d.wid / 2 - g.across / 2) }; }
  return { hx: (+o.rail_len || 135) * 5, hz: ((+o.rail_sp || 110) * 10 + 60) / 2 };
}
const clamp = (v, h) => Math.min(h, Math.max(-h, v));
// Move the panel centre to (tx, tz) in the rack frame (mm). On bars the along-car position snaps so the hole lines land on bars (nearest valid spot);
// on the platform it moves freely, kept inside. -> { px, pz, snapped, x, z } offsets from the slot (mm, whole numbers); caller also zeroes Slide
export function movePanel(inst, rack, partOf, tx, tz) {
  const c = panelCentre(inst, rack, partOf), lim = moveLimits(inst, rack);
  let x = clamp(tx, lim.hx), snapped = false;
  if (rackKind(rack) !== 'platform') { const s = snapCandidates(inst, rack, x); if (s.length) { x = s[0]; snapped = true; } }
  const z = clamp(tz, lim.hz);
  return { px: Math.round(x - c.slotX), pz: Math.round(z - c.slotZ), snapped, x, z };
}
// Turn the panel 90 degrees about its centre, then re-snap its hole lines to the bars. -> { yaw, px, pz, slide: 0, snapped }
export function turnPanel(inst, rack, partOf) {
  const c = panelCentre(inst, rack, partOf), yaw = (Math.round(inst.yaw) + 90) % 360;
  const next = { ...inst, yaw, opts: { ...inst.opts, slide: 0, px: 0, pz: 0 } };
  const m = movePanel(next, rack, partOf, c.x, c.z);
  return { yaw, px: m.px, pz: m.pz, slide: 0, snapped: m.snapped };
}
// bolt heads show only while the hole lines sit over bars: sets opts.bolted on every panel (in place). -> true when something changed
export function syncBolts(insts, partOf) {
  let ch = false;
  for (const i of insts) {
    const p = partOf(i.part); if (!(p && p.options && p.options.bolted)) continue;
    const rack = i.on && insts.find(r => r.id === i.on.split('.')[0]), ok = rack ? holesCheck(i, rack, partOf).ok : true;
    if (i.opts.bolted !== ok) { i.opts.bolted = ok; ch = true; }
  }
  return ch;
}
