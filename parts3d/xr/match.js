// Outlet compatibility. Same vocabulary and rules as build_catalog.match() (Python), plus the capacity numbers of the outlet.
// Pure: no DOM, no three.js. Part = catalog entry; needs = a mount's `needs`; conn = a connection of another part.

// kind and thread must be equal; polarity agrees when either side is missing/'any' (a polarity_option on the outlet is a wildcard).
// Surface needs match no outlet. Identical to build_catalog.match().
export function match(needs, conn) {
  if (!needs || needs.kind !== 'stud' || (conn.form || conn.kind) !== 'stud' || !conn.accepts) return false;
  if (needs.thread !== conn.accepts.thread) return false;
  const a = needs.polarity || 'any', b = conn.polarity_option ? 'any' : (conn.polarity || 'any');
  return a === 'any' || b === 'any' || a === b;
}

// the mount of a part that says how it attaches: { mount, needs } | null
export function needsOf(part) {
  const all = (part.mounts || []).filter(x => x.needs), m = all.find(x => x.needs.kind === part.mountKind) || all[0];
  return m ? { mount: m, needs: m.needs } : null;
}
export const mountKind = part => part.mountKind || (needsOf(part) && needsOf(part).needs.kind) || 'surface';

// inches of thread this part uses on a stud, honouring consumes_by_option (e.g. lug gauge)
export function consumes(part, opts = {}) {
  const n = needsOf(part); if (!n) return 0;
  let v = n.needs.consumes_in || 0;
  for (const [k, tbl] of Object.entries(n.needs.consumes_by_option || {})) if (tbl[opts[k]] !== undefined) v = tbl[opts[k]];
  return v;
}
// connection enabled_when {option: value}: all must hold for this instance's options
export const connEnabled = (conn, opts = {}) => Object.entries(conn.enabled_when || {}).every(([k, v]) => opts[k] === v);

// short thread name for messages: "5/16-18" -> "5/16"
export const threadShort = t => String(t || '').split('-')[0];

// capacity of an outlet: items already on it (inches consumed each) plus the new one
export function fits(accepts, usedIn, extraIn) {
  const items = usedIn.length + 1, total = usedIn.reduce((a, b) => a + b, 0) + extraIn;
  if (accepts.max_items !== undefined && items > accepts.max_items) return { ok: false, why: 'full (' + accepts.max_items + ' items max)' };
  if (accepts.max_stack_in !== undefined && total > accepts.max_stack_in + 1e-9) return { ok: false, why: 'no thread left (' + total.toFixed(2) + ' of ' + accepts.max_stack_in + ' in)' };
  return { ok: true, why: '' };
}

// All outlets in a set of instances that the part can go on.
//   insts: [{ id, part, opts, on }]  (on = "hostId.connId" of the outlet the instance sits on, or falsy)
//   partOf: id -> catalog entry
// -> [{ host, conn, key: "host.conn", ok, why }]   ok = rule match + enabled + capacity; why = reason when not ok
export function outletsFor(part, opts, insts, partOf) {
  const n = needsOf(part); if (!n || n.needs.kind !== 'stud') return [];
  const extra = consumes(part, opts), out = [];
  for (const h of insts) {
    const hp = partOf(h.part); if (!hp) continue;
    for (const c of hp.connections || []) {
      if (!match(n.needs, c)) continue;
      const key = h.id + '.' + c.id;
      if (!connEnabled(c, h.opts)) { out.push({ host: h.id, conn: c.id, key, ok: false, why: 'not available with these options' }); continue; }
      const used = insts.filter(i => i.on === key).map(i => consumes(partOf(i.part), i.opts));
      const f = fits(c.accepts, used, extra);
      out.push({ host: h.id, conn: c.id, key, ok: f.ok, why: f.why });
    }
  }
  return out;
}

// one line when nothing is available: "No free 5/16 stud (+): all full" / ": none in the scene"
export function noOutletMessage(part, outlets) {
  const n = needsOf(part); if (!n) return '';
  const pol = n.needs.polarity && n.needs.polarity !== 'any' ? ' (' + n.needs.polarity + ')' : '';
  return 'No free ' + threadShort(n.needs.thread) + ' stud' + pol + (outlets.length ? ': all full' : ': none in the scene');
}
