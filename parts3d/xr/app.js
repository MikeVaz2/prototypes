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

const q = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const overlay = $('overlay'), ctl = $('ctl'), stack = $('stack'), fab = $('fab'), status = $('status'), enterBtn = $('enter'), msg = $('msg'), hint = $('hint');
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
const outline = new THREE.Box3Helper(new THREE.Box3(), 0xffd400);
outline.material.depthTest = false; outline.renderOrder = 8; outline.visible = false; inner.add(outline);

// ---- tools (select | mark | measure), marks and measurements: world-fixed (not children of pivot) ----
let tool = MD.normTool(q.get('tool'));
const marks = [];      // { group, ball, sprite, pos: Vector3, src, text }
const measures = [];   // { group, sprite, a: [x,y,z], b: [x,y,z], text }
let pendingA = null;   // { pos: [x,y,z], ball } first point of a measurement
let selMark = -1, hovMark = -1, beamHit = null;   // beamHit = { src, dist, point:[x,y,z] } nearest surface under the crosshair
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
  for (const ms of measures) setLabel(ms, MD.fmtLen(XM.distIn(ms.a, ms.b), units));
  $('marks').textContent = markMsg || [toolPrompt(), ...lines].filter(Boolean).join('  |  ');
}
function selectMark(i) { selMark = i >= 0 && i < marks.length ? i : -1; refreshMarks(); }
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
function undoMark() {
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
function undoMeasure() { if (pendingA) { cancelPending(); return; } const m = measures.pop(); if (m) disposeObj(m.group); refreshMarks(); persistSoon(); }
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
  return { insts: state, offs, marks: storedMarks, measures: storedMeasures };
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
  if (adding) { confirmAdd(); return; }
  if (tool === 'mark') { if (hovMark >= 0) selectMark(hovMark); else dropMark(); }
  else if (tool === 'measure') measureHit();
  else if (hovMark >= 0) { selectPart(null); selectMark(hovMark); }
  else { selectMark(-1); tapPick(ev); }
}

// ---- units: chosen on the page before AR, kept in localStorage, ?units=mm|in wins ----
let units = MD.normUnits(q.get('units'), '');
if (!units) { try { units = MD.normUnits(localStorage.getItem(MD.UNIT_KEY)); } catch (e) { units = 'in'; } }
function syncUnitButtons() { for (const b of document.querySelectorAll('#units button')) b.setAttribute('aria-pressed', b.dataset.u === units); }
function setUnits(u) {
  units = MD.normUnits(u); syncUnitButtons();
  try { localStorage.setItem(MD.UNIT_KEY, units); } catch (e) { /* storage blocked */ }
  readout();
}
$('units').addEventListener('click', e => { const b = e.target.closest('button[data-u]'); if (b) setUnits(b.dataset.u); });
syncUnitButtons();

// ---- app state ----
let moreOpen = false;
let adding = null;   // Add part in progress: { partId, kind: 'stud'|'surface', outlets: [{ key, seat: [x,y,z] model frame m }], target: key|null, lock: ray|null }
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
const nameOfId = id => { const i = instOf(id), p = i && C.partOf(i.part), k = kindOfId(id); return !p ? '' : (k === 'fuse' || k === 'bar' || k === 'cable') ? (p.short || p.name) : PK.labelOf(p.id, k); };
const numKey = p => Object.keys(p.options || {}).find(k => p.options[k].type === 'number');
const choiceKey = p => Object.keys(p.options || {}).find(k => p.options[k].type === 'choice');

async function rebuild() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    const root = await C.build(state);
    modelHolder.clear(); modelHolder.add(root);
    hoveredId = null; applyTints(); refreshOutline(); readout(); persistSoon();
  } finally { busy = false; if (again) { again = false; rebuild(); } }
}
const roots = () => (modelHolder.children[0]?.children || []).filter(o => o.userData.instanceId);

// ---- selection: tint (emissive on per-instance materials) + outline ----
function setTint(root, want) {
  root.userData.tint = want;
  root.traverse(c => {
    if (!c.isMesh) return;
    for (const m of Array.isArray(c.material) ? c.material : [c.material]) {
      if (!m.emissive) continue;
      if (!m.userData.e0) m.userData.e0 = { c: m.emissive.clone(), i: m.emissiveIntensity };
      if (want === 'selected') { m.emissive.set(0xffa000); m.emissiveIntensity = 0.55; }
      else if (want === 'hover') { m.emissive.set(0x1a50ff); m.emissiveIntensity = 0.4; }
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
  outline.visible = !!r;
  if (r) outline.box.copy(localBox(r)).expandByScalar(0.002);
}
function selectPart(id) {
  id = id && instOf(id) ? id : null;
  if (id !== selectedId) log('selected ' + (id || 'none'));
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
  if (inst) {
    const nk = numKey(p), ck = choiceKey(p);
    t = nameOfId(inst.id) + (nk ? ' ' + MD.fmtLen(inst.opts[nk], units) : '') + (ck ? ' ' + p.options[ck].values[inst.opts[ck]].label : '') + (kind !== 'battery' && kind !== 'nut' ? ' ' + inst.yaw + '°' : '');
  } else if (hoveredId) t = 'Aim: ' + nameOfId(hoveredId);
  if (adding) t = 'Add ' + (C.partOf(adding.partId).short || adding.partId) + (adding.kind === 'stud' ? ': ' + (adding.target ? outletName(adding.target) : 'no target') : ': aim at a surface');
  $('sel').textContent = t;
  // single button: name of the selection; stack: contextual actions or the More panel
  fab.textContent = adding ? 'Add' : tool === 'select' ? PK.shortName(inst ? inst.part : null, kind, p && (p.short || p.name)) : tool === 'mark' ? 'Marks' : 'Measure';
  const chip = $('mode'); chip.dataset.tool = tool; chip.querySelector('b').textContent = MD.TOOL_LABEL[tool]; chip.setAttribute('aria-label', 'Mode: ' + MD.TOOL_LABEL[tool] + '. Tap to change');
  const step = inst ? C.yawStep(inst.part) : 0;
  const ex = inst ? { free: !!inst.at, num: !!numKey(p), choice: !!choiceKey(p) } : {};
  const lay = adding ? { primary: ['confirm', ...(adding.kind === 'stud' && adding.outlets.length > 1 ? ['next'] : []), 'cancel'], more: [] } : MD.stackForTool(tool, kind, step, !!selectedId, ex);
  const show = moreOpen && !adding ? lay.more : lay.primary;
  for (const id of MD.ALL_IDS) $(id).hidden = !show.includes(id);
  stack.classList.toggle('more', moreOpen);
  for (const id of show) stack.appendChild($(id));   // keep the layout order of the list
  $('rotm').querySelector('small').textContent = $('rotp').querySelector('small').textContent = step + '°';
  $('rotm').setAttribute('aria-label', 'Rotate right ' + step + ' degrees'); $('rotp').setAttribute('aria-label', 'Rotate left ' + step + ' degrees');
  if (inst && choiceKey(p)) { const ck = choiceKey(p), o = p.options[ck]; $('gauge').querySelector('span').textContent = o.values[inst.opts[ck]].label; $('gauge').querySelector('small').textContent = (o.label || ck).toLowerCase(); }
  $('confirm').innerHTML = adding && adding.kind === 'stud' ? 'Place<small>on ring</small>' : 'Place<small>here</small>';
  $('cover').setAttribute('aria-pressed', !!(inst && inst.opts.cover));
  const st = MD.stepsFor(units), lab = (id, big, small, aria) => { $(id).innerHTML = big + '<small>' + small + '</small>'; $(id).setAttribute('aria-label', aria); };
  lab('extp', '+' + st.extLabel, st.extUnit, 'Extension plus ' + (units === 'mm' ? '25 mm' : '1 inch')); lab('extm', '&minus;' + st.extLabel, st.extUnit, 'Extension minus ' + (units === 'mm' ? '25 mm' : '1 inch'));
  lab('hp', '&uarr;', st.heightLabel, 'Raise ' + st.heightLabel); lab('hm', '&darr;', st.heightLabel, 'Lower ' + st.heightLabel);
  for (const [id, ch, w] of [['nl', '&larr;', 'left'], ['nr', '&rarr;', 'right'], ['nu', '&#9650;', 'away'], ['nd', '&#9660;', 'toward me']]) lab(id, ch, st.nudgeLabel, 'Nudge ' + w + ' ' + st.nudgeLabel);
  $('select').disabled = !hoveredId;
  $('cross').classList.toggle('hit', !!hoveredId);
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
const freeSel = () => { const i = selInst(); return i && i.at ? i : null; };
const r2 = v => Math.round(v * 100) / 100;
function moveFree(f, dx, dy, dz) { f.at = [r2(f.at[0] + dx), r2(f.at[1] + dy), r2(f.at[2] + dz)]; rebuild(); }
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
wire('mnew', () => { cancelPending(); flashMsg('Tap point A'); }); wire('mundo', undoMeasure); wire('mclear', clearMeasures);
$('mode').addEventListener('click', () => { setTool(MD.nextTool(tool)); setOpen(true); });
wire('select', () => { if (hoveredId) selectPart(hoveredId); });
wire('deselect', () => selectPart(null));
wire('clearmarks', clearMarks);
wire('reset', () => {
  cancelAdd(); closeLib();
  state = C.parseState(new URLSearchParams(initialHash).get('s')) || C.defaultState();
  selectedId = null; rebuild(); setOffs({ ...OFS.ZERO });
});
wire('exit', () => { if (session) session.end(); });
// single round button: tap opens/closes the stack; it collapses ~4 s after the last tap
let collapseT = 0;
function bumpCollapse() { clearTimeout(collapseT); if (ctl.classList.contains('open') && !adding) collapseT = setTimeout(() => setOpen(false), 4000); }
function setOpen(open) {
  ctl.classList.toggle('open', open); fab.setAttribute('aria-expanded', open);
  if (!open) moreOpen = false;
  if (open) closeLib();
  readout(); bumpCollapse();
}
fab.addEventListener('click', () => setOpen(!ctl.classList.contains('open')));
wire('more', () => { moreOpen = true; });
wire('back', () => { moreOpen = false; });
ctl.addEventListener('click', bumpCollapse, true);
// touches on our controls must not place the model
overlay.addEventListener('beforexrselect', e => { if (e.target !== overlay) e.preventDefault(); });
ctl.addEventListener('beforexrselect', e => e.preventDefault());

// ---- Add part: library list, compatible outlets (xr/match.js), place on an outlet or on a surface; Remove ----
const libEl = $('lib'), listEl = $('liblist'), toastEl = $('toast');
const outletGroup = new THREE.Group(); inner.add(outletGroup);   // rings live in the model frame (inner == modelHolder frame)
let toastT = 0, lastAim = null;
function toast(t, warn = false, ms = 3500) {
  clearTimeout(toastT); toastEl.textContent = t; toastEl.hidden = !t; toastEl.classList.toggle('warn', !!warn); if (t) log('toast: ' + t);
  if (t && ms) toastT = setTimeout(() => { toastEl.hidden = true; }, ms);
}
const CAT_ORDER = ['distribution', 'fusing', 'cable', 'hardware', 'marker'];
const ICON = { lug: 'LUG', busbar: 'BUS', nut: 'NUT', powerbar: 'PWR', fuse: 'FUSE', bar: 'BAR', joint: 'JNT', splice: 'SPL', marker: 'FLAG' };
function buildLib() {
  const parts = C.catalog.parts.filter(p => p !== C.host), cats = [...new Set(parts.map(p => p.category || 'other'))].sort((a, b) => (CAT_ORDER.indexOf(a) + 1 || 99) - (CAT_ORDER.indexOf(b) + 1 || 99));
  listEl.textContent = '';
  for (const c of cats) {
    const h = document.createElement('li'); h.className = 'cat'; h.textContent = c; listEl.appendChild(h);
    for (const p of parts.filter(x => (x.category || 'other') === c)) {
      const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.dataset.part = p.id;
      const ic = document.createElement('span'); ic.className = 'ic'; ic.style.background = p.thumb_color || '#445'; ic.textContent = ICON[p.icon] || String(p.icon || p.kind).slice(0, 4).toUpperCase();
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name; const sm = document.createElement('small'); sm.textContent = (p.category || '') + ' / ' + MT.mountKind(p); nm.appendChild(sm);
      const mk = document.createElement('span'); mk.className = 'mk'; mk.textContent = MT.mountKind(p) === 'stud' ? 'on stud' : 'drop';
      b.append(ic, nm, mk); li.appendChild(b); listEl.appendChild(li);
    }
  }
}
function openLib() {
  if (!C) return;
  cancelAdd(); setOpen(false); moreOpen = false;
  if (!listEl.firstChild) buildLib();
  libEl.hidden = false; listEl.scrollTop = 0; log('library open');
}
function closeLib() { libEl.hidden = true; }
listEl.addEventListener('click', e => { const b = e.target.closest('button[data-part]'); if (b) startAdd(b.dataset.part); });
$('libclose').addEventListener('click', closeLib);
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
  cancelAdd(); selectPart(null);
  if (MT.mountKind(p) === 'stud') {
    const all = C.SC.outlets(partId, C.SC.defOpts(p), state), ok = all.filter(o => o.ok);
    if (!ok.length) { toast(MT.noOutletMessage(p, all), true); return; }
    adding = { partId, kind: 'stud', outlets: ok.map(o => ({ key: o.key, seat: C.SC.seatOf(state, partId, o.key) })).filter(o => o.seat), target: null, lock: null };
    adding.target = adding.outlets[0].key; buildOutletMarkers();
    toast(adding.outlets.length + ' compatible ' + MT.threadShort(MT.needsOf(p).needs.thread) + ' stud' + (adding.outlets.length > 1 ? 's' : '') + ': aim or click a ring, then Place', false, 0);
  } else {
    adding = { partId, kind: 'surface', outlets: [], target: null, lock: null };
    toast(!session && !PREVIEW ? 'Click the model or the floor to drop it' : 'Aim at a surface, then Place (or tap)', false, 0);
  }
  closeLib(); moreOpen = false; setOpen(true); readout();
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
  const r = C.SC.removeInst(state, inst.id);
  if (!r.ok) { toast(r.why, true); return; }
  const names = r.removed.map(nameOfId), extra = names.slice(1);
  state = r.insts; selectPart(null); rebuild();
  toast('Removed ' + names[0] + (extra.length ? ' and ' + extra.length + ' stacked: ' + extra.join(', ') : ''));
}
wire('addpart', openLib); wire('remove', removeSelected); wire('confirm', confirmAdd); wire('cancel', cancelAdd);
wire('next', () => {
  if (!adding || !adding.outlets.length) return;
  const i = adding.outlets.findIndex(o => o.key === adding.target);
  setTarget(adding.outlets[(i + 1) % adding.outlets.length].key, true);
});

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
  } catch (e) { depthOK = false; log('depth read failed, off: ' + (e && e.message || e)); return null; }
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
  if (mouse && !ptr.in) { refreshTargetMarkers(); return; }   // cursor left the canvas: keep the last hover and target
  if (live && roots().length) {
    scene.updateMatrixWorld(true);
    rs = renderer.xr.getReferenceSpace(); vp = frame && rs ? frame.getViewerPose(rs) : null;
    ray = mouse ? pointerRayAt(ptr.ndc) : vp ? PK.rayFromPose(vp.transform.position, vp.transform.orientation) : viewerRay(null);
    modelHit = pickRay(ray);
  }
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
  const hit = pickRay(PK.rayFromPose(pose.transform.position, pose.transform.orientation));
  selectPart(hit ? hit.instanceId : null);
}

function onFrame(time, frame) {
  lastFrame = frame;
  if (!frame) { pivot.matrixWorldNeedsUpdate = true; controls.update(); updateHover(null); renderer.render(scene, camera); return; }
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
  updateHover(frame);
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
      session = null; hitSource = null; anchor = null; lastHit = null; setMode('preview'); selectPart(null); beam.visible = dot.visible = false; beamHit = null; depthOK = false; setOpen(false); cancelAdd(); closeLib(); removeMarkObjs(); removeMeasureObjs(); reticle.visible = false;
      document.body.classList.remove('inar'); grid.visible = true; pivot.visible = true; controls.enabled = true;
      pivot.matrix.identity(); pivot.matrixWorldNeedsUpdate = true; scene.updateMatrixWorld(true); restoreMarks(); setHint(null); log('session ended'); scene.environment = roomEnv; scene.remove(xrLight); fit();
    });
    const viewer = await s.requestReferenceSpace('viewer');
    try { hitSource = await s.requestHitTestSource({ space: viewer, entityTypes: ['point', 'plane'] }); log('hit-test source: point+plane'); }
    catch (e) { log('hit-test entityTypes rejected (' + (e && e.message || e) + '), default'); hitSource = await s.requestHitTestSource({ space: viewer }); }
  } catch (e) { msg.hidden = false; msg.textContent = 'Could not start AR: ' + (e && e.message || e); }
}
enterBtn.addEventListener('click', enterAR);

function fit() {
  if (renderer.xr.isPresenting) return;
  const w = $('stage').clientWidth, h = $('stage').clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  const bar = document.querySelector('.bar');   // the page's own bar (units, Enter AR): keep the round button above it
  document.documentElement.style.setProperty('--lift', (document.body.classList.contains('inar') || !bar ? 0 : bar.offsetHeight) + 'px');
}
addEventListener('resize', fit);
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
  cv.addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; ptr.in = true; ptr.ndc.copy(ndcOf(e)); });
  cv.addEventListener('pointerleave', () => { ptr.in = false; if (hoveredId) { hoveredId = null; applyTints(); readout(); } });
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener('pointerup', e => {
    if (session || !down || !C) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (moved > 6 || dt > 600) return;   // a drag is orbiting
    const ndc = ndcOf(e);
    scene.updateMatrixWorld(true); raycaster.setFromCamera(ndc, camera); raycaster.far = 10;
    const hit = PK.pickFromHits(raycaster.intersectObjects(roots(), true));
    if (adding) {
      if (adding.kind === 'stud') { const k = nearestOutletOnScreen(e); if (k) setTarget(k, true); else toast('Click one of the pulsing rings'); }
      else {
        const g = hit ? hit.point.toArray() : groundCand(pointerRayAt(ndc));
        const pt = hit ? g : g && g.point; if (pt) dropSurfaceAt(pt); else toast('Click on the model or the floor', true);
      }
      return;
    }
    if (tool === 'mark') { if (hit) dropMarkAt(hit.point.toArray(), 'M'); return; }
    if (tool === 'measure') { if (hit) measureAt(hit.point.toArray()); return; }
    if (hovMark >= 0) { selectPart(null); selectMark(hovMark); return; }
    selectMark(-1); selectPart(hit ? hit.instanceId : null);
    if (!PREVIEW) status.textContent = hit ? 'Selected: ' + nameOfId(hit.instanceId) + '. Click empty space to clear.' : 'Drag to orbit. Click a part to select it.';
  });
}
// test / debug hooks
window.__ar = { look(dx, dy, dz) { const t = controls.target; camera.position.set(t.x + dx, t.y + dy, t.z + dz); controls.update(); }, target(x, y, z) { controls.target.set(x, y, z); controls.update(); }, hash: persist, startAdd, confirmAdd, cancelAdd, removeSelected, openLib, setTarget, adding: () => adding && { partId: adding.partId, kind: adding.kind, target: adding.target, outlets: adding.outlets.map(o => o.key) }, toast: () => toastEl.textContent, persist, setTool, tool: () => tool, units: () => units, marks: () => marks.length, measures: () => measures.length, dropAt: dropMarkAt, measureAt, selectMark, select: selectPart, selected: () => selectedId, hovered: () => hoveredId, state: () => JSON.parse(JSON.stringify(state)),
  screenOf(id) { const r = roots().find(o => o.userData.instanceId === id); if (!r) return null; const b = new THREE.Box3().setFromObject(r), c = b.getCenter(new THREE.Vector3()).project(camera), rc = renderer.domElement.getBoundingClientRect();
    return { x: rc.left + (c.x + 1) / 2 * rc.width, y: rc.top + (1 - c.y) / 2 * rc.height }; },
  aimAt(id) { const r = roots().find(o => o.userData.instanceId === id); const c = new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()); controls.target.copy(c); controls.update(); } };

// ---- start ----
(async function init() {
  if (q.has('help')) $('help').hidden = false;
  if (PREVIEW) {
    document.body.classList.add('arpreview');
  }
  fit();
  try { C = await createComposer('parts/catalog.json'); }
  catch (e) { status.textContent = 'Could not load parts: ' + e.message; return; }
  initialHash = location.hash.slice(1);
  const sc0 = C.SC.fromHash(initialHash);
  state = sc0.insts; offs = sc0.offs; storedMarks = sc0.marks; storedMeasures = sc0.measures;
  applyOffsets(); await rebuild();
  fit(); frameModel(); updateCross(); restoreMarks();
  if (q.get('sel')) selectPart(q.get('sel'));
  status.textContent = 'Drag to orbit. Real size (inches to metres).';
  const sup = navigator.xr && navigator.xr.isSessionSupported ? await navigator.xr.isSessionSupported('immersive-ar').catch(() => false) : false;
  if (sup) enterBtn.hidden = false;
  else {
    msg.hidden = false;
    msg.textContent = !window.isSecureContext ? 'AR needs HTTPS. Open this page over https (localhost works with port forwarding).'
      : 'AR is not available here: immersive-ar WebXR is not supported. Use Android Chrome with ARCore.';
  }
  readout();
  if (q.get('addpart')) { startAdd(q.get('addpart')); if (q.get('target')) setTarget(q.get('target'), true); }   // screenshots
  else if (q.get('open') === 'lib') openLib();
  else if (q.get('open')) { if (q.get('open') === 'more') moreOpen = true; setOpen(true); }
  window.__ready = true;
})();
