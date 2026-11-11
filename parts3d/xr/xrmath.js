// Pure math for the WebXR page: view-relative nudges. No DOM, no three.js.
// World: x right, y up, z toward the viewer at start (right-handed, metres). Offsets are in inches (see ../offsets.js).
// The model sits in a "frame" at the placement point rotated about Y by psi (three.js rotation.y: local +z -> world (sin psi, 0, cos psi)).
// Offsets o = {h, x, z, yaw} live in that frame; x is the frame's +x axis (cos psi, 0, -sin psi), z is (sin psi, 0, cos psi).
import * as OFS from '../offsets.js';

export const NUDGE_IN = 0.5, HEIGHT_IN = 0.5, TURN_DEG = 5;

// Camera forward (any 3D vector) projected on the floor, unit length as [x, z]. Looking straight up/down -> fallback.
export function floorForward(fx, fy, fz, fallback = [0, -1]) {
  const l = Math.hypot(fx, fz);
  return l < 1e-3 ? fallback : [fx / l, fz / l];
}
// psi so the frame's +z (the battery label side) points at the user: opposite of the view direction.
export const psiFacingUser = fwd => Math.atan2(-fwd[0], -fwd[1]);
// frame yaw (rad) from a pivot's world direction of local +z
export const psiFromDir = (dx, dz) => Math.atan2(dx, dz);

// direction word -> world delta [dx, dz] in inches, relative to the view: up = away from you, left/right = your left/right.
export function viewDelta(fwd, dir, step = NUDGE_IN) {
  const f = fwd, r = [-f[1], f[0]];   // right = forward x up
  const v = { up: f, down: [-f[0], -f[1]], right: r, left: [-r[0], -r[1]] }[dir];
  if (!v) throw new Error('bad direction ' + dir);
  return [v[0] * step, v[1] * step];
}
// world delta -> frame-local [x, z]
export function worldToFrame(dx, dz, psi) {
  const s = Math.sin(psi), c = Math.cos(psi);
  return [dx * c - dz * s, dx * s + dz * c];
}
// frame-local [x, z] -> world delta
export function frameToWorld(lx, lz, psi) {
  const s = Math.sin(psi), c = Math.cos(psi);
  return [lx * c + lz * s, -lx * s + lz * c];
}
// apply one view-relative nudge to offsets; returns a new offsets object (clamped by OFS limits)
export function nudge(o, fwd, dir, psi, step = NUDGE_IN) {
  const [dx, dz] = viewDelta(fwd, dir, step), [lx, lz] = worldToFrame(dx, dz, psi);
  return OFS.step(OFS.step(o, 'x', lx), 'z', lz);
}
export const raise = (o, d = HEIGHT_IN) => OFS.step(o, 'h', d);
export const turn = (o, d = TURN_DEG) => OFS.step(o, 'yaw', d);
// where the model origin ends up: base world position (m) + frame offset; total yaw (rad)
export function modelPose(basePos, psi, o) {
  const [wx, wz] = frameToWorld(o.x * OFS.IN, o.z * OFS.IN, psi);
  return { pos: [basePos[0] + wx, basePos[1] + o.h * OFS.IN, basePos[2] + wz], yaw: psi + o.yaw * Math.PI / 180 };
}

// ---- mark-a-point measuring (positions in metres, results in inches) ----
export const M_PER_IN = 0.0254;
export const distIn = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / M_PER_IN;
export const fmtIn = d => d.toFixed(1);
export const markText = (n, dPos, dNeg) => `M${n}: +${fmtIn(dPos)} in, −${fmtIn(dNeg)} in`;
