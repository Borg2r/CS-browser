# Uploaded classic maps

Compound, Province, Italy, Assault and Office extend the existing map list at
stable indices 6–10. Their source files come from the user-supplied
[map-assets release](https://github.com/Borg2r/CS-browser/releases/tag/map-assets).
The first six map IDs and all existing weapon IDs remain unchanged.

| Index | Map ID | Source file | Render triangles | Source credit |
| --- | --- | --- | ---: | --- |
| 6 | `compound` | `cs_compound.glb` | 202,633 | Leafia dev.; embedded CC BY 4.0 |
| 7 | `province` | `province old.glb` in `province-old.zip` | 106,953 | Author and license unspecified in supplied source |
| 8 | `italy` | `cs_italy_with_real_light.glb` | 36,915 | Neo_minigan; embedded CC BY 4.0 |
| 9 | `assault` | `cs_assault_with_real_light.glb` | 10,108 | Neo_minigan; embedded CC BY 4.0 |
| 10 | `office` | `source/1.fbx` in `cs-office-with-real-light.zip` | 23,916 | Author and license unspecified in supplied source |

The in-game [credits](client/credits.html) link the original model pages and
authors where the supplied metadata identifies them. Per-map `LICENSE.md` or
`SOURCE.md` files preserve those records alongside the assets. Each `scene.json`
also records the input filename, SHA-256, coordinate conversion and texture
processing. Office records the original FBX hash as well as its intermediate
GLB hash; no author or license is inferred from the names of the other maps.

## Geometry and presentation

The importer applies glTF node transforms, normalizes coordinates into metres,
centres the horizontal footprint and rebases the lowest source vertex to zero.
It retains source triangles, material assignments, UV sets and vertex colors;
compatible batches merge to reduce draw calls. Rendering and triangle collision
derive from the same transformed source geometry. Degenerate and duplicate
collision faces are removed. Province's decorative decal faces and Italy's
leaf faces remain visible but do not block players or shots.

Assault retains its 10,100 source triangles and adds an eight-triangle grey
steel access ramp at the warehouse loading lip. The 3 m by 3 m ramp bridges
the source's 0.8128 m step, so both players and bots can use that connection.
The visible ramp and its collision use identical vertices.

Textures retain their aspect ratio and are limited to 2048 pixels on their
longest side, then encoded as WebP at quality 88. Province's source exporter
marked opaque masonry textures as blended; those materials use normal opaque
depth rendering, while its genuinely transparent decal atlas retains blending.
Italy and Assault preserve their unlit baked lighting. Office's baked atlases
use its second UV channel (`TEXCOORD_1`); its glass keeps a transparent material.
Compound and Province use the source materials with game lighting.

The browser loads only the selected map. A loading screen keeps play gated
until its geometry and textures are ready, and failed downloads can be retried.
Geometry and prediction WASM have gzip sidecars served by the game server.
WASM includes the shared collision data for all maps, so its compressed sidecar
avoids downloading the full uncompressed collision payload. A single
source cache retains decoded buffers and images; replaced downloads are
cancelled, and old map GPU resources and decoded images are released when no
longer needed. Map switching therefore does not retain all five texture sets.

## Gameplay

All five maps use Breachpoint's demolition mode: attackers plant at site A or
B, defenders stop them or defuse the charge. The GLB/FBX geometry supplies the
environment; player spawns, bomb sites, radar and bot routes are authored for
this game. Source CS entity scripts and hostage modes are not imported.

The native server and WebAssembly prediction share the same triangle collision
and movement code. Navigation keeps separate floor levels and connects them
over walkable stairs and ramps. Source mesh surfaces stop shots rather than
guessing the thickness of the original CS brush volumes. Spawn and objective
locations are stored in `crates/sim/src/maps/imported_layouts.rs`.

## Rebuild

The generic converter requires Python 3 with NumPy and Pillow. Keep source
uploads outside the repository. From the repository root, with the indicated
source files extracted, prepare Office's FBX with Blender 4.3 or later:

```sh
blender --background --python-exit-code 1 --python scripts/import-office-source.py -- \
  /path/to/extracted/cs-office-with-real-light /tmp/office.glb \
  --archive /path/to/cs-office-with-real-light.zip
```

The Blender helper needs no additional Python packages. `--archive` is optional
and records the original ZIP hash when provided; original FBX and texture hashes
are always included. Then convert the five GLBs into browser assets and collision:

```sh
python scripts/import-maps.py compound /path/to/cs_compound.glb --scale 1
python scripts/import-maps.py province "/path/to/province old.glb" --scale 100 --exclude-collision-material Decal
python scripts/import-maps.py italy /path/to/cs_italy_with_real_light.glb --scale 1.1 --exclude-collision-material leaves
python scripts/import-maps.py assault /path/to/cs_assault_with_real_light.glb --scale 1.4
python scripts/import-maps.py office /tmp/office.glb --scale 1
```

Office's helper creates a static Y-up GLB, preserving both UV channels and
binding each baked atlas to `UVChannel_2` / `TEXCOORD_1`.
Blender's FBX importer applies the source's
inch-to-metre scale; the generic converter therefore uses scale 1 on the
resulting GLB. The 14 baked materials become unlit base-color materials, with
the glass retained separately. The portable helper uses Blender's atlas resize;
the initial conversion used Pillow's Lanczos resize. The geometry and UVs match,
while filtering can differ slightly at texture edges.

The converter writes `client/assets/maps/<id>/` and
`crates/sim/src/maps/<id>_collision.bin`. Its initial radar is a projection of
source floor triangles. The committed playable radars and gameplay anchors
are selected from the connected navigation floors; preserve or regenerate
those after a fresh import rather than treating roof faces as playable routes.

For radar authoring, `scripts/import-map-radar.py` takes a navigation analysis
JSON containing `points`, strong-component labels in `component`, and `extent`.
A layout JSON supplies `extent`, `spawns` and `spawn_heights` matching the Rust
constants in `imported_layouts.rs`. It selects the component containing the first
attacker spawn using its full XYZ position, excluding isolated roofs and scenery:

```sh
python scripts/import-map-radar.py /path/to/compound-nav.json /path/to/compound-layout.json \
  client/assets/maps/compound --map-id compound --update-manifest
```

The navigation/layout JSON exports are authoring intermediates and are not
committed. This optional command requires those exports; the GLB converter
alone does not recreate the final connected-floor radar. The committed Rust
layout constants and radar assets remain the gameplay source of truth.

Rebuild prediction and run the shared checks after collision changes:

```sh
./build-wasm.sh
cargo test --locked
cargo run --locked --release -p server
```

Against a fresh development server, `node scripts/maps-smoke.mjs
http://127.0.0.1:8080` checks all eleven map selections, guest multiplayer,
native/WASM floor parity and movement, match resets and host permissions.
It changes the shared map and resets matches. Browser validation also covers
texture UV channels, repeated map switches, superseded loads, failed texture
requests and released GPU resources.
