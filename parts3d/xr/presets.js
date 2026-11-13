// Terminal option presets on the Odyssey battery. Pure: no DOM, no three.js. Each preset is a scene hash fragment (s=... and j=...) for the parts on the battery.
// Switching keeps the host instance (its pose: at, yaw, opts) and the scene's offsets, marks and measurements; it swaps every other part and the jumpers.
// All dimensions behind these parts are estimates, see README.
export const CASE_TOP_IN = 8.6;   // battery case top above the floor, inches (heights are quoted above it)
const B = 'odyssey-odp-agm31', H = 's=' + B + ':-:0:';
const side = (pol, mid) => mid;
export const PRESETS = [
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
// which preset the instances equal (parts and their mounts, ignoring the host pose), or null
export function presetOf(S, insts) {
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
  const p = byId(id), f = v => v == null ? '–' : fmt(v);
  return (p ? 'Option ' + p.id + ': ' + p.name : 'Custom') + ' · + ' + f(heights.pos) + ' · − ' + f(heights.neg);
}
