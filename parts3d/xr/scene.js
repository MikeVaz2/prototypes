// One scene model for preview and AR. Pure (no DOM, no three.js): tests run in node.
// Scene = { insts, offs, marks, measures }
//   inst    = { id, part, yaw, opts, on, at }
//             Tree: surface (anchor / floor, the model frame) -> surface parts (battery, PowerBar) -> stacked parts (terminals, lugs, nuts ...).
//             on = "hostInstId.connId" of the stud outlet it sits on (stacking), or null;  at = [x,y,z] inches in the SURFACE frame (surface part), or null
//             yaw is always relative to the parent (the surface for a surface part, the part below for a stacked part), so turning or moving a parent carries its children.
//   offs    = { h, x, z, yaw } whole-model placement correction (offsets.js)
//   marks   = [{ p: [x,y,z] metres, src }]   measures = [{ a: [x,y,z], b: [x,y,z] }]   both in the model frame (follow the model between preview and AR)
// Hash v=2 (relative yaws). A hash without v=2 is the old absolute format and is migrated on load (fromHash).
// Hash: s=<id>:<mount>:<yaw>:<opt>=<v>,...~...   mount = "-" | legacy host mount id | "<hostId>.<conn>" | "@x,y,z"
//       o=h,x,z,yaw   m=x,y,z,S~...   d=ax,ay,az,bx,by,bz~...   (positions in inches, 2 decimals)
// Stacking: items on one outlet are ordered lug, busbar, other, nut (then insertion order); each sits on the previous item's `top` mount.
import { needsOf, consumes, outletsFor, outletsAny, resolveConn, noOutletMessage, mountKind, connPos } from './match.js';
import * as OFS from '../offsets.js';
import * as JMP from './jumper.js';

export const IN = 0.0254;
const norm = d => ((d % 360) + 360) % 360;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
export const baseOf = id => String(id).replace(/_\d+$/, '');

// Start scene: which surface part is the host (the model's root). Default = catalog.host (the battery).
// sel = part id or alias (#host=fan-80mm, ?scene=fume). Unknown / not a surface part -> the default host.
export const HOST_ALIASES = { battery: null, fume: 'fan-80mm', fan: 'fan-80mm', solar: 'roof-rack', roof: 'roof-rack' };
export function resolveHostId(catalog, sel) {
  const s = String(sel == null ? '' : sel).trim().toLowerCase();
  if (!s) return catalog.host;
  const id = s in HOST_ALIASES ? (HOST_ALIASES[s] || catalog.host) : s;
  const p = catalog.parts.find(x => x.id === id);
  return p && (p.id === catalog.host || mountKind(p) === 'surface') ? p.id : catalog.host;
}
// host selection from a page location: hash host=, else ?host= / ?scene=
export function hostSelFrom(search, hash) {
  const h = new URLSearchParams(String(hash || '').replace(/^#/, '')), s = new URLSearchParams(search || '');
  return h.get('host') || s.get('host') || s.get('scene') || '';
}

// How a part's node is turned and lifted by its options (fan orientation, grill): choice values may carry `pose` {rot_z_deg, lift_mm, when: {opt: value}} (one or a list).
// -> { rz: degrees about the part's own Z, lift: metres } | null. Node matrix = T(pos) Ry(yaw) T(0,lift,0) Rz(rz); everything stacked on the part is a child of that node.
export function poseOf(p, opts = {}) {
  let rz = 0, lift = 0, dx = 0, px = 0, pz = 0;
  for (const [k, o] of Object.entries(p.options || {})) {
    if (o.type === 'number' && o.slide && o.slide.frame === 'parent' && typeof opts[k] === 'number') { if (o.slide.axis === 'z') pz += opts[k] * (o.slide.unit_m || 0.001); else px += opts[k] * (o.slide.unit_m || 0.001); continue; }   // Move: offset in the parent's (rack's) frame
    if (o.type === 'number' && o.slide && typeof opts[k] === 'number') { dx += opts[k] * (o.slide.unit_m || 0.01); continue; }   // Slide: moves the part along its own X
    const e = o.type === 'choice' && o.values[opts[k]];
    if (!e || !e.pose) continue;
    for (const q of [].concat(e.pose)) {
      if (q.when && !Object.entries(q.when).every(([a, b]) => opts[a] === b)) continue;
      rz += q.rot_z_deg || 0; lift += (q.lift_mm || 0) / 1000;
    }
  }
  if (!(rz || lift || dx || px || pz)) return null;
  return px || pz ? { rz, lift, dx, px, pz } : { rz, lift, dx };   // px, pz: offset in the parent's frame (set by Move)
}
// 3x3 rotations, row-major, same convention as three.js (makeRotationY / makeRotationZ)
const RY = d => { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const RZ = d => { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const mul3 = (a, b) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j]); return o; };
const mv3 = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// Old part ids from before the Y-branch and fuse became one part each (2026-11-18): old scene hashes still load (the instance keeps its old id, so cables and mounts that name it still resolve).
export const PART_ALIAS = {
  'mc4-y-pos': { part: 'mc4-y', opts: { split: '2', pol: 'pos' } }, 'mc4-y-neg': { part: 'mc4-y', opts: { split: '2', pol: 'neg' } },
  'mc4-y4-pos': { part: 'mc4-y', opts: { split: '4', pol: 'pos' } }, 'mc4-y4-neg': { part: 'mc4-y', opts: { split: '4', pol: 'neg' } },
  'mc4-fuse-pos': { part: 'mc4-fuse', opts: { pol: 'pos' } }, 'mc4-fuse-neg': { part: 'mc4-fuse', opts: { pol: 'neg' } },
};
export function createScene(catalog, hostSel) {
  const hostId = resolveHostId(catalog, hostSel), host = catalog.parts.find(p => p.id === hostId), isDefaultHost = hostId === catalog.host;
  const partOf = id => catalog.parts.find(p => p.id === id);
  const snapMount = p => (p.mounts || []).find(m => m.snap_to);
  const snapList = p => { const s = snapMount(p).snap_to; return Array.isArray(s) ? s : [s]; };
  const ringMount = p => { const n = needsOf(p); return n ? n.mount : null; };
  const defaultYaw = p => { const m = ringMount(p); return m ? (m.default_yaw_deg || 0) : 0; };
  const yawStep = id => { const p = partOf(id), m = p && ringMount(p); return (m && m.yaw_step_deg) || 0; };
  const defOpts = p => Object.fromEntries(Object.entries(p.options || {}).map(([k, o]) => [k, o.default]));
  const clampNum = (o, v) => Math.min(o.max, Math.max(o.min, Math.round(Math.round(v / o.step) * o.step * 1e6) / 1e6));
  const isFree = p => mountKind(p) === 'surface';

  function defInst(p, id = p.id) {
    const sm = snapMount(p);
    return { id, part: p.id, yaw: defaultYaw(p), opts: defOpts(p), on: sm ? host.id + '.' + snapList(p).slice(-1)[0] : null, at: !sm && isFree(p) && p !== host ? [0, 0, 0] : null };
  }
  const defaultState = () => isDefaultHost ? catalog.parts.filter(p => p.default || p.always_on).map(p => defInst(p)) : [defInst(host)];   // another host starts alone
  const emptyScene = () => ({ insts: defaultState(), offs: { ...OFS.ZERO }, marks: [], measures: [], jumpers: [] });
  function nextId(insts, partId) {
    if (!insts.some(i => i.id === partId)) return partId;
    for (let n = 2; ; n++) if (!insts.some(i => i.id === partId + '_' + n)) return partId + '_' + n;
  }
  const hostInst = insts => insts.find(i => i.part === host.id);
  const connOf = (insts, key) => {
    const [hid, cid] = String(key).split('.'), h = insts.find(i => i.id === hid), hp = h && partOf(h.part);
    return hp ? { h, hp, conn: resolveConn((hp.connections || []).find(c => c.id === cid), h.opts) } : null;
  };

  // ---- hash ----
  const optStr = (p, inst) => Object.keys(p.options || {}).map(k => {
    const o = p.options[k], v = inst.opts[k];
    return k + '=' + (o.type === 'bool' ? (v ? 1 : 0) : v);
  }).join(',');
  function serializeState(insts) {
    return insts.map(inst => {
      const p = partOf(inst.part); if (!p) return null;
      let mount = '-';
      if (inst.at) mount = '@' + inst.at.map(r2).join(',');
      else if (inst.on) { const [hid, cid] = inst.on.split('.'); mount = hid === host.id && snapMount(p) ? cid : inst.on; }
      return [inst.id, mount, r1(inst.yaw), optStr(p, inst)].join(':');
    }).filter(Boolean).join('~');
  }
  function parseOpts(p, d, o) {
    for (const kv of (o || '').split(',')) {
      const [k, v] = kv.split('='), spec = (p.options || {})[k];
      if (spec && spec.type === 'bool' && (v === '0' || v === '1')) d.opts[k] = v === '1';
      else if (spec && spec.type === 'choice' && spec.values[v]) d.opts[k] = v;
      else if (spec && spec.type === 'number' && v !== '' && Number.isFinite(Number(v))) d.opts[k] = clampNum(spec, Number(v));
    }
  }
  // invalid -> null (caller falls back to the default scene)
  function parseState(str) {
    let out = [];
    for (const t of (str || '').split('~')) {
      const [id, mount, yaw, o] = t.split(':'), al = id && PART_ALIAS[baseOf(id)], p = id && partOf(al ? al.part : baseOf(id));
      if (!p || out.some(x => x.id === id)) continue;
      const d = defInst(p, id), sm = snapMount(p);
      d.on = null; d.at = null;
      if (mount && mount.startsWith('@')) {
        const v = mount.slice(1).split(',').map(Number);
        if (v.length !== 3 || v.some(n => !Number.isFinite(n))) continue;
        d.at = v;
      } else if (mount && mount.includes('.')) d.on = mount;
      else if (sm && mount && mount !== '-') d.on = host.id + '.' + mount;
      else if (sm) d.on = host.id + '.' + snapList(p).slice(-1)[0];
      else if (p !== host && isFree(p)) d.at = [0, 0, 0];
      else if (p !== host) continue;   // stud part without an outlet
      const y = Number(yaw);
      if (yaw !== '' && yaw !== undefined && Number.isFinite(y)) { const step = yawStep(p.id) || 0.1; d.yaw = r1(norm(Math.round(y / step) * step)); }
      if (al) d.opts = { ...d.opts, ...al.opts };
      parseOpts(p, d, o);
      out.push(d);
    }
    // drop instances whose outlet is missing (and what sits on them)
    for (let again = true; again;) {
      again = false;
      out = out.filter(i => {
        if (!i.on) return true;
        const c = connOf(out, i.on);
        const ok = !!(c && c.conn && c.conn.accepts);
        if (!ok) again = true;
        return ok;
      });
    }
    return out.some(i => i.part === host.id) ? syncOpts(out) : null;
  }
  const f2 = v => String(r2(v));
  function serializeMarks(marks) { return (marks || []).map(m => m.p.map(v => f2(v / IN)).concat(m.src || 'M').join(',')).join('~'); }
  function parseMarks(str) {
    const out = [];
    for (const t of (str || '').split('~')) {
      const a = t.split(','), v = a.slice(0, 3).map(Number);
      if (a.length >= 3 && v.every(Number.isFinite)) out.push({ p: v.map(n => n * IN), src: /^[MPLDG]$/.test(a[3]) ? a[3] : 'M' });
    }
    return out.slice(0, 8);
  }
  function serializeMeasures(ms) { return (ms || []).map(m => [...m.a, ...m.b].map(v => f2(v / IN)).join(',')).join('~'); }
  function parseMeasures(str) {
    const out = [];
    for (const t of (str || '').split('~')) {
      const v = t.split(',').map(Number);
      if (v.length === 6 && v.every(Number.isFinite)) out.push({ a: v.slice(0, 3).map(n => n * IN), b: v.slice(3).map(n => n * IN) });
    }
    return out.slice(0, 8);
  }
  // scene -> "s=...&o=...&m=...&d=..." (no leading #)
  function toHash(sc) {
    const parts = ['s=' + serializeState(sc.insts), 'v=2'];
    if (!isDefaultHost) parts.push('host=' + host.id);
    const o = OFS.ser(sc.offs || OFS.ZERO), m = serializeMarks(sc.marks), d = serializeMeasures(sc.measures);
    if (o) parts.push('o=' + o); if (m) parts.push('m=' + m); if (d) parts.push('d=' + d);
    const j = JMP.serialize(sc.jumpers); if (j) parts.push('j=' + j);
    return parts.join('&');
  }
  function fromHash(hash) {
    const h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    let insts = parseState(h.get('s'));
    if (insts && h.get('v') !== '2') insts = migrateYaws(insts);   // old format: absolute yaws
    const all = insts || defaultState();
    const jumpers = JMP.parse(h.get('j')).filter(j => [j.a, j.b].every(k => { const c = connOf(all, k); return c && c.conn && c.conn.accepts; }));
    return { insts: all, offs: OFS.parse(h.get('o')), marks: parseMarks(h.get('m')), measures: parseMeasures(h.get('d')), jumpers, valid: !!insts };
  }

  // ---- placement: { pos: [m], yaw: deg } per instance id (null when its outlet is missing) ----
  const rank = p => p.kind === 'lug' ? 0 : p.kind === 'busbar' ? 1 : p.kind === 'nut' ? 3 : 2;
  const rotY = (v, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };   // three.js rotation.y
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const topLocal = (p, inst) => {
    const m = (p.mounts || []).find(x => x.id === 'top');
    if (!m) return [0, consumes(p, inst.opts), 0];
    for (const [k, tbl] of Object.entries(m.by_option || {})) { const v = inst.opts[k]; if (tbl[v]) return tbl[v]; }
    return m.pos;
  };
  // Parent of a stacked instance: the previous item on the same outlet (stack order), else the part owning the outlet.
  // -> { parent: inst, pos: [m] in the parent's frame } or null (outlet missing)
  const stackOf = (insts, key) => insts.map((i, n) => ({ i, n })).filter(x => x.i.on === key)
    .sort((a, b) => rank(partOf(a.i.part)) - rank(partOf(b.i.part)) || a.n - b.n).map(x => x.i);
  function parentOf(insts, inst) {
    if (!inst.on || inst.at || partOf(inst.part) === host) return null;
    const c = connOf(insts, inst.on); if (!(c && c.conn)) return null;
    const st = stackOf(insts, inst.on), k = st.indexOf(inst), prev = k > 0 ? st[k - 1] : null;
    return prev ? { parent: prev, pos: topLocal(partOf(prev.part), prev).map(v => v * IN) } : { parent: c.h, pos: connPos(c.conn, c.h.opts).map(v => v * IN) };
  }
  // local pose per instance id: { parent: id | null (the surface), pos: [m] in the parent frame, yaw: deg relative to the parent }; null when unplaceable
  function locals(insts) {
    const out = new Map(), busy = new Set();
    const go = inst => {
      if (out.has(inst.id)) return out.get(inst.id);
      if (busy.has(inst.id)) return null;
      busy.add(inst.id);
      let r = null;
      const p = partOf(inst.part);
      if (!p) r = null;
      else if (p === host || inst.at) r = { parent: null, pos: (inst.at || [0, 0, 0]).map(v => v * IN), yaw: inst.yaw || 0, tilt: poseOf(p, inst.opts) };
      else if (inst.on) {
        const pr = parentOf(insts, inst);
        if (pr && go(pr.parent)) { const t = poseOf(p, inst.opts); r = { parent: pr.parent.id, pos: t && (t.px || t.pz) ? add3(pr.pos, [t.px || 0, 0, t.pz || 0]) : pr.pos, yaw: inst.yaw || 0, tilt: t }; }
      }
      busy.delete(inst.id);
      out.set(inst.id, r);
      return r;
    };
    insts.forEach(go);
    return out;
  }
  // world (surface-frame) pose per id, composed down the tree: { pos: [m], yaw: deg (sum of the relative yaws), R: 3x3 world rotation (yaw, tilt and every parent's)
  // so a tilted fan carries its adapter and duct along the outlet axis: R * (0,1,0) is the axis of the outlet }
  function placements(insts) {
    const loc = locals(insts), out = new Map();
    const go = id => {
      if (out.has(id)) return out.get(id);
      const l = loc.get(id); let r = null;
      if (l) {
        const pp = l.parent == null ? { pos: [0, 0, 0], yaw: 0, R: I3 } : go(l.parent);
        if (pp) {
          const t = l.tilt, Rl = t ? mul3(RY(l.yaw), RZ(t.rz)) : RY(l.yaw), tl = t ? add3(l.pos, mv3(RY(l.yaw), [t.dx || 0, t.lift, 0])) : l.pos;
          r = { pos: add3(pp.pos, mv3(pp.R, tl)), yaw: pp.yaw + l.yaw, R: mul3(pp.R, Rl) };
        }
      }
      out.set(id, r); return r;
    };
    insts.forEach(i => go(i.id));
    return out;
  }
  // options that follow the part an instance sits on (conn.pass_options {childOpt: hostOpt}): the clamp and the duct take the adapter's diameter. In place.
  function syncOpts(insts) {
    for (let again = true, n = 0; again && n < 6; n++) {
      again = false;
      for (const i of insts) {
        if (!i.on) continue;
        const c = connOf(insts, i.on), p = partOf(i.part);
        if (!(c && c.conn && c.conn.pass_options)) continue;
        for (const [co, ho] of Object.entries(c.conn.pass_options)) {
          const spec = p.options && p.options[co], v = c.h.opts[ho];
          if (spec && spec.type === 'choice' && spec.values[v] && i.opts[co] !== v) { i.opts[co] = v; again = true; }
        }
      }
    }
    return insts;
  }
  // old absolute-yaw scenes -> relative yaws (v=2): a stacked part's yaw minus its parent's (both were absolute)
  function migrateYaws(insts) {
    return insts.map(i => {
      const pr = parentOf(insts, i);
      return pr ? { ...i, yaw: r1(norm(i.yaw - pr.parent.yaw)) } : i;
    });
  }
  // where a new instance would sit on an outlet right now (model frame, metres), or null
  function seatOf(insts, partId, key) {
    const p = partOf(partId); if (!p) return null;
    const cand = { ...defInst(p, '__new'), on: key, at: null };
    return (placements([...insts, cand]).get('__new') || {}).pos || null;
  }

  // ---- add / remove ----
  const outlets = (partId, opts, insts) => outletsAny(partOf(partId), opts || defOpts(partOf(partId)), insts, partOf);
  function addOnOutlet(insts, partId, key) {
    const p = partOf(partId); if (!p) return { ok: false, why: 'unknown part' };
    const o = outlets(partId, defOpts(p), insts).find(x => x.key === key);
    if (!o) return { ok: false, why: 'not a compatible outlet' };
    if (!o.ok) return { ok: false, why: o.why };
    let inst = { ...defInst(p, nextId(insts, partId)), on: key, at: null };
    if (o.opts) inst.opts = { ...inst.opts, ...o.opts };   // a part with a polarity option takes the one that fits this outlet
    // the part's default yaw is a pose in the surface frame; stored relative to its parent so it looks the same and then follows the parent
    // (a connection with align_parent, like the fan outlet, keeps yaw 0 relative: the part is aligned with its parent whatever the parent's pose)
    const pr = parentOf([...insts, inst], inst), pw = pr && placements([...insts, inst]).get(pr.parent.id);
    const oc = connOf(insts, key);
    if (oc && oc.conn && oc.conn.child_yaw_deg !== undefined) inst = { ...inst, yaw: oc.conn.child_yaw_deg };   // a seat that turns what sits on it (rack slots for a turned panel)
    else if (pw && !(oc && oc.conn && oc.conn.align_parent)) inst = { ...inst, yaw: r1(norm(inst.yaw - pw.yaw)) };
    const all = [...insts, inst]; syncOpts(all);
    return { ok: true, inst, insts: all };
  }
  function addAt(insts, partId, atInches, yaw) {
    const p = partOf(partId); if (!p || p === host) return { ok: false, why: 'unknown part' };
    const inst = { ...defInst(p, nextId(insts, partId)), on: null, at: atInches.map(r2) };
    if (yaw !== undefined) inst.yaw = norm(yaw);
    return { ok: true, inst, insts: [...insts, inst] };
  }
  // ids that go with removing `id`: itself plus everything stacked on its outlets (recursively)
  function removalSet(insts, id) {
    const ids = [id];
    for (let k = 0; k < ids.length; k++) for (const i of insts) if (i.on && i.on.split('.')[0] === ids[k] && !ids.includes(i.id)) ids.push(i.id);
    return ids;
  }
  function removeInst(insts, id) {
    const inst = insts.find(i => i.id === id);
    if (!inst || inst.part === host.id) return { ok: false, why: 'cannot remove the base part', insts, removed: [] };
    const removed = removalSet(insts, id);
    return { ok: true, insts: insts.filter(i => !removed.includes(i.id)), removed };
  }

  return { catalog, host, isDefaultHost, partOf, defInst, defaultState, emptyScene, nextId, yawStep, defaultYaw, defOpts, clampNum, isFree, snapMount, hostInst, connOf,
    parseState, serializeState, parseMarks, serializeMarks, parseMeasures, serializeMeasures, toHash, fromHash,
    placements, locals, parentOf, syncOpts, migrateYaws, seatOf, outlets, addOnOutlet, addAt, removeInst, removalSet, noOutletMessage };
}
