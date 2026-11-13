// ar-xr.html: own WebXR immersive-ar session (three.js), no model-viewer. See the ?help checklist in ar-xr.html.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { XREstimatedLight } from 'three/addons/webxr/XREstimatedLight.js';
import { createComposer } from './compose.js';
import * as OFS from '../offsets.js';
import * as XM from './xrmath.js';
import * as PK from './pick.js';
import * as BM from './beam.js';
import * as MD from './modes.js';
import * as MT from './match.js';
import * as SCN from './scene.js';
import { createToasts, gestureOutcome } from './toasts.js';
import * as IC from './icons.js';
import * as CT from './cats.js';
import * as JMP from './jumper.js';
import * as PR from './presets.js';

const q = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const overlay = $('overlay'), ctl = $('ctl'), ctx = $('ctx'), bottom = $('bottom'), status = $('status'), enterBtn = $('enter'), hint = $('hint');
const PREVIEW = !!q.get('arpreview');
const DEBUG = q.get('debug') === '1';
const BUILD = window.__BUILD || 'dev';
$('build0').textContent = $('build1').textContent = 'build ' + BUILD;

// ---- debug log (?debug=1): last 20 lines in the overlay; errors always land here ----
const logLines = [];
function log(m) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log('[ar-xr]', m);
  if (!DEBUG) return;
  logLines.push(t + ' ' + m); if (logLines.length > 20) logLines.shift();
  $('dbg').hidden = false; $('dbg').textContent = logLines.join('\n');
}
addEventListener('error', e => log('ERROR ' + (e.message || e.error)));
addEventListener('unhandledrejection', e => log('REJECTION ' + (e.reason && e.reason.message || e.reason)));
if (DEBUG && q.get('eruda') === '1') {   // lazy: only when asked for
  const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/eruda@3.4.1/eruda.min.js';
  sc.onload = () => { try { window.eruda.init(); log('eruda on'); } catch (e) { log('eruda failed ' + e.message); } };
  sc.onerror = () => log('eruda failed to load'); document.head.appendChild(sc);
}
log('build ' + BUILD);

// ---- renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1;   // Khronos PBR Neutral, model-viewer's default
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;      // soft contact-like shadow
renderer.xr.enabled = true;
// light estimation (real-world light on a device); falls back to roomEnv when the session has none
const xrLight = new XREstimatedLight(renderer, true);
xrLight.addEventListener('estimationstart', () => {
  log('light estimation on');
  scene.add(xrLight); if (xrLight.environment) scene.environment = xrLight.environment;
  sun.intensity = 0.5;
});
xrLight.addEventListener('estimationend', () => {
  log('light estimation off'); scene.remove(xrLight); scene.environment = roomEnv; sun.intensity = 0.9; });
$('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
camera.position.set(0.35, 0.3, 0.45);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.1, 0); controls.enableDamping = true;

// image-based lighting (model-viewer's neutral look); direct light stays low and only casts the floor shadow
const pmrem = new THREE.PMREMGenerator(renderer);
const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = roomEnv; scene.environmentIntensity = 0.8;
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(0.2, 1.5, 0.35);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -0.5, right: 0.5, top: 0.5, bottom: -0.5, near: 0.1, far: 4 });
sun.shadow.bias = -0.0005; sun.shadow.radius = 16; sun.shadow.blurSamples = 20;

// pivot = placement point (matrix comes from reticle / anchor, never changed by corrections).
// inner = our authoritative correction: position (x,h,z) in the pivot frame, plus yaw. Parts live in inner.
// floorShadow stays under the pivot at floor level, so raising the model leaves its shadow on the floor.
const pivot = new THREE.Group(); pivot.matrixAutoUpdate = false;
const inner = new THREE.Group();
const floorShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.ShadowMaterial({ opacity: 0.5 }));
floorShadow.rotation.x = -Math.PI / 2; floorShadow.receiveShadow = true;
const grid = new THREE.GridHelper(1.2, 24, 0x8a94a3, 0xc9ced6);   // preview only
const modelHolder = new THREE.Group(); inner.add(modelHolder);
pivot.add(inner, floorShadow, grid, sun, sun.target);
scene.add(pivot);

const reticle = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x1affb0, side: THREE.DoubleSide }));
reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

// ---- selection visuals: beam from the viewer to the hovered point, outline box on the selected part ----
const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0x1affb0, depthTest: false, transparent: true, opacity: 0.9 }));
beam.frustumCulled = false; beam.visible = false; beam.renderOrder = 9; scene.add(beam);
const outline = new THREE.Box3Helper(new THREE.Box3(), 0x2f6fde);
outline.material.depthTest = false; outline.renderOrder = 8; outline.visible = false; inner.add(outline);

// ---- tools (select | mark | measure), marks and measurements: world-fixed (not children of pivot) ----
let tool = MD.normTool(q.get('tool'));
const marks = [];      // { group, ball, sprite, pos: Vector3, src, text }
const measures = [];   // { group, sprite, a: [x,y,z], b: [x,y,z], text }
let pendingA = null;   // { pos: [x,y,z], ball } first point of a measurement
let selMark = -1, hovMark = -1, selMeasure = -1, hovMeasure = -1, beamHit = null;   // beamHit = { src, dist, point:[x,y,z] } nearest surface under the crosshair
const MAX_MARKS = 8, MAX_MEASURES = 8;
function studWorld(id) {
  const m = C.host.mounts.find(h => h.id === id); if (!m) return null;
  modelHolder.updateWorldMatrix(true, false);
  return modelHolder.localToWorld(new THREE.Vector3(m.pos[0], m.pos[1], m.pos[2]).multiplyScalar(XM.M_PER_IN));
}
function labelTexture(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d'); g.fillStyle = 'rgba(10,14,22,.85)'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 48);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function setLabel(obj, text) {   // redraw a label sprite only when its text changed
  if (obj.text === text) return;
  obj.text = text;
  if (obj.sprite.material.map) obj.sprite.material.map.dispose();
  obj.sprite.material.map = labelTexture(text); obj.sprite.material.needsUpdate = true;
}
function makeSprite(w) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
  sprite.scale.set(w, w * 96 / 512, 1); sprite.renderOrder = 11; return sprite;
}
function makeBall(pos, color) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.005, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false }));
  ball.position.fromArray(pos); ball.renderOrder = 10; scene.add(ball); return ball;
}
function disposeObj(o) {
  o.traverse(c => { if (c.material) { c.material.map?.dispose(); c.material.dispose(); } if (c.geometry) c.geometry.dispose(); });
  scene.remove(o);
}
let markMsg = '';
function flashMsg(t) { markMsg = t; refreshMarks(); setTimeout(() => { markMsg = ''; refreshMarks(); }, 2500); }
function toolPrompt() {
  if (tool === 'mark') return 'Mark: aim and tap to drop (' + marks.length + '/' + MAX_MARKS + ')';
  if (tool === 'measure') return pendingA ? 'Measure: tap point B' : 'Measure: tap point A';
  return '';
}
// labels: a mark shows its text only when selected or when the beam passes within ~2 cm; measurements always show their distance
function refreshMarks() {
  const sp = C && studWorld('stud_pos'), sn = C && studWorld('stud_neg'), vis = MD.labelIndices(marks.length, selMark, hovMark), lines = [];
  marks.forEach((m, i) => {
    const on = !!(sp && sn && vis.includes(i));
    m.sprite.visible = on;
    m.ball.material.color.set(i === selMark ? 0xffffff : 0xffd400); m.ball.scale.setScalar(i === selMark ? 1.5 : 1);
    if (!on) return;
    const txt = MD.markTextU(i + 1, XM.distIn(m.pos.toArray(), sp.toArray()), XM.distIn(m.pos.toArray(), sn.toArray()), m.src, units);
    setLabel(m, txt); lines.push(txt);
  });
  measures.forEach((ms, i) => { setLabel(ms, MD.fmtLen(XM.distIn(ms.a, ms.b), units)); ms.group.children[0].material.color.set(i === selMeasure || i === hovMeasure ? 0xffffff : 0x00e5ff); });
  $('marks').textContent = markMsg || [toolPrompt(), ...lines].filter(Boolean).join('  |  ');
}
function selectMark(i) { selMark = i >= 0 && i < marks.length ? i : -1; if (selMark >= 0) selMeasure = -1; refreshMarks(); readout(); }
function selectMeasure(i) { selMeasure = i >= 0 && i < measures.length ? i : -1; if (selMeasure >= 0) { selMark = -1; selectPart(null); } refreshMarks(); readout(); }
function addMarkObj(point, src) {
  const pos = new THREE.Vector3(...point), group = new THREE.Group(), ball = new THREE.Mesh(new THREE.SphereGeometry(0.005, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd400, depthTest: false }));
  ball.renderOrder = 10; const sprite = makeSprite(0.12); sprite.position.y = 0.03; sprite.visible = false;
  group.position.copy(pos); group.add(ball, sprite); scene.add(group);
  marks.push({ group, ball, sprite, pos, src, text: '' });
}
function dropMarkAt(point, src) {
  if (marks.length >= MAX_MARKS) { flashMsg('Max ' + MAX_MARKS + ' marks: Undo or Clear marks first'); return false; }
  addMarkObj(point, src); selMark = marks.length - 1; log('mark ' + marks.length + ' dropped on ' + src);
  refreshMarks(); persistSoon(); return true;
}
function dropMark() {
  if (!beamHit) { flashMsg('Aim at a surface first'); log('mark: no surface under the beam yet'); return false; }
  return dropMarkAt(beamHit.point, beamHit.src);
}
let lastRemoved = null;   // { kind: 'mark'|'measure', index, data } the last mark or measurement removed by hand; Undo puts it back first
function removeMarkAt(i) {
  const m = marks[i]; if (!m) return;
  lastRemoved = { kind: 'mark', index: i, data: { point: m.pos.toArray(), src: m.src } };
  disposeObj(m.group); marks.splice(i, 1); selMark = -1; hovMark = -1; refreshMarks(); persistSoon(); readout();
}
function removeMeasureAt(i) {
  const m = measures[i]; if (!m) return;
  lastRemoved = { kind: 'measure', index: i, data: { a: m.a, b: m.b } };
  disposeObj(m.group); measures.splice(i, 1); selMeasure = -1; refreshMarks(); persistSoon(); readout();
}
function restoreRemoved() {
  const r = lastRemoved; if (!r) return false; lastRemoved = null;
  if (r.kind === 'mark') { addMarkObj(r.data.point, r.data.src); const m = marks.pop(); marks.splice(Math.min(r.index, marks.length), 0, m); selMark = marks.indexOf(m); }
  else { addMeasureObj(r.data.a, r.data.b, null); const m = measures.pop(); measures.splice(Math.min(r.index, measures.length), 0, m); selMeasure = measures.indexOf(m); }
  refreshMarks(); persistSoon(); readout(); return true;
}
function undoMark() {
  if (lastRemoved && lastRemoved.kind === 'mark' && restoreRemoved()) return;
  const m = marks.pop(); if (!m) return;
  disposeObj(m.group); if (selMark >= marks.length) selMark = -1; hovMark = -1; refreshMarks(); persistSoon();
}
function removeMarkObjs() { while (marks.length) disposeObj(marks.pop().group); selMark = hovMark = -1; }
function clearMarks() { removeMarkObjs(); refreshMarks(); persistSoon(); }
function addMeasureObj(a, b, ballA) {
  const group = new THREE.Group();
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]),
    new THREE.LineBasicMaterial({ color: 0x00e5ff, depthTest: false, transparent: true }));
  line.renderOrder = 9; line.frustumCulled = false;
  const sprite = makeSprite(0.09); sprite.position.fromArray(MD.midpoint(a, b)); sprite.position.y += 0.03;
  group.add(line, sprite, makeBall(b, 0x00e5ff));
  if (ballA) { scene.remove(ballA); group.add(ballA); } else group.add(makeBall(a, 0x00e5ff));   // pending A ball is already at a
  scene.add(group);
  measures.push({ group, sprite, a, b, text: '' });
}
function measureAt(point) {
  const r = MD.measureTap(pendingA && pendingA.pos, point);
  if (r.pending) { pendingA = { pos: point, ball: makeBall(point, 0x00e5ff) }; log('measure A'); }
  else {
    if (measures.length >= MAX_MEASURES) { flashMsg('Max ' + MAX_MEASURES + ' measurements: Undo or Clear first'); cancelPending(); return; }
    addMeasureObj(r.done[0], r.done[1], pendingA.ball); pendingA = null; log('measure ' + measures.length + ' done'); persistSoon();
  }
  refreshMarks();
}
function measureHit() { if (!beamHit) { flashMsg('Aim at a surface first'); return; } measureAt(beamHit.point); }
function cancelPending() { if (pendingA) { disposeObj(pendingA.ball); pendingA = null; } refreshMarks(); }
function undoMeasure() { if (lastRemoved && lastRemoved.kind === 'measure' && restoreRemoved()) return; if (pendingA) { cancelPending(); return; } const m = measures.pop(); if (m) disposeObj(m.group); refreshMarks(); persistSoon(); }
function removeMeasureObjs() { cancelPending(); while (measures.length) disposeObj(measures.pop().group); }
function clearMeasures() { removeMeasureObjs(); refreshMarks(); persistSoon(); }

// ---- one scene store, serialized to the URL hash. Marks and measurements are kept in the model frame so they follow the model between preview and AR ----
let marksLive = true, storedMarks = [], storedMeasures = [], persistT = 0, initialHash = '';
const toModel = p => { modelHolder.updateWorldMatrix(true, false); return modelHolder.worldToLocal(new THREE.Vector3(...p)).toArray(); };
const toWorld = p => { scene.updateMatrixWorld(true); return modelHolder.localToWorld(new THREE.Vector3(...p)).toArray(); };
function sceneNow() {
  if (marksLive) {
    storedMarks = marks.map(m => ({ p: toModel(m.pos.toArray()), src: m.src }));
    storedMeasures = measures.map(m => ({ a: toModel(m.a), b: toModel(m.b) }));
  }
  return { insts: state, offs, marks: storedMarks, measures: storedMeasures, jumpers };
}
function persist() {
  clearTimeout(persistT);
  if (!C) return '';
  const h = C.SC.toHash(sceneNow());
  try { history.replaceState(null, '', location.pathname + location.search + '#' + h); } catch (e) { /* sandboxed */ }
  return h;
}
function suspendMarks() { sceneNow(); marksLive = false; removeMarkObjs(); removeMeasureObjs(); refreshMarks(); }
function persistSoon() { clearTimeout(persistT); persistT = setTimeout(persist, 200); }
// rebuild the mark / measure objects from the stored model-frame lists at the model's current world pose
function restoreMarks() {
  removeMarkObjs(); removeMeasureObjs();
  for (const m of storedMarks) addMarkObj(toWorld(m.p), m.src);
  for (const m of storedMeasures) addMeasureObj(toWorld(m.a), toWorld(m.b));
  marksLive = true; refreshMarks();
}
function setHint(t) { hint.hidden = !t; if (t) hint.textContent = t; }
function setTool(t) {
  t = MD.normTool(t); if (t === tool) return;
  if (adding) cancelAdd(); closeLib();
  if (tool === 'measure') cancelPending();
  tool = t; moreOpen = false; log('tool ' + t);
  if (t !== 'select') selectPart(null);
  if (t === 'measure') selMark = -1;
  readout();
}
// a scene tap in a session (placed): what it does depends on the tool
function onSceneTap(ev) {
  if (moving) { endMove(); return; }   // the tap drops the part where the beam put it
  if (linking) { if (linking.target) pickLink(linking.target); else toast('Aim at a stud', true); return; }
  if (adding) { confirmAdd(); return; }
  if (tool === 'mark') { if (hovMark >= 0) selectMark(hovMark); else dropMark(); }
  else if (tool === 'measure') measureHit();
  else if (hovMark >= 0) { selectPart(null); selectMark(hovMark); }
  else { selectMark(-1); tapPick(ev); }
}

// ---- units: chosen on the page before AR, kept in localStorage, ?units=mm|in wins ----
let units = MD.normUnits(q.get('units'), '');
if (!units) { try { units = MD.normUnits(localStorage.getItem(MD.UNIT_KEY)); } catch (e) { units = 'in'; } }
function syncUnitButtons() { $('unitbtn').querySelector('small').textContent = units; $('unitbtn').setAttribute('aria-label', 'Units: ' + (units === 'mm' ? 'millimeters' : 'inches') + '. Tap to change'); }
function setUnits(u) {
  units = MD.normUnits(u); syncUnitButtons();
  try { localStorage.setItem(MD.UNIT_KEY, units); } catch (e) { /* storage blocked */ }
  readout();
}
$('unitbtn').addEventListener('click', () => setUnits(units === 'mm' ? 'in' : 'mm'));
syncUnitButtons();

// ---- app state ----
let moreOpen = false;
let adding = null;   // Add part in progress: { partId, kind: 'stud'|'surface', outlets: [{ key, seat: [x,y,z] model frame m }], target: key|null, lock: ray|null }
let selOutlet = null, selPoint = null;   // outside XR: a selected outlet (key) and the surface point the click hit
let moving = null;   // XR Move: { id }, the part follows the beam on its mount plane until the next tap
let dragMove = null;   // outside XR: { id, grab: [dx, dz], pointerId } a drag of the selected surface part
let jumpers = [], jundo = [], selJumper = null, linking = null, linkAim = null, optLast = null, optOpen = false, stackH = { pos: null, neg: null };   // jumpers: see xr/jumper.js
let C, state = [], offs = { ...OFS.ZERO }, selectedId = null, hoveredId = null, busy = false, again = false;
let session = null, hitSource = null, anchor = null, anchorFix = null, lastFrame = null, lastHit = null;
const baseMat = new THREE.Matrix4();
let mode = 'preview';   // preview | reticle | placed
function setMode(m) { if (m !== mode) log('mode ' + mode + ' -> ' + m); mode = m; updateCross(); }
const tmpV = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
let hitCount = -1;

const instOf = id => state.find(i => i.id === id) || null;
const selInst = () => instOf(selectedId);
const kindOfId = id => { const i = instOf(id), p = i && C.partOf(i.part); return p ? PK.kindOf(p.id, C.host.id, 'cover' in (p.options || {})) : null; };
const nameOfId = id => { const i = instOf(id), p = i && C.partOf(i.part); return !p ? '' : (p.short || p.name); };
const numKey = p => Object.keys(p.options || {}).find(k => p.options[k].type === 'number');
const choiceKey = p => Object.keys(p.options || {}).find(k => p.options[k].type === 'choice');

async function rebuild() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    const root = await C.build(state);
    modelHolder.clear(); modelHolder.add(root);
    hoveredId = null; outletPts = null; fitCache.clear(); hideQuick(); applyTints(); refreshOutline(); updateJumpers(); updateHeights(); readout(); persistSoon();
  } catch (e) {
    const bad = e && e.partName ? e.partName : 'a part';
    log('rebuild failed: ' + (e && e.message)); toast('Could not load ' + bad + ' (' + (e && e.message || 'error') + '). Try again.', true, 0, 'error');
  } finally { busy = false; if (again) { again = false; rebuild(); } }
}
const roots = () => (modelHolder.children[0]?.children || []).filter(o => o.userData.instanceId);

// ---- selection: tint (emissive on per-instance materials) + outline ----
// selection colour = the theme accent (--tb-outline-color), resolved through a probe element because the token is a light-dark() value
const accent = new THREE.Color(0x2f6fde);
function readAccent() {
  const pr = document.createElement('i'); pr.style.cssText = 'position:absolute;visibility:hidden;color:var(--tb-outline-color)'; document.body.appendChild(pr);
  const m = getComputedStyle(pr).color.match(/[\d.]+/g); pr.remove();
  if (m && m.length >= 3) accent.setRGB(+m[0] / 255, +m[1] / 255, +m[2] / 255, THREE.SRGBColorSpace);
  outline.material.color.copy(accent);
}
readAccent();
function retintAll() { readAccent(); for (const r of roots()) r.userData.tint = null; applyTints(); }
document.addEventListener('tb-theme-change', () => setTimeout(retintAll, 0));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(retintAll, 0));
function setTint(root, want) {
  root.userData.tint = want;
  root.traverse(c => {
    if (!c.isMesh) return;
    for (const m of Array.isArray(c.material) ? c.material : [c.material]) {
      if (!m.emissive) continue;
      if (!m.userData.e0) m.userData.e0 = { c: m.emissive.clone(), i: m.emissiveIntensity };
      if (want === 'selected') { m.emissive.copy(accent); m.emissiveIntensity = 0.7; }
      else if (want === 'hover') { m.emissive.set(0xffffff); m.emissiveIntensity = 0.18; }
      else { m.emissive.copy(m.userData.e0.c); m.emissiveIntensity = m.userData.e0.i; }
    }
  });
}
function applyTints() {
  for (const r of roots()) { const w = PK.tintFor(r.userData.instanceId, selectedId, hoveredId); if (r.userData.tint !== w) setTint(r, w); }
}
function localBox(obj) {   // box of obj in the modelHolder frame (outline lives in inner)
  scene.updateMatrixWorld(true);
  const inv = modelHolder.matrixWorld.clone().invert(), b = new THREE.Box3(), mm = new THREE.Matrix4();
  obj.traverse(m => { if (m.isMesh) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    b.union(m.geometry.boundingBox.clone().applyMatrix4(mm.multiplyMatrices(inv, m.matrixWorld)));
  } });
  return b;
}
function refreshOutline() {
  const r = roots().find(o => o.userData.instanceId === selectedId);
  outline.visible = !!r; outline.material.color.copy(accent);
  if (r) outline.box.copy(localBox(r)).expandByScalar(0.002);
}
function selectPart(id, pt = null) {
  id = id && instOf(id) ? id : null; if (selJumper) { selJumper = null; tintJumpers(); }
  selOutlet = null; selPoint = id ? pt : null;
  if (id !== selectedId) { log('selected ' + (id || 'none')); endMove(); }
  selectedId = id;
  applyTints(); refreshOutline(); readout();
}

function applyOffsets() {
  const t = OFS.toTransform(offs);
  inner.position.set(...t.pos); inner.rotation.y = t.yawRad;
  readout(); persistSoon();
}
function readout() {
  if (!C) return;
  const inst = selInst(), p = inst && C.partOf(inst.part), kind = inst ? kindOfId(inst.id) : null;
  $('ofs').textContent = MD.describeU(offs, units);
  refreshMarks();
  let t = 'Nothing selected';
  if (!inst && selMark >= 0) t = 'Selected: mark M' + (selMark + 1); else if (!inst && selMeasure >= 0) t = 'Selected: measurement ' + (selMeasure + 1);
  if (inst) {
    const nk = numKey(p), ck = choiceKey(p);
    t = 'Selected: ' + nameOfId(inst.id) + (nk ? ' ' + MD.fmtLen(inst.opts[nk], units) : '') + (ck ? ' ' + p.options[ck].values[inst.opts[ck]].label : '') + (kind !== 'battery' && kind !== 'nut' ? ' ' + inst.yaw + '°' : '');
  } else if (hoveredId) t = 'Aim: ' + nameOfId(hoveredId);
  if (!inst && !hoveredId && selMark < 0 && selMeasure < 0 && !selJumper) t = PR.tooltip(PR.presetOf(C.SC, state), stackH, v => MD.fmtLen(v, units));
  if (selJumper) { const j = jumpers.find(x => x.id === selJumper), L = j && jumperLen(j); if (L) t = JMP.jumperText(j, MD.fmtLen(L.cut, units)); }
  if (linking) t = 'Cable: ' + (linking.from ? 'pick the second stud' : 'pick the first stud');
  if (selOutlet && !inst) t = 'Outlet: ' + outletName(selOutlet);
  if (adding) t = 'Add ' + (C.partOf(adding.partId).short || adding.partId) + (adding.kind === 'stud' ? ': ' + (adding.target ? outletName(adding.target) : 'no target') : ': aim at a surface');
  $('sel').textContent = t;
  { const tp = inst ? p : hoveredId && !adding ? C.partOf((instOf(hoveredId) || {}).part) : adding ? C.partOf(adding.partId) : null, im = $('selthumb');
    const src = tp && tp.thumb || ''; if (im.getAttribute('src') !== src) { if (src) im.src = src; else im.removeAttribute('src'); } im.hidden = !src;
    $('sel').title = tp ? tp.name : ''; $('sel').setAttribute('aria-label', tp ? t + ' (' + tp.name + ')' : t); }
  const chip = $('mode'); chip.dataset.tool = tool; chip.querySelector('b').textContent = MD.TOOL_LABEL[tool]; chip.setAttribute('aria-label', 'Mode: ' + MD.TOOL_LABEL[tool] + '. Tap to change');
  const step = inst ? C.yawStep(inst.part) : 0;
  const inXR = document.body.classList.contains('inar'), libOpen = !libEl.hidden;
  const ex = inst ? { free: !!inst.at || inst.part === C.host.id, num: !!numKey(p), choice: !!choiceKey(p) } : {};
  const tg = inXR ? null : selTarget();
  const quickView = inXR && quick && { kind: quick.kind, isSel: quick.kind === 'part' && quick.id === selectedId, point: !!quick.point, fit: quick.fit.length };
  const jf = jfromKeys(inXR, quick, tg);
  const acts = libOpen || optOpen ? [] : MD.ctxFor({ linking: !!linking, jumper: !!selJumper, jfrom: !!(jf && jf.length), jundo: jundo.length > 0, markSel: !selectedId && (selMark >= 0 || (inXR && hovMark >= 0)), measSel: !selectedId && selMeasure >= 0, tool, kind, rotStep: step, selected: !!selectedId, x: ex, more: moreOpen, inXR, quick: quickView, target: tg && { kind: tg.kind, point: !!tg.point },
    adding: adding ? { stud: adding.kind === 'stud', outlets: adding.outlets.length } : null });
  const low = MD.bottomFor(tool, inXR);
  for (const id of MD.ALL_IDS) $(id).hidden = !acts.includes(id) && !low.includes(id);
  for (const id of acts) ctx.appendChild($(id));   // keep the layout order of the list
  bottom.appendChild($('mode')); for (const id of low) bottom.appendChild($(id));
  ctx.classList.toggle('lib', libOpen); ctx.classList.toggle('optsl', optOpen); $('optlist').hidden = !optOpen; ctx.classList.toggle('acts', acts.length > 0);
  ctx.classList.toggle('chip', acts.length > 0 && (tool !== 'select' || !!adding || !!inst || !!selJumper || !!linking || jundo.length > 0 || selMark >= 0 || selMeasure >= 0)); ctx.dataset.tool = tool;
  $('more').setAttribute('aria-pressed', moreOpen && !adding);
  const cur = inXR ? quick : tg; $('qadd').disabled = !(cur && (cur.fit.length || (cur.free && cur.free.length)));   // enabled when the part has free outlets even if no library part fits yet (click says so)
  $('rotm').setAttribute('aria-label', 'Rotate right ' + step + ' degrees'); $('rotp').setAttribute('aria-label', 'Rotate left ' + step + ' degrees');
  if (inst && choiceKey(p)) { const ck = choiceKey(p), o = p.options[ck]; $('gauge').dataset.v = o.values[inst.opts[ck]].label; }
  { const j = jumpers.find(x => x.id === selJumper); if (j) { $('jgauge').dataset.v = j.gauge + ' AWG'; $('jcolor').dataset.v = j.color === 'red' ? 'Red' : 'Black'; } }
  { const cur = PR.presetOf(C.SC, state), ob = $('opt'), nm = cur ? cur : optLast ? optLast + '*' : null; ob.dataset.v = nm ? 'Option ' + nm + ' \u25b8' : 'Options \u25b8'; ob.setAttribute('aria-label', cur ? 'Terminal option ' + cur + ': ' + PR.byId(cur).name + '. Tap for the next, hold for the list' : 'Terminal options. Tap for the next, hold for the list'); }
  $('confirm').setAttribute('aria-label', adding && adding.kind === 'stud' ? 'Place on the ring' : 'Place here');
  $('cover').setAttribute('aria-pressed', !!(inst && inst.opts.cover)); $('move').setAttribute('aria-pressed', !!moving);
  const st = MD.stepsFor(units), lab = (id, big, small, aria) => { $(id).setAttribute('aria-label', aria); };
  lab('extp', '+' + st.extLabel, st.extUnit, 'Extension plus ' + (units === 'mm' ? '25 mm' : '1 inch')); lab('extm', '&minus;' + st.extLabel, st.extUnit, 'Extension minus ' + (units === 'mm' ? '25 mm' : '1 inch'));
  lab('hp', '&uarr;', st.heightLabel, 'Raise ' + st.heightLabel); lab('hm', '&darr;', st.heightLabel, 'Lower ' + st.heightLabel);
  for (const [id, ch, w] of [['nl', '&larr;', 'left'], ['nr', '&rarr;', 'right'], ['nu', '&#9650;', 'away'], ['nd', '&#9660;', 'toward me']]) lab(id, ch, st.nudgeLabel, 'Nudge ' + w + ' ' + st.nudgeLabel);
  compactButtons();
  $('cross').classList.toggle('hit', !!hoveredId);
}
// every control is one line: icon + short verb; the full wording stays in aria-label and title
function compactButtons() {
  for (const id of Object.keys(IC.BUTTONS)) {
    const b = $(id); if (!b) continue;
    const txt = id === 'mode' ? MD.TOOL_LABEL[tool] : id === 'gauge' ? (b.dataset.v || 'Gauge') : id === 'jgauge' ? (b.dataset.v || 'Gauge') : id === 'jcolor' ? (b.dataset.v || 'Color') : id === 'opt' ? (b.dataset.v || 'Option') : null;
    const m = IC.markup(id, txt); if (m && b.dataset.m !== m) { b.innerHTML = m; b.dataset.m = m; }
    const al = b.getAttribute('aria-label'); if (al) b.title = al; else b.title = b.textContent.trim();
  }
}

// ---- view direction on the floor (live XR camera in a session, else the preview camera) ----
function viewForward() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldDirection(tmpV);
  return XM.floorForward(tmpV.x, tmpV.y, tmpV.z);
}
function pivotPsi() {   // frame yaw of the pivot as it is now (an anchor may have moved it a little)
  const d = new THREE.Vector3(0, 0, 1).transformDirection(pivot.matrix);
  return XM.psiFromDir(d.x, d.z);
}

// ---- strip buttons ----
const wire = (id, fn) => $(id).addEventListener('click', () => { fn(); readout(); });
const setOffs = o => { offs = o; applyOffsets(); };
function lugExt(d) {
  const li = selInst(); if (!li) return;
  const p = C.partOf(li.part), k = numKey(p); if (!k) return;
  li.opts[k] = MD.extStep(li.opts[k], d, units, p.options[k].min, p.options[k].max); rebuild();
}
wire('extm', () => lugExt(-1)); wire('extp', () => lugExt(1));   // direction only; the step size comes from the units
const rotSel = dir => { const li = selInst(); if (li) { li.yaw = PK.rotateYaw(li.yaw, dir * (C.yawStep(li.part) || 0)); rebuild(); } };
wire('rotm', () => rotSel(-1)); wire('rotp', () => rotSel(1));
wire('gauge', () => { const li = selInst(), p = li && C.partOf(li.part), k = p && choiceKey(p); if (k) { li.opts[k] = PK.nextChoice(p.options[k].values, li.opts[k]); rebuild(); } });
wire('cover', () => { const li = selInst(); if (li && 'cover' in li.opts) { li.opts.cover = !li.opts.cover; rebuild(); } });
// a selected part placed on a surface (inst.at) moves by itself; otherwise these move the whole model
const freeSel = () => { const i = selInst(); return i && (i.at || i.part === C.host.id) ? i : null; };   // surface parts and the battery itself (at = null means the origin)
const atOf = i => i.at || [0, 0, 0];
const r2 = v => Math.round(v * 100) / 100;
function moveFree(f, dx, dy, dz) { const a = atOf(f); f.at = [r2(a[0] + dx), r2(a[1] + dy), r2(a[2] + dz)]; rebuild(); }
// Move: a surface part slides on its mount plane (the horizontal plane at its own height, model frame) under a ray. Stacked parts follow (their placement derives from the host).
function slideTo(inst, ray, grab = [0, 0]) {
  if (!inst || !(inst.at || inst.part === C.host.id)) return false;
  const a0 = atOf(inst);
  modelHolder.updateWorldMatrix(true, false); _inv.copy(modelHolder.matrixWorld).invert();
  _lo.fromArray(ray.origin).applyMatrix4(_inv); _ld.fromArray(ray.dir).transformDirection(_inv);
  const p = XM.slidePoint(_lo.toArray(), _ld.toArray(), a0[1] * SCN.IN, grab);
  if (!p) return false;
  const nx = r2(p[0] / SCN.IN), nz = r2(p[2] / SCN.IN);
  if (nx === a0[0] && nz === a0[2]) return false;
  inst.at = [nx, a0[1], nz]; fastMove(); return true;
}
// during a drag only the matrices change (jumpers restretch); the full rebuild runs once on release
let moveDirty = false;
function fastMove() {
  const pl = C.SC.placements(state); moveDirty = true;
  for (const r of roots()) { const p = pl.get(r.userData.instanceId); if (p) { r.matrix.copy(C.matrixOf(p)); r.matrixWorldNeedsUpdate = true; } }
  modelHolder.updateMatrixWorld(true); refreshOutline(); updateJumpers();
}
function flushMove() { if (moveDirty) { moveDirty = false; rebuild(); } }
function startMove(inst) { moving = { id: inst.id }; toast('Aim at the surface, tap to drop', false, 0); readout(); }
function endMove() { if (!moving) return; moving = null; flushMove(); toast(''); readout(); }
function modelPsi() { modelHolder.updateWorldMatrix(true, false); const d = new THREE.Vector3(0, 0, 1).transformDirection(modelHolder.matrixWorld); return XM.psiFromDir(d.x, d.z); }
wire('hm', () => { const f = freeSel(), h = MD.stepsFor(units).height; if (f) moveFree(f, 0, -h, 0); else setOffs(XM.raise(offs, -h)); });
wire('hp', () => { const f = freeSel(), h = MD.stepsFor(units).height; if (f) moveFree(f, 0, h, 0); else setOffs(XM.raise(offs, h)); });
for (const [id, dir] of [['nl', 'left'], ['nr', 'right'], ['nu', 'up'], ['nd', 'down']])
  wire(id, () => {
    const f = freeSel(), st = MD.stepsFor(units).nudge;
    if (!f) { setOffs(XM.nudge(offs, viewForward(), dir, pivotPsi(), st)); return; }
    const [dx, dz] = XM.viewDelta(viewForward(), dir, st), [lx, lz] = XM.worldToFrame(dx, dz, modelPsi());
    moveFree(f, lx, 0, lz);
  });
const turnSel = d => { const f = freeSel(); if (f) { f.yaw = PK.rotateYaw(f.yaw, d); rebuild(); } else setOffs(XM.turn(offs, d)); };
wire('tm', () => turnSel(-XM.TURN_DEG)); wire('tp', () => turnSel(XM.TURN_DEG));
wire('again', () => { if (session) { cancelAdd(); suspendMarks(); setMode('reticle'); anchor = null; setHint('Move the phone to find the floor, tap to place'); } });
wire('drop', dropMark); wire('undomark', undoMark);
wire('rmmark', () => { const i = selMark >= 0 ? selMark : hovMark; if (i >= 0) removeMarkAt(i); }); wire('rmmeasure', () => { if (selMeasure >= 0) removeMeasureAt(selMeasure); });
wire('mnew', () => { cancelPending(); flashMsg('Tap point A'); }); wire('mundo', undoMeasure); wire('mclear', clearMeasures);
$('mode').addEventListener('click', () => { setTool(MD.nextTool(tool)); });
wire('select', () => { if (hoveredId) selectPart(hoveredId); });
wire('deselect', () => selectPart(null));
wire('clearmarks', clearMarks);
wire('reset', () => {
  cancelAdd(); closeLib();
  state = C.parseState(new URLSearchParams(initialHash).get('s')) || C.defaultState();
  selectedId = null; rebuild(); setOffs({ ...OFS.ZERO });
});
wire('exit', () => { if (session) session.end(); });
// More puts its items in the context row; tapping More again, or Back, returns
wire('more', () => { if (adding) cancelAdd(); closeLib(); moreOpen = !moreOpen; });
wire('back', () => { moreOpen = false; });
// the rows follow the page theme choice (<tb-theme> sets it on the root); rows keep their own data-theme so their buttons are themed even before a choice
{
  const sync = v => ctl.setAttribute('data-theme', v === 'light' || v === 'dark' ? v : 'auto');
  sync(document.documentElement.getAttribute('data-theme'));
  document.addEventListener('tb-theme-change', e => sync(e.detail && e.detail.value));
}
// context row on desktop: the wheel scrolls it sideways, and a mouse drag scrolls it too (a drag does not click the button under it)
{
  let drag = null;
  ctx.addEventListener('wheel', e => { if (ctx.scrollWidth <= ctx.clientWidth) return; ctx.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; e.preventDefault(); }, { passive: false });
  ctx.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) drag = { x: e.clientX, left: ctx.scrollLeft, moved: false }; });
  addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 5) drag.moved = true; if (drag.moved) ctx.scrollLeft = drag.left - dx; });
  addEventListener('pointerup', () => { if (drag && drag.moved) { const d = drag; setTimeout(() => { if (drag === d) drag = null; }, 0); } else drag = null; });
  ctx.addEventListener('click', e => { if (drag && drag.moved) { e.stopPropagation(); e.preventDefault(); drag = null; } }, true);
}
// touches on our controls must not place the model
overlay.addEventListener('beforexrselect', e => { if (e.target !== overlay) e.preventDefault(); });
ctl.addEventListener('beforexrselect', e => e.preventDefault());

// ---- Add part: library list, compatible outlets (xr/match.js), place on an outlet or on a surface; Remove ----
const libEl = $('lib'), listEl = $('liblist'), toastEl = $('toasts');
const outletGroup = new THREE.Group(); inner.add(outletGroup);   // rings live in the model frame (inner == modelHolder frame)
let lastAim = null;
// toasts: pure stack logic in xr/toasts.js, DOM here. Info hides after ~4 s; warn and error stay until closed (x), swiped or tapped. Max 3.
const toastStack = createToasts({ max: 3, infoMs: 4000 });
let toastTimer = 0;
function renderToasts() {
  clearTimeout(toastTimer);
  const host = toastEl, now = Date.now(); toastStack.expire(now);
  host.textContent = '';
  for (const t of toastStack.list()) {
    const el = document.createElement('div');
    el.className = 'toast ' + t.level; el.dataset.id = t.id; el.setAttribute('data-surface', 'glass'); el.setAttribute('data-theme', ctl.getAttribute('data-theme') || 'auto');
    el.setAttribute('role', t.level === 'info' ? 'status' : 'alert');
    const tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = t.text;
    const x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.innerHTML = '&times;';
    x.addEventListener('click', e => { e.stopPropagation(); dismissToast(t.id); });
    x.addEventListener('pointerdown', e => e.stopPropagation());
    el.append(tx, x); host.appendChild(el);
    let g = null;   // swipe sideways or tap the toast to dismiss it
    el.addEventListener('pointerdown', e => { if (e.button) return; g = { x: e.clientX, y: e.clientY, t: performance.now() }; el.classList.add('drag'); try { el.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ } });
    el.addEventListener('pointermove', e => { if (!g) return; const dx = e.clientX - g.x; el.style.transform = 'translateX(' + dx + 'px)'; el.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 200)); });
    const end = e => {
      if (!g) return; const r = gestureOutcome(e.clientX - g.x, e.clientY - g.y, performance.now() - g.t); g = null; el.classList.remove('drag');
      if (r === 'dismiss' && e.type === 'pointerup') dismissToast(t.id); else { el.style.transform = ''; el.style.opacity = ''; }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  const nx = toastStack.nextExpiry();
  if (nx !== Infinity) toastTimer = setTimeout(renderToasts, Math.max(0, nx - Date.now()) + 10);
}
function dismissToast(id) { if (toastStack.dismiss(id)) renderToasts(); }
// toast(text, warn, ms): ms 0 = a prompt that stays until toast('') clears it. Empty text clears the prompt.
function toast(t, warn = false, ms = 3500, level) {
  if (!t) { if (toastStack.dismissKey('prompt')) renderToasts(); return; }
  level = level || (warn ? 'warn' : 'info'); log('toast ' + level + ': ' + t);
  if (ms === 0 && level === 'info') toastStack.add({ text: t, key: 'prompt', sticky: true }, Date.now());
  else toastStack.add({ text: t, level }, Date.now());
  renderToasts();
}
// menu (top right, outside XR only): Theme and Units. Closes on outside tap, Esc, or the button.
{
  const btn = $('menubtn'), panel = $('menu');
  const setOpen = o => { panel.hidden = !o; btn.setAttribute('aria-expanded', String(o)); };
  btn.addEventListener('click', () => setOpen(panel.hidden));
  document.addEventListener('pointerdown', e => { if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) setOpen(false); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); } });
  new MutationObserver(() => { if (document.body.classList.contains('inar')) setOpen(false); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const th = () => { const v = document.documentElement.getAttribute('data-theme'); for (const el of [btn, panel]) el.setAttribute('data-theme', v === 'light' || v === 'dark' ? v : 'auto'); };
  th(); document.addEventListener('tb-theme-change', th);
}
let libKeys = null;   // part id -> outlet keys it fits, while the library is filtered to a highlighted outlet / part
let libFit = null, libCat = null, libPick = false;   // fit list (or null = all), category filter (null = All), category picker open
const catSaved = () => { try { return sessionStorage.getItem(CT.CAT_KEY) || null; } catch (_) { return null; } };
const catSave = c => { try { if (c) sessionStorage.setItem(CT.CAT_KEY, c); else sessionStorage.removeItem(CT.CAT_KEY); } catch (_) { /* storage blocked */ } };
const libParts = () => libFit ? libFit.map(x => x.part) : C.catalog.parts.filter(p => p !== C.host);
function catButton(label, icon, extra) {
  const b = document.createElement('button'); b.type = 'button'; b.innerHTML = CT.catIcon(icon) + '<span class="t">' + label + '</span>'; if (extra) Object.assign(b.dataset, extra); return b;
}
function buildLib(fit, keepCat) {
  libFit = fit || null; libKeys = fit ? Object.fromEntries(fit.map(x => [x.part.id, x.keys])) : null;
  const all = libParts(), cats = CT.categoriesOf(all);
  if (!keepCat) libCat = CT.startCat(cats, catSaved(), !!fit);
  if (libCat != null && !cats.includes(libCat)) libCat = null;
  const parts = CT.filterParts(all, libCat), shown = libPick ? 'pick' : libCat;
  const cb = $('libcat'); cb.innerHTML = CT.catIcon(libCat || 'All') + '<span class="t">' + (libCat || 'All') + '</span>';
  cb.setAttribute('aria-label', 'Category ' + (libCat || 'All') + '. Tap for the next, hold for the list'); cb.title = cb.getAttribute('aria-label'); cb.hidden = libPick;
  listEl.textContent = '';
  if (libPick) {
    for (const c of [null, ...cats]) { const li = document.createElement('li'), b = catButton(c || 'All', c || 'All', { pick: c || '' }); if (c === libCat) b.classList.add('on'); li.appendChild(b); listEl.appendChild(li); }
    return;
  }
  for (const c of CT.categoriesOf(parts)) {
    if (libCat == null) { const h = document.createElement('li'); h.className = 'cat'; h.textContent = c; listEl.appendChild(h); }
    for (const p of parts.filter(x => CT.catOf(x) === c)) {
      const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.dataset.part = p.id;
      const ic = document.createElement('img'); ic.className = 'ic'; ic.alt = ''; if (p.thumb) ic.src = p.thumb; else ic.hidden = true;
      const nm = document.createElement('span'); nm.className = 't'; nm.textContent = p.short || p.name;
      b.title = p.name; b.setAttribute('aria-label', 'Add ' + p.name + (MT.mountKind(p) === 'stud' ? ' on a stud' : ' on a surface'));
      b.append(ic, nm); li.appendChild(b); listEl.appendChild(li);
    }
  }
  listEl.scrollLeft = 0;
}
function setCat(c) { libCat = c; libPick = false; if (!libFit) catSave(c); buildLib(libFit, true); $('ctx').scrollLeft = 0; log('category ' + (c || 'All')); readout(); }
// tap: next category; hold (or right-click): the list of categories in the row
{
  const cb = $('libcat'); let timer = 0, held = false;
  const openPick = () => { held = true; libPick = true; buildLib(libFit, true); $('ctx').scrollLeft = 0; log('category list'); readout(); };
  cb.addEventListener('pointerdown', e => { if (e.button) return; held = false; clearTimeout(timer); timer = setTimeout(openPick, 500); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) cb.addEventListener(ev, () => clearTimeout(timer));
  cb.addEventListener('contextmenu', e => { e.preventDefault(); clearTimeout(timer); if (!held) openPick(); });
  cb.addEventListener('click', () => { if (held) { held = false; return; } setCat(CT.nextCat(CT.categoriesOf(libParts()), libCat)); });
}
function openLib(fit, title) {   // fit = [{ part, keys }] from MT.partsFitting: show only those parts
  if (!C) return;
  cancelAdd(); moreOpen = false; hideQuick(); if (tool !== 'select') setTool('select');
  libPick = false; buildLib(Array.isArray(fit) ? fit : null); $('libtitle').textContent = Array.isArray(fit) ? title || 'Fits here' : 'Add part';
  libEl.hidden = false; $('ctx').scrollLeft = 0; listEl.scrollLeft = 0; log('library open'); readout();
}
function closeLib() { if (libEl.hidden) return; libEl.hidden = true; log('library closed'); readout(); }
listEl.addEventListener('click', e => {
  const pk = e.target.closest('button[data-pick]'); if (pk) { setCat(pk.dataset.pick || null); return; }
  const b = e.target.closest('button[data-part]'); if (!b) return;
  const keys = libKeys && libKeys[b.dataset.part];
  startAdd(b.dataset.part);
  if (keys && adding && adding.kind === 'stud') { const k = keys.find(x => adding.outlets.some(o => o.key === x)); if (k) setTarget(k, true); }   // target-first: the highlighted outlet is the target
});
$('libclose').addEventListener('click', () => { if (libPick) { libPick = false; buildLib(libFit, true); readout(); } else closeLib(); });
libEl.addEventListener('beforexrselect', e => e.preventDefault());

function outletName(key) {
  const c = C.SC.connOf(state, key);
  return c && c.conn ? nameOfId(c.h.id) + ': ' + c.conn.id.replace('_', ' ') : key;
}
function clearOutletMarkers() { while (outletGroup.children.length) { const m = outletGroup.children[0]; outletGroup.remove(m); m.geometry.dispose(); m.material.dispose(); } }
function buildOutletMarkers() {
  clearOutletMarkers();
  for (const o of adding.outlets) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.014, 0.02, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x00e5ff, depthTest: false, transparent: true, side: THREE.DoubleSide }));
    m.position.fromArray(o.seat); m.renderOrder = 13; m.userData.key = o.key; outletGroup.add(m);
  }
}
// pulse every ring, the target one is larger and yellow
function refreshTargetMarkers() {
  if (!adding || adding.kind !== 'stud') return;
  const t = performance.now() / 1000;
  for (const m of outletGroup.children) {
    const on = m.userData.key === adding.target, k = 1 + 0.2 * Math.sin(t * 5 + (on ? 0 : 1.5));
    m.scale.setScalar((on ? 1.5 : 1) * k); m.material.color.set(on ? 0xffd400 : 0x00e5ff); m.material.opacity = on ? 1 : 0.55 + 0.35 * Math.sin(t * 5);
  }
}
function setTarget(key, lock) {
  if (!adding || !adding.outlets.some(o => o.key === key)) return;
  const changed = adding.target !== key;
  adding.target = key; adding.lock = lock && lastAim ? { origin: lastAim.origin.slice(), dir: lastAim.dir.slice() } : null;
  if (changed) { log('target ' + key); readout(); }
}
function aimTarget(ray) {   // AR / crosshair / mouse: the nearest compatible outlet to the aim ray (model frame, rigid so distances carry over)
  lastAim = ray;
  if (adding.lock) {
    const l = adding.lock, d = Math.hypot(...ray.dir), cos = (ray.dir[0] * l.dir[0] + ray.dir[1] * l.dir[1] + ray.dir[2] * l.dir[2]) / (d * Math.hypot(...l.dir));
    if (cos > 0.9995 && Math.hypot(ray.origin[0] - l.origin[0], ray.origin[1] - l.origin[1], ray.origin[2] - l.origin[2]) < 0.03) return;
    adding.lock = null;
  }
  modelHolder.updateWorldMatrix(true, false); _inv.copy(modelHolder.matrixWorld).invert();
  _lo.fromArray(ray.origin).applyMatrix4(_inv); _ld.fromArray(ray.dir).transformDirection(_inv);
  const sn = BM.snapHover(adding.outlets.map(o => ({ id: o.key, min: o.seat, max: o.seat })), _lo.toArray(), _ld.toArray(), 0.6);
  if (sn && sn.id !== adding.target) setTarget(sn.id, false);
}
function nearestOutletOnScreen(e, maxPx = 70) {
  const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
  let best = null, bd = maxPx;
  scene.updateMatrixWorld(true);
  for (const m of outletGroup.children) {
    m.getWorldPosition(v).project(camera);
    const d = Math.hypot(r.left + (v.x + 1) / 2 * r.width - e.clientX, r.top + (1 - v.y) / 2 * r.height - e.clientY);
    if (d < bd) { bd = d; best = m.userData.key; }
  }
  return best;
}
function startAdd(partId) {
  const p = C.partOf(partId); if (!p) return;
  cancelAdd(); cancelLink(); selectPart(null);
  if (MT.mountKind(p) === 'stud') {
    const all = C.SC.outlets(partId, C.SC.defOpts(p), state), ok = all.filter(o => o.ok);
    if (!ok.length) { toast(MT.noOutletMessage(p, all), true); return; }
    adding = { partId, kind: 'stud', outlets: ok.map(o => ({ key: o.key, seat: C.SC.seatOf(state, partId, o.key) })).filter(o => o.seat), target: null, lock: null };
    adding.target = adding.outlets[0].key; buildOutletMarkers();
    toast(adding.outlets.length + ' compatible ' + MT.threadShort(MT.needsOf(p).needs.thread) + ' stud' + (adding.outlets.length > 1 ? 's' : '') + ': aim or click a ring, then Place', false, 0);
  } else {
    adding = { partId, kind: 'surface', outlets: [], target: null, lock: null };
    toast(!session && !PREVIEW ? 'Click the floor to drop it' : 'Aim at a surface, then Place (or tap)', false, 0);
  }
  closeLib(); moreOpen = false; readout();
}
function cancelAdd() {
  if (!adding) return;
  adding = null; clearOutletMarkers(); toast(''); readout();
}
function finishAdd(r, where) {
  const nm = C.partOf(r.inst.part).short || r.inst.part;
  state = r.insts; adding = null; clearOutletMarkers();
  selectPart(r.inst.id); rebuild(); toast('Added ' + nm + ' ' + where);
}
function confirmAdd() {
  if (!adding) return;
  if (adding.kind === 'stud') {
    if (!adding.target) { toast('Aim at a ring first', true); return; }
    const key = adding.target, r = C.SC.addOnOutlet(state, adding.partId, key);
    if (!r.ok) { toast(r.why, true); return; }
    finishAdd(r, 'on ' + outletName(key));
  } else {
    if (!beamHit) { toast('Aim at a surface first', true); return; }
    const sd = MT.surfaceDrop(C.partOf(adding.partId), beamHit.src); if (!sd.ok) { toast(sd.why, true); return; }
    dropSurfaceAt(beamHit.point);
  }
}
function dropSurfaceAt(worldPoint) {
  const at = toModel(worldPoint).map(v => v / SCN.IN), r = C.SC.addAt(state, adding.partId, at);
  if (!r.ok) { toast(r.why, true); return; }
  finishAdd(r, 'on the surface');
}
function removeSelected() {
  const inst = selInst(); if (!inst) return;
  endMove();
  const r = C.SC.removeInst(state, inst.id);
  if (!r.ok) { toast(r.why, true); return; }
  const names = r.removed.map(nameOfId), extra = names.slice(1);
  state = r.insts; selectPart(null); rebuild();
  toast('Removed ' + names[0] + (extra.length ? ' and ' + extra.length + ' stacked: ' + extra.join(', ') : ''));
}
wire('addpart', () => { if (!libEl.hidden) closeLib(); else openLib(); }); wire('remove', removeSelected); wire('move', () => { const f = freeSel(); if (!f) return; if (!session) { toast('Drag the part to slide it on its surface'); return; } if (moving) endMove(); else startMove(f); }); wire('confirm', confirmAdd); wire('cancel', () => { cancelAdd(); cancelLink(); });
wire('next', () => {
  if (!adding || !adding.outlets.length) return;
  const i = adding.outlets.findIndex(o => o.key === adding.target);
  setTarget(adding.outlets[(i + 1) % adding.outlets.length].key, true);
});

// ---- highlight vs selection (#90): the context row acts on what the beam / mouse is on, else on the selected part ----
// Highlight = hoveredId (part) or the outlet whose seat is within OUTLET_NEAR_M of the aim ray. The target is latched for a moment
// (hold timing below) so a sweep does not flicker the row; the actions use the latched target and the point it was on.
const OUTLET_NEAR_M = 0.015, QUICK_HIDE_MS = { mouse: 450, xr: 1500 };
const fitCache = new Map();   // filter id -> [{ part, keys }]; cleared when the scene changes
let quickPend = { id: '', t: 0 }, lastRay = null, outletPts = null, quick = null, quickHideT = 0;
const libraryParts = () => C.catalog.parts.filter(p => p !== C.host);
const defOptsOf = p => C.SC.defOpts(p);
function fitFor(id, keyFilter) {
  if (!fitCache.has(id)) fitCache.set(id, MT.partsFitting(libraryParts(), state, C.partOf, keyFilter, defOptsOf));
  return fitCache.get(id);
}
function outletPoints() {   // seats of every stud outlet in the scene (model frame, metres), stacks included
  if (outletPts) return outletPts;
  outletPts = [];
  const probe = libraryParts().find(p => MT.mountKind(p) === 'stud');
  if (!probe) return outletPts;
  for (const i of state) for (const c of (C.partOf(i.part).connections || [])) {
    if (!c.accepts || (c.form || c.kind) !== 'stud' || !MT.connEnabled(c, i.opts)) continue;
    const key = i.id + '.' + c.id, pos = C.SC.seatOf(state, probe.id, key);
    if (pos) outletPts.push({ key, pos });
  }
  return outletPts;
}
function quickTargetNow() {
  if (!beamHit && !hoveredId) return null;
  if (lastRay && beamHit) {   // the aim ray passes within OUTLET_NEAR_M of an outlet seat that is not hidden behind the surface it hit
    modelHolder.updateWorldMatrix(true, false); _inv.copy(modelHolder.matrixWorld).invert();
    _lo.fromArray(lastRay.origin).applyMatrix4(_inv); _ld.fromArray(lastRay.dir).transformDirection(_inv);
    const open = outletPoints().filter(o => (o.pos[0] - _lo.x) * _ld.x + (o.pos[1] - _lo.y) * _ld.y + (o.pos[2] - _lo.z) * _ld.z <= beamHit.dist + 0.03);
    const sn = BM.snapHover(open.map(o => ({ id: o.key, min: o.pos, max: o.pos })), _lo.toArray(), _ld.toArray(), OUTLET_NEAR_M), key = sn && sn.id;
    const fit = key ? fitFor('o:' + key, k => k === key) : [];
    if (fit.length) return { kind: 'outlet', key, fit, point: beamHit.point, src: beamHit.src };
  }
  if (!hoveredId) return null;
  const fit = fitFor('h:' + hoveredId, k => k.startsWith(hoveredId + '.'));
  return { kind: 'part', id: hoveredId, fit, point: beamHit && beamHit.src === 'M' ? beamHit.point : null, src: beamHit ? beamHit.src : 'M' };
}
const quickId = t => t ? t.kind + ':' + (t.key || t.id) : '';
function hideQuick() { clearTimeout(quickHideT); quickHideT = 0; if (!quick) return; quick = null; readout(); }
function showQuick() { readout(); }
function updateQuick() {
  const blocked = !C || !session || tool !== 'select' || adding || !libEl.hidden || (session && mode !== 'placed');
  if (blocked) { if (quick) hideQuick(); return; }
  const now = quickTargetNow();
  if (now && quickId(now) === quickId(quick)) {   // same target: follow the point until the user reaches for the chip
    clearTimeout(quickHideT); quickHideT = 0;
    quick.point = now.point; quick.src = now.src; quick.fit = now.fit;
  } else if (now) {
    clearTimeout(quickHideT); quickHideT = 0;
    const id = quickId(now), t = performance.now();
    if (id !== quickPend.id) { quickPend = { id, t }; return; }   // a new target must stay highlighted briefly, so sweeping over parts does not flicker the chip
    if (t - quickPend.t < (session ? 120 : 220)) return;
    quick = now; showQuick();
  } else { quickPend = { id: '', t: 0 }; if (quick && !quickHideT) quickHideT = setTimeout(hideQuick, session ? QUICK_HIDE_MS.xr : QUICK_HIDE_MS.mouse); }
}
function selTarget() {   // outside XR: what the user selected, shaped like a quick target
  if (!C) return null;
  const pt = selPoint && selPoint.point, src = selPoint ? selPoint.src : 'M';
  if (selOutlet) return { kind: 'outlet', key: selOutlet, fit: fitFor('o:' + selOutlet, k => k === selOutlet), point: pt, src };
  if (selectedId) return { kind: 'part', id: selectedId, fit: fitFor('h:' + selectedId, k => k.startsWith(selectedId + '.')), free: MT.freeOutlets(instOf(selectedId), state, C.partOf), point: pt, src };
  return null;
}
function selectOutlet(key, pt) { selectPart(null); selOutlet = key; selPoint = pt || null; readout(); }
// marks are small: a click within ~1 cm of the dot (never under 14 px, 20 px on touch) picks it; measurements pick on their line
function markAtScreen(e, touch = false) {
  const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3(); let best = -1, bd = Infinity;
  scene.updateMatrixWorld(true);
  const toPx = p => { v.copy(p).project(camera); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
  marks.forEach((m, i) => {
    const [x, y] = toPx(m.pos), c = toPx(m.pos.clone().add(new THREE.Vector3(0.01, 0, 0))), cm = Math.hypot(c[0] - x, c[1] - y);
    const lim = Math.max(cm, touch ? 20 : 14), d = Math.hypot(x - e.clientX, y - e.clientY);
    if (d <= lim && d < bd) { bd = d; best = i; }
  });
  return best;
}
function measureAtScreen(e, touch = false) {
  const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3(); let best = -1, bd = touch ? 18 : 10;
  const toPx = a => { v.set(...a).project(camera); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
  measures.forEach((m, i) => {
    const [ax, ay] = toPx(m.a), [bx, by] = toPx(m.b), dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((e.clientX - ax) * dx + (e.clientY - ay) * dy) / L)) : 0, d = Math.hypot(ax + t * dx - e.clientX, ay + t * dy - e.clientY);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
function outletAtScreen(e, maxPx = 22) {   // the stud outlet whose seat is nearest to a click, within maxPx
  const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3(); let best = null, bd = maxPx;
  scene.updateMatrixWorld(true);
  for (const o of outletPoints()) {
    v.set(...o.pos); modelHolder.localToWorld(v); v.project(camera);
    const d = Math.hypot(r.left + (v.x + 1) / 2 * r.width - e.clientX, r.top + (1 - v.y) / 2 * r.height - e.clientY);
    if (d < bd) { bd = d; best = o.key; }
  }
  return best;
}
const quickDo = fn => () => { const t = session ? quick : selTarget(); if (!t) return; hideQuick(); fn(t); readout(); };
$('qselect').addEventListener('click', quickDo(t => { if (t.kind === 'part') selectPart(t.id); }));
$('qadd').addEventListener('click', quickDo(t => {
  if (t.kind !== 'part') return;
  if (!t.fit.length) { const f = t.free || [], th = [...new Set(f.map(o => o.thread).filter(Boolean))].join(', '); toast(f.length ? 'No library part fits the ' + f.length + ' free outlet' + (f.length > 1 ? 's' : '') + (th ? ' (' + th + ')' : '') + ' of ' + nameOfId(t.id) + ' yet' : 'Nothing fits ' + nameOfId(t.id), true); return; }
  openLib(t.fit, 'Fits ' + nameOfId(t.id));
}));
$('qhere').addEventListener('click', quickDo(t => { if (t.kind === 'outlet') openLib(t.fit, 'Fits ' + outletName(t.key)); }));
$('qmark').addEventListener('click', quickDo(t => { if (t.point) dropMarkAt(t.point, t.src); }));
$('qmeasure').addEventListener('click', quickDo(t => { if (!t.point) return; setTool('measure'); measureAt(t.point); }));

// ---- jumpers (#93, #109): straight cables between two stud outlets; Options (terminal presets) ----
const jumperGroup = new THREE.Group(), linkGroup = new THREE.Group(); inner.add(jumperGroup, linkGroup);   // model frame, like the outlet rings
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 20);
const linkTube = new THREE.Mesh(unitCyl, new THREE.MeshStandardMaterial({ color: 0xffd400, emissive: 0xffd400, emissiveIntensity: 0.5, transparent: true, opacity: 0.75 }));
linkTube.visible = false; linkTube.renderOrder = 12; linkGroup.add(linkTube);
const nutProbe = () => C.catalog.parts.find(p => p.kind === 'nut');
// ring centre of a jumper lug on an outlet: on top of whatever is stacked there (inches, model frame), or null when the outlet is gone
function jSeat(key) { const np = nutProbe(), m = np && C.SC.seatOf(state, np.id, key); return m ? m.map(v => v / SCN.IN) : null; }
function jumperLen(j) { const a = jSeat(j.a), b = jSeat(j.b); return a && b ? { ...JMP.lengthFor(j, a, b), a, b } : null; }
const LUG_T = 0.09, TIN = 0xc9ced6, CABLE_COL = { red: 0xc62828, black: 0x1c1c20 };
function cylBetween(p, q, r, mat) {
  const a = new THREE.Vector3(...p), d = new THREE.Vector3(...q).sub(a), len = d.length(), m = new THREE.Mesh(unitCyl, mat);
  if (len < 1e-6) { m.visible = false; return m; }
  m.scale.set(r, len, r); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m;
}
// one lug in inches: ring on the stud (flat), tongue, barrel; local +X points at the cable
function lugObject(seat, dir, end, gauge, mat) {
  const g = new THREE.Group(), R = end === '3/8' ? 0.375 : 0.325, hole = end === '3/8' ? 0.195 : 0.17, reach = JMP.LUG_REACH_IN[gauge], bl = 0.8, rb = JMP.OD_IN[gauge] / 2 + 0.07;
  const shape = new THREE.Shape(); shape.absarc(0, 0, R, 0, Math.PI * 2, false);
  const h = new THREE.Path(); h.absarc(0, 0, hole, 0, Math.PI * 2, true); shape.holes.push(h);
  const ring = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: LUG_T, bevelEnabled: false, curveSegments: 24 }).rotateX(-Math.PI / 2), mat);
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(reach - bl, LUG_T, R * 1.4), mat); tongue.position.set((reach - bl) / 2, LUG_T / 2, 0);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rb, rb, bl, 20).rotateZ(Math.PI / 2), mat); barrel.position.set(reach - bl / 2, LUG_T / 2, 0);
  g.add(ring, tongue, barrel); g.position.set(seat[0], seat[1], seat[2]); g.rotation.y = Math.atan2(-dir[1], dir[0]); return g;
}
function jumperObject(j, L) {
  const g = new THREE.Group(), cable = new THREE.MeshStandardMaterial({ color: CABLE_COL[j.color], roughness: 0.6 }), tin = new THREE.MeshStandardMaterial({ color: TIN, metalness: 0.8, roughness: 0.35 });
  const lift = p => [p[0], p[1] + LUG_T / 2, p[2]], hdir = (p, q) => { const x = q[0] - p[0], z = q[2] - p[2], n = Math.hypot(x, z); return n < 1e-9 ? [1, 0] : [x / n, z / n]; };
  g.add(lugObject(L.a, hdir(L.a, L.b), j.endA, j.gauge, tin), lugObject(L.b, hdir(L.b, L.a), j.endB, j.gauge, tin), cylBetween(lift(L.pa), lift(L.pb), JMP.OD_IN[j.gauge] / 2, cable));
  g.scale.setScalar(SCN.IN); g.userData.jumperId = j.id; g.traverse(m => { m.userData.jumperId = j.id; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}
function clearGroup(grp, keep) {
  for (const c of [...grp.children]) { if (c === keep) continue; grp.remove(c); c.traverse(m => { if (m.material) m.material.dispose(); if (m.geometry && m.geometry !== unitCyl) m.geometry.dispose(); }); }
}
function updateJumpers() {
  if (!C) return;
  const alive = jumpers.filter(j => jSeat(j.a) && jSeat(j.b));
  if (alive.length !== jumpers.length) { jumpers = alive; if (selJumper && !jumpers.some(j => j.id === selJumper)) selJumper = null; }
  clearGroup(jumperGroup);
  for (const j of jumpers) jumperGroup.add(jumperObject(j, jumperLen(j)));
  tintJumpers(); if (linking) buildLinkMarks();
}
function tintJumpers() {
  for (const g of jumperGroup.children) {
    const on = g.userData.jumperId === selJumper;
    g.traverse(m => { if (m.isMesh && m.material.emissive) { if (on) m.material.emissive.copy(accent); else m.material.emissive.set(0x000000); m.material.emissiveIntensity = on ? 0.6 : 0; } });
  }
}
function jumperHitRay(ray) {
  raycaster.set(new THREE.Vector3(...ray.origin), new THREE.Vector3(...ray.dir)); raycaster.far = 10;
  return raycaster.intersectObject(jumperGroup, true)[0] || null;
}
function selectJumper(id) {
  selectPart(null); selMark = -1; selMeasure = -1; selJumper = jumpers.some(j => j.id === id) ? id : null; tintJumpers(); readout();
}
function pushUndo() { jundo.push(jumpers.map(j => ({ ...j }))); if (jundo.length > 30) jundo.shift(); }
function jEdit(fn) { const j = jumpers.find(x => x.id === selJumper); if (!j) return; pushUndo(); fn(j); updateJumpers(); persistSoon(); }
wire('jgauge', () => jEdit(j => { j.gauge = JMP.nextOf(JMP.GAUGES, j.gauge); }));
wire('jcolor', () => jEdit(j => { j.color = JMP.nextOf(JMP.COLORS, j.color); }));
wire('jremove', () => { if (!selJumper) return; pushUndo(); jumpers = jumpers.filter(x => x.id !== selJumper); selJumper = null; updateJumpers(); persistSoon(); toast('Removed jumper'); });
wire('undoj', () => { const prev = jundo.pop(); if (!prev) return; jumpers = prev; selJumper = null; updateJumpers(); persistSoon(); toast('Undid the last jumper change'); });
// setting one end by hand: refused unless the lug matches the stud thread (the UI picks the matching end itself)
function jumperSetEnd(id, side, end) {
  const j = jumpers.find(x => x.id === id); if (!j) return { ok: false, why: 'no such jumper' };
  const c = C.SC.connOf(state, side === 'a' ? j.a : j.b), r = JMP.setEnd(j, side, end, c && c.conn && c.conn.accepts && c.conn.accepts.thread);
  if (!r.ok) { toast(r.why, true); return r; }
  pushUndo(); Object.assign(j, r.jumper); updateJumpers(); persistSoon(); readout(); return r;
}

// "Cable from here": candidate first ends (outlet keys) of the highlighted / selected thing
function jfromKeys(inXR, qk, tg) {
  if (!C || linking) return null;
  const cur = inXR ? (qk || (selectedId && { kind: 'part', id: selectedId })) : tg;
  if (!cur) return null;
  if (cur.kind === 'outlet') return [cur.key];
  return outletPoints().filter(o => o.key.startsWith(cur.id + '.')).map(o => o.key);
}
$('jfrom').addEventListener('click', () => {
  const inXR = document.body.classList.contains('inar'), keys = jfromKeys(inXR, inXR ? quick : null, inXR ? null : selTarget());
  if (keys && keys.length) startLink(keys);
});
const linkPts = () => linkGroup.children.filter(m => m.userData.key);
function buildLinkMarks() {
  clearGroup(linkGroup, linkTube);
  for (const o of outletPoints()) {
    const seat = jSeat(o.key), c = C.SC.connOf(state, o.key); if (!seat || !c || !c.conn) continue;
    const ok = !!JMP.endForThread(c.conn.accepts.thread);
    const m = new THREE.Mesh(new THREE.RingGeometry(0.014, 0.02, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ok ? 0x00e5ff : 0xff5252, depthTest: false, transparent: true, side: THREE.DoubleSide }));
    m.position.set(seat[0] * SCN.IN, seat[1] * SCN.IN + 0.002, seat[2] * SCN.IN); m.renderOrder = 13; m.userData.key = o.key; m.userData.ok = ok; linkGroup.add(m);
  }
}
function startLink(keys) {
  cancelAdd(); closeLib(); optOpen = false; moreOpen = false; selectPart(null);
  linking = { from: keys && keys.length === 1 ? keys[0] : null, target: null }; linkAim = null;
  buildLinkMarks(); linkPrompt(); readout();
}
function linkPrompt() { toast(linking.from ? (session ? 'Aim at the second stud, tap' : 'Click or tap the second stud. Esc cancels') : (session ? 'Aim at the first stud, tap' : 'Click or tap the first stud. Esc cancels'), false, 0); }
function endLink() { if (!linking) return; linking = null; linkAim = null; clearGroup(linkGroup, linkTube); linkTube.visible = false; toast(''); readout(); }
function cancelLink() { endLink(); }
function pickLink(key) {
  if (!linking) return;
  const c = C.SC.connOf(state, key); if (!c || !c.conn) return;
  if (!linking.from) {
    const ck = JMP.checkEnd(JMP.endForThread(c.conn.accepts.thread), c.conn.accepts.thread);
    if (!ck.ok) { toast(ck.why, true); return; }
    linking.from = key; linking.target = null; linkPrompt(); readout(); return;
  }
  if (jumpers.length >= 8) { toast('Max 8 jumpers', true); return; }
  const a = C.SC.connOf(state, linking.from), r = JMP.makeJumper(JMP.nextId(jumpers), linking.from, a.conn, key, c.conn);
  if (!r.ok) { toast(r.why, true); return; }
  pushUndo(); jumpers = [...jumpers, r.jumper]; endLink(); updateJumpers(); persistSoon(); selectJumper(r.jumper.id);
  const L = jumperLen(r.jumper); toast('Added jumper ' + (L ? MD.fmtLen(L.cut, units) : ''));
}
function linkAtScreen(x, y, maxPx = 30) {
  const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3(); let best = null, bd = maxPx;
  scene.updateMatrixWorld(true);
  for (const m of linkPts()) {
    m.getWorldPosition(v).project(camera);
    const d = Math.hypot(r.left + (v.x + 1) / 2 * r.width - x, r.top + (1 - v.y) / 2 * r.height - y);
    if (d < bd) { bd = d; best = m.userData.key; }
  }
  return best;
}
// every frame while linking: find the stud under the aim (XR beam, mouse, last touch), pulse the rings, draw the live straight preview
function updateLink() {
  if (!linking) return;
  const pts = linkPts(); if (!pts.length) return;
  const posOf = key => { const m = pts.find(p => p.userData.key === key); return m ? m.position.toArray() : null; };
  let key = null, pt = null;
  const fromP = linking.from ? posOf(linking.from) : null;
  if (session) {
    if (lastRay && mode === 'placed') {
      modelHolder.updateWorldMatrix(true, false); _inv.copy(modelHolder.matrixWorld).invert();
      _lo.fromArray(lastRay.origin).applyMatrix4(_inv); _ld.fromArray(lastRay.dir).transformDirection(_inv);
      const sn = BM.snapHover(pts.map(m => ({ id: m.userData.key, min: m.position.toArray(), max: m.position.toArray() })), _lo.toArray(), _ld.toArray(), 0.03);
      key = sn ? sn.id : null; pt = key ? posOf(key) : beamHit ? toModel(beamHit.point) : _lo.clone().addScaledVector(_ld, 0.3).toArray();
    }
  } else {
    const aim = !PREVIEW && ptr.in ? { x: ptr.cx, y: ptr.cy, touch: false } : linkAim;
    if (aim) {
      key = linkAtScreen(aim.x, aim.y, aim.touch ? 44 : 30);
      if (key) pt = posOf(key);
      else if (fromP) {
        const rc = renderer.domElement.getBoundingClientRect(), ray = pointerRayAt(new THREE.Vector2((aim.x - rc.left) / rc.width * 2 - 1, -((aim.y - rc.top) / rc.height) * 2 + 1));
        const wy = new THREE.Vector3(...toWorld(fromP)).y, hit = new THREE.Ray(new THREE.Vector3(...ray.origin), new THREE.Vector3(...ray.dir).normalize()).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -wy), new THREE.Vector3());
        if (hit) pt = toModel(hit.toArray());
      }
    }
  }
  linking.target = key;
  const t = performance.now() / 1000;
  for (const m of pts) {
    const hot = m.userData.key === linking.from || m.userData.key === key, k = 1 + 0.15 * Math.sin(t * 5);
    m.scale.setScalar((hot ? 1.5 : 1) * k);
    if (m.userData.ok) m.material.color.set(hot ? 0xffd400 : 0x00e5ff);
    m.material.opacity = hot ? 1 : 0.6;
  }
  if (fromP && pt) {
    const a = new THREE.Vector3(...fromP), d = new THREE.Vector3(...pt).sub(a), len = d.length();
    linkTube.visible = len > 1e-4;
    if (linkTube.visible) { const r = JMP.OD_IN[JMP.DEFAULT_GAUGE] / 2 * SCN.IN; linkTube.scale.set(r, len, r); linkTube.position.copy(a).addScaledVector(d, 0.5); linkTube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); }
  } else linkTube.visible = false;
}
addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (linking) cancelLink(); else if (optOpen) { optOpen = false; readout(); } });

// ---- Options: terminal presets on the battery (xr/presets.js). The battery keeps its pose; only what sits on it is swapped. ----
function updateHeights() {
  const host = state.find(i => i.part === C.host.id), y0 = host && host.at ? host.at[1] : 0, top = {};
  for (const r of roots()) top[r.userData.instanceId] = localBox(r).max.y / SCN.IN - y0;
  stackH = PR.stackHeights(C.SC, state, top);
}
function applyOption(id) {
  const sc = PR.applyPreset(C.SC, sceneNow(), id); if (!sc) return;
  cancelAdd(); cancelLink(); closeLib(); endMove(); hideQuick();
  pushUndo(); state = sc.insts; jumpers = sc.jumpers; selJumper = null; optLast = PR.byId(id).id; optOpen = false; stackH = { pos: null, neg: null };
  selectPart(null); rebuild(); toast('Option ' + optLast + ': ' + PR.byId(id).name);
}
function buildOptList() {
  const ul = $('optul'), cur = PR.presetOf(C.SC, state); ul.textContent = '';
  for (const p of PR.PRESETS) {
    const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.dataset.opt = p.id; b.title = p.name; b.setAttribute('aria-label', 'Option ' + p.id + ': ' + p.name);
    b.innerHTML = '<span class="t">' + p.id + ' ' + p.short + '</span>'; if (p.id === cur) b.classList.add('on'); li.appendChild(b); ul.appendChild(li);
  }
}
{
  const b = $('opt'); let timer = 0, held = false;
  const openList = () => { held = true; cancelLink(); optOpen = true; buildOptList(); $('ctx').scrollLeft = 0; log('options list'); readout(); };
  b.addEventListener('pointerdown', e => { if (e.button) return; held = false; clearTimeout(timer); timer = setTimeout(openList, 500); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(timer));
  b.addEventListener('contextmenu', e => { e.preventDefault(); clearTimeout(timer); if (!held) openList(); });
  b.addEventListener('click', () => { if (held) { held = false; return; } const cur = PR.presetOf(C.SC, state); applyOption(cur ? PR.nextId(cur) : optLast ? PR.nextId(optLast) : 'A'); });
  $('optul').addEventListener('click', e => { const o = e.target.closest('button[data-opt]'); if (o) applyOption(o.dataset.opt); });
  $('optback').addEventListener('click', () => { optOpen = false; readout(); });
}

// ---- placement ----
function place() {
  if (!reticle.visible) return;
  const pos = new THREE.Vector3();
  reticle.matrix.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
  const psi = XM.psiFacingUser(viewForward());
  baseMat.compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), psi), new THREE.Vector3(1, 1, 1));
  pivot.matrix.copy(baseMat); pivot.matrixWorldNeedsUpdate = true; pivot.visible = true;
  offs = { ...offs, x: 0, z: 0 }; applyOffsets();   // keep height/turn corrections, the surface is new
  setMode('placed'); setHint(null); reticle.visible = false;
  scene.updateMatrixWorld(true); restoreMarks();   // marks and measurements come back at the model's new pose
  anchor = null; anchorFix = null;
  const rs = renderer.xr.getReferenceSpace();
  const ok = a => { anchor = a; anchorFix = null; };
  if (lastHit && lastHit.createAnchor) lastHit.createAnchor().then(ok).catch(() => {});
  else if (lastFrame && lastFrame.createAnchor && rs) {
    try { lastFrame.createAnchor(new XRRigidTransform({ x: pos.x, y: pos.y, z: pos.z }), rs).then(ok).catch(() => {}); } catch (e) { /* no anchors */ }
  }
}

// ---- aiming: a ray from the viewer pose centre (in a session) or the preview camera centre, against the part roots ----
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
function viewerRay(frame) {
  const rs = renderer.xr.getReferenceSpace(), vp = frame && rs && frame.getViewerPose(rs);
  if (vp) return PK.rayFromPose(vp.transform.position, vp.transform.orientation);
  camera.getWorldPosition(_o); camera.getWorldDirection(_d);
  return { origin: _o.toArray(), dir: _d.toArray(), up: [0, 1, 0] };
}
function pickRay(ray) {
  raycaster.set(new THREE.Vector3(...ray.origin), new THREE.Vector3(...ray.dir)); raycaster.far = 10;
  return PK.pickFromHits(raycaster.intersectObjects(roots(), true));
}
// ---- one beam: nearest of model raycast (M), hit-test point/plane (P/L) and CPU depth (D) ----
let depthOK = false, depthLogged = false, lastSrc = '';
const BEAM_COLOR = { M: '#1affb0', P: '#ffd400', L: '#4aa8ff', D: '#ff6bd6', G: '#c8ccd2' };
const dotTex = {};
function dotTexture(src) {
  if (dotTex[src]) return dotTex[src];
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = BEAM_COLOR[src]; g.beginPath(); g.arc(32, 32, 30, 0, 7); g.fill(); g.lineWidth = 4; g.strokeStyle = '#000'; g.stroke();
  g.fillStyle = '#000'; g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(src, 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return (dotTex[src] = t);
}
const dot = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
dot.visible = false; dot.renderOrder = 12; scene.add(dot);

const _lo = new THREE.Vector3(), _ld = new THREE.Vector3(), _inv = new THREE.Matrix4();
function snapId(ray) {   // crosshair ray within SNAP_M of a part's box (boxes live in the modelHolder frame, rigid so distances carry over)
  modelHolder.updateWorldMatrix(true, false); _inv.copy(modelHolder.matrixWorld).invert();
  _lo.fromArray(ray.origin).applyMatrix4(_inv); _ld.fromArray(ray.dir).transformDirection(_inv);
  const items = [];
  for (const r of roots()) { const b = localBox(r); items.push({ id: r.userData.instanceId, min: b.min.toArray(), max: b.max.toArray() }); }
  const s = BM.snapHover(items, _lo.toArray(), _ld.toArray(), BM.SNAP_M);
  return s ? s.id : null;
}
function hitTestCand(frame, rs, ray) {
  if (!hitSource || !frame) return null;
  const hits = frame.getHitTestResults(hitSource); if (!hits.length) return null;
  const pose = hits[0].getPose(rs); if (!pose) return null;
  const m = pose.transform.matrix, pt = [m[12], m[13], m[14]];
  return { src: BM.classifyHit([m[4], m[5], m[6]]), dist: Math.hypot(pt[0] - ray.origin[0], pt[1] - ray.origin[1], pt[2] - ray.origin[2]), point: pt };
}
function depthCand(frame, vp, ray) {
  if (!depthOK || !frame || !vp || !vp.views.length) return null;
  try {
    const di = frame.getDepthInformation(vp.views[0]); if (!di) return null;
    const d = di.getDepthInMeters(0.5, 0.5), pt = BM.depthToWorld(ray.origin, ray.dir, d);
    if (!depthLogged && pt) { depthLogged = true; log('depth first reading ' + d.toFixed(2) + ' m'); }
    return pt ? { src: 'D', dist: d, point: pt } : null;
  } catch (e) { depthOK = false; log('depth read failed, off: ' + (e && e.message || e)); toast('Depth reading failed, depth is off', true); return null; }
}
// mouse pointer over the canvas (plain preview editor): the aim ray comes from the cursor instead of the screen centre
const ptr = { in: false, ndc: new THREE.Vector2() };
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function pointerRayAt(ndc) { raycaster.setFromCamera(ndc, camera); return { origin: raycaster.ray.origin.toArray(), dir: raycaster.ray.direction.toArray(), up: [0, 1, 0] }; }
function groundCand(ray) {   // preview only, while adding a surface part: the floor under the model
  const hit = new THREE.Ray(new THREE.Vector3(...ray.origin), new THREE.Vector3(...ray.dir).normalize()).intersectPlane(groundPlane, new THREE.Vector3());
  return hit ? { src: 'G', dist: hit.distanceTo(new THREE.Vector3(...ray.origin)), point: hit.toArray() } : null;
}
function updateHover(frame) {
  let modelHit = null, ray = null, rs = null, vp = null;
  const live = mode === 'placed' || !session, mouse = !session && !PREVIEW;
  if (mouse && !ptr.in) { refreshTargetMarkers(); return; }   // cursor left the canvas (maybe onto the quick chip): keep the last hover, target and chip
  //   // cursor left the canvas: keep the last hover and target
  if (live && roots().length) {
    scene.updateMatrixWorld(true);
    rs = renderer.xr.getReferenceSpace(); vp = frame && rs ? frame.getViewerPose(rs) : null;
    ray = mouse ? pointerRayAt(ptr.ndc) : vp ? PK.rayFromPose(vp.transform.position, vp.transform.orientation) : viewerRay(null);
    modelHit = pickRay(ray);
  }
  lastRay = live ? ray : null;
  let id = modelHit ? modelHit.instanceId : null;
  if (!id && ray) id = snapId(ray);
  if (id !== hoveredId) { hoveredId = id; log('hover ' + (id || 'none')); applyTints(); readout(); }
  const cands = [];
  if (modelHit) cands.push({ src: 'M', dist: modelHit.distance, point: modelHit.point.toArray() });
  if (ray && session && frame) { cands.push(hitTestCand(frame, rs, ray)); cands.push(depthCand(frame, vp, ray)); }
  if (ray && !session && adding && adding.kind === 'surface') cands.push(groundCand(ray));
  beamHit = ray && live ? BM.nearestHit(cands) : null;
  const srcNow = beamHit ? beamHit.src : '';
  if (srcNow !== lastSrc) { lastSrc = srcNow; log('beam source ' + (srcNow || 'none')); }
  const hv = ray && live && marks.length ? MD.hoverMark(marks.map(m => m.pos.toArray()), ray.origin, ray.dir, MD.MARK_HOVER_M, beamHit ? beamHit.dist + 0.03 : 10) : -1;
  if (hv !== hovMark) { hovMark = hv; refreshMarks(); }
  if (moving) { const mi = instOf(moving.id); if (!mi) endMove(); else if (ray && session) slideTo(mi, ray); }
  if (ray && adding && adding.kind === 'stud') aimTarget(ray);
  beam.visible = !!beamHit && !mouse; dot.visible = !!beamHit;
  if (beamHit) {
    const a = PK.beamStart(ray), p = beamGeo.attributes.position, h = beamHit.point;
    p.setXYZ(0, ...a); p.setXYZ(1, h[0], h[1], h[2]); p.needsUpdate = true;
    beam.material.color.set(BEAM_COLOR[beamHit.src]);
    dot.material.map = dotTexture(beamHit.src); dot.material.needsUpdate = true;
    dot.position.set(h[0], h[1], h[2]); const sc = Math.min(Math.max(beamHit.dist * 0.04, 0.012), 0.1); dot.scale.set(sc, sc, 1);
  }
  refreshTargetMarkers();
  updateQuick();
}
function updateCross() {
  const on = mode === 'placed' || PREVIEW;
  $('cross').hidden = !on;
  if (on && PREVIEW) { const r = $('stage').getBoundingClientRect(); $('cross').style.left = (r.left + r.width / 2) + 'px'; $('cross').style.top = (r.top + r.height / 2) + 'px'; }
}
// tap ray from the input source (screen tap) in a session
function tapPick(ev) {
  const rs = renderer.xr.getReferenceSpace(), pose = ev.frame && rs && ev.frame.getPose(ev.inputSource.targetRaySpace, rs);
  if (!pose) { log('tap: no target ray pose'); return; }
  scene.updateMatrixWorld(true);
  const ray = PK.rayFromPose(pose.transform.position, pose.transform.orientation), hit = pickRay(ray), jh = jumperHitRay(ray);
  if (jh && (!hit || jh.distance < hit.distance)) { selectJumper(jh.object.userData.jumperId); return; }
  selectPart(hit ? hit.instanceId : null);
}

function onFrame(time, frame) {
  lastFrame = frame;
  if (!frame) { pivot.matrixWorldNeedsUpdate = true; controls.update(); updateHover(null); updateLink(); renderer.render(scene, camera); return; }
  const rs = renderer.xr.getReferenceSpace();
  pivot.matrixWorldNeedsUpdate = true;
  if (mode === 'reticle' && hitSource) {
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length !== hitCount) { hitCount = hits.length; log('hit-test hits ' + hitCount); }
    if (hits.length) { lastHit = hits[0]; reticle.visible = true; reticle.matrix.fromArray(hits[0].getPose(rs).transform.matrix); }
    else { reticle.visible = false; lastHit = null; }
  }
  if (mode === 'placed' && anchor && frame.trackedAnchors && frame.trackedAnchors.has(anchor)) {
    const p = frame.getPose(anchor.anchorSpace, rs);
    if (p) {
      const A = new THREE.Matrix4().fromArray(p.transform.matrix);
      if (!anchorFix) anchorFix = A.clone().invert().multiply(baseMat);   // anchor-local -> our base pose, fixed at placement
      pivot.matrix.copy(A).multiply(anchorFix); pivot.matrixWorldNeedsUpdate = true;
    }
  }
  updateHover(frame); updateLink();
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(onFrame);

// ---- session ----
async function enterAR() {
  try {
    // three 0.170 calls the GPU depth reader whenever 'depth-sensing' is enabled, whatever usage was granted,
    // and that throws every frame in cpu-optimized mode. So depth is opt-in for experiments: ?depth=1.
    const wantDepth = new URLSearchParams(location.search).get('depth') === '1';
    const opts = { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'anchors', 'local-floor', 'light-estimation'], domOverlay: { root: overlay } };
    if (wantDepth) {
      opts.optionalFeatures.push('depth-sensing');
      opts.depthSensing = { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] };
    }
    let s;
    try { s = await navigator.xr.requestSession('immersive-ar', opts); }
    catch (e) {   // a browser that rejects the depth config: retry without it
      log('session with depth-sensing rejected (' + (e && e.message || e) + '), retrying without');
      delete opts.depthSensing; opts.optionalFeatures = opts.optionalFeatures.filter(f => f !== 'depth-sensing');
      s = await navigator.xr.requestSession('immersive-ar', opts);
    }
    if ((s.enabledFeatures || []).includes('depth-sensing') && s.depthUsage !== 'cpu-optimized') {   // three would take its GPU depth path and throw every frame
      log('depth usage ' + s.depthUsage + ' is not cpu-optimized, restarting without depth-sensing');
      try { await s.end(); } catch (e) { /* already ended */ }
      delete opts.depthSensing; opts.optionalFeatures = opts.optionalFeatures.filter(f => f !== 'depth-sensing');
      s = await navigator.xr.requestSession('immersive-ar', opts);
    }
    renderer.xr.setReferenceSpaceType((s.enabledFeatures || []).includes('local-floor') ? 'local-floor' : 'local');
    try {   // sharpness: render at the device's native resolution, capped for speed
      const nat = window.XRWebGLLayer && XRWebGLLayer.getNativeFramebufferScaleFactor ? XRWebGLLayer.getNativeFramebufferScaleFactor(s) : 1;
      renderer.xr.setFramebufferScaleFactor(Math.min(Math.max(nat, 1), 2));
    } catch (e) { /* keep default */ }
    await renderer.xr.setSession(s);
    session = s;
    document.body.classList.add('inar'); grid.visible = false; pivot.visible = false; controls.enabled = false;
    cancelAdd(); closeLib(); suspendMarks(); setMode('reticle'); setHint('Move the phone to find the floor, tap to place'); selectPart(null);
    log('session started, features: ' + (s.enabledFeatures || []).join(','));
    depthOK = (s.enabledFeatures || []).includes('depth-sensing') && s.depthUsage === 'cpu-optimized'; depthLogged = false;
    log(depthOK ? 'depth sensing: cpu, format ' + s.depthDataFormat : 'depth sensing not available (' + ((s.enabledFeatures || []).includes('depth-sensing') ? 'usage ' + s.depthUsage : 'feature not granted') + '), skipped');
    s.addEventListener('select', ev => {
      if (mode === 'reticle') place();
      else if (mode === 'placed') onSceneTap(ev);
    });
    s.addEventListener('end', () => {
      endMove(); session = null; hitSource = null; anchor = null; lastHit = null; setMode('preview'); selectPart(null); beam.visible = dot.visible = false; beamHit = null; depthOK = false; moreOpen = false; cancelAdd(); closeLib(); removeMarkObjs(); removeMeasureObjs(); reticle.visible = false;
      document.body.classList.remove('inar'); grid.visible = true; pivot.visible = true; controls.enabled = true;
      pivot.matrix.identity(); pivot.matrixWorldNeedsUpdate = true; scene.updateMatrixWorld(true); restoreMarks(); setHint(null); log('session ended'); scene.environment = roomEnv; scene.remove(xrLight); fit();
    });
    const viewer = await s.requestReferenceSpace('viewer');
    try { hitSource = await s.requestHitTestSource({ space: viewer, entityTypes: ['point', 'plane'] }); log('hit-test source: point+plane'); }
    catch (e) { log('hit-test entityTypes rejected (' + (e && e.message || e) + '), default'); hitSource = await s.requestHitTestSource({ space: viewer }); }
  } catch (e) { toast('Could not start AR: ' + (e && e.message || e), true, 0, 'error'); }
}
enterBtn.addEventListener('click', enterAR);

function fit() {
  if (renderer.xr.isPresenting) return;
  const w = $('stage').clientWidth, h = $('stage').clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  syncCtlH();
}
// both rows are fixed to the viewport bottom; outside XR the page leaves exactly their height free
function syncCtlH() { document.documentElement.style.setProperty('--ctlh', (document.body.classList.contains('inar') ? 0 : ctl.offsetHeight) + 'px'); }
addEventListener('resize', fit);
if (window.ResizeObserver) { new ResizeObserver(fit).observe($('stage')); new ResizeObserver(syncCtlH).observe(ctl); }
function frameModel() {   // preview camera: whole model in view, 3/4 angle
  const b = new THREE.Box3().setFromObject(modelHolder), c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2;
  const fov = Math.min(camera.fov, 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect) * 180 / Math.PI);
  const d = (r / Math.sin(fov * Math.PI / 360)) * 1.05;
  controls.target.copy(c); camera.position.copy(c).add(new THREE.Vector3(0.3, 0.3, 1).normalize().multiplyScalar(d)); controls.update();
}

// ---- non-AR editor: click / tap select (normal raycast from the preview camera), mouse hover ----
{
  let down = null;
  const cv = renderer.domElement;
  const ndcOf = e => { const r = cv.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
  cv.addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; ptr.in = true; ptr.cx = e.clientX; ptr.cy = e.clientY; ptr.ndc.copy(ndcOf(e)); });
  cv.addEventListener('pointerleave', () => { ptr.in = false; if (hoveredId) { hoveredId = null; applyTints(); readout(); } });
  // dragging the selected surface part slides it on its mount plane; orbit stays off for the drag (mouse and touch)
  const dragRay = e => pointerRayAt(ndcOf(e));
  cv.addEventListener('pointerdown', e => {
    if (session || !C || adding || tool !== 'select' || dragMove || (e.pointerType === 'mouse' && e.button)) return;
    const f = freeSel(); if (!f) return;
    scene.updateMatrixWorld(true); raycaster.setFromCamera(ndcOf(e), camera); raycaster.far = 10;
    const h = PK.pickFromHits(raycaster.intersectObjects(roots(), true)); if (!h || h.instanceId !== f.id) return;
    const ray = dragRay(e); modelHolder.updateWorldMatrix(true, false); _inv.copy(modelHolder.matrixWorld).invert();
    _lo.fromArray(ray.origin).applyMatrix4(_inv); _ld.fromArray(ray.dir).transformDirection(_inv);
    const fa = atOf(f), p0 = XM.rayPlaneY(_lo.toArray(), _ld.toArray(), fa[1] * SCN.IN); if (!p0) return;
    dragMove = { id: f.id, grab: [fa[0] * SCN.IN - p0[0], fa[2] * SCN.IN - p0[2]], pointerId: e.pointerId };
    controls.enabled = false; e.stopImmediatePropagation(); try { cv.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
    log('move drag start ' + f.id);
  }, true);
  cv.addEventListener('pointermove', e => { if (dragMove && e.pointerId === dragMove.pointerId) { slideTo(instOf(dragMove.id), dragRay(e), dragMove.grab); e.preventDefault(); } });
  const endDrag = e => { if (!dragMove || e.pointerId !== dragMove.pointerId) return; dragMove = null; controls.enabled = !session; flushMove(); persist(); log('move drag end'); };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('pointerdown', e => {   // pick now: OrbitControls turns even a 2 px jitter into a small camera move, so the pointerup ray would miss a thin part
    let h = null; if (!session && C) { scene.updateMatrixWorld(true); raycaster.setFromCamera(ndcOf(e), camera); raycaster.far = 10; h = PK.pickFromHits(raycaster.intersectObjects(roots(), true)); }
    down = { x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY, t: performance.now(), hit: h };
  });
  cv.addEventListener('pointercancel', () => { down = null; });
  cv.addEventListener('pointermove', e => { if (linking && e.pointerType !== 'mouse') linkAim = { x: e.clientX, y: e.clientY, touch: true }; });
  cv.addEventListener('pointerdown', e => { if (linking && e.pointerType !== 'mouse') linkAim = { x: e.clientX, y: e.clientY, touch: true }; });
  cv.addEventListener('pointerup', ev => {
    let e = ev;
    if (session || !down || !C) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t, dn = down; down = null;
    e = dn;   // pick where the press landed, not where jitter let go
    if (!PK.isClick(moved, dt, ev.pointerType)) return;   // a drag is orbiting
    const ndc = ndcOf(e);
    const hit = e.hit;
    if (linking) { const k = linkAtScreen(e.clientX, e.clientY, ev.pointerType === 'touch' ? 44 : 30); if (k) pickLink(k); else toast('Click a ring on a stud'); return; }
    if (adding) {
      if (adding.kind === 'stud') { const k = nearestOutletOnScreen(e); if (k) setTarget(k, true); else toast('Click one of the pulsing rings'); }
      else {
        if (hit) { toast(MT.SURFACE_REFUSAL, true); return; }   // surface parts mount on the floor or a wall, never on a part
        const g = groundCand(pointerRayAt(ndc));
        const pt = g && g.point; if (pt) dropSurfaceAt(pt); else toast('Click on the floor', true);
      }
      return;
    }
    const touch = ev.pointerType === 'touch', mk = markAtScreen(e, touch), ms = mk < 0 ? measureAtScreen(e, touch) : -1;
    if (mk >= 0 && tool !== 'measure') { selectPart(null); selectMark(mk); return; }
    if (ms >= 0 && tool !== 'mark') { selectPart(null); selectMark(-1); selectMeasure(ms); return; }
    if (tool === 'select' && mk < 0 && ms < 0) {   // a jumper in front of (or without) a part
      raycaster.setFromCamera(ndc, camera); raycaster.far = 10; const jh = raycaster.intersectObject(jumperGroup, true)[0];
      if (jh && (!hit || jh.distance < hit.distance)) { selectJumper(jh.object.userData.jumperId); return; }
    }
    if (tool === 'mark') { selectMark(-1); if (hit) dropMarkAt(hit.point.toArray(), 'M'); return; }
    if (tool === 'measure') { if (hit) measureAt(hit.point.toArray()); return; }
    selectMark(-1); selectMeasure(-1);
    const ok = hit ? null : outletAtScreen(e, 22);   // outside XR a click on a part selects the part (a lug sits right on its stud's seat); only a click off the model can select an outlet seat
    if (ok) selectOutlet(ok, hit ? { point: hit.point.toArray(), src: 'M' } : null);
    else selectPart(hit ? hit.instanceId : null, hit ? { point: hit.point.toArray(), src: 'M' } : null);
    if (!PREVIEW) status.textContent = hit ? 'Selected: ' + nameOfId(hit.instanceId) + '. Click empty space to clear.' : 'Drag to orbit. Click a part to select it.';
  });
}
// test / debug hooks
window.__ar = { slideTo: (id, ray) => { const r = slideTo(instOf(id), ray); flushMove(); return r; }, startMove: id => startMove(instOf(id)), endMove, moving: () => !!moving, pickAt(cx, cy) { const r = renderer.domElement.getBoundingClientRect(); scene.updateMatrixWorld(true); raycaster.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera); raycaster.far = 10; const h = PK.pickFromHits(raycaster.intersectObjects(roots(), true)); return h && h.instanceId; }, partIds: () => roots().map(o => o.userData.instanceId), canvasRect: () => { const r = renderer.domElement.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; }, outletScreen(key) { const o = outletPoints().find(x => x.key === key); if (!o) return null; const v = modelHolder.localToWorld(new THREE.Vector3(...o.pos)).project(camera), rc = renderer.domElement.getBoundingClientRect(); return { x: rc.left + (v.x + 1) / 2 * rc.width, y: rc.top + (1 - v.y) / 2 * rc.height }; }, quick: () => quick && { kind: quick.kind, id: quick.id, key: quick.key, fit: quick.fit.map(x => x.part.id), shown: true }, look(dx, dy, dz) { const t = controls.target; camera.position.set(t.x + dx, t.y + dy, t.z + dz); controls.update(); }, target(x, y, z) { controls.target.set(x, y, z); controls.update(); }, hash: persist, startAdd, confirmAdd, cancelAdd, removeSelected, openLib, setTarget, adding: () => adding && { partId: adding.partId, kind: adding.kind, target: adding.target, outlets: adding.outlets.map(o => o.key) }, toast: () => [...toastEl.querySelectorAll('.tx')].map(e => e.textContent).join(' | '), persist, setTool, tool: () => tool, units: () => units, marks: () => marks.length, measures: () => measures.length, dropAt: dropMarkAt, measureAt, selectMark, select: selectPart, selected: () => selectedId, hovered: () => hoveredId, state: () => JSON.parse(JSON.stringify(state)),
  screenOf(id) { const r = roots().find(o => o.userData.instanceId === id); if (!r) return null; const b = new THREE.Box3().setFromObject(r), c = b.getCenter(new THREE.Vector3()).project(camera), rc = renderer.domElement.getBoundingClientRect();
    return { x: rc.left + (c.x + 1) / 2 * rc.width, y: rc.top + (1 - c.y) / 2 * rc.height }; },
  aimAt(id) { const r = roots().find(o => o.userData.instanceId === id); const c = new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()); controls.target.copy(c); controls.update(); } };

Object.assign(window.__ar, { jumper: { start: keys => startLink(keys), pick: pickLink, list: () => JSON.parse(JSON.stringify(jumpers)), sel: () => selJumper, select: selectJumper, linking: () => !!linking, cancel: cancelLink, setEnd: jumperSetEnd, len: id => { const j = jumpers.find(x => x.id === id); return j && jumperLen(j); }, undo: () => $('undoj').click(), markScreen: key => { const m = linkPts().find(p => p.userData.key === key); if (!m) return null; const v = m.getWorldPosition(new THREE.Vector3()).project(camera), rc = renderer.domElement.getBoundingClientRect(); return { x: rc.left + (v.x + 1) / 2 * rc.width, y: rc.top + (1 - v.y) / 2 * rc.height }; } }, option: applyOption, heights: () => stackH });

// ---- start ----
(async function init() {
  if (q.has('help')) $('help').hidden = false;
  if (PREVIEW) {
    document.body.classList.add('arpreview');
  }
  fit();
  try { C = await createComposer('parts/catalog.json'); }
  catch (e) { status.textContent = 'Could not load parts'; toast('Could not load parts: ' + e.message, true, 0, 'error'); return; }
  initialHash = location.hash.slice(1);
  const sc0 = C.SC.fromHash(initialHash);
  let sc = sc0; const oq = new URLSearchParams(initialHash).get('opt');
  if (oq && PR.byId(oq)) { sc = PR.applyPreset(C.SC, sc0, oq); optLast = PR.byId(oq).id; }   // #opt=A..F
  state = sc.insts; offs = sc.offs; storedMarks = sc.marks; storedMeasures = sc.measures; jumpers = sc.jumpers || [];
  applyOffsets(); await rebuild();
  fit(); frameModel(); updateCross(); restoreMarks();
  if (q.get('sel')) selectPart(q.get('sel'));
  status.textContent = 'Drag to orbit. Real size (inches to metres).';
  const sup = navigator.xr && navigator.xr.isSessionSupported ? await navigator.xr.isSessionSupported('immersive-ar').catch(() => false) : false;
  if (sup) enterBtn.hidden = false;
  else {
    toast(!window.isSecureContext ? 'AR needs HTTPS. Open this page over https (localhost works with port forwarding).'
      : 'AR is not available here: immersive-ar WebXR is not supported. Use Android Chrome with ARCore.', true);
  }
  readout();
  if (q.get('addpart')) { startAdd(q.get('addpart')); if (q.get('target')) setTarget(q.get('target'), true); }   // screenshots
  else if (q.get('open') === 'lib') openLib();
  else if (q.get('open')) { if (q.get('open') === 'more') moreOpen = true; readout(); }
  window.__ready = true;
  // warm the GLB cache for options A-F while idle (before Enter AR), so switching in AR is instant
  const warm = () => { const ids = PR.PRESETS.flatMap(p => C.SC.fromHash(p.hash).insts.map(i => i.part)); C.preload(ids).then(r => { const n = r.filter(x => x.status === 'rejected').length; log('preload done' + (n ? ', ' + n + ' failed' : '')); }); };
  if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 3000 }); else setTimeout(warm, 500);
})();
