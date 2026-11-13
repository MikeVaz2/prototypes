// Scene composition for ar-xr.html: scene model (scene.js, pure) -> three.js objects. Stacking rules live in scene.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { kindOf } from './pick.js';
import { createScene, IN, baseOf } from './scene.js';

export async function createComposer(catalogUrl = 'parts/catalog.json', base = '') {
  const catalog = await (await fetch(base + catalogUrl)).json();
  const SC = createScene(catalog), host = SC.host, partOf = SC.partOf;
  const loader = new GLTFLoader(), cache = new Map();
  const load = p => {
    if (!cache.has(p.id)) cache.set(p.id, loader.loadAsync(base + p.glb).then(g => g.scene, e => { cache.delete(p.id); const x = new Error(e && e.message || 'load failed'); x.partName = p.short || p.name || p.id; throw x; }));
    return cache.get(p.id);
  };
  const preload = ids => Promise.allSettled([...new Set(ids)].map(id => { const p = partOf(baseOf(id)); return p ? load(p) : null; }));

  const matrixOf = pl => { const m = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(pl.yaw)); m.setPosition(pl.pos[0], pl.pos[1], pl.pos[2]); return m; };

  function applyLength(obj, len, o) {
    if (!o.nodes || len == null) return;   // parametric only in the GLB build (copper-bar): nothing to stretch at runtime
    obj.updateMatrixWorld(true);
    const d = (len - o.default) * IN, s = len / o.default;
    const match = pat => { const re = new RegExp('^' + pat.replace('*', '[^_]+') + '$'); const r = []; obj.traverse(c => { if (re.test(c.name)) r.push(c); }); return r; };
    for (const c of match(o.nodes[0])) { const x0 = new THREE.Box3().setFromObject(c).min.x; c.scale.x = s; c.position.x += x0 * (1 - s); }
    for (const c of match(o.nodes[1])) c.position.x += d;
  }

  async function build(state) {
    const root = new THREE.Group(), pl = SC.placements(state);
    for (const inst of state) {
      const p = partOf(inst.part), plc = pl.get(inst.id);
      if (!plc) continue;
      const mat = matrixOf(plc);
      const obj = (await load(p)).clone(true);
      const hide = [];
      for (const [k, o] of Object.entries(p.options || {})) {
        if (o.type === 'bool' && !inst.opts[k]) hide.push(...o.nodes);
        else if (o.type === 'choice') for (const [v, e] of Object.entries(o.values)) if (v !== inst.opts[k]) hide.push(...e.nodes);
      }
      for (const n of hide) { const x = obj.getObjectByName(n); if (x) x.removeFromParent(); }
      for (const [k, o] of Object.entries(p.options || {})) if (o.type === 'number') applyLength(obj, inst.opts[k], o);
      obj.traverse(c => { if (c.isMesh) {
        c.castShadow = true; c.receiveShadow = true;
        c.material = Array.isArray(c.material) ? c.material.map(m => m.clone()) : c.material.clone();   // per instance, so tints stay on this part
      } });
      obj.userData = { instanceId: inst.id, partId: p.id, kind: kindOf(p.id, host.id, 'cover' in (p.options || {})), tint: null };
      obj.matrixAutoUpdate = false; obj.matrix.copy(mat); obj.matrixWorldNeedsUpdate = true;
      root.add(obj);
    }
    root.updateMatrixWorld(true);
    return root;
  }

  return { catalog, host, partOf, SC, build, preload, matrixOf, defaultState: SC.defaultState, parseState: SC.parseState, clampNum: SC.clampNum, yawStep: SC.yawStep };
}
