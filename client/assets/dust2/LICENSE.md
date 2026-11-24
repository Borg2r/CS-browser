# Dust2 model attribution

“de_dust2 - CS map” by **vrchris** (https://sketchfab.com/vrchris).

Source: https://sketchfab.com/3d-models/de-dust2-cs-map-056008d59eb849a29c0ab6884c0c3d87

Licensed under **Creative Commons Attribution 4.0 International**:
https://creativecommons.org/licenses/by/4.0/

The supplied GLB metadata identifies this author, source and license. The model
has been converted into static buffers for this game. Coordinates are normalized
to metres and aligned with the playable collision geometry; the original mesh
topology and UVs are retained. Gameplay, collision and navigation data are
additions for this game.

Thirty textures have been modified through AI-assisted detail restoration and
upscaled to 2–4 times their original dimensions, then encoded as WebP. These
derivatives are in `textures/hd/`; `texture-upgrade.json` records their source
hashes and dimensions. All original PNGs remain in `textures/`. The two credit
images and the constant black/white textures remain unchanged. The restoration
does not change map dimensions, geometry or gameplay.

Rebuild using `python scripts/import-dust2.py /path/to/de_dust2_-_cs_map.glb`.
