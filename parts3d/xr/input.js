// Input routing (round 6): ONE router object with handleEvent(e), attached once to `document` (capture phase) and, per AR session, to the session.
// No DOM work happens here except attach / dispatch; the handlers stay in app.js and are registered with router.on(stage, type, fn), router.act(name, fn), router.hold(name, spec).
//
// Routing order for every event:
//   (0) 'ui' observers of that type run first, always (outside-tap closers, finger bookkeeping, Escape / Ctrl+Z, drag-scroll of the panel). A handler that stops the event ends routing.
//   (1) UI controls: a click on [data-action] calls the registered action; a press on [data-hold] starts its hold. Anything inside a control, input, dialog or panel stops here: the scene never sees it.
//   (2) active gesture: Move drag, two-finger twist (touch on <html> in AR, pointers in preview), cable link, mark / measure. Registered with stage 'gesture'.
//   (3) scene tap / select: pick, drop, link end, mark, measure. Registered with stage 'scene'.
//   XR session events (selectstart, select, selectend, end) go to stage 'xr' and are logged with the same decision text.
// route() below is the pure decision (which stage and kind); the router uses it for gating (controls, recording, open dialog) and for the one debug line per decision.

export const UI_SELECTOR = 'button, input, select, textarea, a, label, dialog, summary, [data-action], [data-hold], #ctx, #menu, #modedial, #toasts, #editbar, #scrim';
export const DOM_TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'click', 'keydown', 'input', 'wheel'];
export const XR_TYPES = ['selectstart', 'select', 'selectend', 'end'];
const QUIET = new Set(['pointermove', 'touchmove', 'wheel', 'input', 'keydown', 'pointerleave']);   // no log line for these

// info: { type, target: 'control' | 'scene', hasAction, hasHold, dialogOpen, rec, inXR, editOn, selected, touches, gesture: null | 'move' | 'twist', tool, linking, adding }
// -> { stage: 'ui' | 'gesture' | 'scene' | 'ignore', kind, why }
export function route(i) {
  const t = i.type;
  if (t === 'click' && i.hasAction) return { stage: 'ui', kind: 'action', why: 'data-action' };
  if (t === 'pointerdown' && i.hasHold) return { stage: 'ui', kind: 'hold', why: 'data-hold' };
  if (i.target === 'control') return { stage: 'ui', kind: 'pass', why: 'inside a control' };
  if (i.rec) return { stage: 'ignore', kind: 'none', why: 'recording mode' };
  if (i.dialogOpen) return { stage: 'ignore', kind: 'none', why: 'dialog open' };
  const touch = t === 'touchstart' || t === 'touchmove' || t === 'touchend' || t === 'touchcancel';
  if (touch && i.touches >= 2 && i.editOn && i.selected) return { stage: 'gesture', kind: 'twist', why: 'two touches in Move mode' };
  if (i.gesture) return { stage: 'gesture', kind: i.gesture, why: 'running ' + i.gesture };
  if (t === 'pointerdown' && i.editOn && i.selected && !touch) return { stage: 'gesture', kind: 'move', why: 'one-finger press in Move mode' };
  if (t === 'selectstart' && i.editOn && i.selected) return { stage: 'gesture', kind: 'move', why: 'XR press in Move mode' };
  if (t === 'pointerup' || t === 'select') {
    if (i.editOn && i.selected) return { stage: 'scene', kind: 'noop', why: 'a tap in Move mode never changes the selection' };
    if (i.linking) return { stage: 'scene', kind: 'link', why: 'tap ends the cable link' };
    if (i.adding) return { stage: 'scene', kind: 'add', why: 'tap places the part' };
    if (i.tool === 'mark' || i.tool === 'measure') return { stage: 'scene', kind: i.tool, why: 'tap in ' + i.tool + ' mode' };
    return { stage: 'scene', kind: 'select', why: 'scene tap selects' };
  }
  return { stage: 'scene', kind: 'pass', why: 'scene event' };
}

export function createRouter(o = {}) {
  const log = o.log || (() => {});
  const r = {
    actions: new Map(), holds: new Map(), handlers: { ui: {}, gesture: {}, scene: {}, xr: {} }, guards: [], activeHold: null, state: o.state || (() => ({})), counts: { dom: 0, xr: 0 },
    // a click action; the element (if given) gets data-action so the markup carries it. fn(el, event)
    act(name, fn, el) { r.actions.set(name, fn); if (el) el.dataset.action = name; },
    hold(name, spec) { r.holds.set(name, spec); },
    // fn(e, decision); `only` (an element) limits the handler to events targeted at it (the canvas handlers)
    on(stage, type, fn, only) { ((r.handlers[stage] || (r.handlers[stage] = {}))[type] || (r.handlers[stage][type] = [])).push(only ? (e, d) => { if (e.target === only) fn(e, d); } : fn); },
    guard(fn) { r.guards.push(fn); },   // a click guard returning true swallows the click (the panel's drag-scroll)
    attach(doc = document) {
      for (const t of DOM_TYPES) { doc.addEventListener(t, r, { capture: true, passive: !(t.startsWith('touch') || t === 'wheel') }); r.counts.dom++; }
      doc.addEventListener('pointerleave', r, true); r.counts.dom++;
    },
    attachXR(s) { r.detachXR(); r.session = s; for (const t of XR_TYPES) { s.addEventListener(t, r); r.counts.xr++; } },
    detachXR() { const s = r.session; if (!s) return; for (const t of XR_TYPES) s.removeEventListener(t, r); r.session = null; },
    run(stage, e, d) {
      const list = r.handlers[stage] && r.handlers[stage][e.type]; if (!list) return;
      for (const fn of list) { fn(e, d); if (e.cancelBubble) return; }
    },
    handleEvent(e) {
      const t = e.type;
      if (XR_TYPES.includes(t)) {
        const S = r.state();
        if (t !== 'end') log('route ' + t + ' -> xr' + (S.editOn && S.selected ? ' (Move mode)' : ''));
        r.run('xr', e, null); return;
      }
      r.run('ui', e, null); if (e.cancelBubble) return;   // (0) observers
      const el = e.target && e.target.closest ? e.target : null, S = r.state();
      // a held button lets go on release, cancel, or when the pointer leaves it
      if (r.activeHold && (t === 'pointerup' || t === 'pointercancel' || (t === 'pointermove' && !(el && r.activeHold.el.contains(el))))) { const h = r.activeHold; r.activeHold = null; h.spec.up && h.spec.up(h.el, e); }
      const actEl = el && el.closest('[data-action]'), holdEl = el && el.closest('[data-hold]');
      // (1) UI controls
      if (t === 'click') {
        if (r.guards.some(g => g(e))) { e.stopPropagation(); e.preventDefault(); log('route click -> swallowed (panel drag)'); return; }
        const fn = actEl && r.actions.get(actEl.dataset.action);
        if (fn) { log('route click -> ui action ' + actEl.dataset.action + (actEl.dataset.arg ? ' ' + actEl.dataset.arg : '')); fn(actEl, e); return; }
      }
      if (t === 'pointerdown' && holdEl) { const spec = r.holds.get(holdEl.dataset.hold); if (spec) { r.activeHold = { el: holdEl, spec }; log('route pointerdown -> ui hold ' + holdEl.dataset.hold); spec.down && spec.down(holdEl, e); return; } }
      const info = { ...S, type: t, target: el && el.closest(UI_SELECTOR) ? 'control' : 'scene', hasAction: !!actEl, hasHold: !!holdEl, touches: e.touches ? e.touches.length : 0 };
      const d = route(info);
      if (!QUIET.has(t) && !(d.stage === 'ui' && d.kind === 'pass')) log('route ' + t + ' -> ' + d.stage + ' ' + d.kind + ' (' + d.why + ')');
      if (d.stage === 'ui' || d.stage === 'ignore') return;   // controls, recording and open dialogs never reach the scene
      r.run('gesture', e, d); if (e.cancelBubble) return;   // (2)
      r.run('scene', e, d);                                  // (3)
    },
  };
  return r;
}
