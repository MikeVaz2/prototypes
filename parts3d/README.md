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


## Extension cable length (lugs)
The lug's cable stub is the extension cable. Its free end carries a joint marker (dark grey heat-shrink over a butt splice, 1.5 in
long, 0.12 in thicker than the cable) where the factory cable attaches. Option `length` (type `number`, 3 to 24 in, step 1,
default 6) is barrel end to joint. The GLB holds the default 6 in; `viewer.html applyLength` scales the `cable_<gauge>` node along
the lug's own X (so it follows the yaw) and slides `joint_<gauge>`, no Python rebuild. Shown in the lug panel (slider), the caption
("+ extension 10 in") and the hash (`length=10`). `build_catalog.py` ignores `number` options (default length only).

## Commands (text box + mic)
`commands.js` is a rule-based parser (no AI, no network); `viewer.html` applies the result. Tests: `node --test` (commands.test.mjs).
Mic uses SpeechRecognition / webkitSpeechRecognition (en-US, one utterance, no interim results) and is hidden when unsupported.
Numbers can be digits or words ("ten", "twenty four"). plus/positive/red and minus/negative/black pick the side; word order is free.
- Length: `plus cable 12 inches`, `black wire ten in`, `minus extension 24 inches` (cable, wire, extension are synonyms; clamped 3 to 24)
- Rotate: `rotate plus lug 30 degrees`, `turn minus cable ninety`, `rotate plus lug left` (+15) / `right` (-15); `busbar` instead of lug rotates the busbar
- Cover: `plus busbar cover off`, `minus busbar cover on`, `covers off`
- Gauge: `4 gauge plus`, `2 gauge minus`, `4 gauge` (both)
- Show/hide: `hide nuts`, `show busbars`, `hide plus busbar`, `hide lugs` (battery cannot be hidden)
- `reset` (defaults), `undo` (last 30 states)
The status line shows what was heard and what was done, or "Didn't get that" with three example phrases.

AR: model-viewer 3.5 starts the WebXR session with `dom-overlay` rooted at its shadow `div.default`, so everything in the default slot
stays visible in WebXR. The command bar is slotted there, so the mic and text box are shown inside the AR session (taps on the bar
are marked `beforexrselect` so they do not place the model). Not tested on a device: speech permission and the model reload during a
session depend on the phone/browser. In Scene Viewer / Quick Look there is no DOM overlay, so give commands before tapping AR.

## Library parts, connections, outlets (added)
Catalog entries with `default: false` (not in the default scene; GLB per part, default-option preview GLB in `out\lib-<id>.glb`).
Each has `category` (battery, distribution, fusing, cable, marker, hardware), `mountKind` (stud | surface), `icon` hint.
```
%PY% make_part.py parts\powerbar-2104.json     :: also mrbf-5191, copper-bar, lug-joint-38, butt-splice-1-0, factory-cable-end
%PY% build_catalog.py                          :: catalog.json (+ connections, compatible), out\lib-<id>.glb
%PY% validate_and_preview.py out\lib-powerbar-2104.glb out tmp   :: then keep tmp_34.png as out\lib-powerbar-2104.png
%PY% make_part.py parts\copper-bar.json bar.glb thickness=1/8 length=8 studs=2.5:3/8-16,6.0:5/16-18   :: parametric rebuild, writes bar.glb.connections.json
```
| Part | Category / mount | Source | Estimates |
|---|---|---|---|
| `powerbar-2104` Blue Sea 2104, 600 A, 4 x 3/8-16 | distribution / surface (4 x #10, 6.25 x 1.32 in) | `the dimensioned drawing on bluesea.com (product 2104)` (base 7, studs 1.25 pitch, bar top 1.3, stud top 2.0, base 0.5) | base width 2.0, bar block 5.5 x 1.0, nut flange, end screws, per-stud 300 A, per-screw 30 A. Polarity option is a label only (no red/black accents: real bar is tinned copper on black) |
| `mrbf-5191` Blue Sea 5191, 30-300 A, 58 V | fusing / stud 3/8-16 | product page (300 A, 58 V, 5/16 stud, 75 in-lb). Drawing PDF not downloadable (access denied) | all dimensions and body shape. Output stud 5/16-18 (listing says M8). Option `fuse_a` is a label |
| `copper-bar` 1 in wide, 1/8 or 1/4 thick, 2-10 in, 1-3 studs | distribution / stud 3/8-16 | design values | everything. Rating rule: 1000 A per sq in x thickness x width (1/8 = 125 A, 1/4 = 250 A), studs capped 300 A (3/8-16) / 200 A (5/16-18) |
| `lug-joint-38` 3/8 bolt, nut, 2 lug tongues, boot | cable / surface (free) | none | all sizes; ratings by gauge |
| `butt-splice-1-0` with adhesive heat shrink | cable / surface (free) | none | all sizes; 250 A |
| `factory-cable-end` stub + lug, factory +/- , 2 or 4 AWG | marker / surface (free) or stud | none | all sizes; flag stands for the label (see `label_by_option`) |
Existing parts: Odyssey stud rating 300 A is an estimate (not published); Blue Sea 2340 100 A is published (group rating), per-screw 25 A is an estimate; lug ratings by gauge (150 / 100 A) are estimates; nuts have no connections.

### Connections (see projects/buildXR/DESIGN-connections.md)
`connections[]` per part: `id`, `kind` (stud, screw, crimp, fuse_in, fuse_out, plug, splice, and `ring` for a lug/tab that sits on a stud), `form` (what physically carries a part: stud | ring | screw),
`thread` or `gauge`, `rating_a` (+ `rating_estimate: true` when estimated), `polarity` (`+`, `-`, `any`; `polarity_option` = follows that part option), `pos` (inches, part space),
optional `group` (see `rating_groups`: total for a set, e.g. 600 A PowerBar), `by_option` (`{option: {value: {field overrides}}}`, e.g. thickness or gauge), `rating_from_option`, `enabled_when`.

### Outlets and mounts: one vocabulary
- Outlet = a connection with `form: stud` and `accepts`: `{thread, max_items, max_stack_in}` (max_stack_in = thread length above the base available for the items; nut included). Outlets exist on battery studs, PowerBar studs, MRBF output stud, copper bar studs, the lug-joint bolt (only when `factory_lug` is off).
- Mount (what a part attaches to) = `needs`: `{kind: stud|surface, thread, polarity, consumes_in}` (`consumes_by_option` for variants; `placement: free|fixed` for surface). Same words on both sides: a stud mount fits an outlet when `needs.kind == "stud"`, `needs.thread == accepts.thread`, polarity compatible (`any` or `polarity_option` is a wildcard) and the sum of `consumes_in` of the items stays within `max_stack_in` and `max_items`.
- `build_catalog.match()` implements this; every catalog entry has `compatible: {mount id: ["part.connection", ...]}` computed from all parts, so the UI can list valid outlets without extra rules. Surface mounts need no outlet.
- Gap: there is no 5/16-18 lug yet, so nothing is compatible with the MRBF output stud (and the 3/8 lug does not fit it, correctly).
- Library parts do not use `snap_to`; the existing stud-stack snapping (`snap_to`, `top`) still applies to the default parts only.
