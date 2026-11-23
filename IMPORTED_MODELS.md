# Uploaded weapons and operators

The supplied classic and CS2 assets are converted into static browser buffers
with shared geometry and materials. Their original topology and textures are
retained. The two identical Desert Eagle GLBs and equivalent FBX archive are
represented by one asset. Each Dual Elite instance contains one pistol, so
left and right triggers still animate and fire independently.

| Game weapon ID | Uploaded model / shop name |
| --- | --- |
| `knife` | Classic knife |
| `wasp` | MAC-10 |
| `sentinel` | M4A1 |
| `rook` | AK-47 |
| `hornet` | Five-SeveN |
| `mammoth`, `twin_mammoth` | Desert Eagle / Dual Desert Eagles |
| `twin_kestrel` | Dual Elites |
| `twin_mp7`, `mp7` | Dual MP7 / MP7 |
| `anvil` | Negev |
| `m4a4` | M4A4 |
| `longbow` | AWP |
| `lynx` | MP5-SD |
| `reaper` | G3SG1 |
| `jackal` | Galil AR |
| `falcon` | FAMAS |

Existing numeric weapon indices and gameplay statistics are preserved. M4A4
and MP7 append at indices 35 and 36. P9S and QK-9mm retain their requested names.
The dedicated M16, M14, Kar98k, Titan and lever-action models remain available.
Attachments, held models and dropped models all use the same weapon identity.

The eight character source models were static T-poses. Their conversion adds
a 16-bone skeleton and skin weights; runtime poses support running, crouching,
aiming, pistol/rifle/akimbo grips, death and revival. Broken all-black source
vertex colors are omitted so the original textures render correctly. Geometry
and textures are shared, while each player owns independent bones and releases
its skeleton texture when removed.

Initial joining waits for both character and weapon assets. Downloads are
cached for the browser session, and failures offer a reload action. Deterministic
gzip geometry sidecars are served through `ServeDir::precompressed_gzip()`;
CS2 textures use WebP with the original 1024-pixel dimensions. Float rounding
below 0.008 mm improves compression without removing triangles. Color maps
use sRGB, while normal and roughness/metalness maps remain linear. Separate
normal-map UV channels are retained where present.

## Sources and rebuilding

The in-game [credits](client/credits.html) link all embedded authorship and
license metadata. [model-credits.json](client/assets/model-credits.json) records
filenames, hashes, source URLs and provenance. Archive entries without embedded
authorship or license metadata are explicitly recorded as such.

```sh
# Python with numpy/Pillow; Blender 4.x is needed for MAC-10 and knife FBX.
python scripts/import-classic-weapons.py --source-dir /path/to/uploads
python scripts/import-cs2-weapons.py /path/to/uploads
python scripts/import-characters.py /path/to/cs-16-models.zip
./build-wasm.sh
```

Assets are generated under `client/assets/weapons` and
`client/assets/characters`; source uploads are kept outside the repository.
