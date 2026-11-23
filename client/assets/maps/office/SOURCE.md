# Office source record

User-supplied archive: `cs-office-with-real-light.zip`, containing
`source/1.fbx` and 14 baked texture atlases.

Release: https://github.com/Borg2r/CS-browser/releases/tag/map-assets

Original FBX SHA-256: `86f98ba2d3b84c18e0f6309382e2eb0a47591bf082a094eb4cb29addeaff5118`
Intermediate GLB SHA-256: `5384b40df0cb22e7a70fedf5a07a95118ee807a0a19e62b0d496bc25477b0b96`

The supplied archive does not identify an author or license. This record does
not assign a license or infer an author from other imported maps.

Blender imported the FBX with its source inch-to-metre conversion. The exported
Y-up GLB retains 15 meshes and two UV channels. Baked lighting textures use
`TEXCOORD_1` (the source `UVChannel_2`) and become unlit base-color materials;
the glass remains a separate transparent material. The 8096-pixel atlases are
resized to 2048 pixels and encoded as WebP for browser delivery.

Coordinates are centred for gameplay, original triangles and UVs are retained,
and compatible batches merge. Shared collision, navigation, protected player
spawns, radar and two bomb objectives were added for Breachpoint's demolition
mode.

Rebuild the intermediate GLB with `scripts/import-office-source.py` under
Blender 4.3 or later, then run `scripts/import-maps.py office <glb> --scale 1`.
See `IMPORTED_MAPS.md` in the repository for complete commands. The portable
helper preserves the geometry and UVs; its Blender texture resize can filter
edges slightly differently from the original Pillow Lanczos preparation.
