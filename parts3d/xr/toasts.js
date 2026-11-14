// Pure toast stack logic (no DOM): at most `max` toasts, info auto-hides after `infoMs`, warn and error stay until dismissed.
// Time is passed in, so it is testable. The DOM glue lives in app.js.
export const LEVELS = ['info', 'warn', 'error'];

export function createToasts({ max = 3, infoMs = 4000 } = {}) {
  let items = [], seq = 0, held = false, queued = [];
  const normLevel = l => (LEVELS.includes(l) ? l : 'info');
  const expiryOf = (level, now, ms) => (level === 'info' ? now + (ms == null ? infoMs : ms) : Infinity);   // ms only applies to info
  return {
    // key: a new toast with the same key replaces the old one (a prompt that is updated, then cleared by dismissKey).
    // sticky: an info toast that never auto-hides (a prompt that stays until the task ends).
    // ms: own auto-hide time (info only). close: false = no x button (a note that replaces itself, e.g. the option name).
    // While held (recording mode) nothing is shown: toasts wait silently in a queue; release() shows the ones that still matter.
    add({ text, level = 'info', key = null, sticky = false, action = null, ms = null, close = true }, now) {
      level = normLevel(level);
      if (!text) return null;
      if (held) { queued = queued.filter(q => !(key && q.key === key)); queued.push({ text, level, key, sticky, action, ms, close }); return 0; }
      const dup = items.find(t => (key ? t.key === key : t.text === text && t.level === level && !t.key));
      if (dup) {   // same message again: refresh instead of stacking copies
        dup.text = text; dup.level = level; dup.action = action; dup.close = close; dup.expires = sticky ? Infinity : expiryOf(level, now, ms); return dup.id;
      }
      const t = { id: ++seq, text, level, key, action, close, expires: sticky ? Infinity : expiryOf(level, now, ms) };
      items.push(t);
      while (items.length > max) {   // drop the oldest info first so an unread warning or error is not pushed out by a note
        let i = items.findIndex(x => x.level === 'info' && x !== t);
        if (i < 0) i = items.findIndex(x => x !== t);
        items.splice(i, 1);
      }
      return t.id;
    },
    dismiss(id) { const n = items.length; items = items.filter(t => t.id !== id); return items.length !== n; },
    dismissKey(key) { const n = items.length; items = items.filter(t => t.key !== key); return items.length !== n; },
    // remove toasts whose time is up; returns true when something changed
    expire(now) { const n = items.length; items = items.filter(t => t.expires > now); return items.length !== n; },
    nextExpiry() { let m = Infinity; for (const t of items) if (t.expires < m) m = t.expires; return m; },
    list() { return held ? [] : items.map(t => ({ ...t })); },
    get held() { return held; },
    queuedCount() { return queued.length; },
    // recording mode: hide everything and queue new toasts. Releasing drops plain info notes (stale by then) and shows warnings, errors and sticky prompts.
    hold() { held = true; },
    release(now) {
      held = false; const q = queued; queued = [];
      for (const x of q) if (x.level !== 'info' || x.sticky) this.add(x, now);
      return this.list().length;
    },
  };
}

// swipe or tap decision from a pointer gesture: dx, dy in px and elapsed ms
export function gestureOutcome(dx, dy, ms, { swipePx = 40, tapPx = 8, tapMs = 600 } = {}) {
  if (Math.abs(dx) >= swipePx && Math.abs(dx) > Math.abs(dy)) return 'dismiss';
  if (Math.hypot(dx, dy) <= tapPx && ms <= tapMs) return 'dismiss';
  return 'none';
}
