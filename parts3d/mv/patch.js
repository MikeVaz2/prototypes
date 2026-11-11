// Runtime patch for @google/model-viewer 3.5.0 (pinned): keep the model anchored where it was placed, so our
// offsets (an Object3D group inside ModelScene.target, see main.js) are never undone.
//
// Why the stock code undoes corrections: any src change in AR (lug length, rotate, cover toggle) makes
// ModelScene.setupScene -> updateFraming re-derive the scene target from the new model's bounding-box CENTRE
// (ModelScene.setTarget(-cx,-cy,-cz)). ARRenderer.updateTarget() overrides that to the floor (target.y = boundingBox.min.y),
// but only ONCE, in placeInitially(). After a reload the model is re-centred on its origin point: it sinks or jumps
// (and shifts sideways when the bbox centre moves), which looks like "snapped back to the surface".
//
// Patched (instance level, nothing global, nothing else touched):
//  1. arRenderer.updateTarget(): call the stock method, then remember the target it chose ("anchor": x/z centre, y = floor).
//  2. scene.setTarget(x,y,z): while an AR session is presenting (floor mode) and an anchor exists, ignore the new x/y/z and
//     use the anchor. So reloads keep the placement; the stock floor placement and finger drag/rotate (they move
//     scene.position/yaw, not the target) are unchanged. When the session ends, isPresenting is false and stock behaviour resumes.
// Offsets live in a child group of scene.target, outside the cached bounding box, so they never feed back into the anchor.
export function installARPatch(mv) {
  const sym = name => Object.getOwnPropertySymbols(mv).find(s => s.description === name);
  try {
    const sScene = sym('scene'), sRend = sym('renderer');
    const scene = sScene && mv[sScene], ar = sRend && mv[sRend] && mv[sRend].arRenderer;
    const need = [[ar, 'updateTarget'], [ar, 'present'], [ar, 'placeInitially'], [scene, 'setTarget'], [scene, 'getTarget']];
    const miss = need.filter(([o, k]) => !o || typeof o[k] !== 'function').map(([, k]) => k);
    if (!scene || !ar) miss.unshift(!scene ? 'scene' : 'arRenderer');
    if (!scene || !scene.target || !scene.boundingBox) miss.push('scene.target/boundingBox');
    if (miss.length) return { ok: false, reason: 'missing ' + miss.join(', ') };
    if (ar.__lsPatched) return { ok: true, reason: 'already patched' };
    let anchor = null, inStock = false;
    const stockUpdateTarget = ar.updateTarget, stockSetTarget = scene.setTarget;
    ar.updateTarget = function (...a) {
      inStock = true;
      try { stockUpdateTarget.apply(this, a); } finally { inStock = false; }
      if (this.presentedScene && !this.placeOnWall) anchor = scene.getTarget();
    };
    scene.setTarget = function (x, y, z) {
      if (!ar.isPresenting) anchor = null;
      if (anchor && ar.isPresenting && !ar.placeOnWall && !inStock) return stockSetTarget.call(this, anchor.x, anchor.y, anchor.z);
      return stockSetTarget.call(this, x, y, z);
    };
    ar.__lsPatched = true;
    return { ok: true, reason: 'patched updateTarget + setTarget' };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
}
