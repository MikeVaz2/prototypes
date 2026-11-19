// Pure logic for Edit mode (round 5, ticket #107): what a placed part may do depends on its mount.
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
export const DETACH_HINT = 'detach to lift/tilt';

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
// what each mount lets the user unlock. canYaw: the part turns at all (a stud part needs a yaw step, a panel on rails turns with Turn 90)
export function capsFor(mount, canYaw = true) {
  const yes = { mx: true, my: true, mz: true, pitch: true, roll: true, yaw: !!canYaw };
  if (mount === 'free') return yes;
  if (mount === 'surface') return { ...yes, mz: false, pitch: false, roll: false };
  return { mx: false, my: false, mz: false, pitch: false, roll: false, yaw: !!canYaw };   // stud
}
// lock defaults (true = locked). Surface and free: move X, Y and yaw open. Stud (bolted): fully locked until the user opens yaw.
export function defaultLocks(mount) {
  if (mount === 'stud') return { mx: true, my: true, mz: true, pitch: true, roll: true, yaw: true };
  return { mx: false, my: false, mz: true, pitch: true, roll: true, yaw: false };
}
// effective state per axis: 'on' (unlocked and allowed), 'locked' (allowed, user locked), 'off' (the mount does not allow it)
// canTilt false: the scene model has no pitch / roll yet, so those two stay off even for a free part
export function axisStates(mount, locks, canYaw = true, canTilt = true) {
  const caps = capsFor(mount, canYaw), out = {};
  for (const a of AXES) out[a] = !caps[a] || (!canTilt && (a === 'pitch' || a === 'roll')) ? 'off' : locks[a] ? 'locked' : 'on';
  return out;
}
export const unlockedMoves = st => MOVE_AXES.filter(a => st[a] === 'on');
export const rotAxisOf = st => ROT_AXES.find(a => st[a] === 'on') || null;
// flip one chip; an axis the mount does not allow never opens
export function toggleLock(mount, locks, axis, canYaw = true) {
  if (!capsFor(mount, canYaw)[axis]) return { ...locks };
  return { ...locks, [axis]: !locks[axis] };
}
// the hint under a disabled chip
export const hintFor = (mount, axis) => mount === 'stud' ? (axis === 'yaw' ? 'this part does not turn' : 'bolted: detach to move') : (axis === 'yaw' ? 'use Turn 90°' : DETACH_HINT);
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
  if (axes.length === 1) {   // closest point between the ray and the line anchor + t a
    const a = axes[0], w0 = sub(anchor, o), b = dot(a, d), c = dot(d, d), dd = dot(a, w0), e = dot(d, w0), den = c - b * b;
    if (Math.abs(den) < 1e-9) return null;
    return add(anchor, mul(a, (b * e - c * dd) / den));
  }
  const n = axes.length === 2 ? norm(cross(axes[0], axes[1])) : norm(viewDir), den = dot(n, d);
  if (Math.abs(den) < 1e-9) return null;
  const t = dot(n, sub(anchor, o)) / den;
  return t < 0 ? null : add(o, mul(d, t));
}
export const snapTo = (v, step) => { const r = Math.round(v / step) * step; return Math.abs(r) < 1e-12 ? 0 : r; };
export const stepM = fine => (fine ? FINE_MM : SNAP_MM) / 1000;
export const stepDeg = fine => fine ? FINE_DEG : SNAP_DEG;
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
export const snapDeg = (deg, fine = false) => snapTo(deg, stepDeg(fine));
export const normDeg = d => ((d % 360) + 360) % 360;
// new yaw (degrees, the part's own convention: three.js rotation.y, counter-clockwise seen from above is positive) from a screen twist: a counter-clockwise twist turns the part counter-clockwise
export const applyYaw = (yaw0, twist, fine = false) => normDeg(yaw0 + snapDeg(twist, fine));

// ---- long press: a still press of LONG_PRESS_MS before the first move switches to fine steps ----
export const isLongPress = (pressMs, firstMoveMs) => (firstMoveMs - pressMs) >= LONG_PRESS_MS;

// ---- readout chip text ----
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '');
export function moveText(comps) {
  const p = MOVE_AXES.filter(a => comps && comps[a] !== undefined && Math.round(comps[a] * 1000) !== 0).map(a => { const mm = Math.round(comps[a] * 1000); return sgn(mm) + Math.abs(mm) + ' mm ' + AXIS_LABEL[a]; });
  return p.length ? p.join('  ') : '0 mm';
}
export const rotText = (deg, axis = 'yaw') => sgn(deg) + Math.abs(Math.round(deg)) + '°' + (axis === 'yaw' ? '' : ' ' + axis);
