# Uploaded classic operator models

Source supplied by the user: `cs-16-models.zip`, containing
`source/CS 1_6 models.glb` and fourteen PNG textures. The GLB identifies its
exporter as `THREE.GLTFExporter r179dev`; it does not include author or license
metadata. No attribution or license has been invented during conversion.

Included models: Urban, GIGN, SAS and GSG-9 defenders; Arctic, Phoenix,
Elite Crew and Guerilla attackers. Model labels follow the supplied node names.

The original mesh topology, UV coordinates and texture images are retained.
The body meshes in six source models contain broken all-black vertex colors;
those color attributes are omitted so their actual textures remain visible.
Models are centered, oriented toward the game's forward axis and normalized to
1.78 metres. A sixteen-bone skeleton and skin weights are added because the
source contains static T-poses without bones or animation. Gameplay drives the
walk, crouch, weapon grip, aim and death poses.

Rebuild: `python scripts/import-characters.py /path/to/cs-16-models.zip`.
Geometry, materials and textures are shared between instances. Each player has
an independent skeleton that is released when the player leaves or maps change.
