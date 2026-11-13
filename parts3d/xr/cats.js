// Part library categories: order, icons and the filter cycle. Pure, no DOM.
export const CAT_ORDER = ['Battery', 'Terminals', 'Lugs', 'Bus bars', 'Fuses', 'Cables', 'Hardware'];
export const CAT_KEY = 'parts3d.libcat';
// 24x24 stroke paths for the small inline icons (currentColor)
export const CAT_ICONS = {
  All: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  Battery: 'M3 8h16v11H3zM6 8V5h3v3M13 8V5h3v3M8 13h4M10 11v4',
  Terminals: 'M12 3v8M8 11h8v4a4 4 0 01-8 0zM12 19v2',
  Lugs: 'M3 12h7M10 8h4a4 4 0 010 8h-4zM18 12h.01',
  'Bus bars': 'M3 9h18v6H3zM7 9v6M12 9v6M17 9v6',
  Fuses: 'M3 12h4M17 12h4M7 8h10v8H7zM9 12h6',
  Cables: 'M3 17c6 0 4-10 9-10h9',
  Hardware: 'M12 3l7 4v10l-7 4-7-4V7zM12 9a3 3 0 100 6 3 3 0 000-6z',
  other: 'M5 12h.01M12 12h.01M19 12h.01',
};
export const catIcon = c => '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (CAT_ICONS[c] || CAT_ICONS.other) + '"/></svg>';
export const catOf = p => p.category || 'other';
// categories present in parts, in CAT_ORDER (unknown ones last, alphabetical)
export const categoriesOf = parts => [...new Set(parts.map(catOf))].sort((a, b) => (CAT_ORDER.indexOf(a) + 1 || 99) - (CAT_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
// All -> each category -> All. cur null = All. An unknown cur restarts at All.
export function nextCat(cats, cur) {
  if (!cats.length) return null;
  if (cur == null) return cats[0];
  const i = cats.indexOf(cur);
  return i < 0 || i === cats.length - 1 ? null : cats[i + 1];
}
export const filterParts = (parts, cat) => cat == null ? parts : parts.filter(p => catOf(p) === cat);
// the filter to start with: a remembered category if the shown parts still have it; a filtered list (fits) starts on All
export const startCat = (cats, saved, fitting = false) => !fitting && saved && cats.includes(saved) ? saved : null;
