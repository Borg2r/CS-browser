#!/usr/bin/env python3
"""Bake the supplied vrchris Dust2 GLB into the game's static mesh format.

Usage: python scripts/import-dust2.py /path/to/de_dust2_-_cs_map.glb
No third-party Python packages are required. This deliberately validates the
features of this particular asset rather than pretending to be a glTF loader.
The original geometry, normals, UVs, indices, materials and PNGs are retained.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct


def convert(source, destination):
    raw = source.read_bytes()
    magic, version, size = struct.unpack_from('<4sII', raw)
    assert magic == b'glTF' and version == 2 and size == len(raw), 'Expected GLB 2'
    cursor, chunks = 12, {}
    while cursor < len(raw):
        length, kind = struct.unpack_from('<II', raw, cursor)
        chunks[kind] = raw[cursor + 8:cursor + 8 + length]
        cursor += 8 + length
    gltf = json.loads(chunks[0x4e4f534a])
    binary = chunks[0x004e4942]
    assert not gltf.get('extensionsUsed'), 'Unsupported glTF extension'
    scene = gltf['scenes'][gltf.get('scene', 0)]
    assert len(scene['nodes']) == 1, 'Expected one scene root'
    root = scene['nodes'][0]
    root_matrix = gltf['nodes'][root]['matrix']
    expected = [.013333333656191826, 0, 0, 0, 0, -.013333333656191826,
                0, 0, 0, 0, -.013333333656191826, 0, 0, 1008, 1232, 1]
    assert all(abs(a - b) < 1e-8 for a, b in zip(root_matrix, expected)), 'Unexpected root transform'
    for i, node in enumerate(gltf['nodes']):
        if i != root:
            assert not any(k in node for k in ('matrix', 'rotation', 'translation', 'scale')), 'Unexpected child transform'

    def accessor(index):
        item = gltf['accessors'][index]
        assert 'sparse' not in item and not item.get('normalized'), 'Unsupported accessor'
        view = gltf['bufferViews'][item['bufferView']]
        assert view.get('buffer', 0) == 0
        code, width = {5126: ('f', 4), 5125: ('I', 4), 5123: ('H', 2), 5121: ('B', 1)}[item['componentType']]
        count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[item['type']]
        offset = view.get('byteOffset', 0) + item.get('byteOffset', 0)
        stride = view.get('byteStride', width * count)
        return [struct.unpack_from('<' + code * count, binary, offset + i * stride) for i in range(item['count'])]

    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'textures').mkdir(exist_ok=True)
    data, batches, radar_faces = bytearray(), [], []
    bounds = [[float('inf')] * 3, [float('-inf')] * 3]
    triangle_count = 0

    def append(values, code):
        offset = len(data)
        flat = [v for row in values for v in row]
        data.extend(struct.pack('<' + code * len(flat), *flat))
        return {'byteOffset': offset, 'length': len(flat)}

    def visit(index):
        nonlocal triangle_count
        node = gltf['nodes'][index]
        if 'mesh' in node:
            mesh = gltf['meshes'][node['mesh']]
            for primitive in mesh['primitives']:
                assert primitive.get('mode', 4) == 4, 'Expected triangles'
                attrs = primitive['attributes']
                assert set(attrs) == {'POSITION', 'NORMAL', 'TEXCOORD_0'}
                # Normalize the Sketchfab root translation and scale exactly
                # once. The shared collision bake uses this same convention:
                # one Source unit is .025m, Y/Z flip together (no reflection).
                positions = [(x * .025, -y * .025, -z * .025) for x, y, z in accessor(attrs['POSITION'])]
                normals = [(x, -y, -z) for x, y, z in accessor(attrs['NORMAL'])]
                uv = accessor(attrs['TEXCOORD_0'])
                indices = accessor(primitive['indices'])
                assert len(indices) % 3 == 0
                assert all(0 <= i[0] < len(positions) for i in indices)
                for face in range(0, len(indices), 3):
                    a, b, c = [positions[indices[face + k][0]] for k in range(3)]
                    u, v = [b[k] - a[k] for k in range(3)], [c[k] - a[k] for k in range(3)]
                    normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
                    length = math.sqrt(sum(n*n for n in normal))
                    height = (a[1] + b[1] + c[1]) / 3
                    # Floors, ramps, stairs and low cover. Tall roofs/wall caps
                    # would conceal the routes below in a top-down radar.
                    if length and normal[1] / length > .65 and height <= 4.1:
                        radar_faces.append((height, (a, b, c)))
                for p in positions:
                    for axis in range(3):
                        bounds[0][axis] = min(bounds[0][axis], p[axis])
                        bounds[1][axis] = max(bounds[1][axis], p[axis])
                batches.append({
                    'name': mesh.get('name', node.get('name', 'Dust2')),
                    'material': primitive['material'],
                    'position': append(positions, 'f'),
                    'normal': append(normals, 'f'),
                    'uv': append(uv, 'f'),
                    'index': append(indices, 'I'),
                })
                triangle_count += len(indices) // 3
        for child in node.get('children', []):
            visit(child)

    visit(root)
    textures = []
    for i, texture in enumerate(gltf['textures']):
        image = gltf['images'][texture['source']]
        assert image['mimeType'] == 'image/png' and 'uri' not in image
        view = gltf['bufferViews'][image['bufferView']]
        offset = view.get('byteOffset', 0)
        filename = f'textures/{i:02}.png'
        (destination / filename).write_bytes(binary[offset:offset + view['byteLength']])
        sampler = gltf.get('samplers', [{}])[texture.get('sampler', 0)]
        textures.append({'uri': filename, **sampler})

    # Keep the SVG's world extent identical to the map's symmetric w/h bounds.
    radar_extent = [math.ceil(max(abs(bounds[0][k]), abs(bounds[1][k]))) + 1 for k in (0, 2)]
    radar_paths = ['', '', '']
    for height, points in sorted(radar_faces):
        level = 0 if height < -.8 else 1 if height <= 1 else 2
        radar_paths[level] += 'M' + 'L'.join(f'{p[0]:.3f},{p[2]:.3f}' for p in points) + 'Z'
    width, height = (v * 2 for v in radar_extent)
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width*4}" height="{height*4}" viewBox="{-radar_extent[0]} {-radar_extent[1]} {width} {height}">']
    svg.append('<title>Dust2 floor plan from the original map geometry</title>')
    for path, color in zip(radar_paths, ['#566264', '#87958d', '#b2b6a2']):
        svg.append(f'<path d="{path}" fill="{color}" stroke="{color}" stroke-width=".06" stroke-linejoin="round"/>')
    svg.append('</svg>')
    (destination / 'radar.svg').write_text('\n'.join(svg) + '\n')

    manifest = {
        'version': 1,
        'source': {**gltf['asset'].get('extras', {}), 'sha256': hashlib.sha256(raw).hexdigest()},
        'coordinates': {'rawToGameScale': [.025, -.025, -.025], 'units': 'metres', 'up': 'Y'},
        'bounds': bounds,
        'triangleCount': triangle_count,
        'data': 'geometry.bin',
        'radar': {'image': 'radar.svg', 'extent': radar_extent},
        'batches': batches,
        'materials': gltf['materials'],
        'textures': textures,
    }
    (destination / 'geometry.bin').write_bytes(data)
    (destination / 'scene.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
    print(f'{len(batches)} batches, {triangle_count} triangles, {len(textures)} original textures; bounds {bounds}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent.parent / 'client/assets/dust2')
    args = parser.parse_args()
    convert(args.source, args.output)
