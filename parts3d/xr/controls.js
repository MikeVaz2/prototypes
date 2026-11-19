// Pure logic for the phone controls (round 4): parts search, part variants, scene list, speed dial / FAB state, undo-redo history. No DOM, no three.js.
import { catOf } from './cats.js';

// ---- parts dialog: search by name, short name (nick), id, category; every word must match somewhere ----
const norm = s => String(s == null ? '' : s).toLowerCase();
export function searchParts(parts, query) {
  const words = norm(query).split(/[\s,]+/).filter(Boolean);
  if (!words.length) return parts.slice();
  return parts.filter(p => {
    const hay = [p.name, p.short, p.nick, p.id, catOf(p)].map(norm).join(' ');
    return words.every(w => hay.includes(w));
  });
}

// ---- variants: parts of one family (explicit `family` field, else category + first word of the id) and the part's own option variants ----
export function familyKey(p) {
  if (p.family) return norm(p.family);
  const first = String(p.id).replace(/_\d+$/, '').split('-')[0];
  return norm(catOf(p)) + '/' + first;
}
// other parts in the family of p, in catalog order
export function variantsOf(parts, p) {
  const k = familyKey(p);
  return parts.filter(x => x.id !== p.id && familyKey(x) === k);
}
// option variants as { label, values: ['2→1', ...] } for choice and bool options (the "Split 2→1 / 4→1", "Polarity" kind)
export function optionVariants(p) {
  const out = [];
  for (const o of Object.values(p.options || {})) {
    if (o.type === 'choice' && o.values) out.push({ label: (o.label || '').trim(), values: Object.values(o.values).map(v => v.label || '') });
    else if (o.type === 'bool') out.push({ label: (o.label || '').trim(), values: ['on', 'off'] });
  }
  return out.filter(v => v.label);
}
// number options as "Length 3–24 in" lines
export function sizeLines(p) {
  return Object.values(p.options || {}).filter(o => o.type === 'number' && !o.nocycle && o.label && o.label.trim())
    .map(o => o.label.trim() + ' ' + o.min + '–' + o.max + (o.unit ? ' ' + o.unit : ''));
}

// ---- scenes: the empty scene first, then one tile per start scene (host x preset) ----
// hosts = [{ host: '' | partId, hostId, title, presets: [{ id, short, name, hash }] }]
export function sceneList(hosts, known) {
  const list = [{ id: 'empty', host: '', opt: null, empty: true, title: 'New empty scene', line: 'Just the battery. Add parts yourself.', thumbPart: null }];
  for (const h of hosts) for (const pr of h.presets) {
    const ids = [...String(pr.hash).matchAll(/(?:^|~|s=)([a-z0-9][a-z0-9-]*?)(?:_\d+)?:/g)].map(m => m[1]);
    const parts = [...new Set(ids)].filter(id => !known || known(id));
    const other = parts.find(id => id !== h.hostId);
    list.push({ id: (h.host || 'battery') + ':' + pr.id, host: h.host, opt: pr.id, title: h.title + ' ' + pr.id, line: pr.name, group: h.title, thumbPart: other || h.hostId, parts });
  }
  return list;
}
export const sceneUrlHash = sc => sc.empty ? 'empty=1' : (sc.host ? 'host=' + sc.host + '&' : '') + 'opt=' + sc.opt;
// the scene dialog opens by itself when the URL names no scene
export function needsSceneChoice(hash, search) {
  const h = new URLSearchParams(String(hash || '').replace(/^#/, '')), s = new URLSearchParams(search || '');
  return !(h.get('host') || h.get('opt') || h.get('s') || h.get('empty') || s.get('host') || s.get('scene') || s.get('addpart') || s.get('sel') || s.get('open') || s.get('noscene'));
}

// ---- floating action buttons ----
// dial: a speed dial (modes). choose(v) picks, makes it the current one and collapses. toggle() flips. The main button shows current.
export function createDial(items, current) {
  const d = { open: false, items, current: current != null ? current : items[0],
    toggle() { d.open = !d.open; return d.open; },
    close() { d.open = false; },
    choose(v) { if (items.includes(v)) d.current = v; d.open = false; return d.current; } };
  return d;
}
// context FAB: only toggle() changes it. Running an action (acted) never closes it.
export function createToggle() {
  const t = { open: false, toggle() { t.open = !t.open; return t.open; }, show() { t.open = true; }, acted() { return t.open; } };
  return t;
}

// ---- undo / redo of scene edits: snapshots of { state, offs, jumpers } ----
export function createHistory(max = 50) {
  const h = { last: null, undoS: [], redoS: [],
    init(s) { h.last = s; h.undoS = []; h.redoS = []; },
    commit(s) {   // call after an edit: pushes the previous snapshot when something changed
      if (h.last === null) { h.last = s; return false; }
      if (JSON.stringify(s) === JSON.stringify(h.last)) return false;
      h.undoS.push(h.last); if (h.undoS.length > max) h.undoS.shift(); h.redoS = []; h.last = s; return true;
    },
    get canUndo() { return h.undoS.length > 0; }, get canRedo() { return h.redoS.length > 0; },
    undo() { if (!h.undoS.length) return null; h.redoS.push(h.last); h.last = h.undoS.pop(); return h.last; },
    redo() { if (!h.redoS.length) return null; h.undoS.push(h.last); h.last = h.redoS.pop(); return h.last; } };
  return h;
}

// the context panel: Undo and Redo always, then what the selection offers (nothing selected: only what still applies, which may be nothing more)
export const panelIds = acts => ['undo', 'redo', ...acts.filter(id => id !== 'undo' && id !== 'redo')];
