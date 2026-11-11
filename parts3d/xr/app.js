// ar-xr.html: own WebXR immersive-ar session (three.js), no model-viewer. See the ?help checklist in ar-xr.html.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createComposer } from './compose.js';
import * as OFS from '../offsets.js';
import * as XM from './xrmath.js';

const q = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const overlay = $('overlay'), strip = $('strip'), status = $('status'), enterBtn = $('enter'), msg = $('msg'), hint = $('hint');
const PREVIEW = !!q.get('arpreview');

// ---- renderer / scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
$('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
camera.position.set(0.35, 0.3, 0.45);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.1, 0); controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x778899, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(0.6, 1.5, 0.8);
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -0.5, right: 0.5, top: 0.5, bottom: -0.5, near: 0.1, far: 4 });
sun.shadow.bias = -0.0004;

// pivot = placement point (matrix comes from reticle / anchor, never changed by corrections).
// inner = our authoritative correction: position (x,h,z) in the pivot frame, plus yaw. Parts live in inner.
// floorShadow stays under the pivot at floor level, so raising the model leaves its shadow on the floor.
const pivot = new THREE.Group(); pivot.matrixAutoUpdate = false;
const inner = new THREE.Group();
const floorShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.ShadowMaterial({ opacity: 0.35 }));
floorShadow.rotation.x = -Math.PI / 2; floorShadow.receiveShadow = true;
const grid = new THREE.GridHelper(1.2, 24, 0x8a94a3, 0xc9ced6);   // preview only
const modelHolder = new THREE.Group(); inner.add(modelHolder);
pivot.add(inner, floorShadow, grid, sun, sun.target);
scene.add(pivot);

const reticle = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x1affb0, side: THREE.DoubleSide }));
reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

// ---- app state ----
let C, state = [], offs = { ...OFS.ZERO }, selLug = null, busy = false, again = false;
let session = null, hitSource = null, anchor = null, anchorFix = null, lastFrame = null, lastHit = null;
const baseMat = new THREE.Matrix4();
let mode = 'preview';   // preview | reticle | placed
const tmpV = new THREE.Vector3();

const lugs = () => state.filter(i => i.part.startsWith('lug-'));
const covers = () => state.filter(i => i.opts.cover !== undefined);
const sign = id => id.endsWith('-pos') ? '+' : '−';
const lugInst = () => state.find(i => i.part === selLug);
const numKey = p => Object.keys(p.options || {}).find(k => p.options[k].type === 'number');

async function rebuild() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    const root = await C.build(state);
    modelHolder.clear(); modelHolder.add(root);
  } finally { busy = false; if (again) { again = false; rebuild(); } }
}

function applyOffsets() {
  const t = OFS.toTransform(offs);
  inner.position.set(...t.pos); inner.rotation.y = t.yawRad;
  readout();
}
function readout() {
  const li = lugInst(), p = li && C.partOf(li.part), k = p && numKey(p);
  $('ofs').textContent = OFS.describe(offs);
  $('sel').textContent = li ? 'Lug ' + sign(li.part) + ' ' + (k ? li.opts[k] + ' in ' : '') + li.yaw + '°' : 'no lugs';
  $('lugbtn').querySelector('b').textContent = li ? sign(li.part) : '-';
  const cs = covers(); $('cover').setAttribute('aria-pressed', cs.length > 0 && cs.every(i => i.opts.cover));
  for (const id of ['extm', 'extp', 'rotm', 'rotp', 'lugbtn']) $(id).disabled = !li;
  $('cover').disabled = cs.length === 0;
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
  const li = lugInst(); if (!li) return;
  const p = C.partOf(li.part), k = numKey(p);
  li.opts[k] = C.clampNum(p.options[k], li.opts[k] + d); rebuild();
}
wire('extm', () => lugExt(-1)); wire('extp', () => lugExt(1));
wire('lugbtn', () => { const l = lugs(); if (l.length) selLug = l[(l.findIndex(i => i.part === selLug) + 1) % l.length].part; });
const rotLug = d => { const li = lugInst(); if (li) { li.yaw = ((li.yaw + d) % 360 + 360) % 360; rebuild(); } };
wire('rotm', () => rotLug(-15)); wire('rotp', () => rotLug(15));
wire('cover', () => { const cs = covers(), on = !cs.every(i => i.opts.cover); cs.forEach(i => { i.opts.cover = on; }); rebuild(); });
wire('hm', () => setOffs(XM.raise(offs, -XM.HEIGHT_IN))); wire('hp', () => setOffs(XM.raise(offs, XM.HEIGHT_IN)));
for (const [id, dir] of [['nl', 'left'], ['nr', 'right'], ['nu', 'up'], ['nd', 'down']])
  wire(id, () => setOffs(XM.nudge(offs, viewForward(), dir, pivotPsi())));
wire('tm', () => setOffs(XM.turn(offs, -XM.TURN_DEG))); wire('tp', () => setOffs(XM.turn(offs, XM.TURN_DEG)));
wire('again', () => { if (session) { mode = 'reticle'; anchor = null; hint.hidden = false; } });
wire('reset', () => {
  state = C.parseState(new URLSearchParams(location.hash.slice(1)).get('s')) || C.defaultState();
  selLug = lugs()[0]?.part || null; rebuild(); setOffs({ ...OFS.ZERO });
});
wire('exit', () => { if (session) session.end(); });
$('handle').addEventListener('click', () => {
  const open = strip.classList.toggle('open'); $('handle').setAttribute('aria-expanded', open);
  $('handle').querySelector('span').textContent = open ? 'Hide controls' : 'Controls';
});
// touches on our strip must not place the model
overlay.addEventListener('beforexrselect', e => { if (e.target !== overlay) e.preventDefault(); });
strip.addEventListener('beforexrselect', e => e.preventDefault());

// ---- placement ----
function place() {
  if (!reticle.visible) return;
  const pos = new THREE.Vector3();
  reticle.matrix.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
  const psi = XM.psiFacingUser(viewForward());
  baseMat.compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), psi), new THREE.Vector3(1, 1, 1));
  pivot.matrix.copy(baseMat); pivot.visible = true;
  offs = { ...offs, x: 0, z: 0 }; applyOffsets();   // keep height/turn corrections, the surface is new
  mode = 'placed'; hint.hidden = true; reticle.visible = false;
  anchor = null; anchorFix = null;
  const rs = renderer.xr.getReferenceSpace();
  const ok = a => { anchor = a; anchorFix = null; };
  if (lastHit && lastHit.createAnchor) lastHit.createAnchor().then(ok).catch(() => {});
  else if (lastFrame && lastFrame.createAnchor && rs) {
    try { lastFrame.createAnchor(new XRRigidTransform({ x: pos.x, y: pos.y, z: pos.z }), rs).then(ok).catch(() => {}); } catch (e) { /* no anchors */ }
  }
}

function onFrame(time, frame) {
  lastFrame = frame;
  if (!frame) { controls.update(); renderer.render(scene, camera); return; }
  const rs = renderer.xr.getReferenceSpace();
  if (mode === 'reticle' && hitSource) {
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length) { lastHit = hits[0]; reticle.visible = true; reticle.matrix.fromArray(hits[0].getPose(rs).transform.matrix); }
    else { reticle.visible = false; lastHit = null; }
  }
  if (mode === 'placed' && anchor && frame.trackedAnchors && frame.trackedAnchors.has(anchor)) {
    const p = frame.getPose(anchor.anchorSpace, rs);
    if (p) {
      const A = new THREE.Matrix4().fromArray(p.transform.matrix);
      if (!anchorFix) anchorFix = A.clone().invert().multiply(baseMat);   // anchor-local -> our base pose, fixed at placement
      pivot.matrix.copy(A).multiply(anchorFix);
    }
  }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(onFrame);

// ---- session ----
async function enterAR() {
  try {
    const s = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'anchors', 'local-floor'], domOverlay: { root: overlay } });
    renderer.xr.setReferenceSpaceType((s.enabledFeatures || []).includes('local-floor') ? 'local-floor' : 'local');
    await renderer.xr.setSession(s);
    session = s;
    document.body.classList.add('inar'); grid.visible = false; pivot.visible = false; controls.enabled = false;
    mode = 'reticle'; hint.hidden = false;
    s.addEventListener('select', () => { if (mode === 'reticle') place(); });
    s.addEventListener('end', () => {
      session = null; hitSource = null; anchor = null; lastHit = null; mode = 'preview'; reticle.visible = false;
      document.body.classList.remove('inar'); grid.visible = true; pivot.visible = true; controls.enabled = true;
      pivot.matrix.identity(); hint.hidden = true; fit();
    });
    const viewer = await s.requestReferenceSpace('viewer');
    hitSource = await s.requestHitTestSource({ space: viewer });
  } catch (e) { msg.hidden = false; msg.textContent = 'Could not start AR: ' + (e && e.message || e); }
}
enterBtn.addEventListener('click', enterAR);

function fit() {
  if (renderer.xr.isPresenting) return;
  const w = $('stage').clientWidth, h = $('stage').clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', fit);
function frameModel() {   // preview camera: whole model in view, 3/4 angle
  const b = new THREE.Box3().setFromObject(modelHolder), c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2;
  const fov = Math.min(camera.fov, 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect) * 180 / Math.PI);
  const d = (r / Math.sin(fov * Math.PI / 360)) * 1.05;
  controls.target.copy(c); camera.position.copy(c).add(new THREE.Vector3(0.55, 0.45, 0.7).normalize().multiplyScalar(d)); controls.update();
}

// ---- start ----
(async function init() {
  if (q.has('help')) $('help').hidden = false;
  if (PREVIEW) {
    document.body.classList.add('arpreview'); strip.classList.add('open');
    $('handle').setAttribute('aria-expanded', true); $('handle').querySelector('span').textContent = 'Hide controls';
  }
  fit();
  try { C = await createComposer('parts/catalog.json'); }
  catch (e) { status.textContent = 'Could not load parts: ' + e.message; return; }
  const h = new URLSearchParams(location.hash.slice(1));
  state = C.parseState(h.get('s')) || C.defaultState();
  offs = OFS.parse(h.get('o'));
  selLug = lugs()[0]?.part || null;
  applyOffsets(); await rebuild();
  fit(); frameModel();
  status.textContent = 'Drag to orbit. Real size (inches to metres).';
  const sup = navigator.xr && navigator.xr.isSessionSupported ? await navigator.xr.isSessionSupported('immersive-ar').catch(() => false) : false;
  if (sup) enterBtn.hidden = false;
  else {
    msg.hidden = false;
    msg.textContent = !window.isSecureContext ? 'AR needs HTTPS. Open this page over https (localhost works with port forwarding).'
      : 'AR is not available here: immersive-ar WebXR is not supported. Use Android Chrome with ARCore.';
  }
  window.__ready = true;
})();
