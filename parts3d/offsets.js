// Placement-correction offsets for the whole assembly (AR surface misdetected). Pure helpers, no DOM.
// o = { h, x, z, yaw }: h = height up (in), x = right (in), z = forward (in, toward the battery label side), yaw = deg, + = left/counter-clockwise.
export const IN = 0.0254;
export const ZERO = Object.freeze({ h: 0, x: 0, z: 0, yaw: 0 });
export const LIMITS = { h: 12, x: 24, z: 24 };
const r3 = v => Math.round(v * 1000) / 1000;
export const isZero = o => o.h === 0 && o.x === 0 && o.z === 0 && o.yaw === 0;
export function normYaw(d) { let y = ((d % 360) + 360) % 360; if (y > 180) y -= 360; return r3(y === -0 ? 0 : y); }   // -180 < yaw <= 180

// add `delta` to one key (h|x|z in inches, yaw in degrees); clamps; returns a new object
export function step(o, key, delta) {
  const n = { ...o };
  n[key] = key === 'yaw' ? normYaw(o.yaw + delta) : r3(Math.max(-LIMITS[key], Math.min(LIMITS[key], o[key] + delta)));
  if (n[key] === 0) n[key] = 0;   // no -0
  return n;
}
// "h,x,z,yaw" (zero is the empty string); bad input -> ZERO
export const ser = o => (isZero(o) ? '' : [o.h, o.x, o.z, o.yaw].join(','));
export function parse(s) {
  const v = String(s || '').split(',').map(Number);
  if (v.length !== 4 || v.some(n => !Number.isFinite(n))) return { ...ZERO };
  const c = (n, k) => r3(Math.max(-LIMITS[k], Math.min(LIMITS[k], n))) || 0;
  return { h: c(v[0], 'h'), x: c(v[1], 'x'), z: c(v[2], 'z'), yaw: normYaw(v[3]) || 0 };
}
// scene-space transform: position in metres (x right, y up, z forward), yaw in radians
export const toTransform = o => ({ pos: [o.x * IN, o.h * IN, o.z * IN], yawRad: o.yaw * Math.PI / 180 });
// small readout, nonzero parts only: "↑1.5 in →0.5 in ↗1 in ⟲10°"
export function describe(o) {
  if (isZero(o)) return 'no offset';
  const f = n => (Math.abs(n) % 1 ? Math.abs(n).toFixed(1) : String(Math.abs(n)));
  const p = [];
  if (o.h) p.push((o.h > 0 ? '↑' : '↓') + f(o.h) + ' in');
  if (o.x) p.push((o.x > 0 ? '→' : '←') + f(o.x) + ' in');
  if (o.z) p.push((o.z > 0 ? 'fwd ' : 'back ') + f(o.z) + ' in');
  if (o.yaw) p.push((o.yaw > 0 ? '⟲' : '⟳') + f(o.yaw) + '°');
  return p.join(' ');
}
