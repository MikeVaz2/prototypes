# parts3d: parts as data -> web-ready GLB

`make_part.py` turns a part-description JSON (inches) into a glTF 2.0 binary
(meters, Y up, origin at bottom centre of the case, PBR materials, named nodes).
First part: Odyssey ODP-AGM31 (`parts/odyssey-odp-agm31.json`).

## Generate
```
cd /d D:\LifeStyle\prototypes\parts3d
D:\LifeStyle\.venv-3d\Scripts\python.exe make_part.py parts\odyssey-odp-agm31.json
```
Output: `odyssey-odp-agm31.glb` (pass a second argument to choose the output path).

## Validate + previews
```
D:\LifeStyle\.venv-3d\Scripts\python.exe validate_and_preview.py odyssey-odp-agm31.glb out
```
Reloads the GLB, prints bounds in inches, size and triangles, and renders
`out\preview_34.png` and `out\preview_top.png` from the GLB geometry (numpy rasteriser).

## View
```
cd /d D:\LifeStyle\prototypes\parts3d & python -m http.server 8000
```
Open http://localhost:8000/viewer.html. It must be served over http(s), not opened as file://.

AR: phone AR (WebXR / Scene Viewer / Quick Look) needs HTTPS and a phone-reachable URL.
Quick Look on iOS prefers USDZ; model-viewer converts the GLB on the fly where supported.

## JSON fields
`case` (length/width/height), `lid` (height, inset), `overall_height`, `terminals[]`
(polarity, x, y from top-left-back corner, type, thread, height above lid), `terminal_style`,
`label`, `colors`. Only studs are generated; thread is recorded but not modelled.

## Scene builder (parts, mounts, snapping)
Parts: `odyssey-odp-agm31` (battery), `blueseas-2340-pos`, `blueseas-2340-neg` (Blue Sea 2340 battery-terminal
busbars, from the dimensioned drawing on bluesea.com (product 2340)). `make_part.py` dispatches on `"kind"` in the JSON
(`battery` default, `busbar`); busbars are built from drawing dimensions in `dims` (tab with round end + hole, joggled
bus plate, 4 screws, open-sided cover). Each GLB has its own origin; the busbar origin is the tab hole centre on the
tab's bottom face, local -X runs toward the screw block.
```
cd /d D:\LifeStyle\prototypes\parts3d
set PY=D:\LifeStyle\.venv-3d\Scripts\python.exe
%PY% make_part.py parts\odyssey-odp-agm31.json
%PY% make_part.py parts\blueseas-2340-pos.json
%PY% make_part.py parts\blueseas-2340-neg.json
%PY% build_catalog.py        :: writes parts\catalog.json and odyssey-with-busbars.glb
%PY% validate_and_preview.py odyssey-with-busbars.glb out assembly
```
(`validate_and_preview.py` takes an optional 3rd arg, the PNG prefix. Extra deps in the venv: shapely, pymupdf.)

Mounts (JSON `mounts`, inches): battery `stud_pos` / `stud_neg` (type stud, thread 3/8-16, pos = top of the polarity ring
on the boss, case-origin coords, +Z front); busbar `ring` (accepts 3/8-16, 3/8; `polarity`; `snap_to` = host mount id;
`default_yaw_deg` = rotation about the stud axis (Y), right-handed; `yaw_step_deg` = allowed increment, e.g. 90).
Yaw +90 points the busbar body at +Z (front / label side, the default); -90 at -Z (back edge). Snap rule: part origin
goes to the host mount position, then yaw. Implemented in `build_catalog.py` (`placement`) and mirrored in `viewer.html`.
Default placement keeps each busbar inside the footprint (front clearance 1.05 in; see below).

### Options
Part JSON `options`: `{"cover": {"type": "bool", "default": true, "label": "Cover", "nodes": ["cover"]}}`. A bool option
set to false removes the named GLB node(s) (the busbar GLB has a separate `cover` node; other nodes: `tab`, `bus`, `screws`).
Options are copied into `parts/catalog.json`. Python: `build_catalog.assemble(specs, out, {part_id: {"cover": False}})`
(`build_catalog.py` also writes `out/assembly_nocover.glb`).

### Scene state and URL
Scene = list of instances `{part, mount (host mount id), yaw, opts}`. It is stored in the URL hash so reload/share restores it:
`#s=<part>:<mount>:<yaw>:<opt>=<0|1>[,...]~<next instance>` e.g.
`#s=odyssey-odp-agm31:-:0:~blueseas-2340-pos:stud_pos:180:cover=0~blueseas-2340-neg:stud_neg:90:cover=1`.
Parts absent from the hash are off. Yaw is snapped to `yaw_step_deg`. Invalid/missing hash (or no battery) = defaults
(hash is empty while the scene equals the default). Test hook `&sel=<part id>` opens that part's panel.

### Viewer interaction
Tray chips toggle parts. Selecting a part (tap it in the model, the gear on its chip, or long-press its chip) opens a
panel above the tray: Rotate (by `yaw_step_deg`), option toggles (Cover on/off), Reset, Close. The selected part gets a
subtle blue emissive tint. Each instance's materials are renamed `<name>#<part id>` when composed so
`materialFromPoint` identifies the instance.

`viewer.html`: bottom tray chips toggle parts; selected parts are loaded with three.js 0.160.0 GLTFLoader, snapped,
exported with GLTFExporter and shown in model-viewer (camera kept). Initial src is the pre-built
`odyssey-with-busbars.glb`; Scene Viewer / Quick Look only ever see that default set, WebXR sees the current
selection. Test hook: `?off=blueseas-2340-pos`. AR default file has the new defaults (busbars toward the front, covers on).

Estimates (not dimensioned on the drawing): cover height 1.044 in above tab bottom (0.86 in cover itself), joggle
drop 0.26 in, copper thickness 0.125 in, cover open on one side with 0.08 in walls (shape simplified), screw head size.
Drawing says #8-32 screws; Amazon title says 10-24 (drawing used).

## Stud stack: lug, busbar, nut (mount chaining)
Order on each 3/8-16 stud, bottom to top: boss ring, main cable ring lug (sits directly on the ring), Blue Sea 2340 tab,
lock washer + hex nut. New parts: `lug-38-pos` / `lug-38-neg` (kind `lug`, 2 or 4 AWG, tin copper, red/black cable stub) and
`nut-38-pos` / `nut-38-neg` (kind `nut`, 3/8-16 hex 0.56 in AF x 0.33 in + 0.06 in lock washer, stainless). Build:
```
%PY% make_part.py parts\lug-38-pos.json   :: also lug-38-neg, nut-38-pos, nut-38-neg
%PY% build_catalog.py                      :: catalog.json, odyssey-full-stack.glb (viewer default), odyssey-with-busbars.glb, out\assembly_nocover.glb
%PY% check_stack.py                        :: stack heights, asserts tab bottom = lug tongue top, nut on tab top
%PY% validate_and_preview.py odyssey-full-stack.glb out stack stud   :: adds stack_side.png, stack_close34.png (+ stud close-ups)
```
Chaining: every part has a `top` mount (position on the stud axis, may vary with an option via `by_option`; lug top = tongue top,
busbar top = tab top 0.125, nut top = 0.39). The `ring` mount's `snap_to` is now a priority list, e.g. nut:
`["blueseas-2340-pos.top", "lug-38-pos.top", "stud_pos"]` = first present entry wins, last entry is the battery stud mount.
So toggling a part re-stacks the rest (busbar without lug sits on the boss ring as before; nut on the lug if no busbar).
Implemented in `build_catalog.resolve` and `viewer.html placements()`. Option type `choice` (lug `gauge`: 2awg default / 4awg) hides the
GLB nodes of the other values; hash form `gauge=4awg`. Catalog `chip` groups parts under one tray chip (the two nuts = "Nuts").
Lug yaw step 15 deg; default yaw 0 (cable to +X, right end) for +, 180 (left end) for -. Lug origin = hole centre on tongue bottom.

Fit numbers (stud top 9.6 in from floor, case top 8.6 in; ring top 8.81): lug 2 AWG tongue 8.81-8.91, tab 8.91-9.035,
washer 9.035-9.095, nut 9.095-9.425. Nut top = 0.825 in over case top, 9.425 in over floor, 0.175 in of stud above the nut
(about 2.8 threads, so the stud is long enough; with 4 AWG the lug is 0.01 in thinner). With cover on the highest point is the cover top,
9.954 in over floor (1.354 over case top); cover off the nut is highest (9.425). The lug barrel, 0.55 in OD, is taller than the tongue
(top 9.36); keep the lug cable and busbar block pointing different ways (default: busbar toward the front, cable outward).

Estimates (all lug and nut numbers, not from datasheets): 2 AWG lug tongue 0.75 wide x 0.10 thick, 2.0 in long, barrel 0.55 OD x 0.75 long,
cable 0.45 OD (jacket) x 3 in stub, hole 0.39; 4 AWG tongue 0.65 x 0.09, 1.8 in long, barrel 0.45, cable 0.38 OD; barrel bottom flush with
tongue bottom; nut/washer plain (no chamfer, washer not split, washer OD 0.62, ID 0.39). Measure the real parts before ordering.
