// Selection box helpers (pure). A part may name the nodes that make its box (part JSON `outline.nodes`, name prefixes): the solar panel's
// box is the panel body, not the junction box and leads that hang 220 mm past its end.
export const inOutline = (chain, prefixes) => !prefixes || !prefixes.length || chain.some(n => prefixes.some(p => String(n || '').startsWith(p)));
// Box of axis-aligned parts [{ min:[x,y,z], max:[x,y,z] }] -> { min, max } | null
export function unionBox(boxes) {
  let r = null;
  for (const b of boxes) { if (!r) r = { min: [...b.min], max: [...b.max] }; else for (let i = 0; i < 3; i++) { r.min[i] = Math.min(r.min[i], b.min[i]); r.max[i] = Math.max(r.max[i], b.max[i]); } }
  return r;
}
