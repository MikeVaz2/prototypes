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
export const ALL_IDS = [...new Set(['addpart', 'remove', 'confirm', 'cancel', 'next', 'extm', 'extp', 'rotm', 'rotp', 'gauge', 'cover', 'hm', 'hp', 'nl', 'nr', 'nu', 'nd', 'tm', 'tp',
  'again', 'reset', 'select', 'deselect', 'exit', 'move', 'more', 'back', 'qselect', 'qadd', 'qmeasure', 'qmark', 'qhere', 'rmmark', 'rmmeasure', 'opt', 'jfrom', 'jgauge', 'jcolor', 'jremove', 'undoj', ...TOOL_BUTTONS])];
// buttons of the open stack for a tool. Select keeps the part controls (minus the old mark buttons); Mark and Measure show only their own actions.
// x = extras about the selected instance: { free (placed on a surface), num (has a length option), choice (has a choice option) }
export function stackForTool(tool, kind, rotStep = 0, selected = false, x = {}) {
  if (tool === 'mark') return { primary: ['drop', 'undomark', 'clearmarks'], more: [] };
  if (tool === 'measure') return { primary: ['mnew', 'mundo', 'mclear'], more: [] };
  const keep = id => id !== 'mark' && id !== 'clearmarks';
  const rot = rotStep > 0 ? ['rotm', 'rotp'] : [], common = ['again', 'reset', 'exit'];
  if (kind === 'fuse' || kind === 'bar' || kind === 'cable') {   // library parts: on a stud, or free on a surface
    let primary, more;
    if (x.free) { primary = ['move', 'tp', 'tm', 'hp', 'hm', 'remove', 'deselect']; more = ['nl', 'nr', 'nu', 'nd', ...(x.num ? ['extp', 'extm'] : []), ...(x.choice ? ['gauge'] : []), 'addpart', ...common]; }
    else { primary = [...(x.num ? ['extp', 'extm'] : []), ...rot, 'remove', 'deselect']; more = [...(x.choice ? ['gauge'] : []), 'addpart', ...common]; }
    return { primary: [...primary, 'more'], more: ['back', ...more] };
  }
  if (kind === 'battery' && selected && x.free) {   // the host moves like any surface part (Move, turn, raise; nudges in More); its stack and jumpers follow. No Remove.
    return { primary: ['move', 'tp', 'tm', 'hp', 'hm', 'more'], more: ['back', 'nl', 'nr', 'nu', 'nd', 'addpart', 'again', 'reset', 'exit'] };
  }
  const s = stackFor(kind, rotStep, selected);
  const prim = s.primary.filter(keep), mor = s.more.filter(keep), at = prim.indexOf('more');
  if (kind === 'lug' || kind === 'busbar' || kind === 'nut') prim.splice(at, 0, 'remove');
  else prim.splice(at, 0, 'addpart');
  mor.splice(1, 0, 'addpart');
  return { primary: prim, more: mor };
}

// ---- two rows (bottom row sticks, context row above it; never a third row) ----
// bottom row: fixed contents. Undo only where something can be undone, Units live in the top-right menu.
export function bottomFor(tool, inXR = false) {
  return ['addpart', ...(tool === 'mark' ? ['undomark'] : tool === 'measure' ? ['mundo'] : ['opt']), 'more'];   // 'mode' is always first, added by the page
}
// Control paradigm, chosen in one place. In XR the beam is the pointer, so what it is on drives the row ('highlight').
// Outside XR (mouse or touch) the user picks first and then acts: a click / tap selects, hover changes nothing in the row ('select').
export const driveFor = inXR => inXR ? 'highlight' : 'select';
// context row buttons, in order. Empty = show the tooltip line instead.
// o = { markSel, measSel (a mark / measurement is selected or highlighted), tool, kind, rotStep, selected, x, adding: null|{stud, outlets}, more, inXR, quick: null|{kind:'part'|'outlet', isSel, point} (XR highlight),
//        target: null|{kind:'part'|'outlet', point} (outside XR: what is selected) }
// jumpers on top of the base row: o.linking (choosing the ends) = Cancel only; o.jumper (one is selected) = its edits; o.jfrom = "Cable from here" next to the
// highlighted / selected thing; o.jundo = Undo of the last jumper change when nothing else owns the row.
export function ctxFor(o) {
  if (o.linking) return ['cancel'];
  if (o.jumper && !o.adding && !o.more) return ['jgauge', 'jcolor', 'jremove', 'deselect'];
  const base = ctxBase(o);
  if (o.adding || o.more || o.markSel || o.measSel || (o.tool && o.tool !== 'select')) return base;
  const out = [...base];
  if (o.jfrom) { const k = out.indexOf('deselect'); if (k < 0) out.push('jfrom'); else out.splice(k, 0, 'jfrom'); }
  if (o.jundo) out.push('undoj');
  return out;
}
function ctxBase(o) {
  const { markSel = false, measSel = false, tool = 'select', kind = null, rotStep = 0, selected = false, x = {}, adding = null, more = false, inXR = false, quick = null, target = null } = o;
  if (markSel && !adding) return tool === 'mark' ? ['drop', 'rmmark', 'clearmarks'] : ['rmmark', 'deselect'];   // a selected (or, in XR, beam-highlighted) mark: its action is Remove
  if (measSel && !adding) return ['rmmeasure', 'deselect'];
  if (adding) return ['confirm', ...(adding.stud && adding.outlets > 1 ? ['next'] : []), 'cancel'];
  const lay = stackForTool(tool, kind, rotStep, selected, x), drop = new Set(['more', 'back', 'addpart', 'select', ...(inXR ? [] : ['exit'])]);
  const sel = [...new Set(lay.primary.filter(id => !drop.has(id)).concat(selected ? ['deselect'] : []))];
  if (more) {
    const rest = tool === 'select' ? (selected ? lay.more : ['hp', 'hm', 'tp', 'tm', ...lay.more]) : ['again', 'reset', 'exit'];
    return ['back', ...new Set(rest.filter(id => !drop.has(id) || id === 'exit' && inXR))];
  }
  if (tool === 'mark') return ['drop', 'clearmarks'];
  if (tool === 'measure') return ['mnew', 'mclear'];
  if (driveFor(inXR) === 'select') {   // outside XR: the selection is the target; quick (hover) is ignored
    if (target && target.kind === 'outlet') return ['qhere', 'deselect'];
    return selected ? [...sel, 'qadd', ...(target && target.point ? ['qmeasure', 'qmark'] : [])] : [];
  }
  if (quick && selected && !(quick.kind === 'part' && quick.isSel)) return [quick.kind === 'outlet' ? 'qhere' : 'qselect', ...sel];   // the selection keeps its edit actions; the highlighted other thing is one tap ahead of them
  if (quick && !(quick.kind === 'part' && quick.isSel)) return quick.kind === 'outlet' ? ['qhere'] : ['qselect', 'qadd', ...(quick.point ? ['qmeasure', 'qmark'] : [])];
  return selected ? sel : [];
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
