// One scene model for preview and AR. Pure (no DOM, no three.js): tests run in node.
// Scene = { insts, offs, marks, measures }
//   inst    = { id, part, yaw, opts, on, at }
//             on = "hostInstId.connId" of the stud outlet it sits on (stacking), or null;  at = [x,y,z] inches in the model frame (free surface part), or null
//   offs    = { h, x, z, yaw } whole-model placement correction (offsets.js)
//   marks   = [{ p: [x,y,z] metres, src }]   measures = [{ a: [x,y,z], b: [x,y,z] }]   both in the model frame (follow the model between preview and AR)
// Hash: s=<id>:<mount>:<yaw>:<opt>=<v>,...~...   mount = "-" | legacy host mount id | "<hostId>.<conn>" | "@x,y,z"
//       o=h,x,z,yaw   m=x,y,z,S~...   d=ax,ay,az,bx,by,bz~...   (positions in inches, 2 decimals)
// Stacking: items on one outlet are ordered lug, busbar, other, nut (then insertion order); each sits on the previous item's `top` mount.
import { needsOf, consumes, outletsFor, noOutletMessage, mountKind } from './match.js';
import * as OFS from '../offsets.js';

export const IN = 0.0254;
const norm = d => ((d % 360) + 360) % 360;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
export const baseOf = id => String(id).replace(/_\d+$/, '');

export function createScene(catalog) {
  const host = catalog.parts.find(p => p.id === catalog.host);
  const partOf = id => catalog.parts.find(p => p.id === id);
  const snapMount = p => (p.mounts || []).find(m => m.snap_to);
  const snapList = p => { const s = snapMount(p).snap_to; return Array.isArray(s) ? s : [s]; };
  const ringMount = p => { const n = needsOf(p); return n ? n.mount : null; };
  const defaultYaw = p => { const m = ringMount(p); return m ? (m.default_yaw_deg || 0) : 0; };
  const yawStep = id => { const p = partOf(id), m = p && ringMount(p); return (m && m.yaw_step_deg) || 0; };
  const defOpts = p => Object.fromEntries(Object.entries(p.options || {}).map(([k, o]) => [k, o.default]));
  const clampNum = (o, v) => Math.min(o.max, Math.max(o.min, Math.round(v / o.step) * o.step));
  const isFree = p => mountKind(p) === 'surface';

  function defInst(p, id = p.id) {
    const sm = snapMount(p);
    return { id, part: p.id, yaw: defaultYaw(p), opts: defOpts(p), on: sm ? host.id + '.' + snapList(p).slice(-1)[0] : null, at: !sm && isFree(p) && p !== host ? [0, 0, 0] : null };
  }
  const defaultState = () => catalog.parts.filter(p => p.default || p.always_on).map(p => defInst(p));
  const emptyScene = () => ({ insts: defaultState(), offs: { ...OFS.ZERO }, marks: [], measures: [] });
  function nextId(insts, partId) {
    if (!insts.some(i => i.id === partId)) return partId;
    for (let n = 2; ; n++) if (!insts.some(i => i.id === partId + '_' + n)) return partId + '_' + n;
  }
  const hostInst = insts => insts.find(i => i.part === host.id);
  const connOf = (insts, key) => {
    const [hid, cid] = String(key).split('.'), h = insts.find(i => i.id === hid), hp = h && partOf(h.part);
    return hp ? { h, hp, conn: (hp.connections || []).find(c => c.id === cid) } : null;
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
      const [id, mount, yaw, o] = t.split(':'), p = id && partOf(baseOf(id));
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
    return out.some(i => i.part === host.id) ? out : null;
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
    const parts = ['s=' + serializeState(sc.insts)];
    const o = OFS.ser(sc.offs || OFS.ZERO), m = serializeMarks(sc.marks), d = serializeMeasures(sc.measures);
    if (o) parts.push('o=' + o); if (m) parts.push('m=' + m); if (d) parts.push('d=' + d);
    return parts.join('&');
  }
  function fromHash(hash) {
    const h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    const insts = parseState(h.get('s'));
    return { insts: insts || defaultState(), offs: OFS.parse(h.get('o')), marks: parseMarks(h.get('m')), measures: parseMeasures(h.get('d')), valid: !!insts };
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
  function placements(insts) {
    const out = new Map(), busy = new Set();
    const stackOf = key => insts.map((i, n) => ({ i, n })).filter(x => x.i.on === key)
      .sort((a, b) => rank(partOf(a.i.part)) - rank(partOf(b.i.part)) || a.n - b.n).map(x => x.i);
    const go = inst => {
      if (out.has(inst.id)) return out.get(inst.id);
      if (busy.has(inst.id)) return null;
      busy.add(inst.id);
      let r = null;
      const p = partOf(inst.part);
      if (!p) r = null;
      else if (p === host) r = { pos: [0, 0, 0], yaw: 0 };
      else if (inst.at) r = { pos: inst.at.map(v => v * IN), yaw: inst.yaw };
      else if (inst.on) {
        const c = connOf(insts, inst.on), st = stackOf(inst.on), k = st.indexOf(inst), prev = k > 0 ? st[k - 1] : null;
        if (c && c.conn) {
          if (prev) {
            const pp = go(prev);
            if (pp) r = { pos: add3(pp.pos, rotY(topLocal(partOf(prev.part), prev).map(v => v * IN), pp.yaw)), yaw: inst.yaw };
          } else {
            const hp = go(c.h);
            if (hp) r = { pos: add3(hp.pos, rotY(c.conn.pos.map(v => v * IN), hp.yaw)), yaw: inst.yaw };
          }
        }
      }
      busy.delete(inst.id);
      out.set(inst.id, r);
      return r;
    };
    insts.forEach(go);
    return out;
  }
  // where a new instance would sit on an outlet right now (model frame, metres), or null
  function seatOf(insts, partId, key) {
    const p = partOf(partId); if (!p) return null;
    const cand = { ...defInst(p, '__new'), on: key, at: null };
    return (placements([...insts, cand]).get('__new') || {}).pos || null;
  }

  // ---- add / remove ----
  const outlets = (partId, opts, insts) => outletsFor(partOf(partId), opts || defOpts(partOf(partId)), insts, partOf);
  function addOnOutlet(insts, partId, key) {
    const p = partOf(partId); if (!p) return { ok: false, why: 'unknown part' };
    const o = outlets(partId, defOpts(p), insts).find(x => x.key === key);
    if (!o) return { ok: false, why: 'not a compatible outlet' };
    if (!o.ok) return { ok: false, why: o.why };
    const inst = { ...defInst(p, nextId(insts, partId)), on: key, at: null };
    return { ok: true, inst, insts: [...insts, inst] };
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
    if (!inst || inst.part === host.id) return { ok: false, why: 'cannot remove the battery', insts, removed: [] };
    const removed = removalSet(insts, id);
    return { ok: true, insts: insts.filter(i => !removed.includes(i.id)), removed };
  }

  return { catalog, host, partOf, defInst, defaultState, emptyScene, nextId, yawStep, defaultYaw, defOpts, clampNum, isFree, snapMount, hostInst, connOf,
    parseState, serializeState, parseMarks, serializeMarks, parseMeasures, serializeMeasures, toHash, fromHash,
    placements, seatOf, outlets, addOnOutlet, addAt, removeInst, removalSet, noOutletMessage };
}
