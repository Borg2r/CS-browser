#!/usr/bin/env python3
"""Convert the supplied classic weapon uploads to the shared browser mesh format.

Requires Python with numpy/Pillow and Blender 4.x for the two FBX-only archives.
Usage: python scripts/import-classic-weapons.py --source-dir /path/to/uploads
The source directory may contain nested upload folders. Only named assets are
read; archive documents are never executed. No network access is required.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import zipfile

# Blender is used solely to convert FBX geometry and repair archived image paths.
if '--fbx-mode' in sys.argv:
    import bpy
    source, output = sys.argv[sys.argv.index('--fbx-mode') + 1:]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=source)
    textures = list((Path(source).parent.parent / 'textures').glob('*'))
    for image in bpy.data.images:
        candidate = next((p for p in textures if p.name.lower() == Path(image.filepath).name.lower()), None)
        if candidate is None and len(textures) == 1:
            candidate = textures[0]
        if candidate:
            image.filepath = str(candidate)
            image.reload()
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        tree = material.node_tree
        bsdf = next((n for n in tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf and len(textures) == 1:
            if not bsdf.inputs['Base Color'].is_linked:
                node = tree.nodes.new('ShaderNodeTexImage')
                node.image = bpy.data.images.load(str(textures[0]), check_existing=True)
                tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
            bsdf.inputs['Metallic'].default_value = .15
            bsdf.inputs['Roughness'].default_value = .65
    bpy.ops.export_scene.gltf(filepath=output, export_format='GLB', export_animations=False,
                              export_skins=False, export_cameras=False, export_lights=False)
    raise SystemExit(0)

import numpy as np
from PIL import Image

COMPONENT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
# World-space grip centres measured from each source's geometry, after its own
# scene transform. The grip is aligned to the existing gloved hand, not to the
# bounding-box centre (which would make the gun float in the player's palm).
CONFIG = {
    'mac10': dict(archive='mac-10.zip', member='source/mac.fbx', scale=.060,
                  rotation=[[0,0,-1],[0,1,0],[1,0,0]], grip=[.5,-1.5,0],
                  muzzle=[-3.979,.35,0], sight=1.70, optic_base=1.05,
                  support=[-1.6,-.9,0], title='MAC-10',
                  sight_override=.132, adsZ=-.55, hip=[.20,-.14,-.65]),
    'm4a1': dict(archive='m4a1-cs-16.zip', member='source/m4a1.glb', scale=.034,
                 rotation=[[-1,0,0],[0,1,0],[0,0,-1]], grip=[2.79,2.1,15.2],
                 muzzle=[2.79,5.60,36.464], sight=7.64, optic_base=7.64,
                 support=[2.79,5.1,24.0], title='M4A1 CS 1.6'),
    'ak47': dict(archive='ak47-cs-16.zip', member='source/ak47_cs16.glb', scale=.030,
                 rotation=[[-1,0,0],[0,1,0],[0,0,-1]], grip=[2.848,2.4,15.0],
                 muzzle=[2.848,5.55,35.774], sight=6.95, optic_base=6.62,
                 support=[2.848,4.4,25.5], title='AK-47 CS 1.6'),
    'knife': dict(archive='classic-knife-cs-16.zip', member='source/Knife.fbx', scale=.055,
                  rotation=[[0,0,1],[0,1,0],[-1,0,0]], grip=[-1.85,.17,0],
                  muzzle=[2.891,-.03,0], sight=.6, optic_base=.6,
                  title='Classic Knife CS 1.6', hip=[.22,-.11,-.40],
                  viewRotation=[.05,.65,0]),
    'fiveseven': dict(file='five_seven_cs_source_anime.glb', scale=.030,
                      rotation=[[-1,0,0],[0,1,0],[0,0,-1]], grip=[2.877,3.0,15.8],
                      muzzle=[2.877,5.15,21.361], sight=6.07, optic_base=5.85,
                      title='Five-SeveN CS Source Anime'),
    'desert_eagle': dict(file='desert_eagle.glb', scale=.0205,
                         rotation=[[-1,0,0],[0,1,0],[0,0,-1]], grip=[.01,-.8,-3.9],
                         muzzle=[.01,2.38,6.448], sight=3.72, optic_base=3.50,
                         title='Desert Eagle'),
}


def node_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=np.float64).reshape(4,4).T
    x,y,z,w = node.get('rotation', [0,0,0,1])
    rotation = np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                         [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                         [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
    out = np.eye(4)
    out[:3,:3] = rotation @ np.diag(node.get('scale', [1,1,1]))
    out[:3,3] = node.get('translation', [0,0,0])
    return out


def read_glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from('<III', data)
    if magic != 0x46546c67 or version != 2 or length != len(data):
        raise ValueError('Expected complete GLB2')
    chunks, offset = {}, 12
    while offset < len(data):
        size, kind = struct.unpack_from('<II', data, offset)
        chunks[kind] = data[offset+8:offset+8+size]
        offset += size+8
    gltf, binary = json.loads(chunks[0x4e4f534a]), chunks[0x004e4942]
    def accessor(index):
        a = gltf['accessors'][index]
        if 'sparse' in a:
            raise ValueError('Sparse accessors are not used by these assets')
        v = gltf['bufferViews'][a['bufferView']]
        if v.get('buffer',0) != 0:
            raise ValueError('External buffers are not allowed')
        fmt = '<' + COMPONENT[a['componentType']] * WIDTH[a['type']]
        start = v.get('byteOffset',0) + a.get('byteOffset',0)
        stride = v.get('byteStride',struct.calcsize(fmt))
        return np.array([struct.unpack_from(fmt,binary,start+i*stride) for i in range(a['count'])])
    return gltf, binary, accessor


def resolve_source(config, source_dir, work, blender):
    filename = config.get('file') or config['archive']
    candidates = sorted(source_dir.rglob(filename))
    if not candidates:
        raise FileNotFoundError(f'Missing supplied asset {filename}')
    source = candidates[0]
    original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    if 'archive' in config:
        folder = work / source.stem
        folder.mkdir()
        with zipfile.ZipFile(source) as archive:
            for member in archive.infolist():
                name = Path(member.filename)
                if name.is_absolute() or '..' in name.parts or member.file_size > 64*1024*1024:
                    raise ValueError('Unsafe or unexpectedly large archive member')
                if not member.is_dir():
                    target = folder / name
                    target.parent.mkdir(parents=True,exist_ok=True)
                    target.write_bytes(archive.read(member))
        source = folder / config['member']
    if source.suffix.lower() == '.fbx':
        output = work / (source.stem+'.glb')
        env = dict(os.environ, BLENDER_USER_CONFIG=str(work/'blender-config'))
        result = subprocess.run([blender,'-b','--python',str(Path(__file__).resolve()),
                                 '--','--fbx-mode',str(source),str(output)],
                                capture_output=True,text=True,env=env)
        if result.returncode or not output.exists():
            raise RuntimeError(result.stdout[-3000:] + result.stderr[-3000:])
        source = output
    return source, original_hash


def bake(key, config, source, original_hash, destination):
    gltf, binary, accessor = read_glb(source)
    destination.mkdir(parents=True,exist_ok=True)
    rotation = np.array(config['rotation'],dtype=float)
    scale = config['scale']
    grip = np.array(config['grip'])
    hand = np.array([0,-.08,.03])
    transform_point = lambda p: (np.asarray(p)-grip) @ rotation.T * scale + hand
    output, batches, all_points = bytearray(), [], []
    def append(values, dtype):
        array = np.asarray(values,dtype=dtype).reshape(-1)
        assert len(output)%4 == 0
        result = {'byteOffset':len(output),'length':len(array)}
        output.extend(array.tobytes())
        return result
    def visit(index, parent):
        node = gltf['nodes'][index]
        matrix = parent @ node_matrix(node)
        if 'mesh' in node:
            mesh = gltf['meshes'][node['mesh']]
            for primitive in mesh['primitives']:
                if primitive.get('mode',4) != 4:
                    raise ValueError('Only triangles are supported')
                attributes = primitive['attributes']
                pos = accessor(attributes['POSITION'])
                world = (np.c_[pos,np.ones(len(pos))] @ matrix.T)[:,:3]
                pos = transform_point(world)
                normal = accessor(attributes['NORMAL']) @ np.linalg.inv(matrix[:3,:3])
                normal = normal @ rotation.T
                normal /= np.maximum(np.linalg.norm(normal,axis=1)[:,None],1e-12)
                uv = accessor(attributes['TEXCOORD_0']) if 'TEXCOORD_0' in attributes else np.zeros((len(pos),2))
                ids = accessor(primitive['indices']).reshape(-1) if 'indices' in primitive else np.arange(len(pos))
                if np.linalg.det(matrix[:3,:3]) * np.linalg.det(rotation) < 0:
                    ids = ids.reshape(-1,3)[:,[0,2,1]].reshape(-1)
                material = primitive.get('material',0)
                name = gltf['materials'][material].get('name','body')
                groups = [('magazine' if 'magazine' in name.lower() else 'body',ids)]
                # The Five-SeveN source is a single batch, but the slide has a
                # clear horizontal seam. Split only triangles wholly above it.
                if key == 'fiveseven':
                    tri = ids.reshape(-1,3)
                    slide = world[tri,1].min(axis=1) > 4.68
                    groups = [('body',tri[~slide].reshape(-1)),('slide',tri[slide].reshape(-1))]
                for part, part_ids in groups:
                    if not len(part_ids):
                        continue
                    used, inverse = np.unique(part_ids,return_inverse=True)
                    batch = {'name':name,'material':material,'part':part,
                             'position':append(pos[used],'<f4'),'normal':append(normal[used],'<f4'),
                             'uv':append(uv[used],'<f4'),'index':append(inverse,'<u4')}
                    if 'TEXCOORD_1' in attributes:
                        batch['uv1'] = append(accessor(attributes['TEXCOORD_1'])[used],'<f4')
                    batches.append(batch)
                    all_points.append(pos[used])
        for child in node.get('children',[]):
            visit(child,matrix)
    for root in gltf['scenes'][gltf.get('scene',0)]['nodes']:
        visit(root,np.eye(4))
    (destination/'geometry.bin').write_bytes(output)
    # Keep original texture content; lossless WebP avoids painting compression
    # artifacts into classic pixel textures and tangent-space normal maps.
    images = []
    for i, image in enumerate(gltf.get('images',[])):
        view = gltf['bufferViews'][image['bufferView']]
        offset = view.get('byteOffset',0)
        picture = Image.open(io.BytesIO(binary[offset:offset+view['byteLength']])).convert('RGBA')
        picture.thumbnail((1024,1024),Image.Resampling.LANCZOS)
        if picture.getextrema()[3] == (255,255):
            picture = picture.convert('RGB')
        filename = f'texture-{i:02}.webp'
        picture.save(destination/filename,format='WEBP',lossless=True,method=6)
        images.append(filename)
    textures = []
    for texture in gltf.get('textures',[]):
        sampler = gltf.get('samplers',[])[texture['sampler']] if 'sampler' in texture else {}
        textures.append({'uri':images[texture['source']],**{k:sampler[k] for k in ['wrapS','wrapT','magFilter','minFilter'] if k in sampler}})
    materials = gltf.get('materials',[])
    for material in materials:
        if key == 'mac10':
            material.pop('alphaMode',None) # The supplied diffuse image is opaque.
    points = np.concatenate(all_points)
    bounds = [points.min(axis=0).tolist(),points.max(axis=0).tolist()]
    sight_y = config.get('sight_override', (config['sight']-grip[1])*scale-.08)
    optic_base = (config['optic_base']-grip[1])*scale-.08
    optic_z = -.075 if key in ['fiveseven','desert_eagle'] else -.10
    metadata = {'muzzle':transform_point(config['muzzle']).tolist(),
                'sightY':float(sight_y),'length':float(np.ptp(points[:,2])),
                'optic':{'baseY':float(optic_base),'z':optic_z,
                         'redDotY':float(optic_base+.055),'acogY':float(optic_base+.075)}}
    if 'support' in config:
        metadata['supportGrip'] = transform_point(config['support']).tolist()
    for key_name in ['hip', 'adsZ', 'viewRotation']:
        if key_name in config:
            metadata[key_name] = config[key_name]
    source_info = gltf.get('asset',{}).get('extras',{})
    manifest = {'version':1,'id':key,'name':config['title'],'data':'geometry.bin',
                'textures':textures,'materials':materials,'batches':batches,
                'bounds':bounds,'metadata':metadata,'source':source_info,
                'sourceFile':config.get('file') or config['archive'],'sourceSha256':original_hash,
                'triangleCount':sum(batch['index']['length']//3 for batch in batches),
                'modifications':'Normalized units and grip; baked static gun geometry; optimized original textures for browser delivery.'}
    (destination/'scene.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    credit = f"# {config['title']}\n\nSupplied source: `{manifest['sourceFile']}`.\n\n"
    if source_info:
        credit += '\n'.join(f"{label}: {source_info[field]}" for label,field in
                            [('Author','author'),('Source','source'),('License','license')]
                            if field in source_info)+'\n\n'
    else:
        credit += 'No author or license metadata was embedded in the supplied archive/model; none is inferred here.\n\n'
    credit += manifest['modifications']+' The source geometry, UV layout and supplied skin are retained.\n'
    (destination/'SOURCE.md').write_text(credit)
    print(f'{key}: {manifest["triangleCount"]} triangles, {len(batches)} batches, '
          f'{sum(p.stat().st_size for p in destination.iterdir())/1024:.1f} KiB')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'client/assets/weapons')
    parser.add_argument('--blender',default='blender')
    parser.add_argument('--only',choices=CONFIG)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='classic-weapons-',dir='/tmp') as folder:
        for key,config in CONFIG.items():
            if args.only and args.only != key:
                continue
            source,original_hash = resolve_source(config,args.source_dir,Path(folder),args.blender)
            bake(key,config,source,original_hash,args.output/key)

if __name__ == '__main__':
    main()
