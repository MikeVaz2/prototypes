// Pure helpers for part selection and contextual controls (ar-xr.html). No DOM, no three.js.

// kind of a composed part: battery (the host) | lug | busbar | nut
export function kindOf(partId, hostId, hasCoverOption = false) {
  if (partId === hostId) return 'battery';
  if (/^lug-joint/.test(partId)) return 'cable';
  if (/^lug/.test(partId)) return 'lug';
  if (/^nut/.test(partId)) return 'nut';
  if (/^mrbf/.test(partId)) return 'fuse';
  if (/^(powerbar|copper)/.test(partId)) return 'bar';
  if (/^(butt|factory)/.test(partId)) return 'cable';
  if (/^(blueseas|busbar|bus)/.test(partId) || hasCoverOption) return 'busbar';
  return 'busbar';
}
const KIND_NAME = { battery: 'Battery', lug: 'Lug', busbar: 'Busbar', nut: 'Nut', fuse: 'Fuse', bar: 'Bar', cable: 'Cable' };
export function labelOf(partId, kind) {
  const s = /-pos$/.test(partId) ? ' +' : /-neg$/.test(partId) ? ' −' : '';
  return (KIND_NAME[kind] || partId) + (kind === 'battery' ? '' : s);
}

// walk up from a hit object to the pickable root (userData.instanceId); null when none
export function instanceIdOf(obj) {
  for (let o = obj; o; o = o.parent) if (o.userData && o.userData.instanceId) return o.userData.instanceId;
  return null;
}
// first intersection (three.js order: nearest first) that belongs to a part -> { instanceId, point, distance } | null
// hidden nodes (a cover switched off, helpers) still answer a raycast, so they are skipped: a click goes through to what the user sees
export const isShown = obj => { for (let o = obj; o; o = o.parent) if (o.visible === false) return false; return !!obj; };
export function pickFromHits(hits) {
  for (const h of hits || []) {
    if (!isShown(h.object)) continue;
    const id = instanceIdOf(h.object);
    if (id) return { instanceId: id, point: h.point, distance: h.distance };
  }
  return null;
}
// visual state for one part
export function tintFor(id, selectedId, hoveredId) {
  return id === selectedId ? 'selected' : id === hoveredId ? 'hover' : null;
}

// every control button id the strip knows
export const PLACEMENT = ['hm', 'hp', 'nl', 'nr', 'nu', 'nd', 'tm', 'tp', 'again', 'reset', 'mark', 'clearmarks'];
export const ALL_CONTROLS = ['extm', 'extp', 'rotm', 'rotp', 'gauge', 'cover', ...PLACEMENT];
// which control buttons show for the selected kind (null/undefined = nothing selected).
// rotStep = the part's mount yaw step in degrees (0/undefined = cannot rotate)
export function controlsFor(kind, rotStep = 0) {
  const rot = rotStep > 0 ? ['rotm', 'rotp'] : [];
  if (kind === 'lug') return ['extm', 'extp', ...rot, 'gauge'];
  if (kind === 'busbar') return ['cover', ...rot];
  if (kind === 'nut') return [];
  return PLACEMENT.slice();   // battery or nothing: placement fixes and Mark
}
// next key of a choice option (gauge toggle), wraps around
export function nextChoice(values, current) {
  const keys = Array.isArray(values) ? values : Object.keys(values || {});
  if (!keys.length) return current;
  const i = keys.indexOf(current);
  return keys[(i + 1) % keys.length];
}
// rotate a yaw in degrees by d, result in [0, 360)
export const rotateYaw = (yaw, d) => (((yaw + d) % 360) + 360) % 360;

// ray from an XR pose (position {x,y,z}, orientation {x,y,z,w}): forward is -z, up is +y, both rotated by the quaternion
export function rayFromPose(pos, q) {
  const rot = (x, y, z) => {   // v + 2w(u x v) + 2 u x (u x v), u = (qx,qy,qz)
    const ux = q.x, uy = q.y, uz = q.z, w = q.w;
    const cx = uy * z - uz * y, cy = uz * x - ux * z, cz = ux * y - uy * x;
    return [x + 2 * (w * cx + (uy * cz - uz * cy)), y + 2 * (w * cy + (uz * cx - ux * cz)), z + 2 * (w * cz + (ux * cy - uy * cx))];
  };
  return { origin: [pos.x, pos.y, pos.z], dir: rot(0, 0, -1), up: rot(0, 1, 0) };
}
// beam start: slightly below the viewer along the pose's up axis
export const beamStart = (ray, drop = 0.06) => ray.origin.map((v, i) => v - ray.up[i] * drop);

// short name for the single round button: "+ lug", "Battery", "Scene" when nothing is selected
export function shortName(partId, kind, fallback) {
  if (!partId) return 'Scene';
  if (kind === 'fuse' || kind === 'bar' || kind === 'cable') return fallback || KIND_NAME[kind];
  if (kind === 'lug') return /-pos$/.test(partId) ? '+ lug' : /-neg$/.test(partId) ? '− lug' : 'Lug';
  return { battery: 'Battery', busbar: 'Busbar', nut: 'Nut' }[kind] || 'Scene';
}
// every button of the single-button stack
export const ALL_BUTTONS = ['addpart', 'remove', 'confirm', 'cancel', 'next', 'extm', 'extp', 'rotm', 'rotp', 'gauge', 'cover', 'hm', 'hp', 'nl', 'nr', 'nu', 'nd', 'tm', 'tp',
  'again', 'reset', 'mark', 'clearmarks', 'select', 'deselect', 'exit', 'more', 'back'];
// which buttons show in the open stack (primary: contextual actions + More) and in the More panel
export function stackFor(kind, rotStep = 0, selected = false) {
  const rot = rotStep > 0 ? ['rotm', 'rotp'] : [], common = ['again', 'mark', 'clearmarks', 'reset', 'exit'];
  let primary, more;
  if (kind === 'lug') { primary = ['extp', 'extm', ...rot, 'deselect']; more = ['gauge', ...common]; }
  else if (kind === 'busbar') { primary = ['cover', ...rot, 'deselect']; more = common; }
  else if (kind === 'nut') { primary = ['deselect']; more = common; }
  else { primary = ['mark', 'hp', 'hm', 'tp', 'tm']; more = ['nl', 'nr', 'nu', 'nd', selected ? 'deselect' : 'select', 'again', 'clearmarks', 'reset', 'exit']; }
  return { primary: [...primary, 'more'], more: ['back', ...more] };
}

// click versus drag outside XR: movement under 6 px (mouse) or 10 px (touch) between pointerdown and pointerup is a click.
// A slow click is still a click on a mouse; a touch held over 800 ms is a long press, not a tap.
export function isClick(moved, ms, pointerType = 'mouse') {
  const touch = pointerType === 'touch' || pointerType === 'pen';
  return moved <= (touch ? 10 : 6) && (!touch || ms <= 800);
}
