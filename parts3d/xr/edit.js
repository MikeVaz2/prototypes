// Pure logic for Edit mode (round 5, ticket #107; round 7: unlock on demand). The mount only sets the DEFAULT lock state: every axis can be unlocked for every part,
// because a real surface never lines up with the real battery. An axis the mount would normally lock, once opened, is reported as 'off the mount'.
// Mount types: 'stud' (bolted on a stud: lugs, 2340, adapters, clamps), 'surface' (rests on a plane: PowerBar, splices, panels on rails, the AC70 on the floor, the battery),
// 'free' (nothing under it: detached). No DOM, no three.js. Lengths in metres unless a name says mm; angles in degrees.
// Axes: X, Y along the surface, Z = surface normal. The surface is horizontal here, so in the model frame (y up): X = +x, Y = -z, Z = +y. Free parts use the same (world axes, Z up).

export const AXES = ['mx', 'my', 'mz', 'pitch', 'roll', 'yaw'];
export const MOVE_AXES = ['mx', 'my', 'mz'];
export const ROT_AXES = ['yaw', 'pitch', 'roll'];   // priority when several are unlocked: the twist turns the first
export const AXIS_VEC = { mx: [1, 0, 0], my: [0, 0, -1], mz: [0, 1, 0] };
export const AXIS_LABEL = { mx: 'X', my: 'Y', mz: 'Z', pitch: 'Pitch', roll: 'Roll', yaw: 'Yaw' };
export const AXIS_ICON = { mx: '↔', my: '↕', mz: '⬆', pitch: '⇅', roll: '↻', yaw: '↺' };
export const SNAP_MM = 5, SNAP_DEG = 15, FINE_MM = 1, FINE_DEG = 1, LONG_PRESS_MS = 450, FLOAT_MM = 1;
export const SNAP_TILT_DEG = 1, FINE_TILT_DEG = 0.1, STEP_Z_MM = 1, STEP_TILT_DEG = 1;   // pitch / roll snap to 1 degree by default (alignment), 0.1 when fine; the +/- buttons step 1 mm / 1 degree

// ---- mount classification ----
// p = { host (the battery / rack itself), on (stacked on an outlet), at (surface position in inches, or null), panel (a panel on rails), free (explicit detach) }
// host and at-parts rest on a surface unless they were lifted (at[1] > 1 mm) or detached; a stacked panel is on the rails (a plane); anything else stacked is on a stud.
export function mountOf(p) {
  if (p.free) return 'free';
  if (p.host) return p.at && p.at[1] * 0.0254 * 1000 > FLOAT_MM ? 'free' : 'surface';
  if (p.on && !p.at) return p.panel ? 'surface' : 'stud';
  if (p.at) return p.at[1] * 0.0254 * 1000 > FLOAT_MM ? 'free' : 'surface';
  return 'free';
}
// what the user may unlock: everything, for every mount (kept as a function so callers and tests state the rule in one place)
export function capsFor() { return { mx: true, my: true, mz: true, pitch: true, roll: true, yaw: true }; }
// lock defaults (true = locked). Surface and free: move X, Y and yaw open. Stud (bolted): fully locked until the user opens yaw.
// `only`: a part may list the axes that start open (catalog `edit_unlocked`, the hold-down bar: ['mx']); everything else starts locked
export function defaultLocks(mount, only) {
  if (Array.isArray(only)) return Object.fromEntries(AXES.map(a => [a, !only.includes(a)]));
  if (mount === 'stud') return { mx: true, my: true, mz: true, pitch: true, roll: true, yaw: true };
  return { mx: false, my: false, mz: true, pitch: true, roll: true, yaw: false };
}
// effective state per axis: 'on' (unlocked) or 'locked'. Nothing is ever 'off' any more.
export function axisStates(mount, locks) {
  const out = {};
  for (const a of AXES) out[a] = locks[a] ? 'locked' : 'on';
  return out;
}
// axes the mount would lock by default that the user opened: "off the mount: Z, Pitch" (empty when none)
export function offMount(mount, st) { const d = defaultLocks(mount); return AXES.filter(a => d[a] && st[a] === 'on'); }
export function offMountNote(mount, st) { const o = offMount(mount, st); return o.length ? 'off the mount: ' + o.map(a => AXIS_LABEL[a]).join(', ') : ''; }
export const unlockedMoves = st => MOVE_AXES.filter(a => st[a] === 'on');
export const rotAxisOf = st => ROT_AXES.find(a => st[a] === 'on') || null;
// flip one chip (any axis, any mount)
export function toggleLock(mount, locks, axis) { return { ...locks, [axis]: !locks[axis] }; }
// a locked / bolted part: nothing unlocked
export const isFullyLocked = st => !unlockedMoves(st).length && !rotAxisOf(st);

// ---- detach: the part keeps its world place and becomes free ----
// pos metres in the model (surface) frame, yaw degrees -> the part fields
export const detachFields = (pos, yaw) => ({ at: pos.map(v => Math.round(v / 0.0254 * 1000) / 1000), yaw: ((yaw % 360) + 360) % 360, on: null, free: true });

// ---- vector helpers ----
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return mul(a, 1 / l); };

// ---- drag projection ----
// Where the ray {origin, dir} meets the allowed set through `anchor`: one axis = the closest point of that line to the ray, two = the plane they span, three = the plane facing the viewer (normal = viewDir).
// axes: unit vectors (orthonormal). null when nothing is unlocked, or the ray is parallel to the plane / line.
export function hitOnAllowed(ray, anchor, axes, viewDir = ray.dir) {
  const o = ray.origin, d = ray.dir;
  if (!axes.length) return null;
  if (axes.length === 1) {   // the plane through the axis facing the viewer: a vertical drag on screen moves along a vertical axis
    const a = axes[0], v = viewDir, k = dot(v, a), nn = sub(v, mul(a, k)), l = Math.hypot(...nn);
    if (l < 1e-6) return null;
    const n1 = mul(nn, 1 / l), den1 = dot(n1, d); if (Math.abs(den1) < 1e-9) return null;
    const t1 = dot(n1, sub(anchor, o)) / den1; if (t1 < 0) return null;
    const h = add(o, mul(d, t1));
    return add(anchor, mul(a, dot(sub(h, anchor), a)));
  }
  const n = axes.length === 2 ? norm(cross(axes[0], axes[1])) : norm(viewDir), den = dot(n, d);
  if (Math.abs(den) < 1e-9) return null;
  const t = dot(n, sub(anchor, o)) / den;
  return t < 0 ? null : add(o, mul(d, t));
}
export const snapTo = (v, step) => { const r = Math.round(v / step) * step; return Math.abs(r) < 1e-12 ? 0 : r; };
export const stepM = fine => (fine ? FINE_MM : SNAP_MM) / 1000;
export const stepDeg = (fine, axis = 'yaw') => axis === 'pitch' || axis === 'roll' ? (fine ? FINE_TILT_DEG : SNAP_TILT_DEG) : fine ? FINE_DEG : SNAP_DEG;
// One drag sample. start: { pos (part position at press), hit (allowed-set hit at press) }, axes: names of the unlocked move axes.
// -> { delta: [x,y,z] snapped, comps: { mx, my, mz } metres snapped, pos } or null. Moves only along the unlocked axes, so a surface part never leaves its plane.
export function dragMove(ray, start, axisNames, fine = false, viewDir) {
  const vecs = axisNames.map(a => AXIS_VEC[a]), h = hitOnAllowed(ray, start.pos, vecs, viewDir);
  if (!h || !start.hit) return null;
  const d = sub(h, start.hit), step = stepM(fine), comps = {};
  let delta = [0, 0, 0];
  axisNames.forEach((a, i) => { const c = snapTo(dot(d, vecs[i]), step); comps[a] = c; delta = add(delta, mul(vecs[i], c)); });
  return { delta, comps, pos: add(start.pos, delta) };
}
export const pressHit = (ray, pos, axisNames, viewDir) => hitOnAllowed(ray, pos, axisNames.map(a => AXIS_VEC[a]), viewDir);

// ---- rotation by a two-finger twist ----
// angle (degrees, counter-clockwise on screen = positive) from the first finger pair to the current one, in (-180, 180]
export function twistDeg(a0, b0, a1, b1) {
  const ang = (a, b) => Math.atan2(-(b[1] - a[1]), b[0] - a[0]);   // screen y points down
  let d = (ang(a1, b1) - ang(a0, b0)) * 180 / Math.PI;
  d = ((d % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}
export const snapDeg = (deg, fine = false, axis = 'yaw') => snapTo(deg, stepDeg(fine, axis));
export const normDeg = d => ((d % 360) + 360) % 360;
// new yaw (degrees, the part's own convention: three.js rotation.y, counter-clockwise seen from above is positive) from a screen twist: a counter-clockwise twist turns the part counter-clockwise
export const applyYaw = (yaw0, twist, fine = false) => normDeg(yaw0 + snapDeg(twist, fine));
// pitch / roll are signed, kept in (-180, 180]; the twist is added to the current value
export const normSigned = d => { const r = normDeg(d); return r > 180 ? r - 360 : r; };
export const applyAxis = (axis, v0, twist, fine = false) => axis === 'yaw' ? applyYaw(v0, twist, fine) : Math.round(normSigned(v0 + snapDeg(twist, fine, axis)) * 1000) / 1000;
// one +/- step (buttons next to the unlocked Z / Pitch / Roll chips): Z in millimetres, tilts in degrees
export const stepOf = axis => axis === 'mz' ? STEP_Z_MM : STEP_TILT_DEG;

// ---- long press: a still press of LONG_PRESS_MS before the first move switches to fine steps ----
export const isLongPress = (pressMs, firstMoveMs) => (firstMoveMs - pressMs) >= LONG_PRESS_MS;

// ---- readout chip text ----
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '');
export function moveText(comps) {
  const p = MOVE_AXES.filter(a => comps && comps[a] !== undefined && Math.round(comps[a] * 1000) !== 0).map(a => { const mm = Math.round(comps[a] * 1000); return sgn(mm) + Math.abs(mm) + ' mm ' + AXIS_LABEL[a]; });
  return p.length ? p.join('  ') : '0 mm';
}
export const rotText = (deg, axis = 'yaw') => AXIS_LABEL[axis] + ' ' + sgn(deg) + (Math.round(Math.abs(deg) * 10) / 10) + '°';   // names the axis: Pitch +5°
