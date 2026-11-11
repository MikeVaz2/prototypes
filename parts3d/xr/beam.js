// Pure helpers for the one-beam aiming (ar-xr.html): nearest-surface choice, snap distance, depth to world. No DOM, no three.js.
// Vectors are [x,y,z] in metres. Sources: M model, P hit-test feature point, L hit-test plane, D depth sensing.
export const SNAP_M = 0.025;

// nearest valid candidate { src, dist, point }; invalid = non-finite or outside [min,max]
export function nearestHit(cands, min = 0.05, max = 10) {
  let best = null;
  for (const c of cands || []) {
    if (!c || !Number.isFinite(c.dist) || c.dist < min || c.dist > max) continue;
    if (!best || c.dist < best.dist) best = c;
  }
  return best;
}
// hit-test results do not say point or plane: a surface normal within ~20 degrees of straight up reads as plane (floor, table), else point
export function classifyHit(normal, minUp = 0.94) {
  const l = Math.hypot(...normal) || 1;
  return normal[1] / l >= minUp ? 'L' : 'P';
}
// depth reading (metres along the view axis) -> world point along the beam; cosToAxis = cos(angle between beam and view axis), 1 at screen centre
export function depthToWorld(origin, dir, depth, cosToAxis = 1) {
  if (!Number.isFinite(depth) || depth <= 0 || !(cosToAxis > 0)) return null;
  const l = Math.hypot(...dir) || 1, t = depth / cosToAxis;
  return origin.map((v, i) => v + dir[i] / l * t);
}
// distance from a point to an axis-aligned box (0 inside)
export function pointBoxDistance(p, bmin, bmax) {
  let s = 0;
  for (let i = 0; i < 3; i++) { const d = Math.max(bmin[i] - p[i], 0, p[i] - bmax[i]); s += d * d; }
  return Math.sqrt(s);
}
// smallest distance from the ray (t in [0,tmax]) to the box. Distance to a convex set along a line is convex: slab test for 0, else ternary search.
export function rayBoxDistance(o, d, bmin, bmax, tmax = 10) {
  const l = Math.hypot(...d) || 1, u = d.map(v => v / l);
  let t0 = 0, t1 = tmax, hit = true;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(u[i]) < 1e-12) { if (o[i] < bmin[i] || o[i] > bmax[i]) hit = false; continue; }
    let a = (bmin[i] - o[i]) / u[i], b = (bmax[i] - o[i]) / u[i]; if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  if (hit && t0 <= t1) return 0;
  const f = t => pointBoxDistance(o.map((v, i) => v + u[i] * t), bmin, bmax);
  let lo = 0, hi = tmax;
  for (let k = 0; k < 60; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (f(m1) < f(m2)) hi = m2; else lo = m1; }
  return f((lo + hi) / 2);
}
// snap hover: items [{ id, min, max }] (boxes in the same frame as the ray); closest within radius -> { id, dist } | null
export function snapHover(items, o, d, radius = SNAP_M, tmax = 10) {
  let best = null;
  for (const it of items || []) {
    const dist = rayBoxDistance(o, d, it.min, it.max, tmax);
    if (dist <= radius && (!best || dist < best.dist)) best = { id: it.id, dist };
  }
  return best;
}
