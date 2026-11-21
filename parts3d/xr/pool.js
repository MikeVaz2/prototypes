// Backyard pool geometry and looks. Pure: plain arrays, no three.js, no DOM. Units: metres.
// Frame: origin = pool centre at ground level (y = 0 is the floor the AR reticle hits), X = length, Z = width, everything of the pool is below y = 0 except the coping.
// The shell (floor + 4 inner walls) is inward-facing only: with back-face culling the pool reads as a hole in the real ground (the near wall is invisible).
// Sizes come from the options (length, width, depth in m); coping width, tile size and the band height are fixed, so they never scale with the pool.
export const COPING_W = 0.30, COPING_H = 0.025;   // stone border around the rim: 30 cm wide, top 2.5 cm above the ground
export const BAND_TOP = -0.05, BAND_BOT = -0.20;   // waterline tile band: its top is 7.5 cm under the coping top, its bottom 22.5 cm (a 15 cm band)
export const WATER_Y = COPING_H - 0.10;            // water surface: 10 cm below the coping top
export const TEX_M = 0.4;                          // one texture repeat = 40 cm, in metres (uv = metres / TEX_M for every pool size)
export const LIMITS = { length: [3, 12], width: [2, 6], depth: [1.0, 2.4] };

// tile looks. tile = tile size (m) of the canvas grid, grout = grout colour (null = no grid, plain with speckle), rough / metal = PBR, band = waterline band colour, water = water tint
export const TILES = {
  mosaic:   { label: 'Blue mosaic',     color: '#2a78c2', jitter: 0.16, tile: 0.025, grout: '#c9d6de', rough: 0.35, metal: 0.0, band: '#7cc4ee', bandTile: 0.025, water: '#5fb8dc' },
  plaster:  { label: 'White plaster',   color: '#e4eaee', jitter: 0.04, tile: 0,     grout: null,      rough: 0.85, metal: 0.0, band: '#a9bccb', bandTile: 0.05,  water: '#4fb4c8' },
  glass:    { label: 'Turquoise glass', color: '#2cc0c0', jitter: 0.12, tile: 0.05,  grout: '#d4e8e8', rough: 0.12, metal: 0.1, band: '#e6f7f7', bandTile: 0.05,  water: '#4fd0cc' },
  graphite: { label: 'Dark graphite',   color: '#3b3e44', jitter: 0.10, tile: 0.05,  grout: '#202226', rough: 0.45, metal: 0.0, band: '#b9bcc4', bandTile: 0.05,  water: '#3f7f96' },
};
export const TILE_IDS = Object.keys(TILES);
export const STONE = { color: '#b9b1a3', fascia: '#c4bfb3' };

export const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
export function sizeOf(opts = {}) {
  const n = (k, d) => clamp(Number.isFinite(+opts[k]) ? +opts[k] : d, LIMITS[k]);
  return { L: n('length', 8), W: n('width', 4), D: n('depth', 1.5) };
}

// mesh builder: quads with the wanted facing; the winding is flipped when it disagrees, so a face never ends up the wrong way round
function builder(uvOf) {
  const pos = [], uv = [], idx = [];
  return {
    quad(p, facing) {
      const a = sub(p[1], p[0]), b = sub(p[2], p[0]), n = cross(a, b);
      const q = n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2] < 0 ? [p[0], p[3], p[2], p[1]] : p;
      const o = pos.length / 3;
      for (const v of q) { pos.push(v[0], v[1], v[2]); uv.push(...uvOf(v, facing).map(c => c / TEX_M)); }
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    },
    done: () => ({ pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint32Array(idx) }),
  };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// planar uv in metres: floor and tops by (x, z), walls by (distance along the wall, y)
const uvOf = (v, f) => Math.abs(f[1]) > 0.5 ? [v[0], v[2]] : Math.abs(f[0]) > 0.5 ? [v[2], v[1]] : [v[0], v[1]];

// wall strip between heights y0 < y1 around the inside of the pool (rect half sizes a, b), facing inward
function walls(B, a, b, y0, y1) {
  B.quad([[-a, y0, -b], [a, y0, -b], [a, y1, -b], [-a, y1, -b]], [0, 0, 1]);
  B.quad([[-a, y0, b], [a, y0, b], [a, y1, b], [-a, y1, b]], [0, 0, -1]);
  B.quad([[-a, y0, -b], [-a, y0, b], [-a, y1, b], [-a, y1, -b]], [1, 0, 0]);
  B.quad([[a, y0, -b], [a, y0, b], [a, y1, b], [a, y1, -b]], [-1, 0, 0]);
}
// -> { tile, band, fascia, coping, water: { pos, uv, idx } | null }. water = null when the pool is empty.
export function poolMeshes(opts = {}, filled = true) {
  const { L, W, D } = sizeOf(opts), a = L / 2, b = W / 2, c = COPING_W, H = COPING_H;
  const T = builder(uvOf), Bd = builder(uvOf), F = builder(uvOf), C = builder(uvOf), Wt = builder(uvOf);
  T.quad([[-a, -D, -b], [a, -D, -b], [a, -D, b], [-a, -D, b]], [0, 1, 0]);   // floor, faces up
  walls(T, a, b, -D, BAND_BOT);
  walls(Bd, a, b, BAND_BOT, BAND_TOP);
  walls(F, a, b, BAND_TOP, 0);
  // coping: a ring of four slabs, y from 0 to H; top faces up, outside faces out, the rim faces into the pool
  const A = a + c, Bz = b + c;
  C.quad([[-A, H, b], [A, H, b], [A, H, Bz], [-A, H, Bz]], [0, 1, 0]);
  C.quad([[-A, H, -Bz], [A, H, -Bz], [A, H, -b], [-A, H, -b]], [0, 1, 0]);
  C.quad([[-A, H, -b], [-a, H, -b], [-a, H, b], [-A, H, b]], [0, 1, 0]);
  C.quad([[a, H, -b], [A, H, -b], [A, H, b], [a, H, b]], [0, 1, 0]);
  C.quad([[-A, 0, Bz], [A, 0, Bz], [A, H, Bz], [-A, H, Bz]], [0, 0, 1]);
  C.quad([[-A, 0, -Bz], [A, 0, -Bz], [A, H, -Bz], [-A, H, -Bz]], [0, 0, -1]);
  C.quad([[A, 0, -Bz], [A, 0, Bz], [A, H, Bz], [A, H, -Bz]], [1, 0, 0]);
  C.quad([[-A, 0, -Bz], [-A, 0, Bz], [-A, H, Bz], [-A, H, -Bz]], [-1, 0, 0]);
  C.quad([[-a, 0, -b], [a, 0, -b], [a, H, -b], [-a, H, -b]], [0, 0, 1]);
  C.quad([[-a, 0, b], [a, 0, b], [a, H, b], [-a, H, b]], [0, 0, -1]);
  C.quad([[-a, 0, -b], [-a, 0, b], [-a, H, b], [-a, H, -b]], [1, 0, 0]);
  C.quad([[a, 0, -b], [a, 0, b], [a, H, b], [a, H, -b]], [-1, 0, 0]);
  if (filled) { const e = 0.002; Wt.quad([[-a + e, WATER_Y, -b + e], [a - e, WATER_Y, -b + e], [a - e, WATER_Y, b - e], [-a + e, WATER_Y, b - e]], [0, 1, 0]); }
  return { tile: T.done(), band: Bd.done(), fascia: F.done(), coping: C.done(), water: filled ? Wt.done() : null };
}

// camera / shadow fit: the pool with its coping and a margin. -> { r } radius (m) of the circle around the pool centre that holds all of it
export function fitRadius(opts = {}) { const { L, W } = sizeOf(opts); return Math.hypot(L / 2 + COPING_W, W / 2 + COPING_W) + 0.3; }
