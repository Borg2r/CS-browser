# Dust2

The sixth map, `dust2` (stable map index 5), imports the supplied
`de_dust2_-_cs_map.glb`. It retains the original 9,294 triangles, UVs and 34 PNG
textures. The companion ZIP contains the same source model and texture set.

The GLB metadata credits [vrchris](https://sketchfab.com/vrchris) and licenses
[“de_dust2 - CS map”](https://sketchfab.com/3d-models/de-dust2-cs-map-056008d59eb849a29c0ab6884c0c3d87)
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Attribution and modification details also ship in `client/credits.html` and
`client/assets/dust2/LICENSE.md`.

## Geometry and gameplay

Source OBJ coordinates are converted into metres with
`[x, y, z] → [x × .025, −y × .025, −z × .025]`. This removes the GLB's display
translation and matches normal player proportions. Render and collision data
use identical coordinates. Floors retain their original elevations: attacker
spawn at 3.2 m, defender spawn at −3.2 m, site A at 2.4 m and site B at 0 m.

Player boxes sweep against a BVH of the original triangles. Mesh maps support
short steps, ramps and continuous collision; the five existing maps retain
their box movement. Bullet visibility and grenades use the imported surfaces.
The source mesh contains surface shells rather than solid brush volumes, so
shots stop at these surfaces instead of guessing wall penetration thickness.

Bot navigation keeps separate nodes for stacked floor levels and only connects
them over traversable surfaces. Spawns sit in sheltered portions of the
original spawn rooms. Bomb zones align with the original floor markings.
Existing maps, weapons and match controls remain available.

The browser downloads about 1.5 MB of model buffers and textures on first use.
Decoded data is cached; GPU resources are released on map changes. A loading
screen prevents entering an incomplete scene, and failed downloads show a
reload action.

## Rebuild from the supplied GLB

Both importers use Python's standard library:

```sh
python scripts/import-dust2.py /path/to/de_dust2_-_cs_map.glb
python scripts/import-dust2-collision.py /path/to/de_dust2_-_cs_map.glb crates/sim/src/maps/dust2_collision.bin
./build-wasm.sh
cargo test --locked
```

Run `node scripts/maps-smoke.mjs http://127.0.0.1:8088` against a fresh local
server to verify all six map selections, guest multiplayer, native/WASM floor
collision and movement, and host controls.
