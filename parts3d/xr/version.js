// Cache busting for data and asset fetches: append ?v=<BUILD> (same BUILD that versions the module URLs in ar-xr.html). Pure.
export const buildOf = () => (typeof window !== 'undefined' && window.__BUILD) || '';
// url + (?|&) v=<encoded build>; an empty build or an empty url is returned unchanged; an existing v= is replaced
export function withVersion(url, build = buildOf()) {
  if (!url || !build) return url;
  const u = String(url).replace(/([?&])v=[^&#]*&?/, '$1').replace(/[?&]$/, '');
  const hash = u.indexOf('#'), core = hash < 0 ? u : u.slice(0, hash), tail = hash < 0 ? '' : u.slice(hash);
  return core + (core.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(build) + tail;
}
