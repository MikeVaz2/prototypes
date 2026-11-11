// Pure helpers for tools (modes), units and mark/measure logic in ar-xr.html. No DOM, no three.js.
// Internally lengths are inches (offsets, lug length) or metres (positions); units only matter at the edges (labels, step sizes).
import { stackFor } from './pick.js';
import { rayBoxDistance } from './beam.js';

// ---- units ----
export const MM_PER_IN = 25.4;
export const UNIT_KEY = 'parts3d.units';
export const normUnits = (s, fallback = 'in') => (s === 'mm' || s === 'in') ? s : fallback;
// inches -> label: inches one decimal, millimetres whole numbers
export function fmtLen(inches, u = 'in') {
  return u === 'mm' ? Math.round(inches * MM_PER_IN) + ' mm' : inches.toFixed(1) + ' in';
}
// metres -> label
export const fmtM = (m, u = 'in') => fmtLen(m / 0.0254, u);
// step sizes in inches plus their button labels: in -> 1 in length, 0.5 in nudge/height; mm -> 25 mm length, 10 mm nudge/height
export function stepsFor(u = 'in') {
  return u === 'mm'
    ? { ext: 25 / MM_PER_IN, nudge: 10 / MM_PER_IN, height: 10 / MM_PER_IN, extLabel: '25', nudgeLabel: '10 mm', heightLabel: '10 mm', extUnit: 'ext mm' }
    : { ext: 1, nudge: 0.5, height: 0.5, extLabel: '1', nudgeLabel: '0.5 in', heightLabel: '0.5 in', extUnit: 'ext in' };
}
// next lug length (inches) after one step in direction dir (+1/-1): whole inches, or a 25 mm grid; clamped to [min,max] inches
export function extStep(cur, dir, u, min, max) {
  const v = u === 'mm' ? (Math.round(cur * MM_PER_IN / 25) + dir) * 25 / MM_PER_IN : Math.round(cur) + dir;
  return Math.min(max, Math.max(min, v));
}
// offsets readout, nonzero parts only: "↑1.5 in →0.5 in fwd 1 in ⟲10°" (mm: "↑25 mm")
export function describeU(o, u = 'in') {
  if (!o.h && !o.x && !o.z && !o.yaw) return 'no offset';
  const f = n => u === 'mm' ? Math.round(Math.abs(n) * MM_PER_IN) + ' mm' : (Math.abs(n) % 1 ? Math.abs(n).toFixed(1) : String(Math.abs(n))) + ' in';
  const p = [];
  if (o.h) p.push((o.h > 0 ? '↑' : '↓') + f(o.h));
  if (o.x) p.push((o.x > 0 ? '→' : '←') + f(o.x));
  if (o.z) p.push((o.z > 0 ? 'fwd ' : 'back ') + f(o.z));
  if (o.yaw) p.push((o.yaw > 0 ? '⟲' : '⟳') + (Math.abs(o.yaw) % 1 ? Math.abs(o.yaw).toFixed(1) : String(Math.abs(o.yaw))) + '°');
  return p.join(' ');
}
export const markTextU = (n, dPosIn, dNegIn, src, u = 'in') => `M${n}${src ? ' (' + src + ')' : ''}: +${fmtLen(dPosIn, u)}, −${fmtLen(dNegIn, u)}`;

// ---- tools (modes) ----
export const TOOLS = ['select', 'mark', 'measure'];
export const TOOL_LABEL = { select: 'Select', mark: 'Mark', measure: 'Measure' };
export const normTool = (s, fallback = 'select') => TOOLS.includes(s) ? s : fallback;
export const nextTool = t => TOOLS[(TOOLS.indexOf(t) + 1) % TOOLS.length];
export const TOOL_BUTTONS = ['drop', 'undomark', 'clearmarks', 'mnew', 'mundo', 'mclear'];
export const ALL_IDS = [...new Set(['extm', 'extp', 'rotm', 'rotp', 'gauge', 'cover', 'hm', 'hp', 'nl', 'nr', 'nu', 'nd', 'tm', 'tp',
  'again', 'reset', 'select', 'deselect', 'exit', 'more', 'back', ...TOOL_BUTTONS])];
// buttons of the open stack for a tool. Select keeps the part controls (minus the old mark buttons); Mark and Measure show only their own actions.
export function stackForTool(tool, kind, rotStep = 0, selected = false) {
  if (tool === 'mark') return { primary: ['drop', 'undomark', 'clearmarks'], more: [] };
  if (tool === 'measure') return { primary: ['mnew', 'mundo', 'mclear'], more: [] };
  const s = stackFor(kind, rotStep, selected), keep = id => id !== 'mark' && id !== 'clearmarks';
  return { primary: s.primary.filter(keep), more: s.more.filter(keep) };
}

// ---- marks: label only when selected or hovered ----
export const MARK_HOVER_M = 0.02;
// index of the mark nearest to the beam (within radius metres, ray from o along d up to tmax), else -1. points: [[x,y,z], ...]
export function hoverMark(points, o, d, radius = MARK_HOVER_M, tmax = 10) {
  let best = -1, bd = Infinity;
  (points || []).forEach((p, i) => {
    const dist = rayBoxDistance(o, d, p, p, tmax);   // a point is a degenerate box
    if (dist <= radius && dist < bd) { bd = dist; best = i; }
  });
  return best;
}
// which marks show their label: the selected one and the hovered one
export function labelIndices(count, selected = -1, hovered = -1) {
  const out = [];
  for (const i of [selected, hovered]) if (i >= 0 && i < count && !out.includes(i)) out.push(i);
  return out;
}
// ---- measuring: A then B ----
// one tap: pending point or null -> { pending, done }; done = [a,b] when the second point arrived
export function measureTap(pending, point) {
  return pending ? { pending: null, done: [pending, point] } : { pending: point, done: null };
}
export const midpoint = (a, b) => a.map((v, i) => (v + b[i]) / 2);
export const distM = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
