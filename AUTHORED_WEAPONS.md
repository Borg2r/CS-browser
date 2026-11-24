# Authored weapon models

The sixteen firearms without uploaded models have dedicated geometry. These
are original runtime-authored assets, not conversions of the uploaded CS models.
Weapon IDs, prices, ammunition, damage and firing modes are unchanged.

| Builder | Weapons |
| --- | --- |
| `client/js/detailed-pistols.js` | P9S, Bulwark .45, Viper .357 |
| `client/js/detailed-tactical.js` | QK-9mm, Cinder 45, Volt 90, Bastion BP |
| `client/js/sabre.js` | Sabre SG, with rounded Swiss-style receiver/furniture and a curved translucent magazine |
| `client/js/detailed-shotguns.js` | Ram 12, Tempest Auto, Twin Lever-Action (short M1887) |
| `client/js/drifter.js`, `titan.js`, `kar98k.js` | Drifter LR, Titan .50, Kar98k |
| `client/js/m16.js`, `m14.js` | M16, M14 |

`models.js` selects each dedicated builder after checking for an uploaded asset.
The generic builders remain available while uploaded assets load. One template
per weapon/optic combination shares immutable geometry and materials between
held, dropped and remote weapons. Clones have independent animated transforms.

## Geometry and finishes

`weapon-detail.js` provides bevelled side profiles with actual holes, hollow
barrels, turned metal profiles, and deterministic shared PBR finishes. Wood,
polymer, rubber, blued steel, stainless steel and machined steel use color,
roughness and normal textures. Textures are generated locally once per finish;
no additional asset downloads are needed. Color textures use sRGB; roughness
and normals remain linear. Parts are baked into material batches instead of
creating a draw call for every screw, cartridge or panel.

Source geometry uses metres with the muzzle facing negative Z and the gripping
hand around `(0, -.08, .03)`. Profiles take `[z, y]` coordinates and an X width;
barrels are centered on their own Z axis. The shared `Parts.add` helper places
these shapes into the baked model. Most base models use roughly 5,400–13,600
triangles. Sabre's more detailed body uses about 21,400 before its optic.

`weapon-lighting.js` creates one small filtered reflection environment per
renderer for the first-person scene. Low-intensity, broad reflections reveal
curved metal and coated glass without capturing the scene every frame or
downloading an HDR image. Map lighting is independent.

## Animation and sights

Movable groups use the existing `world.js` names: `slide`, `magazine`,
`bolt_action` / `bolt_handle`, or `lever` / `bolt`. Tube-fed shotguns keep their
magazine tubes fixed; Ram's pump shares its reciprocating action group. M1887
levers and rolling breeches animate independently for each hand.

Required metadata includes `muzzle`, `sightY` and `length`; optional `hip`,
`adsZ`, `dualHip` and `supportGrip` set the first-person pose. A top-loaded
magazine sets `magazineReloadDirection: [0, 1, 0]`; other magazines default to
`[0, -1, 0]`. Animation groups have a zero rest translation unless their named
action explicitly defines a pivot/rest position. `authoredDetail: true` identifies
these templates for inspection.

Optics preserve the existing purchase rules and scoped-overlay behavior. Iron
sights share their front and rear sight heights; red dots and ACOGs retain a
clear optical axis. Akimbo M1887s have no ADS. When editing a builder, inspect
both hip and ADS views, attachments, firing/reload animation, the world model,
and both hands for dual weapons. Check finite geometry/UVs, outward normals,
open bores, independent clone transforms and alignment of the sight picture.

`optics.js` supplies compact open-emitter reflex sights (separate pistol/rifle
sizes) and a 155 mm forged prism sight with a curved fiber collector. The
optics expose their real lens height relative to the mounting base. `models.js`
derives ADS height from the actual lens, including optics attached inside a
pistol's moving slide. A few weapons need small rail adapters to clear their
fixed iron sights; those adapters lift the mount without scaling the optic.
The native Sabre sight retains its existing 2× magnification and has a fine
in-model chevron. Purchased ACOG retains the 4× HUD scope; red dots retain 1.5×.
