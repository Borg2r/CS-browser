#!/usr/bin/env python3
"""Package the five restored Dust2 texture atlases into browser-ready WebP.

The image-generation output is a 2x3 grid of 512px cells. This script only
extracts/encodes those restored images; it does not perform the restoration.
Usage: python scripts/prepare-dust2-hd.py /path/to/restored-atlases
Requires ImageMagick. Original PNGs, UVs and all geometry remain unchanged.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess


GROUPS = [
    [1, 2, 29, 3, 15, 0], [4, 9, 12, 33, 13, 14],
    [16, 19, 21, 22, 24, 31], [5, 6, 7, 8, 20, 32],
    [18, 25, 26, 27, 28, 30],
]


def package(atlases, destination):
    manifest_path = destination / 'scene.json'
    manifest = json.loads(manifest_path.read_text())
    output = destination / 'textures/hd'
    output.mkdir(parents=True, exist_ok=True)
    overrides = {}
    for sheet, indices in enumerate(GROUPS):
        atlas = atlases / f'sheet-{sheet}.png'
        assert struct.unpack('>II', atlas.read_bytes()[16:24]) == (1024, 1536), 'Expected 1024x1536 atlas'
        for cell, index in enumerate(indices):
            original = destination / f'textures/{index:02}.png'
            width, height = struct.unpack('>II', original.read_bytes()[16:24])
            scale = min(4, 512 // max(width, height))
            target = (width * scale, height * scale)
            x, y = cell % 2 * 512, cell // 2 * 512
            crop_height = 512
            if sheet == 0 and cell == 5:
                # This generated cell starts slightly below the nominal grid;
                # exclude the preceding rock tile instead of baking a seam.
                y += 18
                crop_height -= 18
            relative = f'textures/hd/{index:02}.webp'
            subprocess.run([
                'convert', str(atlas), '-crop', f'512x{crop_height}+{x}+{y}', '+repage',
                '-filter', 'Lanczos', '-resize', f'{target[0]}x{target[1]}!',
                '-strip', '-quality', '92', '-define', 'webp:method=6', str(destination / relative),
            ], check=True)
            overrides[str(index)] = {
                'uri': relative, 'width': target[0], 'height': target[1],
                'originalSize': [width, height],
                'originalSha256': hashlib.sha256(original.read_bytes()).hexdigest(),
            }
            manifest['textures'][index]['uri'] = relative
    upgrade = {
        'version': 1, 'sourceSha256': manifest['source']['sha256'],
        'method': 'AI-assisted restoration of original diffuse textures; 2–4x resolution, capped at 512px; WebP quality 92',
        'textures': overrides,
        'unchangedTextures': [10, 11, 17, 23],
    }
    manifest['textureUpgrade'] = {'version': 1, 'manifest': 'texture-upgrade.json', 'count': len(overrides)}
    (destination / 'texture-upgrade.json').write_text(json.dumps(upgrade, indent=2) + '\n')
    manifest_path.write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
    print(f'Packaged {len(overrides)} restored textures; geometry, UVs and original PNGs unchanged')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('atlases', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent.parent / 'client/assets/dust2')
    args = parser.parse_args()
    package(args.atlases, args.output)
