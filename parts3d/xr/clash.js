// Hold-down clash check (pure): does a terminal part's bounding box touch the hold-down bar? Boxes are { min: [x, y, z], max: [x, y, z] } in inches in the model frame.
export const holdDownId = id => /^holddown/.test(String(id));
// the bar's own box (the flat bar only, not the hooks) from the instance and its catalog entry (`clash: { bar_y, bar_t }`, options length / width / pos in inches), yaw in degrees about Y
export function barBox(inst, part) {
  const c = part.clash || { bar_y: 9.6, bar_t: 0.125 }, o = { length: 8.3, width: 1, pos: 0, ...(inst.opts || {}) };
  const at = inst.at || [0, 0, 0], ofs = inst.ofs || [0, 0, 0], a = (inst.yaw || 0) * Math.PI / 180, cs = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
  // the bar runs along its own Z (length) and X (width); the position option slides it along its own X
  const hx = cs * o.width / 2 + sn * o.length / 2, hz = sn * o.width / 2 + cs * o.length / 2;
  const cx = at[0] + ofs[0] + o.pos * Math.cos((inst.yaw || 0) * Math.PI / 180), cz = at[2] + ofs[2] - o.pos * Math.sin((inst.yaw || 0) * Math.PI / 180), y0 = at[1] + ofs[1] + c.bar_y;
  return { min: [cx - hx, y0, cz - hz], max: [cx + hx, y0 + c.bar_t, cz + hz] };
}
export const boxesTouch = (a, b, tol = 0) => [0, 1, 2].every(i => a.min[i] <= b.max[i] + tol && b.min[i] <= a.max[i] + tol);
// terminals: [{ id, box }] -> ids whose box touches the bar
export const clashing = (bar, terminals, tol = 0) => terminals.filter(t => boxesTouch(bar, t.box, tol)).map(t => t.id);
export const CLASH_TEXT = 'touches the hold-down bar';
