#!/usr/bin/env python3
"""Bake the nine supplied CS2 weapon GLBs into shared browser mesh buffers.

Usage: python scripts/import-cs2-weapons.py /path/to/uploaded/files
Requires numpy and Pillow. Searches the source directory recursively, validates
static uncompressed glTF 2 geometry, and writes client/assets/weapons/<id>.
Original topology, UV sets and material settings are preserved. Geometry is
quantized below 0.008 mm / 0.008 texture pixels for compact lossless transfer. The
pair of Dual Elites is split at its empty centre, retaining one complete pistol
for independent left/right instances. Magazine/slide batches follow connected
source components, so animated parts do not cut through visible triangles.

Deterministic gzip sidecars reduce geometry transfer; ServeDir advertises their
Content-Encoding. WebP retains full 1024px source texture dimensions.
"""
import argparse
from collections import defaultdict
import gzip
import hashlib
import io
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image

COMPONENT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
# Coordinates below are in the original GLB's transformed metre space. Source
# +Z is forward. Grip centre maps to the existing palm at (0,-.08,.03).
# grip=(Y,Z), bore=Y, sight=Y, rail=(Y,Z), support=(Y,Z), mag=(Zmin,Zmax,Ymax).
CONFIG = {
    'g3sg1': dict(grip=(.035, .36), bore=.141, sight=.230, rail=(.185,.42), support=(.105,.65), mag=(.489,.581,.139)),
    'galil_ar': dict(grip=(-.025,.075), bore=.082, sight=.136, rail=(.120,.23), support=(.045,.36), mag=(.185,.299,.068)),
    'mp7': dict(grip=(-.045,-.045), bore=.032, sight=.111, rail=(.082,0), support=(-.040,.119), mag=(-.067,.003,.018)),
    'm4a4': dict(grip=(.185,.36), bore=.314, sight=.387, rail=(.350,.48), support=(.279,.69), mag=(.479,.580,.320)),
    'awp': dict(grip=(.125,.045), bore=.224, sight=.290, rail=(.250,.22), support=(.155,.42), mag=(.170,.258,.212)),
    'negev': dict(grip=(-.015,-.015), bore=.123, sight=.167, rail=(.148,.015), support=(-.010,.375), mag=(.109,.205,.087)),
    'dual_elite': dict(grip=(.008,.030), bore=.103, sight=.116, rail=(.114,.11), support=None, mag=(.007,.085,.099)),
    # The source rear aperture is textured solid; aim just above its housing.
    'famas': dict(grip=(-.027,.130), bore=.078, sight=.198, rail=(.186,.25), support=(.026,.32), mag=(-.062,.032,.060)),
    'mp5sd': dict(grip=(-.033,0), bore=.091, sight=.148, rail=(.137,.13), support=(.063,.32), mag=(.139,.243,.090)),
}


def node_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix']).reshape(4, 4).T
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    sx, sy, sz = node.get('scale', [1, 1, 1])
    tx, ty, tz = node.get('translation', [0, 0, 0])
    return np.array([
        [(1-2*(y*y+z*z))*sx, 2*(x*y-z*w)*sy, 2*(x*z+y*w)*sz, tx],
        [2*(x*y+z*w)*sx, (1-2*(x*x+z*z))*sy, 2*(y*z-x*w)*sz, ty],
        [2*(x*z-y*w)*sx, 2*(y*z+x*w)*sy, (1-2*(x*x+y*y))*sz, tz],
        [0, 0, 0, 1],
    ])


def read_glb(path):
    raw = path.read_bytes()
    magic, version, total = struct.unpack_from('<III', raw)
    assert magic == 0x46546c67 and version == 2 and total == len(raw), 'Expected complete GLB 2'
    off, gltf, binary = 12, None, None
    while off < len(raw):
        length, kind = struct.unpack_from('<II', raw, off)
        off += 8
        if kind == 0x4e4f534a:
            gltf = json.loads(raw[off:off+length])
        elif kind == 0x004e4942:
            binary = raw[off:off+length]
        off += length
    assert gltf and binary and not gltf.get('extensionsUsed'), 'Unexpected compressed/extended source'
    assert not gltf.get('skins') and not gltf.get('animations'), 'Expected static weapon source'

    def accessor(index):
        item = gltf['accessors'][index]
        assert 'sparse' not in item and not item.get('normalized'), 'Unsupported accessor'
        view = gltf['bufferViews'][item['bufferView']]
        assert view.get('buffer', 0) == 0
        fmt = '<' + COMPONENT[item['componentType']] * WIDTH[item['type']]
        stride = view.get('byteStride', struct.calcsize(fmt))
        start = view.get('byteOffset', 0) + item.get('byteOffset', 0)
        return np.array([struct.unpack_from(fmt, binary, start+stride*j) for j in range(item['count'])])

    meshes = []
    def visit(index, parent):
        node = gltf['nodes'][index]
        transform = parent @ node_matrix(node)
        if 'mesh' in node:
            for primitive in gltf['meshes'][node['mesh']]['primitives']:
                assert primitive.get('mode', 4) == 4
                a = primitive['attributes']
                vertices = accessor(a['POSITION'])
                position = (np.c_[vertices, np.ones(len(vertices))] @ transform.T)[:, :3]
                normal = accessor(a['NORMAL']) @ np.linalg.inv(transform[:3, :3])
                normal /= np.maximum(np.linalg.norm(normal, axis=1)[:, None], 1e-15)
                mesh = {'position': position, 'normal': normal, 'uv': accessor(a['TEXCOORD_0']),
                        'index': accessor(primitive['indices']).flatten().astype(int), 'material': primitive['material']}
                if 'TEXCOORD_1' in a:
                    mesh['uv1'] = accessor(a['TEXCOORD_1'])
                meshes.append(mesh)
        for child in node.get('children', []):
            visit(child, transform)
    for root in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
        visit(root, np.eye(4))
    return gltf, binary, meshes, hashlib.sha256(raw).hexdigest()


def component_parts(mesh, key):
    """Classify whole connected pieces; identical positions weld UV seams only for analysis."""
    vertices, triangles = mesh['position'], mesh['index'].reshape(-1, 3)
    parent = list(range(len(vertices)))
    def root(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index
    def join(a, b):
        parent[root(a)] = root(b)
    positions = {}
    for i, point in enumerate(vertices):
        join(i, positions.setdefault(tuple(np.round(point, 6)), i))
    for a, b, c in triangles:
        join(a, b)
        join(b, c)
    components = defaultdict(list)
    for i in range(len(vertices)):
        components[root(i)].append(i)
    parts = {}
    zmin, zmax, ymax = CONFIG[key]['mag']
    bounds = {group: (vertices[indices].min(0), vertices[indices].max(0))
              for group, indices in components.items()}
    candidates = [group for group, (lo, hi) in bounds.items()
                  if lo[2] >= zmin and hi[2] <= zmax and hi[1] <= ymax
                  and (key != 'dual_elite' or hi[0] < .25)]
    # The magazine's largest connected shell also bounds its loose internal
    # cartridges. Adjacent release levers/pins outside that shell remain fixed.
    main = max(candidates, key=lambda group: len(components[group]))
    magazine_lo, magazine_hi = bounds[main]
    for group, indices in components.items():
        lo, hi = bounds[group]
        part = 'body'
        if np.all(lo >= magazine_lo-.0006) and np.all(hi <= magazine_hi+.0006):
            part = 'magazine'
        if key == 'dual_elite' and lo[1] > .070 and len(indices) > 1000:
            part = 'slide'
        parts[group] = part
    return [parts[root(int(face[0]))] for face in triangles]


def convert(path, destination, key):
    gltf, source_bytes, meshes, source_sha = read_glb(path)
    destination.mkdir(parents=True, exist_ok=True)
    config = CONFIG[key]
    grip_y, grip_z = config['grip']
    offset_y = -.08 - grip_y
    def point(x, y, z):
        return [-float(x), float(y + offset_y), float(-z + grip_z + .03)]
    data = bytearray()
    def append(values, dtype):
        if dtype == '<f4':
            # Binary-grid quantization clears noise bits without visible detail
            # loss (positions <=7.7 micrometres, UVs <=0.008 texels at1024px).
            values = np.round(np.asarray(values) * 65536) / 65536
        values = np.ascontiguousarray(values, dtype=dtype)
        result = {'byteOffset': len(data), 'length': int(values.size)}
        data.extend(values.tobytes())
        return result
    batches, all_positions = [], []
    for mesh in meshes:
        parts = component_parts(mesh, key)
        triangles = mesh['index'].reshape(-1, 3)
        for part in ['body', 'slide', 'magazine']:
            selected = np.array([i for i, name in enumerate(parts) if name == part and
                (key != 'dual_elite' or np.all(mesh['position'][triangles[i], 0] < .25))], dtype=int)
            if not len(selected):
                continue
            used, inverse = np.unique(triangles[selected].flatten(), return_inverse=True)
            source_positions = mesh['position'][used]
            position = source_positions * [-1, 1, -1] + [0, offset_y, grip_z+.03]
            normal = np.round(mesh['normal'][used] * [-1, 1, -1] * 16384) / 16384
            batch = {'name': key + '_' + part, 'material': mesh['material'], 'part': part,
                     'position': append(position, '<f4'), 'normal': append(normal, '<f4'),
                     'uv': append(mesh['uv'][used], '<f4')}
            if 'uv1' in mesh:
                batch['uv1'] = append(mesh['uv1'][used], '<f4')
            batch['index'] = append(inverse, '<u4')
            batches.append(batch)
            all_positions.append(position)
    position = np.concatenate(all_positions)
    textures = []
    normal_images = {gltf['textures'][m['normalTexture']['index']]['source'] for m in gltf['materials'] if 'normalTexture' in m}
    image_paths = []
    for i, source in enumerate(gltf['images']):
        view = gltf['bufferViews'][source['bufferView']]
        start = view.get('byteOffset', 0)
        image = Image.open(io.BytesIO(source_bytes[start:start+view['byteLength']])).convert('RGB')
        assert max(image.size) <= 2048, 'Unexpectedly large source texture'
        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        uri = f'texture-{i}.webp'
        image.save(destination/uri, format='WEBP', quality=96 if i in normal_images else 92, method=6)
        image_paths.append(uri)
    for source in gltf['textures']:
        sampler = gltf.get('samplers', [])[source['sampler']] if 'sampler' in source else {}
        textures.append({'uri': image_paths[source['source']], **sampler})
    source_max_z = max(m['position'][:, 2].max() for m in meshes)
    rail_y, rail_z = config['rail']
    metadata = {
        'muzzle': point(0, config['bore'], source_max_z+.003),
        'sightY': config['sight']+offset_y,
        'length': float(np.ptp(position[:, 2])),
        'hip': [.22, -.19, -.48] if key in ['mp7', 'dual_elite'] else [.22, -.18, -.45],
        'optic': {'baseY': rail_y+offset_y, 'z': point(0, rail_y, rail_z)[2],
                  'redDotY': rail_y+offset_y+.055, 'acogY': rail_y+offset_y+.070},
    }
    if config['support']:
        sy, sz = config['support']
        # Existing support hand palm is (0,-.082,.028) within its group.
        palm = point(0, sy, sz)
        metadata['supportGrip'] = [-.015, palm[1]+.082, palm[2]-.028]
    if key in ['mp7', 'dual_elite']:
        metadata['dualHip'] = [.235, -.175, -.44]
    manifest = {
        'version': 1, 'data': 'geometry.bin', 'textures': textures,
        'materials': gltf['materials'], 'batches': batches, 'metadata': metadata,
        'bounds': [position.min(0).tolist(), position.max(0).tolist()],
        'triangleCount': sum(b['index']['length']//3 for b in batches),
        'source': {**gltf['asset'].get('extras', {}), 'sha256': source_sha},
        'modifications': 'Coordinates normalized to grip space and quantized below 0.008 mm; UVs quantized below 0.008 texels; textures converted to WebP; source connected parts grouped for animation.' +
            (' One complete pistol retained from the original pair for independent akimbo instances.' if key == 'dual_elite' else ''),
    }
    (destination/'geometry.bin').write_bytes(data)
    (destination/'geometry.bin.gz').write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
    (destination/'scene.json').write_text(json.dumps(manifest, separators=(',', ':'))+'\n')
    source = manifest['source']
    (destination/'LICENSE.md').write_text(
        f"# {source.get('title', key)}\n\n{source.get('author', 'Author unspecified')}\n\n"
        f"Source: {source.get('source', 'Source unspecified')}\n\nLicense: {source.get('license', 'License unspecified')}\n\n"
        f"{manifest['modifications']} Original topology, UVs and PBR material configuration are retained.\n")
    transfer = len((destination/'geometry.bin.gz').read_bytes()) + sum((destination/p).stat().st_size for p in image_paths)
    print(f'{key}: {manifest["triangleCount"]:,} triangles, {len(batches)} parts, {len(data):,} bytes geometry, {transfer:,} bytes compressed geometry+textures')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'client/assets/weapons')
    parser.add_argument('--only', choices=list(CONFIG))
    args = parser.parse_args()
    for key in ([args.only] if args.only else CONFIG):
        files = list(args.source.rglob(key+'_counter_strike_2.glb'))
        if len(files) != 1:
            raise ValueError(f'Expected exactly one {key} source, found {len(files)}')
        convert(files[0], args.output/key, key)

if __name__ == '__main__':
    main()
