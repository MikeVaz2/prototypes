// Terminal option presets on the Odyssey battery. Pure: no DOM, no three.js. Each preset is a scene hash fragment (s=... and j=...) for the parts on the battery.
// Switching keeps the host instance (its pose: at, yaw, opts) and the scene's offsets, marks and measurements; it swaps every other part and the jumpers.
// All dimensions behind these parts are estimates, see README.
export const CASE_TOP_IN = 8.6;   // battery case top above the floor, inches (heights are quoted above it)
const B = 'odyssey-odp-agm31', H = 's=' + B + ':-:0:';
const side = (pol, mid) => mid;
const BATTERY_RAW = [
  { id: 'A', short: 'Adapter', name: 'Adapter on stud',
    hash: H + '~blueseas-2340-pos:stud_pos:90:cover=1~sae-adapter-pos:' + B + '.stud_pos:0:~gx470-clamp-pos:sae-adapter-pos.post:0:' +
      '~blueseas-2340-neg:stud_neg:90:cover=1~sae-adapter-neg:' + B + '.stud_neg:0:~gx470-clamp-neg:sae-adapter-neg.post:0:' },
  { id: 'B', short: 'Offset post', name: 'Offset post',
    hash: H + '~blueseas-2340-pos-drilled:' + B + '.stud_pos:90:cover=1~nut-38-pos:stud_pos:0:~stud-38-16-pos:blueseas-2340-pos-drilled.bar_hole:0:~sae-adapter-pos:stud-38-16-pos.top:0:~gx470-clamp-pos:sae-adapter-pos.post:0:' +
      '~blueseas-2340-neg-drilled:' + B + '.stud_neg:90:cover=1~nut-38-neg:stud_neg:0:~stud-38-16-neg:blueseas-2340-neg-drilled.bar_hole:0:~sae-adapter-neg:stud-38-16-neg.top:0:~gx470-clamp-neg:sae-adapter-neg.post:0:' },
  { id: 'C', short: 'R4T', name: 'R4T terminals',
    hash: H + '~r4t-g31-pos:' + B + '.stud_pos:0:~gx470-clamp-pos:r4t-g31-pos.post:0:~r4t-g31-neg:' + B + '.stud_neg:0:~gx470-clamp-neg:r4t-g31-neg.post:0:' },
  { id: 'D', short: 'Billet', name: 'Billet: Blaze (+), SLEE (−)',
    hash: H + '~blaze-4runner-pos:' + B + '.stud_pos:0:~gx470-clamp-pos:blaze-4runner-pos.post:0:~slee-sok20002-neg:' + B + '.stud_neg:0:~gx470-clamp-neg:slee-sok20002-neg.post:0:' },
  { id: 'E', short: 'Vgate', name: 'Vgate 20-way block',
    hash: H + '~vgate-20way-pos:' + B + '.stud_pos:0:' },
  { id: 'F', short: 'PowerBar', name: 'MRBF and PowerBar',
    hash: H + '~mrbf-5191:' + B + '.stud_pos:0:~powerbar-2104:@14,0,0:0:&j=mrbf-5191.fuse_out:powerbar-2104.s1:1/0:red:5/16:3/8' },
];
// the hold-down bar (flat bar with two J-hooks) is in every battery option, at the battery centre on the floor (@x,y,z inches in the battery frame)
export const HOLDDOWN = 'holddown-bar';
const HD = '~' + HOLDDOWN + ':@0,0,0:0:';
const withHold = h => { const k = h.indexOf('&j='); return k < 0 ? h + HD : h.slice(0, k) + HD + h.slice(k); };
export const BATTERY_PRESETS = BATTERY_RAW.map(p => ({ ...p, hash: withHold(p.hash) }));
// Fume extractor options: the fan with everything connected (adapter, clamp, flex duct). Hash fragments like the battery ones; opts as in the catalog.
const F = 'fan-80mm', AD = 'fan-duct-adapter', fan = o => 's=' + F + ':-:0:' + o;
// yaw: the duct's bend turns toward the fan frame's +X; on a vertical fan that is down, so the vertical options turn it 180 degrees (bend up)
const chain = (dia, len, bend, yaw = 0, cl = 'hose-clamp') => '~' + AD + ':' + F + '.outlet:0:dia=' + dia + ',length=30' +
  '~' + cl + ':' + AD + '.clamp:0:dia=' + dia + '~flex-duct:' + AD + '.spigot:' + yaw + ':dia=' + dia + ',length=' + len + ',bend=' + bend;
export const FAN_PRESETS = [
  { id: 'A', short: 'Straight', name: 'Horizontal fan, 75 mm duct, 1 m straight', hash: fan('orient=horizontal,grill=inlet') + chain('d75', 1, 'straight') },
  { id: 'B', short: '90 bend', name: 'Vertical fan, 102 mm (4 in) duct, 90 degree bend, 1.5 m', hash: fan('orient=vertical,grill=inlet') + chain('d102', 1.5, 'b90', 180) },
  { id: 'C', short: '45 bend', name: 'Vertical fan, 75 mm duct, 45 degree bend, 0.8 m', hash: fan('orient=vertical,grill=inlet') + chain('d75', 0.8, 'b45', 180) },
];
// Solar roof options (2026-11-18): the DIY rack with panels, MC4 Y-branches, fuses and cables to the Bluetti AC70 on the ground beside the car.
// Ground parts are '@x,y,z' inches in the rack frame (y = 0 is the roof, the ground is about 185 cm below).
const R = 'roof-rack', SP = 'solar-panel', ST = 'bluetti-ac70';
const rack = o => 's=' + R + ':-:0:rack=diy,profile=tslot,' + o;
const sfx = n => n > 1 ? '_' + n : '';
const panel = (n, slot) => '~' + SP + sfx(n) + ':' + R + '.' + slot + ':90:width=690,length=855,slide=0';
const station = (xc, yc, zc) => '~' + ST + ':@' + [xc, yc, zc].map(c => Math.round(c / 2.54 * 100) / 100).join(',') + ':0:';
const wire = (a, b, col) => a + ':' + b + ':12:' + col + ':mc4:mc4';
const STATION_AT = [190, -185, 280];   // cm in the rack frame: beside the car, on the ground (the roof is y = 0)
const P = n => SP + sfx(n);
// the MC4 Y-branch is one part with options split (2 / 4) and pol (pos / neg); a + and a - Y of one preset are the instances mc4-y and mc4-y_2
const YP = 'mc4-y', YN = 'mc4-y_2', yTok = (id, parent, split, pol) => '~' + id + ':' + parent + ':0:split=' + split + ',pol=' + pol;
const lead = (n, pol) => P(n) + '.lead_' + pol;
const J = list => '&j=' + list.join('~');
// Round 5 (2026-11-20), GX470 numbers. 2 panels (A, B): DIY bars on the factory rails, rails 1100 mm apart and 1350 mm long. The panels lie side by side across the car, length along the car,
// on 3 bars 400 mm apart (the 402 mm hole pitch; smaller than the 600-937 mm factory crossbar range, kept because 3 bars is what one panel needs). Two panels are 1380 mm wide: 140 mm past each rail (limit 150).
// 4 panels (C, D, E): POFENZE platform (2324 x 1207), 7 bars spread evenly (339.8 mm), the panel middle rows on bars 2 and 5 (platform bars at x = -957 + k * 339.8 mm, solar.barsX).
const R2 = rack('bars=3,gap=400,rail_sp=110,rail_len=135'), R4 = 's=' + R + ':-:0:rack=platform,plat_bars=7';
const PLAT_BAR_X = [-957 + 339.833 * 1, -957 + 339.833 * 4];   // bar 2 and bar 5 (mm, rack frame); slots b1 b2 sit at x = -600, b3 b4 at +600
const panel4 = (n, slot, k) => panel(n, slot).replace('slide=0', 'slide=0,px=' + Math.round(PLAT_BAR_X[k] - (k ? 600 : -600)));
const panels2 = panel(1, 'a1') + panel(2, 'a2'), panels4 = panel4(1, 'b1', 0) + panel4(2, 'b2', 0) + panel4(3, 'b3', 1) + panel4(4, 'b4', 1);
// Five ways to connect the panels (2026-11-18). The AC70 solar input takes 12-58 V and 10 A; a panel is Voc 22.42 V, Isc 5.79 A, Vmp 19 V, Imp 5.26 A.
// A series link is a cable from one panel's + lead to the next panel's - lead (or the plugs mated directly).
export const SOLAR_PRESETS = [
  { id: 'A', short: '2 in series', name: '2 panels in series (the founder build): leads mate, extension cables to the AC70',
    hash: R2 + panels2 + station(...STATION_AT) +
      J([wire(lead(1, 'pos'), ST + '.pv_pos', 'red'), wire(lead(1, 'neg'), lead(2, 'pos'), 'black'), wire(lead(2, 'neg'), ST + '.pv_neg', 'black')]) },
  { id: 'B', short: '2 parallel', name: '2 panels in parallel with a 2-to-1 Y pair',
    hash: R2 + panels2 + yTok(YP, lead(1, 'pos'), 2, 'pos') + yTok(YN, lead(1, 'neg'), 2, 'neg') + station(...STATION_AT) +
      J([wire(lead(2, 'pos'), YP + '.in_b', 'red'), wire(lead(2, 'neg'), YN + '.in_b', 'black'), wire(YP + '.out', ST + '.pv_pos', 'red'), wire(YN + '.out', ST + '.pv_neg', 'black')]) },
  { id: 'C', short: '4: 2S2P', name: '4 panels, two strings of 2 in series, joined with a 2-to-1 Y pair',
    hash: R4 + panels4 + yTok(YP, lead(3, 'pos'), 2, 'pos') + yTok(YN, lead(1, 'neg'), 2, 'neg') + station(...STATION_AT) +
      J([wire(lead(1, 'pos'), lead(3, 'neg'), 'red'), wire(lead(2, 'pos'), lead(4, 'neg'), 'red'), wire(lead(4, 'pos'), YP + '.in_b', 'red'), wire(lead(2, 'neg'), YN + '.in_b', 'black'),
        wire(YP + '.out', ST + '.pv_pos', 'red'), wire(YN + '.out', ST + '.pv_neg', 'black')]) },
  { id: 'D', short: '4 parallel', name: '4 panels in parallel with a 1-to-4 Y pair',
    hash: R4 + panels4 + yTok(YP, lead(1, 'pos'), 4, 'pos') + yTok(YN, lead(1, 'neg'), 4, 'neg') + station(...STATION_AT) +
      J([...[2, 3, 4].map((n, k) => wire(lead(n, 'pos'), YP + '.in_' + 'bcd'[k], 'red')), ...[2, 3, 4].map((n, k) => wire(lead(n, 'neg'), YN + '.in_' + 'bcd'[k], 'black')),
        wire(YP + '.out', ST + '.pv_pos', 'red'), wire(YN + '.out', ST + '.pv_neg', 'black')]) },
  { id: 'E', short: '4 in series: too high', name: '4 panels in series: over the AC70 voltage limit, do not connect',
    hash: R4 + panels4 + station(...STATION_AT) +
      J([wire(lead(1, 'neg'), ST + '.pv_neg', 'black'), wire(lead(1, 'pos'), lead(2, 'neg'), 'red'), wire(lead(2, 'pos'), lead(3, 'neg'), 'red'), wire(lead(3, 'pos'), lead(4, 'neg'), 'red'), wire(lead(4, 'pos'), ST + '.pv_pos', 'red')]) },
];
// Backyard pool options (2026-11-21): the pool alone, sizes in metres. Option line: size, depth, tile, water.
const pool = (len, wid, dep, tile, filled) => 's=pool:-:0:length=' + len + ',width=' + wid + ',depth=' + dep + ',tile=' + tile + ',filled=' + (filled ? 1 : 0);
export const POOL_PRESETS = [
  { id: 'A', short: 'Plunge', name: 'Plunge pool 2.4 x 4 m, 1.4 m deep, blue mosaic, filled', hash: pool(4, 2.4, 1.4, 'mosaic', true) },
  { id: 'B', short: 'Standard', name: 'Standard pool 4 x 8 m, 1.5 m deep, white plaster, filled', hash: pool(8, 4, 1.5, 'plaster', true) },
  { id: 'C', short: 'Lap', name: 'Lap pool 2.5 x 12 m, 1.3 m deep, dark graphite, filled', hash: pool(12, 2.5, 1.3, 'graphite', true) },
  { id: 'D', short: 'Family', name: 'Family pool 5 x 10 m, 1.8 m deep, turquoise glass, empty', hash: pool(10, 5, 1.8, 'glass', false) },
];
const HOST_LISTS = { 'fan-80mm': FAN_PRESETS, 'roof-rack': SOLAR_PRESETS, 'pool': POOL_PRESETS };
const listFor = S => !S || S.isDefaultHost ? BATTERY_PRESETS : HOST_LISTS[S.host.id] || FAN_PRESETS;
// the active list follows the start scene: battery options by default, the host's own options otherwise (setHost is called once, when the scene is created)
export let PRESETS = BATTERY_PRESETS;
export const setHost = S => { PRESETS = listFor(S); };
export const ids = () => PRESETS.map(p => p.id);
export const byId = id => PRESETS.find(p => p.id === String(id).toUpperCase()) || null;
export const nextId = id => { const i = ids().indexOf(id); return ids()[(i + 1) % ids().length]; };

// Ground parts of a preset are written as '@x,y,z' in the battery frame (inches, +yaw as in matrixOf); this maps them to the model frame for the battery's current pose.
export function relPlace(hostAt, hostYaw, rel, yaw = 0) {
  const t = (hostYaw || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), a = hostAt || [0, 0, 0];
  const r2 = v => Math.round(v * 100) / 100;
  return { at: [r2(a[0] + rel[0] * c + rel[2] * s), r2(a[1] + rel[1]), r2(a[2] - rel[0] * s + rel[2] * c)], yaw: Math.round((((yaw + (hostYaw || 0)) % 360) + 360) % 360 * 10) / 10 };
}
// scene = { insts, offs, marks, measures, jumpers }. S = createScene(catalog). -> new scene, or null for an unknown id.
// Replaces only what the preset owns (parts stacked on the battery studs); keeps parts placed elsewhere and jumpers whose two ends still exist.
export function applyPreset(S, scene, id) {
  if (!S.isDefaultHost) return applyHostPreset(S, scene, id);
  const p = byId(id); if (!p) return null;
  const parsed = S.fromHash(p.hash);
  const host = scene.insts.find(i => i.part === S.host.id) || parsed.insts.find(i => i.part === S.host.id);
  const kept = scene.insts.filter(i => i.part !== S.host.id && sideOf(S, scene.insts, i.id) == null);
  const have = new Set([host.id, ...kept.map(i => i.id)]);
  const added = [];
  for (const i of parsed.insts) {
    if (i.part === S.host.id) continue;
    if (i.at) { if (have.has(i.id)) continue; const pl = relPlace(host.at, host.yaw, i.at, i.yaw); added.push({ ...i, at: pl.at, yaw: pl.yaw }); }
    else added.push(i);
    have.add(i.id);
  }
  const insts = [host, ...kept, ...added];
  const alive = k => { const c = S.connOf(insts, k); return !!(c && c.conn); };
  const jumpers = [];
  for (const j of [...(scene.jumpers || []), ...parsed.jumpers]) {
    if (!alive(j.a) || !alive(j.b)) continue;
    if (jumpers.some(x => (x.a === j.a && x.b === j.b) || (x.a === j.b && x.b === j.a))) continue;
    let n = 1; while (jumpers.some(x => x.id === 'j' + n)) n++;
    jumpers.push({ ...j, id: jumpers.some(x => x.id === j.id) ? 'j' + n : j.id });
  }
  return { ...scene, insts, jumpers };
}
// fan scene: the fan keeps its pose (at, yaw), takes the preset's fan options, and everything else is replaced by the preset's chain. Marks and offsets stay.
// Solar roof: same, plus ground parts ('@x,y,z' inches in the rack frame, the AC70) are placed relative to the rack's pose, and the preset's cables come with it.
function applyHostPreset(S, scene, id) {
  const p = listFor(S).find(x => x.id === String(id).toUpperCase()); if (!p) return null;
  const parsed = S.fromHash(p.hash), ph = parsed.insts.find(i => i.part === S.host.id), old = scene.insts.find(i => i.part === S.host.id) || ph;
  const host = { ...old, opts: { ...old.opts, ...ph.opts } };
  const rest = parsed.insts.filter(i => i.part !== S.host.id).map(i => { if (!i.at) return i; const pl = relPlace(host.at, host.yaw, i.at, i.yaw); return { ...i, at: pl.at, yaw: pl.yaw }; });
  return { ...scene, insts: [host, ...rest], jumpers: parsed.jumpers || [] };
}
// which preset the instances equal (parts and their mounts, ignoring the host pose), or null
export function presetOf(S, insts) {
  if (!S.isDefaultHost) {   // fan scene: the fan's options and the chain on it, ignoring where the fan stands
    const key = list => list.map(i => S.serializeState([i.part === S.host.id || i.at ? { ...i, at: null, yaw: 0 } : i])).sort().join('~');
    const mine = key(insts), hit = listFor(S).find(p => key(S.fromHash(p.hash).insts) === mine);
    return hit ? hit.id : null;
  }
  const key = list => S.serializeState(list.filter(i => i.part !== S.host.id && sideOf(S, list, i.id) != null)).split('~').sort().join('~');
  const mine = key(insts);
  const hit = PRESETS.find(p => key(S.fromHash(p.hash).insts) === mine);
  return hit ? hit.id : null;
}
// "pos" | "neg" | null: the battery stud an instance is stacked on (follows the `on` chain)
export function sideOf(S, insts, id) {
  for (let i = insts.find(x => x.id === id), n = 0; i && i.on && n < 20; n++) {
    const [hid, cid] = i.on.split('.');
    const h = insts.find(x => x.id === hid); if (!h) return null;
    if (h.part === S.host.id) return cid === 'stud_pos' ? 'pos' : cid === 'stud_neg' ? 'neg' : null;
    i = h;
  }
  return null;
}
// topIn = { instId: top height in inches above the floor } -> { pos, neg } inches above the battery case top (null when nothing is stacked on that side)
export function stackHeights(S, insts, topIn) {
  const out = { pos: null, neg: null };
  for (const i of insts) {
    const s = sideOf(S, insts, i.id), t = topIn[i.id];
    if (!s || t == null) continue;
    const h = Math.round((t - CASE_TOP_IN) * 100) / 100;
    if (out[s] == null || h > out[s]) out[s] = h;
  }
  return out;
}
export function tooltip(id, heights, fmt) {
  const p = byId(id);
  if (PRESETS === POOL_PRESETS) return p ? 'Option ' + p.id + ': ' + p.name : 'Custom pool';
  if (PRESETS !== BATTERY_PRESETS) return p ? 'Option ' + p.id + ': ' + (PRESETS === SOLAR_PRESETS ? p.short : p.name) : PRESETS === SOLAR_PRESETS ? 'Custom solar setup' : 'Custom fume extractor setup';
  const f = v => v == null ? '–' : fmt(v);
  return (p ? 'Option ' + p.id + ': ' + p.name : 'Custom') + ' · + ' + f(heights.pos) + ' · − ' + f(heights.neg);
}
