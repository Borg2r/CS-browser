# Assault model attribution

“Cs_Assault with real light” by **Neo_minigan (https://sketchfab.com/neominigan)**.

Source: https://sketchfab.com/3d-models/cs-assault-with-real-light-7f718ece9a57461586b03ea7cc47dc62

The supplied GLB metadata identifies the author and source above and states
**Creative Commons Attribution 4.0 International**:
https://creativecommons.org/licenses/by/4.0/

Supplied through: https://github.com/Borg2r/CS-browser/releases/tag/map-assets

Input file: `cs_assault_with_real_light.glb`
SHA-256: `4d67b57b13443247e811facf995fb4b5a59e985416bced06b1718a98130d22a9`

For Breachpoint, glTF node transforms were applied and coordinates normalized
to metres. Original triangles, material assignments and UVs are retained in
static browser buffers; compatible batches are merged. Textures are resized
to at most 2048 pixels on their longest side and encoded as WebP. Collision,
navigation, protected player spawns, a radar and two bomb objectives were
added for the game's demolition mode.

The source baked lighting is retained in unlit materials.

Breachpoint adds a visible grey steel ramp at the warehouse loading lip:
eight triangles spanning 3 m by 3 m bridge the 0.8128 m step. Its render and
collision geometry match, allowing players and bots to reach the raised floor.
