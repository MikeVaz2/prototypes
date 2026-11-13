// Pure toast stack logic (no DOM): at most `max` toasts, info auto-hides after `infoMs`, warn and error stay until dismissed.
// Time is passed in, so it is testable. The DOM glue lives in app.js.
export const LEVELS = ['info', 'warn', 'error'];

export function createToasts({ max = 3, infoMs = 4000 } = {}) {
  let items = [], seq = 0;
  const normLevel = l => (LEVELS.includes(l) ? l : 'info');
  const expiryOf = (level, now, ms) => (level === 'info' ? now + (ms == null ? infoMs : ms) : Infinity);   // ms only applies to info
  return {
    // key: a new toast with the same key replaces the old one (a prompt that is updated, then cleared by dismissKey).
    // sticky: an info toast that never auto-hides (a prompt that stays until the task ends).
    add({ text, level = 'info', key = null, sticky = false }, now) {
      level = normLevel(level);
      if (!text) return null;
      const dup = items.find(t => (key ? t.key === key : t.text === text && t.level === level && !t.key));
      if (dup) {   // same message again: refresh instead of stacking copies
        dup.text = text; dup.level = level; dup.expires = sticky ? Infinity : expiryOf(level, now); return dup.id;
      }
      const t = { id: ++seq, text, level, key, expires: sticky ? Infinity : expiryOf(level, now) };
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
    list() { return items.map(t => ({ ...t })); },
  };
}

// swipe or tap decision from a pointer gesture: dx, dy in px and elapsed ms
export function gestureOutcome(dx, dy, ms, { swipePx = 40, tapPx = 8, tapMs = 600 } = {}) {
  if (Math.abs(dx) >= swipePx && Math.abs(dx) > Math.abs(dy)) return 'dismiss';
  if (Math.hypot(dx, dy) <= tapPx && ms <= tapMs) return 'dismiss';
  return 'none';
}
