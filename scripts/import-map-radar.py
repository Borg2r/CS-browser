#!/usr/bin/env python3
"""Draw an imported map's radar from its connected, playable navigation floors.

Usage: python3 scripts/import-map-radar.py NAV.json LAYOUT.json OUTPUT_DIR
       [--map-id compound] [--update-manifest] [--cell-size 1]

NAV.json is the output of the Nav::build analysis helper, containing points,
strong-component labels and symmetric map extents. LAYOUT.json contains the
gameplay spawns and their floor heights. The first attacker spawn selects the
component using full XYZ distance; isolated roofs/skyboxes are not displayed.
Only the Python standard library is required. By default only radar.svg is
written. --update-manifest also updates scene.json radar metadata and the
authored Compound/Province overview framing, after final map asset generation.
"""
import argparse
from collections import defaultdict
from html import escape
import json
import math
from pathlib import Path


COLORS = ['#596b70', '#70878b', '#879c99', '#a4b3a2', '#c4c9ad']
OVERVIEWS = {
    'compound': {'target': [-17, 5, -18], 'radius': 80, 'height': 68},
    'province': {'target': [-15, 9, 11], 'radius': 65, 'height': 60},
}


def finite_number(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def grid_spacing(points):
    """Production nav uses 1m cells; also accept finer analysis grids."""
    deltas = []
    for axis in (0, 2):
        values = sorted(set(round(point[axis], 6) for point in points))
        deltas.extend(b - a for a, b in zip(values, values[1:]) if b - a > 1e-5)
    if not deltas:
        raise ValueError('Cannot infer navigation cell size; pass --cell-size')
    return round(min(deltas), 6)


def write_text(path, contents):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(contents, encoding='utf-8')
    temporary.replace(path)


def build_radar(nav, layout, destination, map_id, cell_size=None, update_manifest=False):
    points, components = nav['points'], nav['component']
    extent = layout['extent']
    if not points or len(points) != len(components):
        raise ValueError('Navigation points/component labels are empty or inconsistent')
    if (len(extent) != 2 or not all(finite_number(v) and v > 0 for v in extent)
            or list(nav['extent']) != list(extent)):
        raise ValueError('Navigation and layout must use identical positive symmetric extents')
    if any(len(p) != 3 or not all(map(finite_number, p)) for p in points):
        raise ValueError('Navigation points must contain finite XYZ coordinates')
    spawn_x, spawn_z = layout['spawns'][0][0]
    spawn = [spawn_x, layout['spawn_heights'][0] + 0.02, spawn_z]
    if not all(map(finite_number, spawn)):
        raise ValueError('First spawn must contain finite coordinates and floor height')
    nearest = min(range(len(points)), key=lambda i: sum((p - s) ** 2 for p, s in zip(points[i], spawn)))
    component = components[nearest]
    selected = [p for p, label in zip(points, components) if label == component]
    cell_size = grid_spacing(points) if cell_size is None else cell_size
    if not finite_number(cell_size) or cell_size <= 0:
        raise ValueError('Navigation cell size must be finite and positive')

    # Keep one topmost connected floor per projected cell. Other components,
    # including isolated roofs above the same XZ, never enter this projection.
    cells = {}
    for x, y, z in selected:
        c = round((x + extent[0]) / cell_size - 0.5)
        r = round((z + extent[1]) / cell_size - 0.5)
        if (abs(x - (-extent[0] + (c + 0.5) * cell_size)) > 1e-4
                or abs(z - (-extent[1] + (r + 0.5) * cell_size)) > 1e-4):
            raise ValueError('Navigation centres do not align with the selected cell size')
        if not (0 <= c < 2 * extent[0] / cell_size and 0 <= r < 2 * extent[1] / cell_size):
            raise ValueError('Navigation point lies outside the layout extent')
        cells[(c, r)] = max(y, cells.get((c, r), -math.inf))

    minimum = min(cells.values())
    maximum = max(cells.values())
    bucket_height = max(2.0, (maximum - minimum) / len(COLORS))
    rows = defaultdict(list)
    for (c, r), y in cells.items():
        level = min(len(COLORS) - 1, int((y - minimum) / bucket_height))
        rows[(level, r)].append(c)
    paths = [[] for _ in COLORS]
    rectangles = 0
    for (level, r), columns in sorted(rows.items()):
        columns.sort()
        first = previous = columns[0]
        for c in columns[1:] + [None]:
            if c is not None and c == previous + 1:
                previous = c
                continue
            x = -extent[0] + first * cell_size
            z = -extent[1] + r * cell_size
            width = (previous - first + 1) * cell_size
            paths[level].append(f'M{x:g},{z:g}h{width:g}v{cell_size:g}h{-width:g}Z')
            rectangles += 1
            first = previous = c

    width, height = 2 * extent[0], 2 * extent[1]
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width * 4:g}" height="{height * 4:g}" '
           f'viewBox="{-extent[0]:g} {-extent[1]:g} {width:g} {height:g}" shape-rendering="crispEdges">',
           f'<title>{escape(map_id.title())} connected playable floors</title>',
           f'<desc>Navigation component {escape(str(component))}, selected from the first attacker spawn; '
           f'{len(cells)} floor cells. Brighter cells indicate higher floors.</desc>']
    for color, path in zip(COLORS, paths):
        if path:
            svg.append(f'<path fill="{color}" d="{"".join(path)}"/>')
    svg.append('</svg>')

    # Validate the existing manifest before writing anything when updating it.
    manifest = None
    if update_manifest:
        manifest = json.loads((destination / 'scene.json').read_text(encoding='utf-8'))
        manifest['radar'] = {**manifest.get('radar', {}), 'image': 'radar.svg',
                             'extent': extent, 'projection': 'connected-navigation',
                             'component': component, 'cellSize': cell_size}
        if map_id in OVERVIEWS:
            manifest['overview'] = OVERVIEWS[map_id]
    destination.mkdir(parents=True, exist_ok=True)
    write_text(destination / 'radar.svg', '\n'.join(svg) + '\n')
    if manifest is not None:
        write_text(destination / 'scene.json', json.dumps(manifest, separators=(',', ':')) + '\n')
    return {'map': map_id, 'component': component, 'nearestSpawnNode': nearest,
            'selectedNodes': len(selected), 'floorCells': len(cells),
            'rectangles': rectangles, 'cellSize': cell_size, 'extent': extent,
            'heightRange': [minimum - 0.02, maximum - 0.02],
            'updatedManifest': update_manifest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('nav', type=Path)
    parser.add_argument('layout', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--map-id', help='Defaults to layout filename without -layout')
    parser.add_argument('--cell-size', type=float, help='Otherwise inferred from navigation centre spacing')
    parser.add_argument('--update-manifest', action='store_true', help='Update radar/overview in existing scene.json')
    args = parser.parse_args()
    nav = json.loads(args.nav.read_text(encoding='utf-8'))
    layout = json.loads(args.layout.read_text(encoding='utf-8'))
    map_id = args.map_id or layout.get('id') or args.layout.stem.removesuffix('-layout')
    result = build_radar(nav, layout, args.output, map_id, args.cell_size, args.update_manifest)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
