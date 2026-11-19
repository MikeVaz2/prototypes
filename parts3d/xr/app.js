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
import { createScan } from './scan.js';
import * as CT from './cats.js';
import * as JMP from './jumper.js';
import * as PR from './presets.js';
import * as LC from './lifecycle.js';
import * as RC from './rec.js';
import * as SOL from './solar.js';
import * as OL from './outline.js';
import * as CTL from './controls.js';
import * as IN from './input.js';
import * as ED from './edit.js';
import * as CL from './clash.js';

const q = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
// one input router (xr/input.js): every DOM and XR event enters here and is dispatched to the handlers registered below. Order: UI controls, active gesture, scene tap.
const router = IN.createRouter({ log: m => log(m), state: () => ({ inXR: !!session, editOn: !!(typeof edit !== 'undefined' && edit.on), rec: !!rec.on, selected: !!selectedId, dialogOpen: dlgs.some(d => d.open), gesture: typeof eg !== 'undefined' && eg ? eg.kind : (dragMove ? 'move' : null), tool, linking: !!linking, adding: !!adding }) });
const act = (id, fn) => router.act(id, fn, $(id));   // a click action; the button gets data-action
const overlay = $('overlay'), ctl = $('ctl'), ctx = $('ctx'), status = $('status'), hint = $('hint');
const PREVIEW = !!q.get('arpreview');
const DEBUG_KEY = 'ar-xr-debug';
let DEBUG = q.get('debug') === '1';   // mutable: ?debug=1 forces it on; otherwise the menu toggle (localStorage)
if (!DEBUG) { try { DEBUG = localStorage.getItem(DEBUG_KEY) === '1'; } catch (e) { /* storage blocked */ } }
const BUILD = window.__BUILD || 'dev';
$('aboutbuild').textContent = BUILD;
act('aboutbtn', () => { const b = $('aboutbox'); b.hidden = !b.hidden; $('aboutbtn').setAttribute('aria-expanded', String(!b.hidden)); });   // About: expands inline in the menu (the menu stays open)

// ---- debug log (?debug=1): last 20 lines in the overlay; errors always land here ----
const logLines = [];
function log(m) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log('[ar-xr]', m);
  logLines.push(t + ' ' + m); if (logLines.length > 20) logLines.shift();   // always buffered, so errors before switching on still show
  renderLog();
}
function renderLog() {
  $('dbg').hidden = !DEBUG;
  if (DEBUG) $('dbg').textContent = logLines.join('\n');
}
function syncDebugButton() { $('dbgbtn').querySelector('small').textContent = DEBUG ? 'On' : 'Off'; $('dbgbtn').setAttribute('aria-label', 'Debug: ' + (DEBUG ? 'on' : 'off') + '. Tap to change'); }
function setDebug(on) {
  DEBUG = !!on; syncDebugButton();
  if (!q.get('debug')) { try { localStorage.setItem(DEBUG_KEY, DEBUG ? '1' : '0'); } catch (e) { /* storage blocked */ } }
  renderLog(); if (DEBUG) log('debug on, build ' + BUILD + ', hash #' + location.hash.slice(1));
}
addEventListener('error', e => log('ERROR ' + (e.message || e.error)));
addEventListener('unhandledrejection', e => log('REJECTION ' + (e.reason && e.reason.message || e.reason)));
if (DEBUG && q.get('eruda') === '1') {   // lazy: only when asked for
  const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/eruda@3.4.1/eruda.min.js';
  sc.onload = () => { try { window.eruda.init(); log('eruda on'); } catch (e) { log('eruda failed ' + e.message); } };
  sc.onerror = () => log('eruda failed to load'); document.head.appendChild(sc);
}
log('build ' + BUILD);
act('dbgbtn', () => setDebug(!DEBUG));
syncDebugButton(); renderLog();

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
const ctxT = CTL.createToggle(), modeDial = CTL.createDial(MD.TOOLS, tool), hist = CTL.createHistory(60);   // context FAB, modes speed dial, undo / redo of scene edits
let histT = 0;
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
function markHeightIn(m) {   // inches above the battery's top face (model frame), or null when there is no battery body
  const hr = roots().find(o => o.userData.partId === C.host.id); if (!hr) return null;
  return (toModel(m.pos.toArray())[1] - localBox(hr).max.y) / SCN.IN;
}
// labels: a mark shows its text only when selected; measurements always show their distance
function refreshMarks() {
  const lines = [];   // a mark shows its label only when selected: its height above the battery top (no raw coordinates)
  marks.forEach((m, i) => {
    const on = !!(C && RC.markLabelVisible(i, selMark));
    m.sprite.visible = on;
    m.ball.material.color.set(i === selMark ? 0xffffff : 0xffd400); m.ball.scale.setScalar(i === selMark ? 1.5 : 1);
    if (!on) return;
    const txt = RC.markHeightText(i + 1, markHeightIn(m), v => MD.fmtLen(v, units));
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
function persistSoon() { clearTimeout(persistT); persistT = setTimeout(persist, 200); clearTimeout(histT); histT = setTimeout(histCommit, 350); }
// rebuild the mark / measure objects from the stored model-frame lists at the model's current world pose
function restoreMarks() {
  removeMarkObjs(); removeMeasureObjs();
  for (const m of storedMarks) addMarkObj(toWorld(m.p), m.src);
  for (const m of storedMeasures) addMeasureObj(toWorld(m.a), toWorld(m.b));
  marksLive = true; refreshMarks();
}
function setHint(t) { hint.hidden = !t; document.body.classList.toggle('hinting', !!t); if (t) hint.textContent = t; }
function setTool(t) {
  t = MD.normTool(t); if (t === tool) return;
  if (adding) cancelAdd(); closeLib();
  if (tool === 'measure') cancelPending();
  tool = t; log('tool ' + t);
  if (t !== 'select') selectPart(null);
  if (t === 'measure') selMark = -1;
  readout();
}
// a scene tap in a session (placed): what it does depends on the tool
function onSceneTap(ev) {
  if (rec.on) return;   // recording: scene taps do nothing
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
act('unitbtn', () => setUnits(units === 'mm' ? 'in' : 'mm'));
syncUnitButtons();

// ---- app state ----
let recOpen = false;
const rec = { on: false, bar: false, chosen: false };   // recording mode (#126)
let adding = null;   // Add part in progress: { partId, kind: 'stud'|'surface', outlets: [{ key, seat: [x,y,z] model frame m }], target: key|null, lock: ray|null }
let selOutlet = null, selPoint = null;   // outside XR: a selected outlet (key) and the surface point the click hit
let moving = null;   // XR Move: { id }, the part follows the beam on its mount plane until the next tap
let dragMove = null;   // outside XR: { id, grab: [dx, dz], pointerId } a drag of the selected surface part
let jumpers = [], selJumper = null, linking = null, linkAim = null, optLast = null, stackH = { pos: null, neg: null };   // jumpers: see xr/jumper.js
let C, state = [], offs = { ...OFS.ZERO }, selectedId = null, hoveredId = null, busy = false, again = false;
let session = null, hitSource = null, anchor = null, anchorFix = null, lastFrame = null, lastHit = null;
const baseMat = new THREE.Matrix4();
let mode = 'preview';   // preview | reticle | placed
function setMode(m) { if (m !== mode) log('mode ' + mode + ' -> ' + m); mode = m; updateCross(); }
const tmpV = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
let hitCount = -1;
const scan = createScan();   // surface-scan hint (xr/scan.js)
function scanHint(t) { setHint(t); }

const instOf = id => state.find(i => i.id === id) || null;
const selInst = () => instOf(selectedId);
const kindOfId = id => { const i = instOf(id), p = i && C.partOf(i.part); return p ? PK.kindOf(p.id, C.host.id, 'cover' in (p.options || {})) : null; };
const nameOfId = id => { const i = instOf(id), p = i && C.partOf(i.part); return !p ? '' : (p.short || p.name); };
const numKeys = (p, inst) => PK.sizeKeys(p, inst && inst.opts);   // size options (Move's offsets are nocycle, `when` hides platform sizes on a DIY rack)
const numSel = new Map();   // instance id -> the number option the +/- buttons edit (parts with several: panel width / length / slide, rack spacing ...)
const numKey = (p, id) => { const ks = numKeys(p, instOf(id)), s = numSel.get(id); return ks.includes(s) ? s : ks[0]; };
let sizeOpen = false;   // the size row (Back, dimension, -, +) replaces the actions of a part with several size options
const NUM = '#num';   // pseudo option button: "Edit: <name> <value>", taps through the number options
const choiceKey = p => Object.keys(p.options || {}).find(k => p.options[k].type === 'choice');
const optKeys = (p, kind, inst) => PK.optionButtons(p, kind, inst && inst.opts);   // choice / bool option buttons of a part: gauge, gauge2, gauge3
const isPanel = PK.isPanel;
const sizeable = (p, inst) => !!p && !!inst && numKeys(p, inst).length > 1;
const numLabel = (p, inst) => { const k = numKey(p, inst.id), o = p.options[k]; return (o.short || o.label) + ' ' + MD.fmtOpt(o, inst.opts[k], units) + ' ▸'; };
const optText = (p, inst, k) => PK.optLabel(p.options[k], inst.opts[k]);
const numText = (p, inst) => numKeys(p, inst).map(k => (numKeys(p, inst).length > 1 ? (p.options[k].short || p.options[k].label) + ' ' : '') + MD.fmtOpt(p.options[k], inst.opts[k], units)).join(' ');

async function rebuild() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    SOL.syncBolts(state, C.partOf);   // bolt heads only where the hole rows sit over bars
    const root = await C.build(state);
    modelHolder.clear(); modelHolder.add(root);
    hoveredId = null; outletPts = null; fitCache.clear(); hideQuick(); edgeFor = null; edgeLines = []; applyXray(); applyTints(); refreshOutline(); updateJumpers(); updateHeights(); readout(); persistSoon();
  } catch (e) {
    const bad = e && e.partName ? e.partName : 'a part';
    log('rebuild failed: ' + (e && e.message)); toast('Could not load ' + bad + ' (' + (e && e.message || 'error') + '). Try again.', true, 0, 'error');
  } finally { busy = false; if (again) { again = false; rebuild(); } }
}
const roots = () => modelHolder.children[0]?.userData.bodies || [];   // part bodies (meshes) of every instance, wherever they sit in the tree

// ---- selection: an accent edge outline on the selected part (no full-surface tint, the real scene stays visible); hover keeps a faint white tint ----
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
      if (want === 'hover') { m.emissive.set(0xffffff); m.emissiveIntensity = 0.18; }
      else { m.emissive.copy(m.userData.e0.c); m.emissiveIntensity = m.userData.e0.i; }
    }
  });
}
function applyTints() {
  for (const r of roots()) { const w = PK.tintFor(r.userData.instanceId, selectedId, rec.on ? null : hoveredId); if (r.userData.tint !== w) setTint(r, w); }
}
function localBox(obj) {
  scene.updateMatrixWorld(true);
  const inv = modelHolder.matrixWorld.clone().invert(), b = new THREE.Box3(), mm = new THREE.Matrix4();
  const part = C && C.partOf(obj.userData.partId), only = part && part.outline && part.outline.nodes;   // some parts box only their body (solar panel: not the leads)
  obj.traverse(m => { if (m.isMesh) {
    if (only) { const chain = []; for (let o = m; o && o !== obj; o = o.parent) chain.push(o.name); if (!OL.inOutline(chain, only)) return; }
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    b.union(m.geometry.boundingBox.clone().applyMatrix4(mm.multiplyMatrices(inv, m.matrixWorld)));
  } });
  return b;
}
const edgeMat = new THREE.LineBasicMaterial({ color: 0x2f6fde, depthTest: false, transparent: true, opacity: 0.95 });
let edgeLines = [], edgeFor = null;   // edge lines of the selected part's meshes (children of those meshes, so they follow every pose change)
function clearEdges() { for (const l of edgeLines) { l.removeFromParent(); l.geometry.dispose(); } edgeLines = []; edgeFor = null; }
function refreshOutline() {
  const r = roots().find(o => o.userData.instanceId === selectedId);
  outline.visible = !!r && !rec.on; outline.material.color.copy(accent); edgeMat.color.copy(accent);
  if (!r) { clearEdges(); return; }
  outline.box.copy(localBox(r)).expandByScalar(0.002);
  if (edgeFor !== r) {
    clearEdges(); edgeFor = r;
    r.traverse(m => { if (!m.isMesh || m.userData.isEdge) return; const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 35), edgeMat); l.userData.isEdge = true; l.renderOrder = 8; l.raycast = () => {}; m.add(l); edgeLines.push(l); });
  }
  for (const l of edgeLines) l.visible = !rec.on;
}
// ---- x-ray: the host (battery) can be Solid, Ghost, Wireframe or hidden; parts on it stay solid. Per session (sessionStorage). ----
const xray = RC.createXray({ get: k => sessionStorage.getItem(k), set: (k, v) => sessionStorage.setItem(k, v) });
function applyXray() {
  for (const r of roots()) {
    const look = RC.xrayLook(xray.modeFor(r.userData.partId === C.host.id));
    r.visible = look.visible;
    r.traverse(c => {
      if (!c.isMesh || c.userData.isEdge) return;
      c.castShadow = look.shadow;
      for (const m of Array.isArray(c.material) ? c.material : [c.material]) {
        m.transparent = look.transparent; m.opacity = look.opacity; m.depthWrite = look.depthWrite; m.wireframe = look.wireframe; m.needsUpdate = true;
      }
    });
  }
}
function setXray(m) {
  if (m === 'next') xray.next(); else xray.set(m);
  applyXray(); if (xray.mode === 'hide' && selectedId && selInst() && selInst().part === C.host.id) selectPart(null);
  log('xray ' + xray.mode); readout();
}
function selectPart(id, pt = null) {
  id = id && instOf(id) ? id : null; if (selJumper) { selJumper = null; tintJumpers(); }
  selOutlet = null; selPoint = id ? pt : null;
  if (id !== selectedId) { log('selected ' + (id || 'none')); endMove(); sizeOpen = false; }
  selectedId = id;
  applyTints(); refreshOutline(); readout();
}

function applyOffsets() {
  const t = OFS.toTransform(offs);
  inner.position.set(...t.pos); inner.rotation.y = t.yawRad;
  readout(); persistSoon();
}
// solar extras of the selected part: panel numbers and whether its holes sit over the bars, the station's parallel check, a cable's polarity
function solarNote(inst, p) {
  if (p.electrical && p.electrical.imp) {
    const rk = state.find(i => i.part === C.host.id), hc = rk && SOL.holesCheck(inst, rk, C.partOf);
    return SOL.panelText(p, inst.opts) + (hc && !hc.ok ? ' · ' + hc.text : '');
  }
  if (p.electrical && p.electrical.vmax) { const ck = SOL.stationCheck(state, jumpers, C.partOf); if (ck) chkLevel = ck.level; return ck ? ck.text : ''; }
  return '';
}
let chkLevel = '';   // 'ok' | 'limited' | 'over' while the solar check line is shown in #sel (colours it)
// hold-down check: a terminal part (anything stacked on a battery stud) whose box touches the bar warns "touches the hold-down bar" (xr/clash.js)
function clashNote(inst) {
  if (!state.some(i => CL.holdDownId(i.part))) return '';
  const inch = b => ({ min: [b.min.x, b.min.y, b.min.z].map(v => v / SCN.IN), max: [b.max.x, b.max.y, b.max.z].map(v => v / SCN.IN) });
  const rootOf = id => roots().find(o => o.userData.instanceId === id), bars = state.filter(i => CL.holdDownId(i.part)).map(h => CL.barBox(h, C.partOf(h.part)));
  const terminals = state.filter(i => !CL.holdDownId(i.part) && PR.sideOf(C.SC, state, i.id) != null);
  if (CL.holdDownId(inst.part)) {
    const bar = CL.barBox(inst, C.partOf(inst.part)), hit = CL.clashing(bar, terminals.filter(t => rootOf(t.id)).map(t => ({ id: t.id, box: inch(localBox(rootOf(t.id))) })));
    return hit.length ? CL.CLASH_TEXT + ': ' + hit.map(nameOfId).join(', ') : '';
  }
  if (!terminals.some(t => t.id === inst.id) || !rootOf(inst.id)) return '';
  const box = inch(localBox(rootOf(inst.id)));
  return bars.some(b => CL.boxesTouch(b, box)) ? CL.CLASH_TEXT : '';
}
function readout() {
  if (!C) return;
  const keepTop = ctx.scrollTop; try { readoutBody(); } finally { if (ctx.scrollTop !== keepTop) ctx.scrollTop = keepTop; }
}
function readoutBody() {
  chkLevel = '';
  const inst = selInst(), p = inst && C.partOf(inst.part), kind = inst ? kindOfId(inst.id) : null;
  $('ofs').textContent = MD.describeU(offs, units);
  refreshMarks();
  let t = 'Nothing selected';
  if (!inst && selMark >= 0) t = 'Selected: mark M' + (selMark + 1); else if (!inst && selMeasure >= 0) t = 'Selected: measurement ' + (selMeasure + 1);
  if (inst) {
    t = 'Selected: ' + nameOfId(inst.id) + (numKeys(p, inst).length ? ' ' + numText(p, inst) : '') + optKeys(p, kind, inst).map(k => ' ' + PK.optLabel(p.options[k], inst.opts[k])).join('') + (kind !== 'battery' && kind !== 'nut' ? ' ' + inst.yaw + '°' : '');
    const sx = solarNote(inst, p); if (sx) t += ' · ' + sx;
    const cn = clashNote(inst); if (cn) t += ' · ' + cn;
  } else if (hoveredId) t = 'Aim: ' + nameOfId(hoveredId);
  if (!inst && !hoveredId && selMark < 0 && selMeasure < 0 && !selJumper) { t = PR.tooltip(PR.presetOf(C.SC, state), stackH, v => MD.fmtLen(v, units)); const ck = SOL.stationCheck(state, jumpers, C.partOf); if (ck && !C.SC.isDefaultHost) { t += ' · ' + ck.text; chkLevel = ck.level; } }
  if (selJumper) { const j = jumpers.find(x => x.id === selJumper), L = j && jumperLen(j); if (L) t = JMP.jumperText(j, JMP.isMc4(j) ? L.metres.toFixed(1) + ' m' : MD.fmtLen(L.cut, units)); }
  if (linking) t = 'Cable: ' + (linking.from ? 'pick the second stud' : 'pick the first stud');
  if (selOutlet && !inst) t = 'Outlet: ' + outletName(selOutlet);
  if (adding) t = 'Add ' + (C.partOf(adding.partId).short || adding.partId) + (adding.kind === 'stud' ? ': ' + (adding.target ? outletName(adding.target) : 'no target') : ': aim at a surface');
  $('sel').textContent = t; $('sel').dataset.level = chkLevel;
  { const tp = inst ? p : hoveredId && !adding ? C.partOf((instOf(hoveredId) || {}).part) : adding ? C.partOf(adding.partId) : null, im = $('selthumb');
    const src = tp && tp.thumb || ''; if (im.getAttribute('src') !== src) { if (src) im.src = src; else im.removeAttribute('src'); } im.hidden = !src;
    $('sel').title = tp ? tp.name : ''; $('sel').setAttribute('aria-label', tp ? t + ' (' + tp.name + ')' : t); }
  const step = inst ? C.yawStep(inst.part) : 0;
  const inXR = document.body.classList.contains('inar');
  const ex = inst ? PK.extrasFor(p, inst, kind, C.host.id) : {};
  const tg = inXR ? null : selTarget();
  const quickView = inXR && quick && { kind: quick.kind, isSel: quick.kind === 'part' && quick.id === selectedId, point: !!quick.point, fit: quick.fit.length };
  const jf = jfromKeys(inXR, quick, tg);
  const ca = { xrayUi: true, size: sizeOpen && sizeable(p, inst), linking: !!linking, jumper: !!selJumper, jfrom: !!(jf && jf.length), markSel: !selectedId && (selMark >= 0 || (inXR && hovMark >= 0)), measSel: !selectedId && selMeasure >= 0, tool, kind, rotStep: step, selected: !!selectedId, x: ex, inXR, quick: quickView, target: tg && { kind: tg.kind, point: !!tg.point },
    adding: adding ? { stud: adding.kind === 'stud', outlets: adding.outlets.length } : null };
  // one panel: the part's actions, then what used to sit behind More (model nudges, Place again, Reset, X-ray, Record, Exit AR); not while a flow owns the row
  const flow = !!(linking || selJumper || adding || ca.markSel || ca.measSel || ca.size), sub = recOpen;
  const noLift = !!(inst && ED.mountOf({ host: inst.part === C.host.id, on: inst.on, at: inst.at, panel: !!(inst.on && isPanel(p)), free: inst.free }) !== 'free');   // #107: only a free part lifts (Up / Down); a surface part stays in its plane
  ex.change = !!(inst && (partChoices(p, inst.opts).length || C.catalog.parts.some(x => x !== C.host && x.id !== p.id && CTL.familyKey(x) === CTL.familyKey(p))));
  ca.x = ex;
  const acts = sub ? [] : [...new Set([...MD.ctxFor({ ...ca, more: false }), ...(flow ? [] : MD.ctxFor({ ...ca, more: true }).filter(id => id !== 'back' && id !== 'addpart'))])].filter(id => id !== 'exit' && !(noLift && (id === 'hp' || id === 'hm')) && (ca.size || !/^gauge[23]?$/.test(id)));   // Exit AR is in the menu
  const low = MD.bottomFor(tool, inXR, true);   // Options: battery terminals, or the fume extractor setups
  for (const id of MD.ALL_IDS) { const e = $(id); if (e && id !== 'addpart') e.hidden = !acts.includes(id) && !low.includes(id); }   // Add part and Option live in the menu
  for (const id of acts) ctx.appendChild($(id));   // keep the layout order of the list
  for (const id of low) ctx.appendChild($(id));   // Undo of marks / measures, in the action panel while that mode is on
  if (!$('move').hidden) $('move').after($('editbar')); else ctx.appendChild($('editbar'));   // the lock chips sit right under the Move toggle
  ctx.classList.toggle('recsl', recOpen); $('recopts').hidden = !recOpen; ctx.classList.toggle('acts', acts.length > 0); ctx.dataset.tool = tool;
  ctx.hidden = !(ctxT.open || sub); $('info').dataset.sel = inst ? '1' : '';
  $('undo').disabled = !hist.canUndo; $('redo').disabled = !hist.canRedo;
  $('xray').setAttribute('aria-pressed', String(xray.mode !== 'solid'));
  syncFabs();
  const cur = inXR ? quick : tg; $('qadd').disabled = !(cur && (cur.fit.length || (cur.free && cur.free.length)));   // enabled when the part has free outlets even if no library part fits yet (click says so)
  $('rotm').setAttribute('aria-label', 'Rotate right ' + step + ' degrees'); $('rotp').setAttribute('aria-label', 'Rotate left ' + step + ' degrees');
  if (inst && sizeOpen && sizeable(p, inst)) $('gauge').dataset.v = numLabel(p, inst);
  { const j = jumpers.find(x => x.id === selJumper); if (j) { $('jgauge').dataset.v = j.gauge + ' AWG'; $('jcolor').dataset.v = j.color === 'red' ? 'Red' : 'Black'; } }
  $('confirm').setAttribute('aria-label', adding && adding.kind === 'stud' ? 'Place on the ring' : 'Place here');
  $('cover').setAttribute('aria-pressed', !!(inst && inst.opts.cover)); $('move').setAttribute('aria-pressed', String(!!edit.on)); renderEdit();
  const st = MD.stepsFor(units), lab = (id, big, small, aria) => { $(id).setAttribute('aria-label', aria); };
  { const no = inst && numKeys(p, inst).length ? p.options[numKey(p, inst.id)] : null, mmo = no && (no.unit === 'mm' || no.unit === 'cm' || no.unit === 'm'), ex = mmo ? no.step + ' ' + no.unit : units === 'mm' ? '25 mm' : '1 inch', nm = mmo ? no.label : 'Extension';   // a number option in mm (fan adapter spigot length) steps by its own size
    lab('extp', '+' + st.extLabel, st.extUnit, nm + ' plus ' + ex); lab('extm', '&minus;' + st.extLabel, st.extUnit, nm + ' minus ' + ex); }
  lab('hp', '&uarr;', st.heightLabel, 'Raise ' + st.heightLabel); lab('hm', '&darr;', st.heightLabel, 'Lower ' + st.heightLabel);
  for (const [id, ch, w] of [['nl', '&larr;', 'left'], ['nr', '&rarr;', 'right'], ['nu', '&#9650;', 'away'], ['nd', '&#9660;', 'toward me']]) lab(id, ch, st.nudgeLabel, 'Nudge ' + w + ' ' + st.nudgeLabel);
  compactButtons();
  $('cross').classList.toggle('hit', !!hoveredId);
  updateRecUi();
}
// every control is one line: icon + short verb; the full wording stays in aria-label and title
function compactButtons() {
  for (const id of Object.keys(IC.BUTTONS)) {
    const b = $(id); if (!b) continue;
    const txt = id === 'mode' ? MD.TOOL_LABEL[tool] : id === 'gauge' || id === 'gauge2' || id === 'gauge3' ? (b.dataset.v || 'Option') : id === 'jgauge' ? (b.dataset.v || 'Gauge') : id === 'jcolor' ? (b.dataset.v || 'Color') : id === 'armenu' ? (b.dataset.v || 'Enter AR') : id === 'xray' ? 'X-ray' : id === 'rbxray' ? 'X-ray ' + RC.XRAY_SHORT[xray.mode] : id === 'rbpause' ? (cycle.paused ? 'Resume' : 'Pause') : null;
    let m = IC.markup(id, txt);
    if ((id === 'extp' || id === 'extm') && sizeOpen && !b.hidden) { const sp = selInst() && C.partOf(selInst().part), o = sp && sp.options[numKey(sp, selInst().id)]; if (o) m = IC.svg(id === 'extp' ? 'plus' : 'minus') + '<span class="t">' + (o.unit ? o.step + ' ' + o.unit : '1') + '</span>'; }   // size row: step size on the button
    if (m && b.dataset.m !== m) { b.innerHTML = m; b.dataset.m = m; }
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
const wire = (id, fn) => act(id, () => { fn(); readout(); });
const setOffs = o => { offs = o; applyOffsets(); };
function lugExt(d) {
  const li = selInst(); if (!li) return;
  const p = C.partOf(li.part), k = numKey(p, li.id); if (!k) return;
  li.opts[k] = MD.extOpt(p.options[k], li.opts[k], d, units); rebuild();
}
// direction only; the step size comes from the units. Hold to repeat (long ranges: platform length, panel width), a short tap steps once.
const extHold = {};   // per direction: { t0, rep, held }
const extStop = h => { clearTimeout(h.t0); clearInterval(h.rep); h.t0 = h.rep = 0; };
router.hold('ext', {
  down(el) { const dir = +el.dataset.arg, h = extHold[dir] || (extHold[dir] = { t0: 0, rep: 0, held: false }); h.held = false; extStop(h); h.t0 = setTimeout(() => { h.held = true; lugExt(dir); h.rep = setInterval(() => lugExt(dir), 110); }, 450); },
  up(el) { const h = extHold[+el.dataset.arg]; if (!h) return; extStop(h); if (h.held) setTimeout(() => { h.held = false; readout(); }, 0); },
});
for (const [id, dir] of [['extm', -1], ['extp', 1]]) { const b = $(id); b.dataset.hold = 'ext'; b.dataset.arg = String(dir); act(id, () => { const h = extHold[dir]; if (h && h.held) return; lugExt(dir); readout(); }); }
const rotSel = dir => { const li = selInst(); if (li) { li.yaw = PK.rotateYaw(li.yaw, dir * (C.yawStep(li.part) || 0)); log('rotate btn ' + (dir * (C.yawStep(li.part) || 0)) + ', yaw now ' + li.yaw); rebuild(); } };
wire('rotm', () => rotSel(-1)); wire('rotp', () => rotSel(1));
wire('gauge', () => {   // size row only: switch the dimension (W <-> L ...). Options are chosen in the parts dialog (Change...)
  const li = selInst(), p = li && C.partOf(li.part);
  if (sizeOpen && sizeable(p, li)) { const ks = numKeys(p, li); numSel.set(li.id, ks[(ks.indexOf(numKey(p, li.id)) + 1) % ks.length]); }
});
wire('size', () => { const li = selInst(), p = li && C.partOf(li.part); if (sizeable(p, li)) { sizeOpen = true; $('ctx').scrollLeft = 0; } });
wire('turn', () => turnPanelSel());
wire('cover', () => { const li = selInst(); if (li && 'cover' in li.opts) { li.opts.cover = !li.opts.cover; rebuild(); } });
// a selected part placed on a surface (inst.at) moves by itself; otherwise these move the whole model
const freeSel = () => { const i = selInst(); return i && (i.at || i.part === C.host.id) ? i : null; };   // surface parts and the battery itself (at = null means the origin)
const atOf = i => i.at || [0, 0, 0];
const r2 = v => Math.round(v * 100) / 100;
function moveFree(f, dx, dy, dz) { const a = atOf(f); f.at = [r2(a[0] + dx), r2(a[1] + dy), r2(a[2] + dz)]; rebuild(); }
// Move: a surface part slides on its mount plane (the horizontal plane at its own height, model frame) under a ray. Stacked parts follow (their placement derives from the host).
// A panel sits on a rack slot and Move slides it over the rack: the ray meets the panel's own height plane, the point goes into the rack frame (mm), SOL.movePanel
// snaps it onto the bars (or keeps it on the platform) and stores the offsets in its px / pz options. Its leads travel with it (fastMove restretches the cables).
const rackOf = () => state.find(i => i.part === C.host.id);
function panelPoint(inst, ray) {
  const rack = rackOf(), pl = C.SC.placements(state), rp = rack && pl.get(rack.id), pp = pl.get(inst.id); if (!(rp && pp)) return null;
  modelHolder.updateWorldMatrix(true, false); _inv.copy(modelHolder.matrixWorld).invert();
  _lo.fromArray(ray.origin).applyMatrix4(_inv); _ld.fromArray(ray.dir).transformDirection(_inv);
  const h = XM.rayPlaneY(_lo.toArray(), _ld.toArray(), pp.pos[1]); if (!h) return null;
  const a = -rp.yaw * Math.PI / 180, dx = h[0] - rp.pos[0], dz = h[2] - rp.pos[2], c = Math.cos(a), sn = Math.sin(a);
  return { rack, q: [(dx * c + dz * sn) * 1000, (-dx * sn + dz * c) * 1000] };   // rack frame, mm (same rotation convention as scene.js rotY)
}
function slidePanel(inst, ray, grab = [0, 0]) {
  const pp = panelPoint(inst, ray); if (!pp) return false;
  const m = SOL.movePanel(inst, pp.rack, C.partOf, pp.q[0] + grab[0], pp.q[1] + grab[1]);
  if (m.px === (inst.opts.px || 0) && m.pz === (inst.opts.pz || 0) && !inst.opts.slide) return false;
  inst.opts.px = m.px; inst.opts.pz = m.pz; inst.opts.slide = 0; fastMove(); return true;
}
function turnPanelSel() {
  const li = selInst(), rack = rackOf(); if (!li || !rack || !li.on || !isPanel(C.partOf(li.part))) return;
  const t = SOL.turnPanel(li, rack, C.partOf); li.yaw = t.yaw; li.opts.px = t.px; li.opts.pz = t.pz; li.opts.slide = 0; rebuild();
}
const moveSel = () => { const i = selInst(); return freeSel() || (i && i.on && isPanel(C.partOf(i.part)) ? i : null); };
function slideTo(inst, ray, grab = [0, 0]) {
  if (inst && inst.on && isPanel(C.partOf(inst.part))) return slidePanel(inst, ray, grab);
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
  moveDirty = true;
  if (modelHolder.children[0]) C.applyLocals(modelHolder.children[0], state);   // local poses only; the tree carries the children
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
const turnSel = d => { const f = freeSel(); if (f) { f.yaw = PK.rotateYaw(f.yaw, d); log('rotate btn ' + d + ', yaw now ' + f.yaw); rebuild(); } else setOffs(XM.turn(offs, d)); };
wire('tm', () => turnSel(-XM.TURN_DEG)); wire('tp', () => turnSel(XM.TURN_DEG));

// ---- Edit mode (round 5, #107): the Move toggle shows axis locks; a one-finger drag moves along the unlocked axes, a two-finger twist turns about the unlocked rotate axis. Pure logic: xr/edit.js ----
// Unlock on demand (round 7): the mount (ED.mountOf: stud / surface / free) only sets which axes start unlocked; every chip opens for every part, because a real surface never lines up with the real battery.
// Axes: X, Y along the surface, Z up (the parent's frame for stacked parts). Offsets live in inst.ofs [x, h, z] inches, tilt in inst.pitch / inst.roll degrees (scene.js, hash field 5).
const edit = { on: false };
const editLocks = new Map();   // instance id -> { mount, locks } (resets when the mount type changes)
let eg = null;                 // the running gesture { kind: 'move' | 'twist', id, ... }
let editDragMoved = false;     // a drag happened: the select tap that follows is not a pick
function editInfo(inst) {
  const p = C.partOf(inst.part), panel = !!(inst.on && isPanel(p));
  const mount = ED.mountOf({ host: inst.part === C.host.id, on: inst.on, at: inst.at, panel, free: inst.free });
  let rc = editLocks.get(inst.id); if (!rc || rc.mount !== mount) { rc = { mount, locks: ED.defaultLocks(mount, p.edit_unlocked) }; editLocks.set(inst.id, rc); }
  return { mount, rec: rc, panel, st: ED.axisStates(mount, rc.locks) };
}
const editActive = () => !!(edit.on && C && selectedId && selInst() && tool === 'select' && !adding && !rec.on);
let editSig = '';
function renderEdit() {
  const bar = $('editbar'), inst = selInst(), show = !!(edit.on && inst && C && tool === 'select');
  bar.hidden = !show; if (!show) { editSig = ''; return; }
  const ei = editInfo(inst), note = ED.offMountNote(ei.mount, ei.st), sig = inst.id + '|' + ei.mount + '|' + JSON.stringify(ei.st) + '|' + note;
  $('detach').hidden = ei.mount === 'free';
  if (sig === editSig) return; editSig = sig;
  const mk = a => {
    const s = ei.st[a], on = s === 'on', ic = a.startsWith('m') ? 'axis' + a[1].toUpperCase() : 'rot' + a[0].toUpperCase() + a.slice(1), kind = a.startsWith('m') ? 'Move ' : 'Rotate ';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'edchip'; b.dataset.action = 'edit-chip'; b.dataset.axis = a; b.dataset.state = s; b.dataset.spaceModel = 'relative';
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', kind + ED.AXIS_LABEL[a] + ': ' + (on ? 'unlocked' : 'locked') + '. Tap to ' + (on ? 'lock' : 'unlock')); b.title = b.getAttribute('aria-label');
    b.innerHTML = IC.svg(ic) + '<span class="t">' + ED.AXIS_LABEL[a] + '</span>' + (s === 'locked' ? IC.svg('lock') : '');
    const out = [b];
    if (on && (a === 'mz' || a === 'pitch' || a === 'roll')) for (const dir of [-1, 1]) {   // 1 mm / 1 degree steps for precise alignment
      const t = document.createElement('button'); t.type = 'button'; t.className = 'edstep'; t.dataset.action = 'edit-step'; t.dataset.axis = a; t.dataset.arg = String(dir); t.dataset.spaceModel = 'relative';
      t.textContent = dir < 0 ? '\u2212' : '+'; t.setAttribute('aria-label', ED.AXIS_LABEL[a] + (dir < 0 ? ' minus ' : ' plus ') + ED.stepOf(a) + (a === 'mz' ? ' mm' : ' degree')); t.title = t.getAttribute('aria-label'); out.push(t);
    }
    const g = document.createElement('span'); g.className = 'edgrp'; g.append(...out); return g;   // chip and its +/- stay together on one row
  };
  $('edmove').replaceChildren(...ED.MOVE_AXES.map(mk)); $('edrot').replaceChildren(...['pitch', 'roll', 'yaw'].map(mk));
  $('edhint').textContent = note || (ei.mount === 'stud' ? 'Bolted to a stud. Open an axis to adjust it.' : ei.mount === 'surface' ? 'On a surface.' : 'Free part.');
}
function stepAxis(axis, dir) {
  const inst = selInst(); if (!inst) return; histCommit();
  if (axis === 'mz') { const o = (inst.ofs || [0, 0, 0]).slice(); o[1] = Math.round((o[1] + dir * ED.stepOf('mz') / 25.4) * 1000) / 1000; inst.ofs = o.some(v => v) ? o : undefined; editChip('Z ' + (dir < 0 ? '\u2212' : '+') + ED.stepOf('mz') + ' mm'); }
  else { const v = ED.normSigned((inst[axis] || 0) + dir * ED.stepOf(axis)); inst[axis] = Math.round(v * 1000) / 1000 || undefined; editChip(ED.rotText(inst[axis] || 0, axis)); }
  clearTimeout(editChip.t); editChip.t = setTimeout(() => editChip(''), 900); rebuild(); histCommit();
}
router.act('edit-step', b => stepAxis(b.dataset.axis, +b.dataset.arg));
router.act('edit-chip', b => {
  const inst = selInst(); if (!b || !inst) return;
  const ei = editInfo(inst); ei.rec.locks = ED.toggleLock(ei.mount, ei.rec.locks, b.dataset.axis); readout();
});
wire('detach', () => {
  const i = selInst(); if (!i) return; const pl = C.SC.placements(state).get(i.id); if (!pl) return;
  histCommit(); Object.assign(i, ED.detachFields(pl.pos, pl.yaw)); delete i.ofs; editLocks.delete(i.id); rebuild(); toast('Detached: free to move', false, 1800);
});
const toModelRay = ray => { modelHolder.updateWorldMatrix(true, false); _inv.copy(modelHolder.matrixWorld).invert(); _lo.fromArray(ray.origin).applyMatrix4(_inv); _ld.fromArray(ray.dir).transformDirection(_inv); return { origin: _lo.toArray(), dir: _ld.toArray() }; };
function editChip(t) { const c = $('editchip'); clearTimeout(editChip.t); if (!t) { c.hidden = true; return; } c.textContent = t; c.hidden = false; }
const editPos = inst => atOf(inst).map(v => v * SCN.IN);
// a one-finger / select-ray press on the selected part: starts a move along the unlocked axes. ray in world space. -> true when a gesture started
let editWhy = '';
const noBegin = why => { editWhy = why; return false; };
function editBegin(ray, src) {
  editWhy = '';
  const inst = selInst(); if (!inst) return noBegin('no selection'); if (!editActive()) return noBegin('edit not active (edit.on ' + edit.on + ', tool ' + tool + ', adding ' + !!adding + ', rec ' + rec.on + ')');
  const ei = editInfo(inst), axes = ED.unlockedMoves(ei.st); if (!axes.length) return noBegin('no unlocked move axes (' + ei.mount + ')');
  const mr = toModelRay(ray), plc = C.SC.placements(state), me = plc.get(inst.id), pos = me ? me.pos.slice() : editPos(inst);
  if (ei.panel && axes.length === 2 && axes.includes('mx') && axes.includes('my')) {   // a panel on rails slides over the rack with the existing snapping (SOL.movePanel)
    const pp = panelPoint(inst, ray), c = pp && SOL.panelCentre(inst, pp.rack, C.partOf); if (!pp) return noBegin('panel point null');
    histCommit(); eg = { kind: 'move', panel: true, id: inst.id, grab: [c.x - pp.q[0], c.z - pp.q[1]], src, t0: performance.now(), started: false }; editDragMoved = false; return true;
  }
  const hit = ED.pressHit(mr, pos, axes, mr.dir); if (!hit) return noBegin('movement plane parallel to the ray (or behind it)');
  const lc = C.SC.locals(state).get(inst.id), par = lc && lc.parent != null ? plc.get(lc.parent) : null;
  histCommit(); eg = { kind: 'move', id: inst.id, axes, start: { pos, hit }, at0: atOf(inst).slice(), ofs0: (inst.ofs || [0, 0, 0]).slice(), isAt: !!(inst.at || inst.part === C.host.id), Rp: par ? par.R : [1, 0, 0, 0, 1, 0, 0, 0, 1], view: mr.dir, src, t0: performance.now(), started: false, fine: false };   // the part moves by the finger's delta on its plane from the press point
  editDragMoved = false; return true;
}
const r2s = v => v.map(x => Math.round(x * 100) / 100).join(',');
let lastEditLog = 0;
const editLogThrottled = t => { const n = performance.now(); if (n - lastEditLog >= 500) { lastEditLog = n; log(t); } };
let pendingEdit = null, editPress = false;   // pendingEdit: the input source that pressed, resolved with a valid frame; editPress: the press landed on the selected part (its select is not a scene tap)
function resolveEditPress(frame, via) {
  const src = pendingEdit; pendingEdit = null; if (!src) return;
  if (domLock) { editPress = true; log('edit press: DOM twist owns the touches'); return; }
  if (!editActive() || eg) { log('edit press: not resolved (editActive ' + editActive() + ', gesture ' + !!eg + ')'); return; }
  const rs = renderer.xr.getReferenceSpace(), pose = rs && frame.getPose(src.targetRaySpace, rs);
  log('edit press resolved via ' + via + ', pose ' + (pose ? 'ok' : 'null') + (rs ? '' : ', no reference space'));
  editPress = true;   // Move mode: a press anywhere on the scene never changes the selection
  if (!pose) return;
  const ray = PK.rayFromPose(pose.transform.position, pose.transform.orientation);
  log('edit ray o ' + r2s(ray.origin) + ' d ' + r2s(ray.dir));
  if (editBegin(ray, src)) log('edit drag start (xr) ' + selectedId); else log('edit drag refused: ' + editWhy);
}
function editUpdate(ray) {
  if (!eg || eg.kind !== 'move' || domLock) return;
  const inst = instOf(eg.id); if (!inst) { editEnd(); return; }
  if (eg.panel) { if (slidePanel(inst, ray, eg.grab)) { eg.started = true; editDragMoved = true; editChip('slide'); } return; }
  const mr = toModelRay(ray);
  if (!eg.started) {
    const probe = ED.dragMove(mr, eg.start, eg.axes, true, eg.view);
    if (!probe || Math.max(...Object.values(probe.comps).map(Math.abs)) < 0.003) return;   // not moved yet: still a press (a still press first = fine steps)
    eg.started = true; eg.fine = ED.isLongPress(eg.t0, performance.now()); editDragMoved = true; log('edit move started (' + (eg.fine ? 'fine' : 'coarse') + ')');
  }
  const r = ED.dragMove(mr, eg.start, eg.axes, eg.fine, eg.view); if (!r) { editLogThrottled('edit update: ray parallel to the plane'); return; }
  const d = r.delta.map(v => v / SCN.IN), rd = v => Math.round(v * 1000) / 1000, txt = ED.moveText(r.comps) + (eg.fine ? ' (fine)' : '');
  editChip(txt); editLogThrottled('edit move ' + txt);
  let at = null, ofs;
  if (eg.isAt) { at = [rd(eg.at0[0] + d[0]), eg.at0[1], rd(eg.at0[2] + d[2])]; ofs = [eg.ofs0[0], rd(eg.ofs0[1] + d[1]), eg.ofs0[2]]; }   // a part on the surface: X / Y change its place, Z its height offset
  else { const R = eg.Rp, dp = [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]]; ofs = eg.ofs0.map((v, i) => rd(v + dp[i])); }   // stacked part: the offset in the parent's frame
  const same = (!at || at.every((v, i) => v === atOf(inst)[i])) && ofs.every((v, i) => v === (inst.ofs || [0, 0, 0])[i]);
  if (same) return;
  if (at) inst.at = at; inst.ofs = ofs.some(v => v) ? ofs : undefined; fastMove();
}
function editEnd() {
  const g = eg; eg = null;
  if (!g) return;
  controls.enabled = !session; flushMove(); if (g.started) { persist(); histCommit(); }   // one drag or twist = one undo step
  clearTimeout(editChip.t); editChip.t = setTimeout(() => editChip(''), 700);
  readout();
}
// ---- XR twist: every touch is its own transient 'screen' input source, so two fingers = two sources. Their screen positions come from gamepad.axes ([x, y] in -1..1) when present, else the source's ray projected to the screen. ----
const xrFingers = new Set();   // active screen input sources
let xrLocked = false;          // a twist happened: no new drag until every finger is up
const _pp = new THREE.Vector3();
function xrScreenPoint(src, frame, rs) {   // -> { p: [x * aspect, y], how } or null; y down like pixels, x scaled by the aspect ratio so angles are true
  const asp = innerWidth / Math.max(1, innerHeight);
  const ax = src.gamepad && src.gamepad.axes;
  if (ax && ax.length >= 2 && (ax[0] !== 0 || ax[1] !== 0)) return { p: [ax[0] * asp, ax[1]], how: 'gamepad axes' };
  const pose = frame.getPose(src.targetRaySpace, rs); if (!pose) return null;
  const ray = PK.rayFromPose(pose.transform.position, pose.transform.orientation), cam = renderer.xr.getCamera().cameras && renderer.xr.getCamera().cameras[0];
  if (!cam) return null;
  _pp.set(ray.origin[0] + ray.dir[0] * 2, ray.origin[1] + ray.dir[1] * 2, ray.origin[2] + ray.dir[2] * 2).project(cam);
  return { p: [_pp.x * asp, -_pp.y], how: 'projected ray' };
}
function xrTwistBegin() {   // the second finger landed: commit any move in progress and switch to twist
  const inst = selInst(); if (!editActive() || !inst) { log('xr twist: not starting (editActive ' + editActive() + ')'); return; }
  const axis = ED.rotAxisOf(editInfo(inst).st); if (!axis) { log('xr twist: every rotate axis is locked'); return; }
  if (eg) { const g = eg; eg = null; if (g.started) { flushMove(); persist(); histCommit(); } log('xr twist: move committed'); }
  histCommit(); pendingEdit = null;
  eg = { kind: 'twist', xr: true, id: inst.id, axis, srcs: [...xrFingers].slice(0, 2), p0: null, p1: null, yaw0: inst[axis] || 0, t0: performance.now(), started: false, fine: false, total: 0 };
  editDragMoved = false; editPress = true; xrLocked = true; log('xr twist: start, ' + xrFingers.size + ' sources');
}
function xrTwistFrame(frame, rs) {
  const g = eg; if (!g || g.kind !== 'twist' || !g.xr) return;
  const inst = instOf(g.id); if (!inst) { editEnd(); return; }
  const a = xrScreenPoint(g.srcs[0], frame, rs), b = xrScreenPoint(g.srcs[1], frame, rs);
  if (!a || !b) { editLogThrottled('xr twist: no screen point (' + (a ? '' : 'first ') + (b ? '' : 'second') + ')'); return; }
  if (!g.p0) { g.p0 = a.p; g.p1 = b.p; g.t0 = performance.now(); log('xr twist: positions from ' + a.how + ' / ' + b.how); return; }
  const d = ED.twistDeg(g.p0, g.p1, a.p, b.p);
  if (!g.started) { if (Math.abs(d) < 3) return; g.started = true; g.fine = ED.isLongPress(g.t0, performance.now()); editDragMoved = true; }
  g.total = ED.snapDeg(d, g.fine, g.axis); inst[g.axis] = ED.applyAxis(g.axis, g.yaw0, d, g.fine); fastMove(); editChip(ED.rotText(g.total, g.axis) + (g.fine ? ' (fine)' : ''));
  editLogThrottled('xr twist angle ' + Math.round(d) + ' deg, snapped ' + g.total);
}
// ---- DOM touch twist inside an AR session: Chrome AR gives only one transient XR input source, so the second finger is read from DOM touch events on the overlay root (capture phase, whatever child it lands on) ----
let domLock = false, domTouchLogged = false;   // domLock: a DOM twist is running or its fingers are still down: no XR drag / update meanwhile
const touchUi = t => !!(t && t.closest && t.closest('button, input, select, textarea, a, label, dialog, #ctx, #menu, #modedial, #toasts, #editbar'));
const touchPts = e => [[e.touches[0].clientX, e.touches[0].clientY], [e.touches[1].clientX, e.touches[1].clientY]];
const tdesc = t => (t && (t.id || t.tagName)) || '?';
router.on('gesture', 'touchstart', e => {
  if (!domTouchLogged) { domTouchLogged = true; log('first DOM touchstart this session (target ' + tdesc(e.target) + ', touches ' + e.touches.length + ', session ' + !!session + ')'); }
  if (!session || e.touches.length !== 2 || touchUi(e.target)) return;
  const inst = selInst();
  if (!editActive() || !inst) { log('dom twist: not starting (editActive ' + editActive() + ')'); return; }
  const taxis = ED.rotAxisOf(editInfo(inst).st); if (!taxis) { log('dom twist: every rotate axis is locked'); return; }
  if (eg) { const g = eg; eg = null; if (g.started) { flushMove(); persist(); histCommit(); } log('dom twist: move committed'); }
  histCommit(); pendingEdit = null; domLock = true; editPress = true; editDragMoved = false;
  const pts = touchPts(e);
  eg = { kind: 'twist', dom: true, id: inst.id, axis: taxis, p0: pts[0], p1: pts[1], yaw0: inst[taxis] || 0, t0: performance.now(), started: false, fine: false, total: 0 };
  log('dom twist start (target ' + tdesc(e.target) + ')'); e.preventDefault();
});
router.on('gesture', 'touchmove', e => {
  if (!(eg && eg.kind === 'twist' && eg.dom)) return;
  if (e.touches.length < 2) return; e.preventDefault();
  const inst = instOf(eg.id); if (!inst) { editEnd(); return; }
  const pts = touchPts(e), d = ED.twistDeg(eg.p0, eg.p1, pts[0], pts[1]);
  if (!eg.started) { if (Math.abs(d) < 3) return; eg.started = true; eg.fine = ED.isLongPress(eg.t0, performance.now()); editDragMoved = true; }
  eg.total = ED.snapDeg(d, eg.fine, eg.axis); inst[eg.axis] = ED.applyAxis(eg.axis, eg.yaw0, d, eg.fine); fastMove(); editChip(ED.rotText(eg.total, eg.axis) + (eg.fine ? ' (fine)' : ''));
  editLogThrottled('dom twist angle ' + Math.round(d) + ' deg, snapped ' + eg.total);
});
for (const ev of ['touchend', 'touchcancel']) router.on('ui', ev, e => {
  if (eg && eg.kind === 'twist' && eg.dom && e.touches.length < 2) { log('dom twist end, total ' + eg.total + ' deg'); editEnd(); }
  if (!e.touches.length) domLock = false;
});
// two-finger twist: the unlocked rotate axis (yaw) turns by the snapped twist angle
const fingers = new Map();
const editUiTarget = e => { const t = e.target; return t === renderer.domElement || t === overlay || t === document.body || t === document.documentElement; };
function twistBegin() {
  const inst = selInst(); if (!editActive() || !inst) return false;
  const ei = editInfo(inst), axis = ED.rotAxisOf(ei.st); if (!axis) return false;
  const pts = [...fingers.values()]; if (pts.length < 2) return false;
  if (eg) { const g = eg; eg = null; if (g.started) { flushMove(); persist(); histCommit(); } }
  histCommit(); controls.enabled = false;
  eg = { kind: 'twist', id: inst.id, axis, p0: pts[0].slice(), p1: pts[1].slice(), yaw0: inst[axis] || 0, t0: performance.now(), started: false, fine: false };
  editDragMoved = false; return true;
}
function twistUpdate() {
  if (!eg || eg.kind !== 'twist' || eg.xr || eg.dom || fingers.size < 2) return;
  const inst = instOf(eg.id); if (!inst) { editEnd(); return; }
  const pts = [...fingers.values()].slice(0, 2), d = ED.twistDeg(eg.p0, eg.p1, pts[0], pts[1]);
  if (!eg.started) { if (Math.abs(d) < 3) return; eg.started = true; eg.fine = ED.isLongPress(eg.t0, performance.now()); editDragMoved = true; }
  inst[eg.axis] = ED.applyAxis(eg.axis, eg.yaw0, d, eg.fine); fastMove(); editChip(ED.rotText(ED.snapDeg(d, eg.fine, eg.axis), eg.axis) + (eg.fine ? ' (fine)' : ''));
}
router.on('gesture', 'pointerdown', e => {
  if (!editUiTarget(e)) return; fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (!session && fingers.size === 2 && twistBegin()) { e.stopImmediatePropagation(); e.preventDefault(); }
  else if (fingers.size >= 2 && eg && eg.kind === 'twist') e.stopImmediatePropagation();
});
router.on('ui', 'pointermove', e => { if (!fingers.has(e.pointerId)) return; fingers.set(e.pointerId, [e.clientX, e.clientY]); if (eg && eg.kind === 'twist') { twistUpdate(); e.preventDefault(); } });
for (const ev of ['pointerup', 'pointercancel']) router.on('ui', ev, e => { if (!fingers.delete(e.pointerId)) return; if (eg && eg.kind === 'twist') editEnd(); });
wire('again', () => { if (session) { cancelAdd(); suspendMarks(); setMode('reticle'); anchor = null; scanHint(scan.start(performance.now())); }  });
wire('drop', dropMark); wire('undomark', undoMark);
wire('rmmark', () => { const i = selMark >= 0 ? selMark : hovMark; if (i >= 0) removeMarkAt(i); }); wire('rmmeasure', () => { if (selMeasure >= 0) removeMeasureAt(selMeasure); });
wire('mnew', () => { cancelPending(); flashMsg('Tap point A'); }); wire('mundo', undoMeasure); wire('mclear', clearMeasures);
wire('select', () => { if (hoveredId) selectPart(hoveredId); });
wire('deselect', () => selectPart(null));
wire('clearmarks', clearMarks);
wire('reset', () => {
  cancelAdd(); closeLib();
  state = startScene().insts;
  selectedId = null; rebuild(); setOffs({ ...OFS.ZERO });
});
wire('back', () => { sizeOpen = false; });
wire('xray', () => setXray(xray.mode === 'solid' ? 'ghost' : 'solid'));   // one toggle: the battery as a ghost, or solid again
wire('rec', () => { if (adding) cancelAdd(); closeLib(); recOpen = true; $('ctx').scrollLeft = 0; });

// ---- recording mode (#126): a clean camera. Hides the build stamp, toasts (queued silently), the context card and every control except a small
//      translucent corner button that opens a mini bar (next option, x-ray, pause, exit). Optional auto-cycle of options A-F every 4, 6 or 8 s with a glass caption. ----
let cycle = RC.createCycle(PR.ids());   // re-created once the start scene is known (battery or fan options)
let cycleTimer = 0;
const curOption = () => PR.presetOf(C.SC, state);
function updateRecUi() {
  document.body.classList.toggle('rec', rec.on);
  $('recbtn').hidden = !rec.on; $('recbtn').setAttribute('aria-expanded', String(rec.bar)); $('recbtn').setAttribute('aria-label', rec.bar ? 'Hide recording tools' : 'Recording tools');
  $('recbar').hidden = !(rec.on && rec.bar);
  $('rbpause').hidden = !rec.chosen;
  const cur = C && curOption(), cap = $('reccap'), txt = rec.on && rec.chosen && cur ? RC.captionText(PR.byId(cur), stackH, v => MD.fmtLen(v, units)) : '';
  cap.hidden = !txt; if (txt && cap.textContent !== txt) cap.textContent = txt;
}
function startRec(secs = 0) {
  if (rec.on || !C) return;
  cancelAdd(); closeLib(); cancelLink(); endMove(); hideQuick(); selectPart(null); selectMark(-1); selectMeasure(-1);
  closeDlgs(); recOpen = false; if (tool !== 'select') setTool('select');
  rec.on = true; rec.bar = false; rec.chosen = secs > 0;
  toastStack.hold(); renderToasts(); log('recording on' + (secs ? ', auto ' + secs + ' s' : ''));
  if (rec.chosen) {
    const first = cycle.start(Date.now(), secs, curOption()); if (first) applyOption(first);
    clearInterval(cycleTimer); cycleTimer = setInterval(() => { const id = cycle.tick(Date.now()); if (id) applyOption(id); }, 250);
  }
  refreshOutline(); applyTints(); updateCross(); readout(); setTimeout(fit, 0);
}
function stopRec() {
  if (!rec.on) return;
  rec.on = false; rec.bar = false; rec.chosen = false; cycle.stop(); clearInterval(cycleTimer); cycleTimer = 0;
  toastStack.release(Date.now()); renderToasts(); log('recording off');
  refreshOutline(); applyTints(); updateCross(); readout(); setTimeout(fit, 0);
}
function recNext() {
  const id = cycle.on ? cycle.next(Date.now()) : RC.stepId(PR.ids(), curOption() || optLast || 'F'); applyOption(id);
}
wire('recbtn', () => { rec.bar = !rec.bar; });
wire('rbnext', recNext); wire('rbxray', () => setXray('next')); wire('rbpause', () => { cycle.toggle(Date.now()); });
wire('rbexit', stopRec);
wire('recback', () => { recOpen = false; });
for (const [id, n] of [['rec0', 0], ['rec4', 4], ['rec6', 6], ['rec8', 8]]) wire(id, () => startRec(n));
router.on('ui', 'keydown', e => { if (e.key === 'Escape' && rec.on) stopRec(); });
// the rows follow the page theme choice (<tb-theme> sets it on the root); rows keep their own data-theme so their buttons are themed even before a choice
{
  const sync = v => { const t = v === 'light' || v === 'dark' ? v : 'auto'; ctl.setAttribute('data-theme', t); document.querySelectorAll('dialog.dlg').forEach(d => d.setAttribute('data-theme', t)); };
  sync(document.documentElement.getAttribute('data-theme'));
  document.addEventListener('tb-theme-change', e => sync(e.detail && e.detail.value));
}
// context row on desktop: the wheel scrolls it sideways, and a mouse drag scrolls it too (a drag does not click the button under it)
{
  let drag = null;
  router.on('ui', 'wheel', e => { if (!ctx.contains(e.target) || ctx.scrollWidth <= ctx.clientWidth) return; ctx.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; e.preventDefault(); });
  router.on('ui', 'pointerdown', e => { if (ctx.contains(e.target) && e.pointerType === 'mouse' && e.button === 0) drag = { x: e.clientX, left: ctx.scrollLeft, moved: false }; });
  router.on('ui', 'pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 5) drag.moved = true; if (drag.moved) ctx.scrollLeft = drag.left - dx; });
  router.on('ui', 'pointerup', () => { if (drag && drag.moved) { const d = drag; setTimeout(() => { if (drag === d) drag = null; }, 0); } else drag = null; });
  router.guard(e => { if (drag && drag.moved && ctx.contains(e.target)) { drag = null; return true; } return false; });   // a drag does not click the button under it
}
// touches on our controls must not place the model
overlay.addEventListener('beforexrselect', e => { if (e.target !== overlay) e.preventDefault(); });
ctl.addEventListener('beforexrselect', e => e.preventDefault());

// ---- Add part: library list, compatible outlets (xr/match.js), place on an outlet or on a surface; Remove ----
const toastEl = $('toasts');
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
    if (t.close === false) { el.classList.add('noclose'); el.append(tx); } else el.append(tx, x);
    host.appendChild(el);
    let g = null;   // swipe sideways or tap the toast to dismiss it
    el.addEventListener('pointerdown', e => { if (e.button) return; g = { x: e.clientX, y: e.clientY, t: performance.now() }; el.classList.add('drag'); try { el.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ } });
    el.addEventListener('pointermove', e => { if (!g) return; const dx = e.clientX - g.x; el.style.transform = 'translateX(' + dx + 'px)'; el.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 200)); });
    const end = e => {
      if (!g) return; const x0 = g.x, y0 = g.y; const r = gestureOutcome(e.clientX - g.x, e.clientY - g.y, performance.now() - g.t); g = null; el.classList.remove('drag');
      if (r === 'dismiss' && e.type === 'pointerup') { const tap = Math.hypot(e.clientX - x0, e.clientY - y0) <= 8; if (t.action === 'resume' && tap) resumeAR(); dismissToast(t.id); }   // resume first: the tap is the user gesture that restarts the session else { el.style.transform = ''; el.style.opacity = ''; }
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  const nx = toastStack.nextExpiry();
  if (nx !== Infinity) toastTimer = setTimeout(renderToasts, Math.max(0, nx - Date.now()) + 10);
}
function dismissToast(id) { const t = toastStack.list().find(x => x.id === id); if (toastStack.dismiss(id)) renderToasts(); if (t && t.action === 'resume' && life.state === 'paused' && !resumed) life.send('dismiss'); }
// toast(text, warn, ms): ms 0 = a prompt that stays until toast('') clears it. Empty text clears the prompt.
function toast(t, warn = false, ms = 3500, level, opts = null) {
  if (!t) { if (toastStack.dismissKey('prompt')) renderToasts(); return; }
  level = level || (warn ? 'warn' : 'info'); log('toast ' + level + ': ' + t + (toastStack.held ? ' (queued, recording)' : ''));
  if (opts) toastStack.add({ text: t, level, ...opts }, Date.now());   // keyed note: replaces the previous one with the same key
  else if (ms === 0 && level === 'info') toastStack.add({ text: t, key: 'prompt', sticky: true }, Date.now());
  else toastStack.add({ text: t, level }, Date.now());
  renderToasts();
}
let closeMenuFn = () => {};
// menu (top right, in XR too): Scene, Enter / Exit AR, Add part, Option, Theme, Units, Debug. Closes on outside tap, Esc, or the button.
{
  const btn = $('menubtn'), panel = $('menu');
  const setOpen = o => { panel.hidden = !o; btn.setAttribute('aria-expanded', String(o)); };
  closeMenuFn = () => setOpen(false);
  act('menubtn', () => setOpen(panel.hidden));
  router.on('ui', 'pointerdown', e => { if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) setOpen(false); });
  router.on('ui', 'keydown', e => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); } });
  new MutationObserver(() => { syncArItem(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  router.on('ui', 'click', e => { if (panel.contains(e.target) && e.target.closest('button.mi:not(#aboutbtn)')) setOpen(false); });   // an item was chosen: the menu gets out of the way
  const th = () => { const v = document.documentElement.getAttribute('data-theme'); for (const el of [btn, panel]) el.setAttribute('data-theme', v === 'light' || v === 'dark' ? v : 'auto'); };
  th(); document.addEventListener('tb-theme-change', th);
}
// ---- controls (round 4): floating buttons, undo / redo, and the Scene and Add part dialogs ----
// Dialogs are native <dialog> elements inside the overlay root, opened with show() (not showModal(): the top layer may not draw over the AR camera inside dom-overlay),
// with our own scrim, Escape and outside-tap handling. Touches on them never reach the AR scene (beforexrselect on the overlay, see above).
const scrim = $('scrim'), scenedlg = $('scenedlg'), partsdlg = $('partsdlg'), dlgs = [scenedlg, partsdlg];
function syncScrim() { scrim.hidden = !dlgs.some(d => d.open); }
function openDlg(d) { for (const o of dlgs) if (o !== d && o.open) o.close(); modeDial.close(); d.show(); syncScrim(); syncFabs(); }
function closeDlg(d) { if (d.open) d.close(); syncScrim(); }
function closeDlgs() { for (const d of dlgs) if (d.open) d.close(); syncScrim(); }
act('scrim', closeDlgs);
act('sceneclose', () => closeDlg(scenedlg)); act('partsclose', () => closeDlg(partsdlg));
router.on('ui', 'keydown', e => { if (e.key !== 'Escape') return; const top = partsdlg.open ? partsdlg : scenedlg.open ? scenedlg : null; if (top) { closeDlg(top); e.preventDefault(); } else if (modeDial.open) { modeDial.close(); syncFabs(); } });
for (const d of dlgs) d.addEventListener('beforexrselect', e => e.preventDefault());

// floating buttons: the context "..." (a toggle that only its own button closes) and the modes speed dial (a pick switches the mode and collapses)
const MODE_ICON = { select: 'cursor', mark: 'pin', measure: 'ruler' };
$('ctxfab').innerHTML = IC.svg('dots');
for (const t of [...MD.TOOLS].reverse()) {   // the first mode sits next to the main button
  const b = document.createElement('button'); b.type = 'button'; b.dataset.action = 'mode-pick'; b.dataset.tool = t; b.setAttribute('role', 'menuitem'); b.setAttribute('data-space-model', 'relative');
  b.innerHTML = IC.svg(MODE_ICON[t]) + '<span class="t">' + MD.TOOL_LABEL[t] + '</span>'; $('modelist').appendChild(b);
}
function syncFabs() {
  const cf = $('ctxfab'); cf.setAttribute('aria-expanded', String(ctxT.open)); cf.setAttribute('aria-label', ctxT.open ? 'Hide part actions' : 'Part actions');
  modeDial.current = tool;
  const mf = $('modefab'), m = IC.svg(MODE_ICON[tool]) + '<span class="t">' + MD.TOOL_LABEL[tool] + '</span>';
  if (mf.dataset.m !== m) { mf.innerHTML = m; mf.dataset.m = m; }
  mf.setAttribute('aria-expanded', String(modeDial.open)); mf.setAttribute('aria-label', 'Mode: ' + MD.TOOL_LABEL[tool] + '. Tap to ' + (modeDial.open ? 'close the list' : 'change'));
  $('modelist').hidden = !modeDial.open;
  for (const b of $('modelist').children) { const on = b.dataset.tool === tool; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
}
act('ctxfab', () => { ctxT.toggle(); readout(); });
act('modefab', () => { modeDial.toggle(); syncFabs(); });
router.act('mode-pick', b => { modeDial.choose(b.dataset.tool); setTool(b.dataset.tool); readout(); });
router.on('ui', 'pointerdown', e => { if (modeDial.open && !$('modedial').contains(e.target)) { modeDial.close(); syncFabs(); } });

// undo / redo: snapshots of the parts, offsets and jumpers, committed shortly after any change (a held +/- is one step). Marks and measurements keep their own Undo.
const snapNow = () => ({ state: JSON.parse(JSON.stringify(state)), offs: { ...offs }, jumpers: JSON.parse(JSON.stringify(jumpers)) });
function histCommit() { clearTimeout(histT); if (C && hist.commit(snapNow())) readout(); }
function doUndo(redo) {
  histCommit();
  const sn = redo ? hist.redo() : hist.undo(); if (!sn) return;
  cancelAdd(); cancelLink(); endMove(); hideQuick();
  state = JSON.parse(JSON.stringify(sn.state)); offs = { ...sn.offs }; jumpers = JSON.parse(JSON.stringify(sn.jumpers)); selJumper = null;
  if (selectedId && !instOf(selectedId)) selectPart(null);
  applyOffsets(); rebuild(); toast(redo ? 'Redone' : 'Undone', false, 1200); log((redo ? 'redo' : 'undo') + ', ' + hist.undoS.length + ' undo / ' + hist.redoS.length + ' redo left');
}
act('undo', () => doUndo(false)); act('redo', () => doUndo(true));
router.on('ui', 'keydown', e => { if ((e.ctrlKey || e.metaKey) && !e.altKey && e.target && e.target.tagName !== 'INPUT' && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) { doUndo(e.key === 'y' || e.shiftKey); e.preventDefault(); } });

// ---- Scene dialog: new empty scene first, then every start scene (battery options, fume extractor, solar roof) ----
const thumbOf = id => { const p = C.partOf(id); return p && p.thumb || ''; };
function sceneHosts() {
  return [{ host: '', hostId: C.catalog.host, title: 'Battery', presets: PR.BATTERY_PRESETS }, { host: 'fan-80mm', hostId: 'fan-80mm', title: 'Fume extractor', presets: PR.FAN_PRESETS }, { host: 'roof-rack', hostId: 'roof-rack', title: 'Solar roof', presets: PR.SOLAR_PRESETS }];
}
function curSceneId() { const o = PR.presetOf(C.SC, state); return o ? (C.SC.isDefaultHost ? 'battery' : C.SC.host.id) + ':' + o : ''; }
function openScenes() {
  if (!C) return;
  cancelAdd(); hideQuick(); closeLib();
  const ul = $('scenelist'), cur = curSceneId(); ul.textContent = ''; let grp = null;
  for (const sc of CTL.sceneList(sceneHosts(), id => C.partOf(id))) {
    if (sc.group && sc.group !== grp) { grp = sc.group; const h = document.createElement('li'); h.className = 'gh'; h.textContent = grp; ul.appendChild(h); }
    const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.className = 'tile'; b.dataset.action = 'scene-pick'; b.dataset.scene = sc.id; b.setAttribute('data-space-model', 'relative');
    const th = sc.empty ? '' : thumbOf(sc.thumbPart);
    b.innerHTML = (th ? '<img alt="" src="' + th + '">' : '<span class="ph">' + (sc.empty ? '+' : '') + '</span>') + '<span class="tt"><b></b><small></small></span>';
    b.querySelector('b').textContent = sc.title; b.querySelector('small').textContent = sc.line; b.setAttribute('aria-label', sc.title + ': ' + sc.line);
    if (sc.id === cur) { b.classList.add('on'); b.setAttribute('aria-current', 'true'); }
    li.appendChild(b); ul.appendChild(li); b._sc = sc;
  }
  openDlg(scenedlg); const body = $('scenelist').closest('.dbody'), curTile = ul.querySelector('.tile.on'); body.scrollTop = 0; if (curTile) body.scrollTop = Math.max(0, curTile.offsetTop - body.clientHeight / 2 + curTile.offsetHeight / 2); log('scene dialog open');   // the current scene is marked and in view
}
router.act('scene-pick', b => { if (b._sc) chooseScene(b._sc); });
wire('scenebtn', () => openScenes());
async function chooseScene(sc) {
  closeDlg(scenedlg);
  const h = CTL.sceneUrlHash(sc), sp = new URLSearchParams(location.search); sp.delete('host'); sp.delete('scene');
  try { history.replaceState(null, '', location.pathname + (sp.toString() ? '?' + sp : '') + '#' + h); } catch (e) { /* sandboxed */ }
  try { await loadScene(sc.host, h); toast(sc.title); } catch (e) { log('scene load failed: ' + (e && e.message)); toast('Could not load the scene (' + (e && e.message || 'error') + ')', true, 0, 'error'); }
}
// build a whole start scene in place (no reload, so an AR session and its placement survive)
async function loadScene(hostSel, hash) {
  cancelAdd(); cancelLink(); endMove(); hideQuick(); selectPart(null); editLocks.clear(); eg = null; selMark = selMeasure = -1; recOpen = false; sizeOpen = false;
  const nc = await createComposer('parts/catalog.json', '', hostSel);
  C = nc; PR.setHost(C.SC); cycle = RC.createCycle(PR.ids());
  initialHash = hash; optLast = null; stackH = { pos: null, neg: null }; fitCache.clear(); outletPts = null; numSel.clear(); lastRemoved = null;
  log('scene hash #' + initialHash);
  const hp = new URLSearchParams(hash);
  let sc;
  if (hp.get('empty')) sc = C.SC.fromHash('s=' + C.SC.host.id + ':-:0:');   // the host (battery) alone
  else { sc = startScene(); const oq = hp.get('opt'); if (oq && PR.byId(oq)) { sc = PR.applyPreset(C.SC, sc, oq); optLast = PR.byId(oq).id; } }   // #opt=A..F
  state = sc.insts; offs = sc.offs; storedMarks = sc.marks; storedMeasures = sc.measures; jumpers = sc.jumpers || []; marksLive = true;
  applyOffsets(); await rebuild();
  if (!session) { fit(); frameModel(); }
  updateCross(); restoreMarks(); clearTimeout(histT); hist.init(snapNow()); readout();
  const warm = () => { const ids = !C.SC.isDefaultHost ? C.catalog.parts.filter(p => p.category === C.host.category).map(p => p.id) : PR.PRESETS.flatMap(p => C.SC.fromHash(p.hash).insts.map(i => i.part)); C.preload(ids).then(r => { const n = r.filter(x => x.status === 'rejected').length; log('preload done' + (n ? ', ' + n + ' failed' : '')); }); };   // GLB cache for the options, so switching in AR is instant
  if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 3000 }); else setTimeout(warm, 500);
}

// ---- Add part dialog: search, a grid of parts with thumbnails, a preview pane for the focused part ----
let pdAll = [], pdKeys = {}, pdFocus = null, pdFit = false;   // pdKeys: part id -> outlet keys it fits on the selection / highlight (the Add button targets the first)
function selFit() {   // what the parts would attach to: the selection (outside XR) or the highlight / selection (XR), when something fits it
  const inXR = document.body.classList.contains('inar');
  const t = inXR ? (quick || (selectedId && { kind: 'part', id: selectedId, fit: fitFor('h:' + selectedId, k => k.startsWith(selectedId + '.')) })) : selTarget();
  return t && t.fit && t.fit.length ? t : null;
}
function openLib(fit, title) {   // fit = [{ part, keys }]: show only those parts (the "Add to this" / "Add part here" buttons); no fit: every part, the ones that fit the selection are marked
  if (!C) return;
  cancelAdd(); hideQuick(); if (tool !== 'select') setTool('select');
  const only = Array.isArray(fit) ? fit : null, sf = only ? null : selFit(), fl = only || (sf ? sf.fit : []);
  pdChange = null; pdKeys = Object.fromEntries(fl.map(x => [x.part.id, x.keys])); pdFit = fl.length > 0;
  pdAll = only ? only.map(x => x.part) : C.catalog.parts.filter(p => p !== C.host);
  $('partstitle').textContent = only ? title || 'Fits here' : 'Add part';
  $('partsq').value = ''; focusPart((pdFit ? pdAll.find(p => pdKeys[p.id]) : null) || pdAll[0] || null);
  renderParts(); openDlg(partsdlg); $('partslist').scrollTop = 0; log('parts dialog open');
}
// Change...: the parts dialog on the selected part, with its option values; Apply changes that same instance (same place and attachment) in one undo step
function openChange() {
  const inst = selInst(); if (!inst || !C) return; const p = C.partOf(inst.part); if (!p) return;
  cancelAdd(); hideQuick(); if (tool !== 'select') setTool('select');
  pdChange = inst.id; pdKeys = {}; pdFit = false;
  pdAll = [p, ...CTL.variantsOf(C.catalog.parts, p)];
  $('partstitle').textContent = 'Change ' + (p.short || p.name); $('partsq').value = '';
  focusPart(p, inst); renderParts(); openDlg(partsdlg); $('partslist').scrollTop = 0; log('change dialog open ' + inst.id);
}
// a variant may replace the part only on a mount it fits: same mount kind and, on a stud, the same outlet still accepts it
function swapCheck(inst, np, opts) {
  const op = C.partOf(inst.part);
  if (np.id === op.id) return { ok: true };
  if (MT.mountKind(np) !== MT.mountKind(op)) return { ok: false, why: (np.short || np.name) + ' mounts differently, so it cannot replace ' + (op.short || op.name) + '. Remove and add it instead.' };
  if (inst.on && !inst.at) {
    const o = C.SC.outlets(np.id, opts, state.filter(i => i.id !== inst.id)).find(x => x.key === inst.on);
    if (!o || !o.ok) return { ok: false, why: (np.short || np.name) + ' does not fit here' + (o && o.why ? ': ' + o.why : '') + '.' };
  }
  return { ok: true };
}
function pickPart(np) {
  if (!np) return;
  if (pdChange) {
    const inst = instOf(pdChange), cur = inst && C.partOf(inst.part); if (!inst) return;
    const opts = { ...defOptsOf(np), ...(np.id === cur.id ? inst.opts : {}) }, ck = swapCheck(inst, np, opts);
    focusPart(np, np.id === cur.id ? inst : null);
    if (!ck.ok) pdMsg = ck.why;
    renderParts(); return;
  }
  focusPart(np); renderParts();
}
function applyChange() {
  const inst = instOf(pdChange), np = pdFocus; if (!inst || !np) return;
  const old = C.partOf(inst.part), newOpts = { ...defOptsOf(np) };
  for (const k of Object.keys(inst.opts)) if (np.options && np.options[k] !== undefined && !(np.id !== old.id && (np.options[k].type === 'choice' || np.options[k].type === 'bool'))) newOpts[k] = inst.opts[k];   // sizes carry over
  for (const k of partChoices(np, pdOpts)) newOpts[k] = pdOpts[k];
  const ck = swapCheck(inst, np, newOpts); if (!ck.ok) { pdMsg = ck.why; renderPreview(); return; }
  histCommit();
  if (np.id !== old.id) {
    const nid = C.SC.nextId(state.filter(i => i.id !== inst.id), np.id), oid = inst.id;
    for (const i of state) if (i.on && i.on.startsWith(oid + '.')) i.on = nid + i.on.slice(oid.length);
    for (const j of jumpers) for (const side of ['a', 'b']) if (typeof j[side] === 'string' && j[side].startsWith(oid + '.')) j[side] = nid + j[side].slice(oid.length);
    inst.id = nid; inst.part = np.id; if (selectedId === oid) selectedId = nid; editLocks.delete(oid);
  }
  inst.opts = newOpts; C.SC.syncOpts(state);
  const nm = np.short || np.name; pdChange = null; closeDlg(partsdlg); rebuild(); histCommit(); toast('Changed to ' + nm, false, 1800);
}
wire('change', () => openChange());
function closeLib() { if (!partsdlg.open) return; pdChange = null; closeDlg(partsdlg); log('parts dialog closed'); readout(); }
function renderParts() {
  const list = CTL.searchParts(pdAll, $('partsq').value), ul = $('partslist'); ul.textContent = '';
  if (!list.length) { const li = document.createElement('li'); li.id = 'partsnone'; li.style.gridColumn = '1 / -1'; li.textContent = 'No part matches'; ul.appendChild(li); }
  for (const p of list) {
    const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.className = 'pt'; b.dataset.action = 'part-pick'; b.dataset.part = p.id; b.setAttribute('data-space-model', 'relative');
    if (pdFocus && p.id === pdFocus.id) { b.classList.add('sel'); b.setAttribute('aria-current', 'true'); }
    b.innerHTML = (p.thumb ? '<img alt="" loading="lazy" src="' + p.thumb + '">' : '') + '<span class="nm"></span>';
    b.querySelector('.nm').textContent = (pdKeys[p.id] ? '✓ ' : '') + (p.short || p.name); b.title = p.name;
    li.appendChild(b); ul.appendChild(li);
  }
  renderPreview();
}
const fmtDim = v => MD.fmtLen(v / 0.0254, units).replace(/ in$/, ' in');
// choice and bool options of a part (what the preview shows as segmented buttons / toggles); size options stay with the Size action
const partChoices = (p, opts) => Object.entries((p && p.options) || {}).filter(([, o]) => (o.type === 'choice' || o.type === 'bool') && !o.auto_from && !o.derived && !o.nocycle && PK.optShown(o, opts)).map(([k]) => k);
let pdOpts = {}, pdChange = null, pdMsg = '';   // pdOpts: the option values chosen for the focused part (Add uses them); pdChange: instance id while the dialog is in Change mode
function focusPart(p, keepFrom) {
  pdFocus = p; pdMsg = '';
  const src = keepFrom && keepFrom.part === p.id ? keepFrom.opts : null;
  pdOpts = { ...defOptsOf(p), ...(src || {}) };
}
async function renderPreview() {
  const box = $('partsprev'), p = pdFocus; box.textContent = '';
  if (!p) return;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const top = el('div', 'pv-top'), meta = el('div', 'pv-meta');
  if (p.thumb) { const im = el('img'); im.alt = ''; im.src = p.thumb; top.appendChild(im); }
  const size = el('span', null, ''); size.id = 'pvsize';
  meta.append(el('b', null, p.short || p.name), el('span', null, CT.catOf(p)), size); meta.title = p.name;
  const add = el('button', null, pdChange ? 'Apply' : 'Add'); add.id = 'partsadd'; add.dataset.action = 'pv-add'; add.type = 'button'; add.setAttribute('data-space-model', 'relative'); add.setAttribute('aria-label', (pdChange ? 'Apply to the selected part: ' : 'Add ') + p.name);
  top.append(meta, add); box.appendChild(top);
  const k = pdKeys[p.id];
  if (pdMsg) { const m = el('div', 'pv-sec pv-msg', pdMsg); m.setAttribute('role', 'status'); box.appendChild(m); }
  if (pdFit && !pdChange) box.appendChild(el('div', 'pv-sec', k ? '✓ Fits the selected part: Add puts it there.' : 'Does not fit the selected part: Add puts it in the scene.'));
  const ks = partChoices(p, pdOpts), lines = CTL.sizeLines(p);
  if (ks.length || lines.length) {
    const s = el('div', 'pv-sec'); s.appendChild(el('h3', null, 'Options'));
    for (const key of ks) {
      const o = p.options[key], g = el('div', 'pv-opt'); g.dataset.opt = key; g.setAttribute('role', 'group'); g.setAttribute('aria-label', (o.label || key).trim());
      g.appendChild(el('span', 'pv-lab', (o.label || key).trim()));
      if (o.type === 'bool') { const b = el('button', null, pdOpts[key] ? 'On' : 'Off'); b.type = 'button'; b.dataset.action = 'pv-opt'; b.dataset.opt = key; b.dataset.val = pdOpts[key] ? '' : '1'; b.setAttribute('aria-pressed', String(!!pdOpts[key])); b.setAttribute('data-space-model', 'relative'); g.appendChild(b); }
      else { const row = el('div', 'pv-seg'); for (const [v, e] of Object.entries(o.values)) { const b = el('button', null, e.label || v); b.type = 'button'; b.dataset.action = 'pv-opt'; b.dataset.opt = key; b.dataset.val = v; b.setAttribute('aria-pressed', String(String(pdOpts[key]) === v)); b.setAttribute('data-space-model', 'relative'); row.appendChild(b); } g.appendChild(row); }
      s.appendChild(g);
    }
    for (const t of lines) s.appendChild(el('div', 'pv-line', t));
    box.appendChild(s);
  }
  const vs = CTL.variantsOf(pdChange ? C.catalog.parts : C.catalog.parts.filter(x => x !== C.host), p);
  if (vs.length) {
    const s = el('div', 'pv-sec'), row = el('div', 'pv-var'); s.appendChild(el('h3', null, 'Variants'));
    for (const v of vs) { const b = el('button'); b.type = 'button'; b.dataset.action = 'pv-variant'; b.dataset.variant = v.id; b.setAttribute('data-space-model', 'relative'); b.title = v.name; if (v.thumb) { const im = el('img'); im.alt = ''; im.src = v.thumb; b.appendChild(im); } b.appendChild(el('span', null, v.short || v.name)); row.appendChild(b); }
    s.appendChild(row); box.appendChild(s);
  }
  try { const d = await C.sizeOf(p.id); if (d && pdFocus === p && size.isConnected) size.textContent = 'W ' + fmtDim(d[0]) + ' × H ' + fmtDim(d[1]) + ' × D ' + fmtDim(d[2]); } catch (e) { /* no model */ }
}
router.on('ui', 'input', e => { if (e.target.id !== 'partsq') return; const l = CTL.searchParts(pdAll, $('partsq').value); if (l.length && !l.includes(pdFocus)) focusPart(l[0]); renderParts(); });
router.act('part-pick', b => pickPart(C.partOf(b.dataset.part)));
const pvClick = e => {
  const v = e.target.closest('button[data-variant]');
  const ob = e.target.closest('button[data-opt]');
  if (ob) { const key = ob.dataset.opt, o = pdFocus.options[key]; pdOpts = { ...pdOpts, [key]: o.type === 'bool' ? !!ob.dataset.val : ob.dataset.val }; pdMsg = ''; renderPreview(); return; }
  if (v) { pickPart(C.partOf(v.dataset.variant)); return; }
  if (!e.target.closest('#partsadd') || !pdFocus) return;
  if (pdChange) { applyChange(); return; }
  const id = pdFocus.id, keys = pdKeys[id], dfl = defOptsOf(pdFocus), addOpts = Object.fromEntries(Object.entries(pdOpts).filter(([k, v]) => v !== dfl[k]));   // only what the user changed: the rest follows the outlet (polarity ...)
  closeDlg(partsdlg); startAdd(id, addOpts);   // same rules as before: a stud part on a highlighted outlet it fits, else the rings / the surface
  if (keys && adding && adding.kind === 'stud') { const k = keys.find(x => adding.outlets.some(o => o.key === x)); if (k) setTarget(k, true); }
};
for (const n of ['pv-variant', 'pv-opt', 'pv-add']) router.act(n, (el, e) => pvClick(e));

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
function startAdd(partId, opts = null) {
  const p = C.partOf(partId); if (!p) return;
  cancelAdd(); cancelLink(); selectPart(null);
  if (MT.mountKind(p) === 'stud') {
    const all = C.SC.outlets(partId, { ...C.SC.defOpts(p), ...(opts || {}) }, state), ok = all.filter(o => o.ok);
    if (!ok.length) { toast(MT.noOutletMessage(p, all), true); return; }
    adding = { partId, opts, kind: 'stud', outlets: ok.map(o => ({ key: o.key, seat: C.SC.seatOf(state, partId, o.key) })).filter(o => o.seat), target: null, lock: null };
    adding.target = adding.outlets[0].key; buildOutletMarkers();
    toast(adding.outlets.length + ' compatible ' + MT.threadShort(MT.needsOf(p).needs.thread) + ' stud' + (adding.outlets.length > 1 ? 's' : '') + ': aim or click a ring, then Place', false, 0);
  } else {
    adding = { partId, opts, kind: 'surface', outlets: [], target: null, lock: null };
    toast(!session && !PREVIEW ? 'Click the floor to drop it' : 'Aim at a surface, then Place (or tap)', false, 0);
  }
  closeLib(); ctxT.show(); readout();
}
function cancelAdd() {
  if (!adding) return;
  adding = null; clearOutletMarkers(); toast(''); readout();
}
function finishAdd(r, where) {
  const nm = C.partOf(r.inst.part).short || r.inst.part;
  if (adding && adding.opts) { const sp = C.partOf(r.inst.part); for (const [k, v] of Object.entries(adding.opts)) if (sp.options && sp.options[k] && (sp.options[k].type === 'choice' || sp.options[k].type === 'bool') && !(r.o && r.o[k] !== undefined)) r.inst.opts[k] = v; C.SC.syncOpts(r.insts); }   // the options picked in the dialog
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
wire('addpart', () => openLib()); wire('remove', removeSelected); wire('move', () => { if (!selInst()) return; endMove(); edit.on = !edit.on; editEnd(); log('edit mode ' + (edit.on ? 'on' : 'off')); }); wire('confirm', confirmAdd); wire('cancel', () => { cancelAdd(); cancelLink(); });
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
  for (const i of state) for (const c0 of (C.partOf(i.part).connections || [])) {
    const c = MT.resolveConn(c0, i.opts);
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
  const blocked = !C || !session || tool !== 'select' || adding || partsdlg.open || (session && mode !== 'placed');
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
act('qselect', quickDo(t => { if (t.kind === 'part') selectPart(t.id); }));
act('qadd', quickDo(t => {
  if (t.kind !== 'part') return;
  if (!t.fit.length) { const f = t.free || [], th = [...new Set(f.map(o => o.thread).filter(Boolean))].join(', '); toast(f.length ? 'No library part fits the ' + f.length + ' free outlet' + (f.length > 1 ? 's' : '') + (th ? ' (' + th + ')' : '') + ' of ' + nameOfId(t.id) + ' yet' : 'Nothing fits ' + nameOfId(t.id), true); return; }
  openLib(t.fit, 'Fits ' + nameOfId(t.id));
}));
act('qhere', quickDo(t => { if (t.kind === 'outlet') openLib(t.fit, 'Fits ' + outletName(t.key)); }));
act('qmark', quickDo(t => { if (t.point) dropMarkAt(t.point, t.src); }));
act('qmeasure', quickDo(t => { if (!t.point) return; setTool('measure'); measureAt(t.point); }));

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
// MC4 cable: a plug at each end (18 x 60 mm) and a 6 mm cable that sags a little between them; red + cables ride a little above black - ones where they run side by side. Inches.
function mc4Object(j, L) {
  const g = new THREE.Group(), cable = new THREE.MeshStandardMaterial({ color: CABLE_COL[j.color], roughness: 0.6 }), body = new THREE.MeshStandardMaterial({ color: 0x1a1a1d, roughness: 0.5 }), band = new THREE.MeshStandardMaterial({ color: j.color === 'red' ? 0xd32020 : 0x2a4fd0, roughness: 0.5 });
  const lane = j.color === 'red' ? 0.25 : -0.25, a = [L.a[0], L.a[1] + lane, L.a[2]], b = [L.b[0], L.b[1] + lane, L.b[2]], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), sag = Math.min(len * 0.06, 8);
  const pt = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t], N = 14, r = JMP.OD_IN[j.gauge] / 2;
  for (let i = 0; i < N; i++) g.add(cylBetween(pt(i / N), pt((i + 1) / N), r, cable));
  for (const [p0, p1] of [[pt(0), pt(0.02)], [pt(1), pt(0.98)]]) {
    const d = new THREE.Vector3(...p1).sub(new THREE.Vector3(...p0)).normalize(), e = new THREE.Vector3(...p0).addScaledVector(d, 2.36);
    g.add(cylBetween(p0, e.toArray(), 0.35, body)); const m = new THREE.Vector3(...p0).addScaledVector(d, 1.2), m2 = new THREE.Vector3(...p0).addScaledVector(d, 1.5); g.add(cylBetween(m.toArray(), m2.toArray(), 0.38, band));
  }
  g.scale.setScalar(SCN.IN); g.userData.jumperId = j.id; g.traverse(m => { m.userData.jumperId = j.id; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
}
function jumperObject(j, L) {
  if (JMP.isMc4(j)) return mc4Object(j, L);
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
function jEdit(fn) { const j = jumpers.find(x => x.id === selJumper); if (!j) return; fn(j); updateJumpers(); persistSoon(); }
wire('jgauge', () => jEdit(j => { j.gauge = JMP.nextOf(JMP.gaugesFor(j), j.gauge); }));
wire('jcolor', () => jEdit(j => { j.color = JMP.nextOf(JMP.COLORS, j.color); }));
wire('jremove', () => { if (!selJumper) return; jumpers = jumpers.filter(x => x.id !== selJumper); selJumper = null; updateJumpers(); persistSoon(); toast('Removed jumper'); });
// setting one end by hand: refused unless the lug matches the stud thread (the UI picks the matching end itself)
function jumperSetEnd(id, side, end) {
  const j = jumpers.find(x => x.id === id); if (!j) return { ok: false, why: 'no such jumper' };
  const c = C.SC.connOf(state, side === 'a' ? j.a : j.b), r = JMP.setEnd(j, side, end, c && c.conn && c.conn.accepts && c.conn.accepts.thread);
  if (!r.ok) { toast(r.why, true); return r; }
  Object.assign(j, r.jumper); updateJumpers(); persistSoon(); readout(); return r;
}

// "Cable from here": candidate first ends (outlet keys) of the highlighted / selected thing
function jfromKeys(inXR, qk, tg) {
  if (!C || linking) return null;
  const cur = inXR ? (qk || (selectedId && { kind: 'part', id: selectedId })) : tg;
  if (!cur) return null;
  if (cur.kind === 'outlet') return [cur.key];
  return outletPoints().filter(o => o.key.startsWith(cur.id + '.')).map(o => o.key);
}
act('jfrom', () => {
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
  cancelAdd(); closeLib(); ctxT.show(); selectPart(null);
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
  jumpers = [...jumpers, r.jumper]; endLink(); updateJumpers(); persistSoon(); selectJumper(r.jumper.id);
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
router.on('ui', 'keydown', e => { if (e.key !== 'Escape') return; if (linking) cancelLink();  });

// ---- Options: terminal presets on the battery (xr/presets.js). The battery keeps its pose; only what sits on it is swapped. ----
function updateHeights() {
  const host = state.find(i => i.part === C.host.id), y0 = host && host.at ? host.at[1] : 0, top = {};
  for (const r of roots()) top[r.userData.instanceId] = localBox(r).max.y / SCN.IN - y0;
  stackH = PR.stackHeights(C.SC, state, top);
}
const OPTION_TOAST = { key: 'option', ms: 2200, close: false };   // option names replace each other: one at a time, short, no x
function applyOption(id) {
  const sc = PR.applyPreset(C.SC, sceneNow(), id); if (!sc) return;
  cancelAdd(); cancelLink(); closeLib(); endMove(); hideQuick();
  state = sc.insts; jumpers = sc.jumpers; selJumper = null; optLast = PR.byId(id).id; stackH = { pos: null, neg: null };
  selectPart(null); rebuild(); toast('Option ' + optLast + ': ' + PR.byId(id).name, false, 0, 'info', OPTION_TOAST);
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
  setMode('placed'); scan.placed(); setHint(null); reticle.visible = false;
  scene.updateMatrixWorld(true); restoreMarks();   // marks and measurements come back at the model's new pose
  life.send('place'); ensureModel(resumed); resumed = false;   // after a lost session the model is rebuilt from the kept state
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
  beam.visible = !!beamHit && !mouse && !rec.on; dot.visible = !!beamHit && !rec.on;
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
  try { onFrameBody(time, frame); } catch (e) { log('frame error: ' + (e && e.message || e)); }   // one bad frame must not stop the loop
}
function onFrameBody(time, frame) {
  lastFrame = frame;
  if (!frame) { pivot.matrixWorldNeedsUpdate = true; controls.update(); updateHover(null); updateLink(); renderer.render(scene, camera); return; }
  const rs = renderer.xr.getReferenceSpace();
  pivot.matrixWorldNeedsUpdate = true;
  if (mode === 'reticle' && hitSource) {
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length !== hitCount) { hitCount = hits.length; log('hit-test hits ' + hitCount); }
    const hp = hits.length ? hits[0].getPose(rs) : null;
    if (hp) { lastHit = hits[0]; reticle.visible = true; reticle.matrix.fromArray(hp.transform.matrix); }
    else { reticle.visible = false; lastHit = null; }
    const was = scan.text, ft = scan.update(performance.now(), !!hp);
    if (ft !== null) log('time to first hit ' + Math.round(ft) + ' ms');
    if (scan.text !== was) scanHint(scan.text);
  }
  if (mode === 'placed' && anchor && frame.trackedAnchors && frame.trackedAnchors.has(anchor)) {
    const p = frame.getPose(anchor.anchorSpace, rs);
    if (p) {
      const A = new THREE.Matrix4().fromArray(p.transform.matrix);
      if (!anchorFix) anchorFix = A.clone().invert().multiply(baseMat);   // anchor-local -> our base pose, fixed at placement
      pivot.matrix.copy(A).multiply(anchorFix); pivot.matrixWorldNeedsUpdate = true;
    }
  }
  if (pendingEdit) resolveEditPress(frame, 'frame loop');
  if (eg && eg.kind === 'twist' && eg.xr) xrTwistFrame(frame, rs);
  if (eg && eg.kind === 'move' && eg.src) { const pose = frame.getPose(eg.src.targetRaySpace, rs); if (pose) { if (!eg.logged) { eg.logged = true; log('edit loop: first pose for the input source'); } editUpdate(PK.rayFromPose(pose.transform.position, pose.transform.orientation)); } else editLogThrottled('edit loop: no pose for the input source (targetRayMode ' + eg.src.targetRayMode + ')'); }
  updateHover(frame); updateLink();
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(onFrame);

// ---- session ----
// Lifecycle (xr/lifecycle.js): preview -> starting -> reticle -> placed, and paused when the browser takes the session away
// (app switch, screen recorder panel, notification). The scene state (state, offs, jumpers, marks) is never cleared by a lost session.
const life = LC.createLifecycle(e => log('lifecycle ' + e.from + ' -> ' + e.to + ' (' + e.ev + ')' + (e.fx.length ? ' [' + e.fx.join(',') + ']' : '')));
let userExit = false, resumed = false;
function showPaused() { toastStack.add({ text: LC.PAUSED_TEXT, level: 'info', key: 'paused', sticky: true, action: 'resume' }, Date.now()); renderToasts(); }
function clearPaused() { if (toastStack.dismissKey('paused')) renderToasts(); }
function resumeAR() { if (life.state !== 'paused') return; log('resume tapped'); resumed = true; enterAR(); }
// the session is gone: leave AR visuals, keep every bit of scene state
let xrEnd = null;
const xrH = {};   // the per-session select handlers; the router routes to them (registered once, not per session)
for (const t of ['selectstart', 'selectend', 'select']) router.on('xr', t, ev => xrH[t] && xrH[t](ev));
router.on('xr', 'end', () => { if (xrEnd) xrEnd(); });
function teardownSession(byUser) {
  router.detachXR();
  if (rec.on) stopRec();   // otherwise the 'AR paused' toast stays hidden and auto-cycle keeps running
  const wasPlaced = mode === 'placed';
  endMove(); session = null; hitSource = null; anchor = null; lastHit = null; setMode('preview'); selectPart(null); beam.visible = dot.visible = false; beamHit = null; depthOK = false; cancelAdd(); closeLib(); removeMarkObjs(); removeMeasureObjs(); reticle.visible = false;
  document.body.classList.remove('inar'); grid.visible = true; pivot.visible = true; controls.enabled = true;
  pivot.matrix.identity(); pivot.matrixWorldNeedsUpdate = true; scene.updateMatrixWorld(true); restoreMarks(); scan.reset(); setHint(null); scene.environment = roomEnv; scene.remove(xrLight); fit();
  const r = life.send(byUser ? 'exit' : 'sessionEnd');
  log('session ended ' + (byUser ? 'by the user' : 'by the system') + (wasPlaced ? ', was placed' : '') + ', parts kept: ' + state.length);
  if (r.fx.includes('toast-paused')) showPaused();
}
// the model must be in the scene whenever it is shown: rebuild from state when it is missing or stale
async function ensureModel(force) {
  const n = [...C.SC.locals(state).values()].filter(Boolean).length, have = roots().length;
  if (force || have !== n) { log('rebuild from state (' + (force ? 'forced' : have + ' of ' + n + ' parts present') + ')'); await rebuild(); }
  pivot.visible = true; inner.visible = true; modelHolder.visible = true; applyOffsets(); scene.updateMatrixWorld(true); readout();
  log('model shown: ' + roots().length + ' parts');
}
let startImpl = null;   // test seam: headless runs replace the WebXR request
async function enterAR() {
  life.send(life.state === 'paused' ? 'resume' : 'start'); clearPaused(); userExit = false;
  try {
    await (startImpl || startSession)();
    if (life.state === 'starting') life.send('started');
  } catch (e) {
    if (life.state === 'starting') life.send('startFailed');
    toast('Could not start AR: ' + (e && e.message || e), true, 0, 'error');
  }
}
async function startSession() {
  // three 0.170 calls the GPU depth reader whenever 'depth-sensing' is enabled, whatever usage was granted,
  // and that throws every frame in cpu-optimized mode. So depth is opt-in for experiments: ?depth=1.
  const wantDepth = new URLSearchParams(location.search).get('depth') === '1';
  const opts = { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'anchors', 'local-floor', 'light-estimation'], domOverlay: { root: overlay } };
  if (wantDepth) {
    opts.optionalFeatures.push('depth-sensing');
    opts.depthSensing = { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] };
  }
  let s;
  // listen from the first moment: the session can end while we still await below
  const request = async o => {
    const x = await navigator.xr.requestSession('immersive-ar', o);
    xrEnd = () => { log('xr session end event'); if (x === s && life.state !== 'preview' && life.state !== 'paused') teardownSession(userExit); };
    router.attachXR(x);   // selectstart / select / selectend / end go to the same router object
    return x;
  };
  try { s = await request(opts); }
  catch (e) {   // a browser that rejects the depth config: retry without it
    log('session with depth-sensing rejected (' + (e && e.message || e) + '), retrying without');
    delete opts.depthSensing; opts.optionalFeatures = opts.optionalFeatures.filter(f => f !== 'depth-sensing');
    s = await request(opts);
  }
  if ((s.enabledFeatures || []).includes('depth-sensing') && s.depthUsage !== 'cpu-optimized') {   // three would take its GPU depth path and throw every frame
    log('depth usage ' + s.depthUsage + ' is not cpu-optimized, restarting without depth-sensing');
    const old = s; s = null; try { await old.end(); } catch (e) { /* already ended */ }
    delete opts.depthSensing; opts.optionalFeatures = opts.optionalFeatures.filter(f => f !== 'depth-sensing');
    s = await request(opts);
  }
  renderer.xr.setReferenceSpaceType((s.enabledFeatures || []).includes('local-floor') ? 'local-floor' : 'local');
  try {   // sharpness: render at the device's native resolution, capped for speed
    const nat = window.XRWebGLLayer && XRWebGLLayer.getNativeFramebufferScaleFactor ? XRWebGLLayer.getNativeFramebufferScaleFactor(s) : 1;
    renderer.xr.setFramebufferScaleFactor(Math.min(Math.max(nat, 1), 2));
  } catch (e) { /* keep default */ }
  await renderer.xr.setSession(s);
  session = s;
  beginSessionUi(s);
  xrH.selectstart = ev => {   // Move mode: a press anywhere drags the selected part on its movement plane; a second finger twists. ev.frame is valid inside the event; lastFrame is not
    log('selectstart ' + (ev.inputSource && ev.inputSource.handedness) + '/' + (ev.inputSource && ev.inputSource.targetRayMode) + ', mode ' + mode + ', edit.on ' + edit.on + ', frame ' + !!ev.frame);
    if (ev.inputSource && ev.inputSource.targetRayMode === 'screen') xrFingers.add(ev.inputSource);
    if (mode !== 'placed' || !edit.on) return;
    if (xrFingers.size >= 2 && !(eg && eg.kind === 'twist')) { if (!xrLocked || eg) xrTwistBegin(); editPress = true; return; }
    if (domLock) { editPress = true; log('selectstart: DOM twist owns the touches'); return; }
    if (xrLocked) { editPress = true; log('selectstart: fingers still down after a twist, no new drag'); return; }
    if (!editActive() || eg) { log('selectstart: not starting (editActive ' + editActive() + ', gesture ' + !!eg + ', selected ' + selectedId + ')'); if (selectedId) editPress = true; return; }
    pendingEdit = ev.inputSource; editPress = false; log('edit press pending');
    if (ev.frame) resolveEditPress(ev.frame, 'event frame');
  };
  xrH.selectend = ev => {
    xrFingers.delete(ev.inputSource);
    log('selectend, gesture ' + (eg ? eg.kind : 'none') + ', fingers left ' + xrFingers.size + (pendingEdit === ev.inputSource ? ', still pending: dropped' : ''));
    if (pendingEdit === ev.inputSource) pendingEdit = null;
    if (eg && eg.kind === 'move' && eg.src === ev.inputSource) editEnd();
    else if (eg && eg.kind === 'twist' && eg.xr) { log('xr twist: end, total ' + eg.total + ' deg'); editEnd(); }
    if (!xrFingers.size) xrLocked = false;
  };
  xrH.select = ev => {
    if (editDragMoved) { editDragMoved = false; editPress = false; log('select swallowed (end of a drag)'); return; }
    if (editPress || (edit.on && selectedId && mode === 'placed')) { editPress = false; log('select swallowed (Move mode: a tap never changes the selection)'); return; }
    if (mode === 'reticle') place();
    else if (mode === 'placed') onSceneTap(ev);
  };
  const viewer = await s.requestReferenceSpace('viewer');
  try { hitSource = await s.requestHitTestSource({ space: viewer, entityTypes: ['point', 'plane'] }); log('hit-test source: point+plane'); }
  catch (e) { log('hit-test entityTypes rejected (' + (e && e.message || e) + '), default'); hitSource = await s.requestHitTestSource({ space: viewer }); }
}
function beginSessionUi(s) {
  domTouchLogged = false; domLock = false;   // log the first touch of each session
  document.body.classList.add('inar'); grid.visible = false; pivot.visible = false; controls.enabled = false;
  cancelAdd(); closeLib(); suspendMarks(); setMode('reticle'); scanHint(scan.start(performance.now())); selectPart(null);
  const f = (s && s.enabledFeatures) || [];
  log('session started' + (resumed ? ' (resumed, scene state kept: ' + state.length + ' parts)' : '') + ', features: ' + f.join(','));
  depthOK = f.includes('depth-sensing') && s.depthUsage === 'cpu-optimized'; depthLogged = false;
  log(depthOK ? 'depth sensing: cpu, format ' + s.depthDataFormat : 'depth sensing not available, skipped');
}
// Enter AR / Exit AR: one menu item. Disabled with a short reason when the device cannot do immersive AR.
let arSupport = { known: false, ok: false, why: '' };
function syncArItem() {
  const b = $('armenu'), inAR = document.body.classList.contains('inar');
  const v = inAR ? 'Exit AR' : !arSupport.known ? 'Enter AR' : arSupport.ok ? 'Enter AR' : 'Enter AR · ' + arSupport.why;
  b.disabled = !inAR && !(arSupport.known && arSupport.ok); b.dataset.v = v; b.setAttribute('aria-label', v);
  if (C) compactButtons();
}
act('armenu', () => { if (document.body.classList.contains('inar')) { if (session) { userExit = true; session.end(); } } else enterAR(); });
// page lifecycle: log everything that can take the session away; if the session vanished without an end event, treat it as lost
for (const ev of ['pagehide', 'pageshow', 'freeze', 'resume']) addEventListener(ev, () => log('page ' + ev));
document.addEventListener('visibilitychange', () => {
  log('visibilitychange: ' + document.visibilityState + ', life ' + life.state + ', xr presenting ' + renderer.xr.isPresenting);
  if (document.visibilityState === 'visible' && (life.state === 'reticle' || life.state === 'placed') && !renderer.xr.isPresenting && !startImpl) { log('session gone without an end event'); teardownSession(false); }
});
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); log('webgl context lost'); });
renderer.domElement.addEventListener('webglcontextrestored', () => { log('webgl context restored'); if (C) ensureModel(true); });

function fit() {
  if (renderer.xr.isPresenting) return;
  const w = $('stage').clientWidth, h = $('stage').clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  syncCtlH();
}
// both rows are fixed to the viewport bottom; outside XR the page leaves exactly their height free
function syncCtlH() { const h = ctl.offsetHeight - (ctx.hidden ? 0 : ctx.offsetHeight + 6); document.documentElement.style.setProperty('--ctlh', (document.body.classList.contains('inar') ? 0 : Math.max(0, h)) + 'px'); }   // the action panel floats over the page, only the row and the info line reserve room
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
  const onCv = (stage, type, fn) => router.on(stage, type, fn, cv);   // canvas-only handlers go through the router too
  const ndcOf = e => { const r = cv.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
  onCv('scene', 'pointermove', e => { if (e.pointerType === 'touch') return; ptr.in = true; ptr.cx = e.clientX; ptr.cy = e.clientY; ptr.ndc.copy(ndcOf(e)); });
  onCv('ui', 'pointerleave', () => { ptr.in = false; if (hoveredId) { hoveredId = null; applyTints(); readout(); } });
  // dragging the selected surface part slides it on its mount plane; orbit stays off for the drag (mouse and touch)
  const dragRay = e => pointerRayAt(ndcOf(e));
  onCv('gesture', 'pointerdown', e => {
    if (session || !C || adding || tool !== 'select' || dragMove || eg || (e.pointerType === 'mouse' && e.button)) return;
    if (edit.on) {   // Move mode: a one-finger / mouse press anywhere on the scene drags the selected part by the finger's delta on its movement plane (two fingers still orbit, or twist)
      if (!selectedId) return;
      if (!editBegin(dragRay(e), null)) { log('edit drag refused: ' + editWhy); return; } eg.pointerId = e.pointerId;
      controls.enabled = false; e.stopImmediatePropagation(); try { cv.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ } log('edit drag start ' + selectedId); return;
    }
    const f = moveSel(); if (!f) return;
    scene.updateMatrixWorld(true); raycaster.setFromCamera(ndcOf(e), camera); raycaster.far = 10;
    const h = PK.pickFromHits(raycaster.intersectObjects(roots(), true)); if (!h || h.instanceId !== f.id) return;
    const ray = dragRay(e); modelHolder.updateWorldMatrix(true, false); _inv.copy(modelHolder.matrixWorld).invert();
    _lo.fromArray(ray.origin).applyMatrix4(_inv); _ld.fromArray(ray.dir).transformDirection(_inv);
    let grab;
    if (f.on && isPanel(C.partOf(f.part))) { const pp = panelPoint(f, ray), c = pp && SOL.panelCentre(f, pp.rack, C.partOf); if (!pp) return; grab = [c.x - pp.q[0], c.z - pp.q[1]]; }   // mm in the rack frame
    else { const fa = atOf(f), p0 = XM.rayPlaneY(_lo.toArray(), _ld.toArray(), fa[1] * SCN.IN); if (!p0) return; grab = [fa[0] * SCN.IN - p0[0], fa[2] * SCN.IN - p0[2]]; }
    dragMove = { id: f.id, grab, pointerId: e.pointerId };
    controls.enabled = false; e.stopImmediatePropagation(); try { cv.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
    log('move drag start ' + f.id);
  });
  onCv('scene', 'pointermove', e => { if (eg && eg.kind === 'move' && e.pointerId === eg.pointerId) { editUpdate(dragRay(e)); e.preventDefault(); } });
  onCv('scene', 'pointermove', e => { if (dragMove && e.pointerId === dragMove.pointerId) { slideTo(instOf(dragMove.id), dragRay(e), dragMove.grab); e.preventDefault(); } });
  const endDrag = e => { if (!dragMove || e.pointerId !== dragMove.pointerId) return; dragMove = null; controls.enabled = !session; flushMove(); persist(); log('move drag end'); };
  router.on('ui', 'pointerup', endDrag); router.on('ui', 'pointercancel', endDrag);
  const endEditDrag = e => { if (eg && eg.kind === 'move' && e.pointerId === eg.pointerId) editEnd(); };
  router.on('ui', 'pointerup', endEditDrag); router.on('ui', 'pointercancel', endEditDrag);
  onCv('scene', 'pointerdown', e => {   // pick now: OrbitControls turns even a 2 px jitter into a small camera move, so the pointerup ray would miss a thin part
    let h = null; if (!session && C) { scene.updateMatrixWorld(true); raycaster.setFromCamera(ndcOf(e), camera); raycaster.far = 10; h = PK.pickFromHits(raycaster.intersectObjects(roots(), true)); }
    down = { x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY, t: performance.now(), hit: h };
  });
  router.on('ui', 'pointercancel', () => { down = null; });
  onCv('scene', 'pointermove', e => { if (linking && e.pointerType !== 'mouse') linkAim = { x: e.clientX, y: e.clientY, touch: true }; });
  onCv('scene', 'pointerdown', e => { if (linking && e.pointerType !== 'mouse') linkAim = { x: e.clientX, y: e.clientY, touch: true }; });
  onCv('scene', 'pointerup', ev => {
    let e = ev;
    if (session || !down || !C || rec.on) return;
    if (edit.on && selectedId) { down = null; return; }   // Move mode: a tap never changes the selection (turn Move off to pick another part)
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
router.attach(document);   // the one place DOM listeners for input are attached (capture phase)
// test / debug hooks
window.__ar = { rec: { start: startRec, stop: stopRec, on: () => rec.on, bar: () => rec.bar, cycle: () => ({ on: cycle.on, paused: cycle.paused, secs: cycle.secs }), tick: now => { const id = cycle.tick(now); if (id) applyOption(id); return id; }, option: curOption, caption: () => $('reccap').hidden ? '' : $('reccap').textContent }, xray: { mode: () => xray.mode, set: setXray }, markText: i => marks[i] && marks[i].text, worldPose(id) { const b = roots().find(o => o.userData.instanceId === id); if (!b) return null; scene.updateMatrixWorld(true); const m = new THREE.Matrix4().copy(modelHolder.matrixWorld).invert().multiply(b.matrixWorld), pos = new THREE.Vector3(), q = new THREE.Quaternion(); m.decompose(pos, q, new THREE.Vector3()); const e = new THREE.Euler().setFromQuaternion(q, 'YXZ'); return { pos: pos.toArray(), yaw: ((e.y * 180 / Math.PI) % 360 + 360) % 360 }; }, slideTo: (id, ray) => { const r = slideTo(instOf(id), ray); flushMove(); return r; }, startMove: id => startMove(instOf(id)), endMove, moving: () => !!moving, pickAt(cx, cy) { const r = renderer.domElement.getBoundingClientRect(); scene.updateMatrixWorld(true); raycaster.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera); raycaster.far = 10; const h = PK.pickFromHits(raycaster.intersectObjects(roots(), true)); return h && h.instanceId; }, partIds: () => roots().map(o => o.userData.instanceId), canvasRect: () => { const r = renderer.domElement.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; }, outletScreen(key) { const o = outletPoints().find(x => x.key === key); if (!o) return null; const v = modelHolder.localToWorld(new THREE.Vector3(...o.pos)).project(camera), rc = renderer.domElement.getBoundingClientRect(); return { x: rc.left + (v.x + 1) / 2 * rc.width, y: rc.top + (1 - v.y) / 2 * rc.height }; }, quick: () => quick && { kind: quick.kind, id: quick.id, key: quick.key, fit: quick.fit.map(x => x.part.id), shown: true }, look(dx, dy, dz) { const t = controls.target; camera.position.set(t.x + dx, t.y + dy, t.z + dz); controls.update(); }, target(x, y, z) { controls.target.set(x, y, z); controls.update(); }, hash: persist, startAdd, confirmAdd, cancelAdd, removeSelected, openLib, setTarget, adding: () => adding && { partId: adding.partId, kind: adding.kind, target: adding.target, outlets: adding.outlets.map(o => o.key) }, toast: () => [...toastEl.querySelectorAll('.tx')].map(e => e.textContent).join(' | '), persist, setTool, tool: () => tool, units: () => units, marks: () => marks.length, measures: () => measures.length, dropAt: dropMarkAt, measureAt, selectMark, select: selectPart, selected: () => selectedId, hovered: () => hoveredId, state: () => JSON.parse(JSON.stringify(state)),
  screenOf(id) { const r = roots().find(o => o.userData.instanceId === id); if (!r) return null; const b = new THREE.Box3().setFromObject(r), c = b.getCenter(new THREE.Vector3()).project(camera), rc = renderer.domElement.getBoundingClientRect();
    return { x: rc.left + (c.x + 1) / 2 * rc.width, y: rc.top + (1 - c.y) / 2 * rc.height }; },
  aimAt(id) { const r = roots().find(o => o.userData.instanceId === id); const c = new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()); controls.target.copy(c); controls.update(); } };

Object.assign(window.__ar, { jumper: { start: keys => startLink(keys), pick: pickLink, list: () => JSON.parse(JSON.stringify(jumpers)), sel: () => selJumper, select: selectJumper, linking: () => !!linking, cancel: cancelLink, setEnd: jumperSetEnd, len: id => { const j = jumpers.find(x => x.id === id); return j && jumperLen(j); }, undo: () => doUndo(false), markScreen: key => { const m = linkPts().find(p => p.userData.key === key); if (!m) return null; const v = m.getWorldPosition(new THREE.Vector3()).project(camera), rc = renderer.domElement.getBoundingClientRect(); return { x: rc.left + (v.x + 1) / 2 * rc.width, y: rc.top + (1 - v.y) / 2 * rc.height }; } }, option: applyOption, heights: () => stackH });

// the scene a page starts (and Reset returns) to: the hash, or without one the battery's default stack / the fume extractor option A fully assembled
function startScene() {
  const sc = C.SC.fromHash(initialHash);
  if (!sc.valid && !C.SC.isDefaultHost) { const a = PR.applyPreset(C.SC, sc, 'A'); if (a) { optLast = 'A'; return a; } }
  return sc;
}
// ---- start ----
(async function init() {
  if (q.has('help')) $('help').hidden = false;
  if (PREVIEW) {
    document.body.classList.add('arpreview');
  }
  fit();
  const wantScenes = CTL.needsSceneChoice(location.hash, location.search);   // read before the first persist rewrites the hash
  try { await loadScene(SCN.hostSelFrom(location.search, location.hash), location.hash.slice(1)); }
  catch (e) { status.textContent = 'Could not load parts'; toast('Could not load parts: ' + e.message, true, 0, 'error'); return; }
  if (q.get('sel')) selectPart(q.get('sel'));
  status.textContent = 'Drag to orbit. Real size (inches to metres).';
  const sup = navigator.xr && navigator.xr.isSessionSupported ? await navigator.xr.isSessionSupported('immersive-ar').catch(() => false) : false;
  arSupport = { known: true, ok: !!sup, why: !window.isSecureContext ? 'needs HTTPS' : 'not supported here' }; syncArItem();
  if (!sup) {
    toast(!window.isSecureContext ? 'AR needs HTTPS. Open this page over https (localhost works with port forwarding).'
      : 'AR is not available here: immersive-ar WebXR is not supported. Use Android Chrome with ARCore.', true);
  }
  readout();
  if (wantScenes) openScenes();
  if (q.get('addpart')) { startAdd(q.get('addpart')); if (q.get('target')) setTarget(q.get('target'), true); }   // screenshots
  else if (q.get('open') === 'lib') openLib();
  else if (q.get('open') === 'scene') openScenes();
  else if (q.get('open')) { if (q.get('open') === 'more' || q.get('open') === 'ctx') ctxT.show(); readout(); }
  window.__ready = true;
})();

// headless seam for the lifecycle (no WebXR in a test browser): pretend a session starts, gets placed, is lost, and resumes
Object.assign(window.__ar, { sim: {
  async enter() { startImpl = async () => { session = { end() { teardownSession(userExit); } }; beginSessionUi(null); }; await enterAR(); },
  place() { reticle.visible = true; reticle.matrix.identity(); place(); },
  lose() { teardownSession(false); },
  resume: () => resumeAR(),
  exit() { userExit = true; session && session.end(); },
  life: () => life.state, parts: () => roots().length, wanted: () => [...C.SC.locals(state).values()].filter(Boolean).length,
  wipe() { modelHolder.clear(); },   // simulate a model lost from the scene
  pausedToast: () => toastStack.list().some(t => t.key === 'paused'),
  tapPaused() { const el = [...toastEl.querySelectorAll('.toast')].find(e => /AR paused/.test(e.textContent)); if (!el) return false; const r = el.getBoundingClientRect(), o = { clientX: r.left + 5, clientY: r.top + 5, pointerId: 1, button: 0, bubbles: true }; el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o)); return true; },
} });

// test hooks for the XR row logic (headless sim): select a part, read the state and the visible rows
Object.assign(window.__ar, { select: id => { selectPart(id); }, state: () => JSON.parse(JSON.stringify(state)), rows: () => ({ ctx: [...ctx.children].filter(e => !e.hidden && e.id).map(e => e.id), menu: [...$('menu').querySelectorAll('button.mi')].filter(e => !e.hidden).map(e => e.id) }) });
Object.assign(window.__ar, { edit: { opt: (id, k, v) => { const i = instOf(id); if (i) { i.opts[k] = v; rebuild(); } }, on: () => edit.on, info: id => { const i = instOf(id || selectedId); if (!i) return null; const e = editInfo(i); return { mount: e.mount, st: e.st, note: ED.offMountNote(e.mount, e.st) }; }, begin: (ray, pid) => { const ok = editBegin(ray, null); if (ok) eg.pointerId = pid; return ok; }, update: editUpdate, end: editEnd, twist: deg => { const i = selInst(); if (!i || !ED.rotAxisOf(editInfo(i).st)) return false; histCommit(); { const ax = ED.rotAxisOf(editInfo(i).st); i[ax] = ED.applyAxis(ax, i[ax] || 0, deg); } fastMove(); flushMove(); persist(); histCommit(); return true; } }, hist: () => ({ undo: hist.undoS.length, redo: hist.redoS.length }), undo: doUndo, ctxOpen: () => ctxT.open, modeOpen: () => modeDial.open, commit: histCommit });
