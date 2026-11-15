// Flexible duct geometry (bellows). Pure: plain arrays, no three.js. Units: metres. Same numbers as make_part.py (RIB_MIN, RIB_AMP, DUCT_PITCH, DUCT_OVERLAP).
// Frame: origin = the adapter spigot end, +Y = the adapter axis. The duct starts OVERLAP below the origin (slid over the spigot), runs straight along +Y,
// and a bend turns it toward +X (a twist about Y turns the bend direction). Length = centre line length from its start.
export const MM = 0.001;
export const PITCH = 7 * MM, RIB_MIN = 2.5 * MM, RIB_AMP = 4 * MM, OVERLAP = 26 * MM;
export const BENDS = { straight: 0, b45: 45, b90: 90 };
export const SIDES = 20, PER_RIB = 6;
export const crestRadius = dMm => dMm / 2 * MM + RIB_MIN + RIB_AMP;   // outer radius at a rib crest (the clamp sits on it)

// centre line: s in [0, L] -> { c: [x, y], t: [tx, ty] }
export function ductPath(L, bendDeg, dMm) {
  const a = bendDeg * Math.PI / 180;
  let R = a ? Math.max(0.06, 1.5 * dMm * MM) : 0;
  if (a && R * a > 0.8 * L) R = 0.8 * L / a;
  const s1 = L - R * a;
  return s => {
    if (s <= s1) return { c: [0, -OVERLAP + s], t: [0, 1] };
    const th = (s - s1) / R;
    return { c: [R * (1 - Math.cos(th)), -OVERLAP + s1 + R * Math.sin(th)], t: [Math.sin(th), Math.cos(th)] };
  };
}
// ribbed tube: { pos: Float32Array, idx: Uint32Array } (outward-facing triangles; render outside black, inside silver with a second material on the back faces)
export function ductMesh(dMm, L, bendDeg) {
  const f = ductPath(L, bendDeg, dMm), n = Math.max(2, Math.ceil(L / PITCH) * PER_RIB + 1), r0 = dMm / 2 * MM + RIB_MIN;
  const pos = new Float32Array(n * SIDES * 3), idx = new Uint32Array((n - 1) * SIDES * 6);
  for (let i = 0; i < n; i++) {
    const s = L * i / (n - 1), { c, t } = f(s), rr = r0 + RIB_AMP * (0.5 + 0.5 * Math.cos(2 * Math.PI * s / PITCH)), nx = t[1], ny = -t[0];
    for (let k = 0; k < SIDES; k++) {
      const ph = 2 * Math.PI * k / SIDES, o = (i * SIDES + k) * 3;
      pos[o] = c[0] + rr * Math.cos(ph) * nx; pos[o + 1] = c[1] + rr * Math.cos(ph) * ny; pos[o + 2] = rr * Math.sin(ph);
    }
  }
  let q = 0;
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < SIDES; k++) {
    const a0 = i * SIDES + k, a1 = i * SIDES + (k + 1) % SIDES, b0 = (i + 1) * SIDES + k, b1 = (i + 1) * SIDES + (k + 1) % SIDES;
    idx[q++] = a0; idx[q++] = b0; idx[q++] = a1; idx[q++] = a1; idx[q++] = b0; idx[q++] = b1;
  }
  return { pos, idx, end: f(L) };
}
