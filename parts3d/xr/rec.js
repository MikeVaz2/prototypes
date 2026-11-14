// Recording mode, x-ray and mark labels. Pure: no DOM, no three.js (tests run in node). Time is passed in.

// ---- x-ray of the host part (the battery): Solid | Ghost | Wireframe | Hide host. Only the host gets it; new parts stay solid. ----
export const XRAY = ['solid', 'ghost', 'wire', 'hide'];
export const XRAY_LABEL = { solid: 'Solid', ghost: 'Ghost', wire: 'Wireframe', hide: 'Hide host' };
export const XRAY_SHORT = { solid: 'Solid', ghost: 'Ghost', wire: 'Wire', hide: 'Hidden' };
export const GHOST_OPACITY = 0.3;
export const XRAY_KEY = 'parts3d.xray';
export const normXray = (s, fallback = 'solid') => XRAY.includes(s) ? s : fallback;
export const nextXray = s => XRAY[(XRAY.indexOf(normXray(s)) + 1) % XRAY.length];
// how the host's meshes look in a mode
export function xrayLook(mode) {
  switch (normXray(mode)) {
    case 'ghost': return { visible: true, transparent: true, opacity: GHOST_OPACITY, depthWrite: false, wireframe: false, shadow: false };
    case 'wire': return { visible: true, transparent: false, opacity: 1, depthWrite: true, wireframe: true, shadow: false };
    case 'hide': return { visible: false, transparent: false, opacity: 1, depthWrite: true, wireframe: false, shadow: false };
    default: return { visible: true, transparent: false, opacity: 1, depthWrite: true, wireframe: false, shadow: true };
  }
}
// state with a store hook (sessionStorage in the page): remembered for the session, solid by default
export function createXray(store = null) {
  let mode = 'solid';
  try { if (store) mode = normXray(store.get(XRAY_KEY)); } catch (e) { /* storage blocked */ }
  const save = () => { try { if (store) store.set(XRAY_KEY, mode); } catch (e) { /* storage blocked */ } };
  return {
    get mode() { return mode; },
    set(m) { mode = normXray(m, mode); save(); return mode; },
    next() { mode = nextXray(mode); save(); return mode; },
    // a part that is not the host is always solid
    modeFor(isHost) { return isHost ? mode : 'solid'; },
  };
}

// ---- auto-cycle of the options ----
export const CYCLE_SECS = [4, 6, 8];
export const normSecs = n => CYCLE_SECS.includes(Number(n)) ? Number(n) : 6;
// ids: option ids in order. start(now, secs, currentId): the first option shows now if none is current (returned by start), then one per `secs`.
export function createCycle(ids) {
  let on = false, paused = false, secs = 6, idx = -1, due = 0, left = 0;
  const cur = () => (idx >= 0 ? ids[idx] : null);
  const advance = now => { idx = (idx + 1) % ids.length; due = now + secs * 1000; return ids[idx]; };
  return {
    get on() { return on; }, get paused() { return paused; }, get secs() { return secs; }, get current() { return cur(); },
    start(now, s, currentId) { on = true; paused = false; secs = normSecs(s); idx = ids.indexOf(currentId); if (idx < 0) return advance(now); due = now + secs * 1000; return null; },
    stop() { on = false; paused = false; },
    // timer tick: the option to show now, or null
    tick(now) { return on && !paused && now >= due ? advance(now) : null; },
    next(now) { return advance(now); },   // manual skip: also restarts the timer
    pause(now) { if (on && !paused) { paused = true; left = Math.max(0, due - now); } },
    resume(now) { if (on && paused) { paused = false; due = now + left; } },
    toggle(now) { if (paused) this.resume(now); else this.pause(now); return paused; },
    msLeft(now) { return !on ? 0 : paused ? left : Math.max(0, due - now); },
  };
}
// next option id for the manual skip when no cycle runs (wraps)
export const stepId = (ids, id) => ids[(ids.indexOf(id) + 1) % ids.length];

// ---- caption (recording mode, clean): "A  Adapter on stud   + 3.2 in   − 3.2 in" ----
export function captionText(opt, heights, fmt) {
  if (!opt) return '';
  const f = v => v == null ? '–' : fmt(v);
  return opt.id + ' · ' + opt.name + ' · + ' + f(heights.pos) + ' · − ' + f(heights.neg);
}

// ---- mark label: the height above the battery top, shown only when the mark is selected ----
// hIn: mark height above the battery top in inches (negative = below it). fmt: inches -> text
export function markHeightText(n, hIn, fmt) {
  if (hIn == null || !Number.isFinite(hIn)) return 'M' + n;
  const a = Math.abs(hIn) < 0.05 ? 0 : hIn;
  return 'M' + n + ': ' + (a === 0 ? 'at the battery top' : fmt(Math.abs(a)) + (a > 0 ? ' above the battery top' : ' below the battery top'));
}
// which marks show a label: only the selected one (hovering shows nothing)
export const markLabelVisible = (i, selected) => i >= 0 && i === selected;
