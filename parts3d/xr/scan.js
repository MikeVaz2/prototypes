// Surface-scan hint as a small state machine. Pure: time is passed in. Phases: idle | scanning | slow | found | placed.
// start(now) on every session start and on Re-place; update(now, hasHit) once per frame while finding a surface; placed() after placing.
export const SLOW_MS = 8000;
export const TEXTS = { scanning: 'Looking for a surface. Move the phone slowly.', slow: 'Point at a textured, well-lit spot.', found: 'Tap to place.' };
export function createScan({ slowMs = SLOW_MS } = {}) {
  let phase = 'idle', t0 = 0, firstHitMs = null;
  return {
    start(now) { phase = 'scanning'; t0 = now; firstHitMs = null; return this.text; },
    // returns the first-hit time (ms since start) once, on the frame the first hit arrives, else null
    update(now, hasHit) {
      if (phase === 'scanning' || phase === 'slow') {
        if (hasHit) { phase = 'found'; firstHitMs = now - t0; return firstHitMs; }
        if (phase === 'scanning' && now - t0 >= slowMs) phase = 'slow';
      }
      return null;
    },
    placed() { phase = 'placed'; },
    reset() { phase = 'idle'; firstHitMs = null; },
    get phase() { return phase; },
    get firstHitMs() { return firstHitMs; },
    get text() { return TEXTS[phase] || null; },
  };
}
