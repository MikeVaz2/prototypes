// ar-mv: viewer.html scene composition + model-viewer 3.5.0 AR patch + compact AR control strip.
// The composition code (state, placements, buildGroup, refresh) is copied from viewer.html (shared files stay read-only).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import * as OFS from '../offsets.js';
import { installARPatch } from './patch.js';

const IN = 0.0254, mv = document.getElementById('mv');
const loader = new GLTFLoader(), cache = new Map();
let catalog, host, state = [], offs = { ...OFS.ZERO }, selId = null, lastUrl = null, busy = false, again = false, defaultKey = '';

const load = p => cache.has(p.id) ? cache.get(p.id)
  : cache.set(p.id, loader.loadAsync(p.glb).then(g => g.scene)).get(p.id);
const partOf = id => catalog.parts.find(p => p.id === id);
const snapMount = p => (p.mounts || []).find(m => m.snap_to);
const snapList = p => { const s = snapMount(p).snap_to; return Array.isArray(s) ? s : [s]; };   // chain entries "part.mount", then the host mount
const chipId = p => p.chip || p.id;
function topPos(p, inst) {   // part-local position (in) of the `top` mount, with by_option overrides
  const m = p.mounts.find(x => x.id === 'top');
  for (const [k, tbl] of Object.entries(m.by_option || {})) { const v = inst.opts[k]; if (tbl[v]) return tbl[v]; }
  return m.pos;
}
const defOpts = p => Object.fromEntries(Object.entries(p.options || {}).map(([k, o]) => [k, o.default]));
const defInst = p => { const m = snapMount(p);
  return { part: p.id, mount: m ? snapList(p).slice(-1)[0] : '-', yaw: m ? (m.default_yaw_deg || 0) : 0, opts: defOpts(p) }; };
const editable = p => !!(snapMount(p) && ((snapMount(p).yaw_step_deg || 0) > 0 || Object.keys(p.options || {}).length));
const clampNum = (o, v) => Math.min(o.max, Math.max(o.min, Math.round(v / o.step) * o.step));
const sign = pol => pol === 'pos' ? '+' : '\u2212';
const norm = d => ((d % 360) + 360) % 360;

// ---- scene state <-> URL hash:  #s=part:mount:yaw:opt=0,opt=1~part:...   (optional &sel=<part id>) ----
const ser = st => st.map(i => [i.part, i.mount, i.yaw,
  Object.entries(i.opts).map(([k, v]) => k + '=' + (v === true ? 1 : v === false ? 0 : v)).join(',')].join(':')).join('~');
function parse(str) {
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
  return out.some(i => i.part === host.id) ? out : null;   // invalid / missing -> defaults
}
const defaultState = () => catalog.parts.filter(p => p.default || p.always_on).map(defInst);
function writeHash() {
  const parts = [];
  if (ser(state) !== defaultKey) parts.push('s=' + ser(state));
  if (OFS.ser(offs)) parts.push('o=' + OFS.ser(offs));   // placement offsets: h,x,z,yaw (in, in, in, deg)
  const h = parts.length ? '#' + parts.join('&') : '';
  history.replaceState(null, '', location.pathname + location.search + h);
}

// Snap rule (same as build_catalog.py resolve): the part origin goes to the first present entry of snap_to
// ("part.mount" = that part's mount on the same stud, else the host mount), rotated about Y by inst.yaw.
function placements() {
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

// Extension cable length: the GLB holds the default length. Scale the cable node along its own axis (X) about its start at the
// lug barrel, and slide the joint node by the difference. Nodes are matched by `nodes` patterns ("cable_*" = cable_<gauge>).
function applyLength(obj, len, o) {
  obj.updateMatrixWorld(true);
  const d = (len - o.default) * IN, s = len / o.default;
  const match = pat => { const re = new RegExp('^' + pat.replace('*', '[^_]+') + '$'); const r = []; obj.traverse(c => { if (re.test(c.name)) r.push(c); }); return r; };
  for (const c of match(o.nodes[0])) {   // cable: scale about its barrel end
    const x0 = new THREE.Box3().setFromObject(c).min.x;
    c.scale.x = s; c.position.x += x0 * (1 - s);
  }
  for (const c of match(o.nodes[1])) c.position.x += d;   // joint: just moves
}

async function buildGroup() {
  const root = new THREE.Group(), used = [], pl = placements();
  for (const inst of state) {
    const p = partOf(inst.part), mat = pl.get(inst.part);
    if (!mat) continue;
    const obj = (await load(p)).clone(true);
    // hide option nodes: bool off, or the nodes of the non-selected choice values
    const hide = [];
    for (const [k, o] of Object.entries(p.options || {})) {
      if (o.type === 'bool' && !inst.opts[k]) hide.push(...o.nodes);
      else if (o.type === 'choice') for (const [v, e] of Object.entries(o.values)) if (v !== inst.opts[k]) hide.push(...e.nodes);
    }
    for (const n of hide) { const x = obj.getObjectByName(n); if (x) x.removeFromParent(); }
    for (const [k, o] of Object.entries(p.options || {})) if (o.type === 'number') applyLength(obj, inst.opts[k], o);
    // per-instance material names (suffix "#<part id>") so a tap maps back to the instance
    obj.traverse(c => { if (c.isMesh) { c.material = c.material.clone(); c.material.name = (c.material.name || 'm') + '#' + inst.part; } });
    obj.matrixAutoUpdate = false; obj.matrix.copy(mat); obj.matrixWorldNeedsUpdate = true;
    root.add(obj); used.push(p);
  }
  root.updateMatrixWorld(true);
  return { root, used };
}

function caption(root, used) {
  const s = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).multiplyScalar(1 / IN);
  const f = v => v.toFixed(1), mm = v => Math.round(v * 25.4);
  document.getElementById('caption').innerHTML =
    '<strong>' + [...new Set(state.flatMap(i => { const p = partOf(i.part), o = p.options || {};
      const off = Object.keys(o).filter(k => o[k].type === 'bool' && !i.opts[k]).map(k => 'no ' + o[k].label.toLowerCase())
        .concat(Object.keys(o).filter(k => o[k].type === 'choice' && i.opts[k] !== o[k].default).map(k => o[k].values[i.opts[k]].label));
      const num = Object.keys(o).filter(k => o[k].type === 'number').map(k => p.short.split(' ')[0] + ' ' + o[k].label.toLowerCase() + ' ' + i.opts[k] + ' ' + o[k].unit);
      return [p.short + (off.length ? ' (' + off.join(', ') + ')' : ''), ...num]; }))].join(', ') + '</strong><br>' +
    'Overall ' + f(s.x) + ' &times; ' + f(s.z) + ' &times; ' + f(s.y) + ' in (' +
    mm(s.x) + ' &times; ' + mm(s.z) + ' &times; ' + mm(s.y) + ' mm), L &times; W &times; H.<br>' +
    '<small>' + used.map(p => p.name).join('; ') + '</small>';
}

function highlight() {   // subtle emissive tint on the selected instance (optional nicety)
  try {
    for (const m of mv.model.materials) {
      const on = selId && (m.name || '').endsWith('#' + selId);
      m.setEmissiveFactor(on ? [0.1, 0.25, 0.6] : [0, 0, 0]);
    }
  } catch (e) { /* ignore */ }
}

async function refresh(initial) {
  if (busy) { again = true; return; }
  busy = true;
  try {
    const { root, used } = await buildGroup();
    caption(root, used);
    if (initial && ser(state) === defaultKey && OFS.isZero(offs)) { if (selId) mv.addEventListener('load', highlight, { once: true }); return; }   // src already shows the default assembly
    const orbit = mv.getCameraOrbit(), target = mv.getCameraTarget(), fov = mv.getFieldOfView();
    const buf = await new GLTFExporter().parseAsync(liveOffsets() ? root : bakeOffsets(root), { binary: true });
    const url = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    mv.addEventListener('load', () => {
      if (!initial) {
        mv.cameraOrbit = orbit.toString(); mv.cameraTarget = target.toString(); mv.fieldOfView = fov + 'deg';
        if (mv.jumpCameraToGoal) mv.jumpCameraToGoal();
      }
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = url; highlight(); applyOffsets();
    }, { once: true });
    mv.src = url;
  } finally {
    busy = false;
    if (again) { again = false; refresh(); }
  }
}

// ---- placement offsets (live: a Group inside ModelScene.target; see patch.js for why they survive reloads) ----
const sym = name => Object.getOwnPropertySymbols(mv).find(s => s.description === name);
const mvScene = () => { const s = sym('scene'); return s ? mv[s] : null; };
let ofsGroup = null, ofsMode = 'none';
function liveOffsets() { const sc = mvScene(); return !!(sc && sc.target && sc.target.isObject3D); }
function bakeOffsets(root) {
  if (OFS.isZero(offs)) return root;
  const g = new THREE.Group(), t = OFS.toTransform(offs);
  g.position.set(...t.pos); g.rotation.y = t.yawRad; g.add(root); g.updateMatrixWorld(true);
  return g;
}
function applyOffsets() {
  if (!liveOffsets()) { ofsMode = 'bake'; return false; }
  const sc = mvScene(), tgt = sc.target;
  if (!ofsGroup) { ofsGroup = new THREE.Group(); ofsGroup.name = 'offsets'; }
  if (ofsGroup.parent !== tgt) tgt.add(ofsGroup);
  if (sc.model && sc.model.parent !== ofsGroup) ofsGroup.add(sc.model);   // re-adopt after a src reload / re-framing
  const t = OFS.toTransform(offs);
  ofsGroup.position.set(...t.pos); ofsGroup.rotation.set(0, t.yawRad, 0); ofsGroup.updateMatrixWorld(true);
  ofsMode = 'live';
  try { if (sc.queueRender) sc.queueRender(); } catch (e) { /* ignore */ }
  return true;
}
function setOffsets(next) {
  offs = next; writeHash();
  if (!applyOffsets()) refresh();
  updateStrip();
}

// ---- AR patch (fail safe: warning + stock behaviour) ----
const params = new URLSearchParams(location.search);
await customElements.whenDefined('model-viewer');
const patch = installARPatch(mv);
if (!patch.ok) {
  const w = document.getElementById('warn');
  w.hidden = false; w.textContent = 'AR patch unavailable (' + patch.reason + '). Stock model-viewer placement; corrections may snap back.';
}
console.info('[ar-mv] patch', patch);

// ---- compact AR control strip ----
const strip = document.getElementById('arstrip');
let arSide = 'pos', stripOpen = false;
if (params.get('arpreview')) { strip.classList.add('preview'); document.body.classList.add('arpreview'); stripOpen = true; }
const lug = pol => state.find(i => i.part === 'lug-38-' + pol);
const lugOpt = () => (partOf('lug-38-pos').options || {}).length || { min: 3, max: 24, step: 1, default: 6 };
const coverInsts = () => ['pos', 'neg'].map(p => state.find(i => i.part === 'blueseas-2340-' + p)).filter(Boolean);
const btns = {};
function addBtn(row, key, cls, text, label, fn, span) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.textContent = text; b.setAttribute('aria-label', label);
  if (span) b.style.gridColumn = 'span ' + span;
  b.addEventListener('click', fn); row.append(b); btns[key] = b;
}
function buildStrip() {
  const head = document.createElement('button');
  head.type = 'button'; head.id = 'arhandle'; head.setAttribute('aria-controls', 'arbody');
  head.addEventListener('click', () => { stripOpen = !stripOpen; updateStrip(); });
  const body = document.createElement('div'); body.id = 'arbody';
  const r1 = document.createElement('div'), r2 = document.createElement('div'); r1.className = r2.className = 'r';
  const st = (key, d) => () => setOffsets(OFS.step(offs, key, d));
  const ext = d => () => { const i = lug(arSide), o = lugOpt(); if (!i) return; i.opts.length = clampNum(o, i.opts.length + d); changed(); };
  const turn = d => () => { const i = lug(arSide); if (!i) return; i.yaw = norm(i.yaw + d * (snapMount(partOf(i.part)).yaw_step_deg || 15)); changed(); };
  addBtn(r1, 'ext-', 'b ext', '−1"', 'Selected lug extension shorter by 1 inch', ext(-1));
  addBtn(r1, 'ext+', 'b ext', '+1"', 'Selected lug extension longer by 1 inch', ext(1));
  addBtn(r1, 'side', 'b lug', '', 'Switch selected lug', () => { arSide = arSide === 'pos' ? 'neg' : 'pos'; updateStrip(); }, 2);
  addBtn(r1, 'rl', 'b lug', '↺15°', 'Rotate lug left 15 degrees', turn(1));
  addBtn(r1, 'rr', 'b lug', '↻15°', 'Rotate lug right 15 degrees', turn(-1));
  addBtn(r1, 'cov', 'b cov', 'Cover', 'Toggle busbar covers', () => { const c = coverInsts(), on = c.length > 0 && c.every(i => i.opts.cover); c.forEach(i => { i.opts.cover = !on; }); changed(); });
  addBtn(r1, 'reset', 'b rst', 'Reset', 'Reset height, nudge and turn', () => setOffsets({ ...OFS.ZERO }));
  addBtn(r2, 'hu', 'b hgt', 'Up½', 'Raise 0.5 inch', st('h', 0.5));
  addBtn(r2, 'hd', 'b hgt', 'Dn½', 'Lower 0.5 inch', st('h', -0.5));
  addBtn(r2, 'nl', 'b nud', '←', 'Nudge left 0.5 inch', st('x', -0.5));
  addBtn(r2, 'nr', 'b nud', '→', 'Nudge right 0.5 inch', st('x', 0.5));
  addBtn(r2, 'nf', 'b nud', '↑', 'Nudge forward 0.5 inch', st('z', 0.5));
  addBtn(r2, 'nb', 'b nud', '↓', 'Nudge back 0.5 inch', st('z', -0.5));
  addBtn(r2, 'tl', 'b trn', '↺5°', 'Turn assembly left 5 degrees', st('yaw', 5));
  addBtn(r2, 'tr', 'b trn', '↻5°', 'Turn assembly right 5 degrees', st('yaw', -5));
  body.append(r1, r2);
  strip.replaceChildren(body, head);
  btns.head = head; btns.body = body;
}
function updateStrip() {
  if (!btns.head) return;
  const i = lug(arSide), sg = sign(arSide);
  btns.head.textContent = (stripOpen ? '▾ ' : '▴ ') + 'Adjust · ' + OFS.describe(offs);
  btns.head.setAttribute('aria-expanded', stripOpen);
  btns.body.hidden = !stripOpen;
  btns.side.textContent = i ? sg + ' lug ' + i.opts.length + '" ' + i.yaw + '°' : sg + ' lug off';
  for (const k of ['ext-', 'ext+', 'rl', 'rr']) btns[k].disabled = !i;
  const c = coverInsts(), on = c.length > 0 && c.every(x => x.opts.cover);
  btns.cov.disabled = !c.length; btns.cov.setAttribute('aria-pressed', on); 
  btns.reset.disabled = OFS.isZero(offs);
}
strip.addEventListener('beforexrselect', e => e.preventDefault());   // taps on the strip must not place / drag the model in AR
mv.addEventListener('ar-status', () => { applyOffsets(); updateStrip(); });
if (params.has('help')) document.getElementById('help').open = true;

function changed() { writeHash(); renderChips(); updateStrip(); refresh(); }

function renderChips() {
  const box = document.getElementById('chips'); box.innerHTML = '';
  const seen = new Set();
  for (const p of catalog.parts) {
    if (seen.has(chipId(p))) continue; seen.add(chipId(p));
    const members = catalog.parts.filter(q => chipId(q) === chipId(p));
    const on = members.some(q => state.some(i => i.part === q.id));
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', on);
    b.innerHTML = '<span class="dot" style="background:' + p.thumb_color + '"></span>' + p.short;
    if (p.always_on) b.disabled = true;
    b.addEventListener('click', () => { for (const q of members) setPresent(q.id, !on); changed(); });
    box.appendChild(b);
  }
}
function setPresent(id, on) {
  const has = state.some(i => i.part === id);
  if (on && !has) { state.push(defInst(partOf(id))); state.sort((a, c) => catalog.parts.indexOf(partOf(a.part)) - catalog.parts.indexOf(partOf(c.part))); }
  if (!on && has) state = state.filter(i => i.part !== id);
}

catalog = await (await fetch('parts/catalog.json')).json();
host = partOf(catalog.host);
defaultKey = ser(defaultState());
const q = new URLSearchParams(location.hash.slice(1));
state = parse(q.get('s')) || defaultState();
offs = OFS.parse(q.get('o'));
params.get('off')?.split(',').forEach(id => { state = state.filter(i => i.part !== id || i.part === host.id); });
buildStrip(); renderChips(); updateStrip();
refresh(true);
