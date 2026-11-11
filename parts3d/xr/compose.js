// Scene composition for ar-xr.html. Ported from viewer.html (placements / applyLength / buildGroup / hash parse), same rules.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const IN = 0.0254;
const norm = d => ((d % 360) + 360) % 360;

export async function createComposer(catalogUrl = 'parts/catalog.json', base = '') {
  const catalog = await (await fetch(base + catalogUrl)).json();
  const host = catalog.parts.find(p => p.id === catalog.host);
  const loader = new GLTFLoader(), cache = new Map();
  const load = p => cache.has(p.id) ? cache.get(p.id) : cache.set(p.id, loader.loadAsync(base + p.glb).then(g => g.scene)).get(p.id);
  const partOf = id => catalog.parts.find(p => p.id === id);
  const snapMount = p => (p.mounts || []).find(m => m.snap_to);
  const snapList = p => { const s = snapMount(p).snap_to; return Array.isArray(s) ? s : [s]; };
  const defOpts = p => Object.fromEntries(Object.entries(p.options || {}).map(([k, o]) => [k, o.default]));
  const defInst = p => { const m = snapMount(p);
    return { part: p.id, mount: m ? snapList(p).slice(-1)[0] : '-', yaw: m ? (m.default_yaw_deg || 0) : 0, opts: defOpts(p) }; };
  const clampNum = (o, v) => Math.min(o.max, Math.max(o.min, Math.round(v / o.step) * o.step));
  const topPos = (p, inst) => {
    const m = p.mounts.find(x => x.id === 'top');
    for (const [k, tbl] of Object.entries(m.by_option || {})) { const v = inst.opts[k]; if (tbl[v]) return tbl[v]; }
    return m.pos;
  };
  const defaultState = () => catalog.parts.filter(p => p.default || p.always_on).map(defInst);

  // same hash format as viewer.html: s=part:mount:yaw:opt=v,...~...   (invalid -> null)
  function parseState(str) {
    const out = [];
    for (const t of (str || '').split('~')) {
      const [id, mount, yaw, o] = t.split(':'), p = partOf(id);
      if (!p || out.some(x => x.part === id)) continue;
      const d = defInst(p), sm = snapMount(p);
      if (sm && mount !== d.mount) { if (!host.mounts.some(h => h.id === mount)) continue; d.mount = mount; }
      const y = Number(yaw), step = sm && sm.yaw_step_deg;
      if (step && yaw !== '' && Number.isFinite(y)) d.yaw = norm(Math.round(y / step) * step);
      for (const kv of (o || '').split(',')) {
        const [k, v] = kv.split('='), spec = (p.options || {})[k];
        if (spec && spec.type === 'bool' && (v === '0' || v === '1')) d.opts[k] = v === '1';
        else if (spec && spec.type === 'choice' && spec.values[v]) d.opts[k] = v;
        else if (spec && spec.type === 'number' && v !== '' && Number.isFinite(Number(v))) d.opts[k] = clampNum(spec, Number(v));
      }
      out.push(d);
    }
    return out.some(i => i.part === host.id) ? out : null;
  }

  function placements(state) {
    const out = new Map();
    const go = inst => {
      if (out.has(inst.part)) return out.get(inst.part);
      const p = partOf(inst.part);
      let mat = new THREE.Matrix4();
      if (p !== host) {
        let pos = null;
        for (const e of snapList(p).slice(0, -1)) {
          const other = state.find(i => i.part === e.split('.')[0]);
          if (other && snapMount(partOf(other.part)) && other.mount === inst.mount) {
            const t = topPos(partOf(other.part), other);
            pos = new THREE.Vector3(t[0] * IN, t[1] * IN, t[2] * IN).applyMatrix4(go(other));
            break;
          }
        }
        if (!pos) {
          const hm = host.mounts.find(h => h.id === inst.mount);
          if (!hm) { out.set(inst.part, null); return null; }
          pos = new THREE.Vector3(hm.pos[0] * IN, hm.pos[1] * IN, hm.pos[2] * IN);
        }
        mat = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(inst.yaw));
        mat.setPosition(pos);
      }
      out.set(inst.part, mat);
      return mat;
    };
    state.forEach(go);
    return out;
  }

  function applyLength(obj, len, o) {
    obj.updateMatrixWorld(true);
    const d = (len - o.default) * IN, s = len / o.default;
    const match = pat => { const re = new RegExp('^' + pat.replace('*', '[^_]+') + '$'); const r = []; obj.traverse(c => { if (re.test(c.name)) r.push(c); }); return r; };
    for (const c of match(o.nodes[0])) { const x0 = new THREE.Box3().setFromObject(c).min.x; c.scale.x = s; c.position.x += x0 * (1 - s); }
    for (const c of match(o.nodes[1])) c.position.x += d;
  }

  async function build(state) {
    const root = new THREE.Group(), pl = placements(state);
    for (const inst of state) {
      const p = partOf(inst.part), mat = pl.get(inst.part);
      if (!mat) continue;
      const obj = (await load(p)).clone(true);
      const hide = [];
      for (const [k, o] of Object.entries(p.options || {})) {
        if (o.type === 'bool' && !inst.opts[k]) hide.push(...o.nodes);
        else if (o.type === 'choice') for (const [v, e] of Object.entries(o.values)) if (v !== inst.opts[k]) hide.push(...e.nodes);
      }
      for (const n of hide) { const x = obj.getObjectByName(n); if (x) x.removeFromParent(); }
      for (const [k, o] of Object.entries(p.options || {})) if (o.type === 'number') applyLength(obj, inst.opts[k], o);
      obj.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      obj.matrixAutoUpdate = false; obj.matrix.copy(mat); obj.matrixWorldNeedsUpdate = true;
      root.add(obj);
    }
    root.updateMatrixWorld(true);
    return root;
  }

  return { catalog, host, partOf, defaultState, parseState, build, clampNum, snapMount };
}
