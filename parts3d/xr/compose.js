// Scene composition for ar-xr.html: scene model (scene.js, pure) -> three.js objects. Stacking rules live in scene.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { kindOf } from './pick.js';
import { createScene, IN, baseOf } from './scene.js';
import { withVersion } from './version.js';
import { ductMesh, BENDS, stretchOps } from './flex.js';

export async function createComposer(catalogUrl = 'parts/catalog.json', base = '', hostSel = '') {
  const catalog = await (await fetch(withVersion(base + catalogUrl))).json();
  for (const p of catalog.parts || []) if (p.thumb) p.thumb = withVersion(p.thumb);   // thumbnails too: one stale cached image per part otherwise
  const SC = createScene(catalog, hostSel), host = SC.host, partOf = SC.partOf;
  const loader = new GLTFLoader(), cache = new Map();
  const load = p => {
    if (!cache.has(p.id)) cache.set(p.id, loader.loadAsync(withVersion(base + p.glb)).then(g => g.scene, e => { cache.delete(p.id); const x = new Error(e && e.message || 'load failed'); x.partName = p.short || p.name || p.id; throw x; }));
    return cache.get(p.id);
  };
  const preload = ids => Promise.allSettled([...new Set(ids)].map(id => { const p = partOf(baseOf(id)); return p ? load(p) : null; }));

  // T(pos) Ry(yaw) [T(0,lift,0) Rz(rz)]: the bracket is the tilt of a part with a pose option (fan orientation); its children hang below this node
  const matrixOf = pl => {
    const m = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(pl.yaw));
    if (pl.pitch) m.multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(pl.pitch)));
    if (pl.roll) m.multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(pl.roll)));
    if (pl.tilt) m.multiply(new THREE.Matrix4().makeTranslation(pl.tilt.dx || 0, pl.tilt.lift, 0)).multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(pl.tilt.rz)));
    m.premultiply(new THREE.Matrix4().makeTranslation(pl.pos[0], pl.pos[1], pl.pos[2]));
    return m;
  };
  // flex duct: built at runtime (ribs and bend do not stretch): black bellows outside, silver foil on the inside faces
  function flexMeshes(inst, p) {
    const dMm = +String(inst.opts.dia || 'd100').slice(1), m = ductMesh(dMm, inst.opts.length, BENDS[inst.opts.bend] || 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3)); g.setIndex(new THREE.BufferAttribute(m.idx, 1)); g.computeVertexNormals();
    const out = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x28282c, metalness: 0, roughness: 0.75, side: THREE.FrontSide })); out.name = 'duct_outer';
    const inn = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd2d6db, metalness: 1, roughness: 0.3, side: THREE.BackSide })); inn.name = 'duct_inner';
    return [out, inn];
  }

  // stretch spec (rack bars, panel size): { axis, scale: [[nodePrefix, baseMetres]], moves: [[nodePrefix, coef, refValue?]] }. Nodes are scaled about their own origin
  // (the geometry is centred there) by (base + d) / base, or moved by d * coef, with d = (value - default) * unit_m (moves may use their own reference value).
  // Pure arithmetic in stretchOps (xr/flex.js), so tests can check it.
  function applyStretch(obj, len, o) {
    const ax = o.stretch.axis || o.axis || 'x', ops = stretchOps(o, len), all = [];
    obj.traverse(c => { if (c.name) all.push(c); });
    for (const op of ops) for (const c of all) if (c.name.startsWith(op.prefix)) { if (op.scale !== undefined) c.scale[ax] = op.scale; else c.position[ax] += op.move; }
  }
  function applyLength(obj, len, o) {
    if (o.stretch && len != null) return applyStretch(obj, len, o);
    if (!o.nodes || len == null) return;   // parametric only in the GLB build (copper-bar): nothing to stretch at runtime
    obj.updateMatrixWorld(true);
    const ax = o.axis === 'y' ? 'y' : 'x';   // stretch axis (default X; the fan adapter spigot stretches along Y); o.unit_m = metres per unit (default inch)
    const d = (len - o.default) * (o.unit_m || IN), s = len / o.default;
    const match = pat => { const re = new RegExp('^' + pat.replace('*', '[^_]+') + '$'); const r = []; obj.traverse(c => { if (re.test(c.name)) r.push(c); }); return r; };
    for (const c of match(o.nodes[0])) { const x0 = new THREE.Box3().setFromObject(c).min[ax]; c.scale[ax] = s; c.position[ax] += x0 * (1 - s); }
    for (const c of match(o.nodes[1])) c.position[ax] += d;
  }

  // Flexible ETFE panel surface (2026-11-18): a small procedural pebble normal map (128 px, made once on a canvas) on the panel body, border and cells; low specular, no glassy look.
  // The GLB meshes have no UVs, so planar ones are made from the vertex positions (one tile = 40 mm). Skipped without a DOM (tests).
  let etfeTex = null;
  function etfeNormal() {
    if (etfeTex !== null) return etfeTex || null;
    try {
      const N = 128, cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d'), img = g.createImageData(N, N), T = Math.PI * 2;
      const rnd = (x, y) => { const v = Math.sin((x * 127.1 + y * 311.7) * 12.9898) * 43758.5453; return v - Math.floor(v); };
      const h = (x, y) => { x = (x + N) % N; y = (y + N) % N; return 0.5 * Math.cos(T * 8 * x / N) * Math.cos(T * 8 * y / N) + 0.3 * Math.cos(T * (13 * x + 9 * y) / N) + 0.25 * Math.cos(T * (5 * x - 17 * y) / N) + 0.12 * rnd(x, y); };
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1), k = 1 / Math.hypot(dx, dy, 1.6), i = (y * N + x) * 4;
        img.data[i] = 128 + 127 * dx * k; img.data[i + 1] = 128 + 127 * dy * k; img.data[i + 2] = 128 + 127 * 1.6 * k; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0); etfeTex = new THREE.CanvasTexture(cv); etfeTex.wrapS = etfeTex.wrapT = THREE.RepeatWrapping; etfeTex.anisotropy = 4;
    } catch (e) { etfeTex = false; }
    return etfeTex || null;
  }
  function etfeSurface(obj) {
    const tex = etfeNormal(); if (!tex) return;
    obj.traverse(c => {
      if (!c.isMesh || !/^(pn_(az|bx|back|cells)|pc_)/.test(c.name)) return;
      const g = c.geometry, pos = g.getAttribute('position');
      if (!g.getAttribute('uv') && pos) { const uv = new Float32Array(pos.count * 2); for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) * 25; uv[i * 2 + 1] = pos.getZ(i) * 25; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
      const ms = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of ms) { m.normalMap = tex; if (m.normalScale) m.normalScale.set(0.45, 0.45); m.roughness = Math.max(m.roughness || 0, 0.62); m.metalness = Math.min(m.metalness || 0, 0.15); m.needsUpdate = true; }
    });
  }
  // Real tree: root (the surface frame) -> node per instance (local pose relative to its parent) -> body (the part's meshes) + the nodes stacked on it.
  // Turning or moving a node carries everything below it. Bodies carry the instance data (pick, tint); nodes only carry the pose.
  async function build(state) {
    const root = new THREE.Group(), loc = SC.locals(state), nodes = new Map(), bodies = [];
    for (const inst of state) {
      const p = partOf(inst.part), l = loc.get(inst.id);
      if (!l) continue;
      const obj = (await load(p)).clone(true);
      const hide = [];
      for (const [k, o] of Object.entries(p.options || {})) {
        if (o.type === 'bool' && !inst.opts[k]) hide.push(...o.nodes);
        else if (o.type === 'choice') for (const [v, e] of Object.entries(o.values)) if (v !== inst.opts[k]) hide.push(...e.nodes);
      }
      for (const n of hide) { const x = obj.getObjectByName(n); if (x) x.removeFromParent(); }
      if (p.kind === 'flexduct') { obj.clear(); obj.add(...flexMeshes(inst, p)); }
      for (const [k, o] of Object.entries(p.options || {})) if (o.type === 'number') applyLength(obj, inst.opts[k], o);
      obj.traverse(c => { if (c.isMesh) {
        c.castShadow = true; c.receiveShadow = true;
        c.material = Array.isArray(c.material) ? c.material.map(m => m.clone()) : c.material.clone();   // per instance, so tints stay on this part
      } });
      if (p.kind === 'solarpanel') etfeSurface(obj);
      obj.userData = { instanceId: inst.id, partId: p.id, kind: kindOf(p.id, host.id, 'cover' in (p.options || {})), tint: null };
      const node = new THREE.Group(); node.name = 'node:' + inst.id; node.userData.nodeId = inst.id;
      node.matrixAutoUpdate = false; node.add(obj); nodes.set(inst.id, node); bodies.push(obj);
    }
    for (const [id, node] of nodes) { const l = loc.get(id), par = l.parent != null && nodes.get(l.parent); (par || root).add(node); }
    root.userData.nodes = nodes; root.userData.bodies = bodies;
    applyLocals(root, state);
    return root;
  }
  // refresh every node's local matrix from the scene state (drag, move, turn): children follow through the tree
  function applyLocals(root, state) {
    const loc = SC.locals(state), nodes = root.userData.nodes;
    for (const [id, node] of nodes) { const l = loc.get(id); if (l) { node.matrix.copy(matrixOf(l)); node.matrixWorldNeedsUpdate = true; } }
    root.updateMatrixWorld(true);
  }

  // bounding size of a part's model at its default options, metres [x, y, z] (parts dialog preview)
  async function sizeOf(id) { const p = partOf(baseOf(id)); if (!p) return null; const b = new THREE.Box3().setFromObject(await load(p)), v = b.getSize(new THREE.Vector3()); return [v.x, v.y, v.z]; }
  return { catalog, host, partOf, SC, build, sizeOf, applyLocals, preload, matrixOf, defaultState: SC.defaultState, parseState: SC.parseState, clampNum: SC.clampNum, yawStep: SC.yawStep };
}
