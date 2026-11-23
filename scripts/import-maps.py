#!/usr/bin/env python3
"""Import user-supplied static GLB maps; rendering and collision share vertices.

Requires numpy and Pillow. Example:
  python scripts/import-maps.py assault SOURCE.glb --scale 1.4
The scale removes presentation normalization; glTF node transforms, UVs and
material assignments are preserved. One bounded 2048px WebP atlas at a time is
encoded; gzip sidecars reduce transfer without runtime decompression code.
Inspect the emitted manifest and collision before authoring gameplay anchors.
"""
import argparse
from collections import defaultdict
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import struct
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
COMPONENT = {5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1',5122:'<i2',5120:'i1'}
WIDTH = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}


def matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix']).reshape(4,4).T
    x,y,z,w=node.get('rotation',[0,0,0,1]);sx,sy,sz=node.get('scale',[1,1,1]);tx,ty,tz=node.get('translation',[0,0,0])
    return np.array([[(1-2*(y*y+z*z))*sx,2*(x*y-z*w)*sy,2*(x*z+y*w)*sz,tx],
        [2*(x*y+z*w)*sx,(1-2*(x*x+z*z))*sy,2*(y*z-x*w)*sz,ty],
        [2*(x*z-y*w)*sx,2*(y*z+x*w)*sy,(1-2*(x*x+y*y))*sz,tz],[0,0,0,1]])


def read_glb(path):
    raw=path.read_bytes()
    magic,version,total=struct.unpack_from('<III',raw)
    if (magic,version,total)!=(0x46546c67,2,len(raw)):
        raise ValueError('Expected complete GLB 2')
    off=12;g=None;buf=None
    while off<len(raw):
        n,k=struct.unpack_from('<II',raw,off);off+=8
        if k==0x4e4f534a:g=json.loads(raw[off:off+n])
        elif k==0x004e4942:buf=memoryview(raw)[off:off+n]
        off+=n
    if g is None or buf is None:raise ValueError('Missing glTF chunks')
    if g.get('skins') or g.get('animations'):raise ValueError('Expected static map')
    unsupported=set(g.get('extensionsRequired',[]))-{'KHR_materials_unlit','KHR_materials_specular','KHR_texture_transform'}
    if unsupported:raise ValueError(f'Unsupported required extensions: {unsupported}')
    def acc(i):
        a=g['accessors'][i];v=g['bufferViews'][a['bufferView']]
        if 'sparse'in a or v.get('buffer',0)!=0:raise ValueError('Unsupported accessor')
        dt=np.dtype(COMPONENT[a['componentType']]);width=WIDTH[a['type']]
        arr=np.ndarray((a['count'],width),dt,buf,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',width*dt.itemsize),dt.itemsize))
        if a.get('normalized'):arr=np.maximum(-1,arr/np.iinfo(dt).max)
        return arr
    meshes=[]
    def visit(i,parent):
        n=g['nodes'][i];m=parent@matrix(n)
        if 'mesh'in n:
            mesh=g['meshes'][n['mesh']]
            for p in mesh['primitives']:
                if p.get('mode',4)!=4:raise ValueError('Expected triangle primitives')
                a=p['attributes'];v=acc(a['POSITION']);pos=(np.c_[v,np.ones(len(v))]@m.T)[:,:3]
                ids=acc(p['indices']).flatten().astype(np.uint32) if 'indices'in p else np.arange(len(v),dtype=np.uint32)
                if len(ids)%3 or np.any(ids>=len(v)):raise ValueError('Invalid triangles')
                if np.linalg.det(m[:3,:3])<0:ids=ids.reshape(-1,3)[:,[0,2,1]].flatten()
                out={'position':pos,'index':ids,'material':p.get('material',0),'name':mesh.get('name',n.get('name','mesh'))}
                for gl,at in [('NORMAL','normal'),('TEXCOORD_0','uv'),('TEXCOORD_1','uv1'),('COLOR_0','color')]:
                    if gl in a:out[at]=acc(a[gl]).astype(float)
                if 'normal'in out:
                    out['normal']=out['normal']@np.linalg.inv(m[:3,:3]);out['normal']/=np.maximum(np.linalg.norm(out['normal'],axis=1)[:,None],1e-15)
                else:
                    normals=np.zeros_like(pos);t=pos[ids.reshape(-1,3)];face=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0])
                    for k in range(3):np.add.at(normals,ids.reshape(-1,3)[:,k],face)
                    out['normal']=normals/np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-15)
                if 'uv'not in out:out['uv']=np.zeros((len(pos),2))
                meshes.append(out)
        for ch in n.get('children',[]):visit(ch,m)
    for i in g['scenes'][g.get('scene',0)]['nodes']:visit(i,np.eye(4))
    return g,buf,meshes,hashlib.sha256(raw).hexdigest()


def convert(args):
    g,buf,meshes,sha=read_glb(args.source)
    for m in meshes:m['position']*=args.scale
    lo=np.min([m['position'].min(0) for m in meshes],axis=0);hi=np.max([m['position'].max(0) for m in meshes],axis=0)
    # Vertical translation only changes the coordinate origin, never the layout.
    origin=np.array([(lo[0]+hi[0])/2,lo[1],(lo[2]+hi[2])/2])
    if args.origin:origin=np.array(args.origin)
    for m in meshes:m['position']=np.round(m['position']-origin,6).astype('<f4')
    lo-=origin;hi-=origin
    if args.id == 'assault':
        # A source loading-dock lip is 0.8128m tall: players can jump it, but
        # walking bots cannot. This visible steel access ramp has identical
        # render/collision vertices and preserves all original map geometry.
        vertices=np.array([[29,1.641522,-28.3],[32,1.641522,-28.3],[32,2.454322,-31.3],
            [29,2.454322,-31.3],[29,1.641522,-31.3],[32,1.641522,-31.3]],dtype='<f4')
        faces=np.array([[0,1,2],[0,2,3],[0,4,5],[0,5,1],[0,3,4],[1,5,2],[4,3,2],[4,2,5]])
        positions=vertices[faces].reshape(-1,3)
        normal=np.cross(vertices[faces[:,1]]-vertices[faces[:,0]],vertices[faces[:,2]]-vertices[faces[:,0]])
        normal/=np.linalg.norm(normal,axis=1)[:,None]
        material=len(g['materials'])
        g['materials'].append({'name':'Breachpoint loading-dock access ramp','pbrMetallicRoughness':
            {'baseColorFactor':[.19,.23,.25,1],'metallicFactor':.45,'roughnessFactor':.8}})
        meshes.append({'name':'Loading-dock access ramp','material':material,'position':positions,
            'normal':np.repeat(normal,3,axis=0),'uv':positions[:,[0,2]],'index':np.arange(24,dtype=np.uint32)})
    destination=args.output or ROOT/'client/assets/maps'/args.id
    destination.mkdir(parents=True,exist_ok=True);(destination/'textures').mkdir(exist_ok=True)
    textures=[];opaque={};texture_stats=[]
    # Uploaded atlases are 8096px; process sequentially to cap memory usage.
    for i,t in enumerate(g.get('textures',[])):
        im=g['images'][t['source']]
        if 'bufferView'in im:
            v=g['bufferViews'][im['bufferView']];off=v.get('byteOffset',0);data=buf[off:off+v['byteLength']]
        else:
            p=(args.source.parent/im['uri']).resolve()
            if not p.is_relative_to(args.source.parent.resolve()):raise ValueError('External image outside source directory')
            data=p.read_bytes()
        with Image.open(io.BytesIO(data)) as source:
            original=source.size
            source.thumbnail((args.texture_size,args.texture_size),Image.Resampling.LANCZOS)
            out=source.convert('RGBA' if 'A'in source.getbands() or 'transparency'in source.info else 'RGB')
            opaque[i]=out.mode!='RGBA' or out.getextrema()[3]==(255,255)
            if opaque[i]:out=out.convert('RGB')
            uri=f'textures/{i:03}.webp';out.save(destination/uri,'WEBP',quality=88,method=6)
            texture_stats.append({'index':i,'sourceSize':original,'size':out.size,'bytes':(destination/uri).stat().st_size})
        samplers=g.get('samplers',[]);sampler=samplers[t['sampler']] if 'sampler'in t else {}
        textures.append({'uri':uri,**sampler})
    materials=g.get('materials',[{}])
    for m in materials:
        pbr=m.setdefault('pbrMetallicRoughness',{})
        # Province's exporter marked opaque RGB masonry as blended. Restore
        # normal depth writes, retaining true decals/alpha textures as supplied.
        base=pbr.get('baseColorTexture',{}).get('index')
        if m.get('alphaMode')=='BLEND' and base in opaque and opaque[base] and pbr.get('baseColorFactor',[1,1,1,1])[3]>=1:
            m.pop('alphaMode',None)
        if args.id=='province':pbr['metallicFactor']=0
    groups=defaultdict(list);collision=[];excluded=[]
    for m in meshes:
        attrs=tuple(k for k in ['position','normal','uv','uv1','color'] if k in m)
        groups[(m['material'],attrs)].append(m)
        name=materials[m['material']].get('name','').lower()
        if any(token.lower() in name for token in args.exclude_collision_material):
            excluded.append({'mesh':m['name'],'material':name});continue
        t=m['position'][m['index'].reshape(-1,3)]
        n=np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]);valid=np.linalg.norm(n,axis=1)>1e-7
        collision.append(t[valid])
    data=bytearray();batches=[]
    def append(a,dtype):
        a=np.ascontiguousarray(a,dtype=dtype);offset=len(data);data.extend(a.tobytes());return {'byteOffset':offset,'length':int(a.size)}
    for (material,attrs),parts in groups.items():
        batch={'name':materials[material].get('name',str(material)),'material':material}
        for attr in attrs:
            values=np.concatenate([m[attr] for m in parts])
            batch[attr]=append(values if attr=='position' else np.round(values,6),'<f4')
        offset=0;ids=[]
        for m in parts:ids.append(m['index']+offset);offset+=len(m['position'])
        batch['index']=append(np.concatenate(ids),'<u4');batches.append(batch)
    collision=np.concatenate(collision).astype('<f4')
    # Remove exact duplicate physical faces; sorted vertex keys retain original
    # winding for the first face so floor/ceiling classification stays intact.
    keys=np.sort(collision.view('V12').reshape(-1,3),axis=1).copy().view('V36').ravel()
    _,unique=np.unique(keys,return_index=True);collision=collision[np.sort(unique)]
    collision_path=args.collision or ROOT/'crates/sim/src/maps'/f'{args.id}_collision.bin'
    collision_path.parent.mkdir(parents=True,exist_ok=True);collision_path.write_bytes(collision.tobytes())
    extent=[math.ceil(max(abs(lo[k]),abs(hi[k])))+1 for k in (0,2)]
    manifest={'version':1,'id':args.id,'source':{**g.get('asset',{}).get('extras',{}),'file':args.source.name,'sha256':sha},
        'coordinates':{'worldScale':args.scale,'origin':origin.tolist(),'up':'Y','units':'metres'},'bounds':[lo.tolist(),hi.tolist()],
        'triangleCount':sum(len(m['index'])//3 for m in meshes),'collisionTriangles':len(collision),'collisionExclusions':excluded,
        'data':'geometry.bin','radar':{'image':'radar.svg','extent':extent},'batches':batches,'materials':materials,'textures':textures,
        'textureProcessing':texture_stats}
    (destination/'geometry.bin').write_bytes(data)
    (destination/'geometry.bin.gz').write_bytes(gzip.compress(data,compresslevel=9,mtime=0))
    (destination/'scene.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    # Initial floor projection. Final walkable navigation radar is rebuilt from
    # the authoritative connected floors when gameplay anchors are selected.
    tri=collision;n=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);length=np.linalg.norm(n,axis=1);up=n[:,1]/np.maximum(length,1e-15)
    paths=[]
    for face in tri[(up>.65)&(tri.mean(1)[:,1]<lo[1]+8)]:paths.append('M'+'L'.join(f'{p[0]:.2f},{p[2]:.2f}' for p in face)+'Z')
    (destination/'radar.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-extent[0]} {-extent[1]} {2*extent[0]} {2*extent[1]}"><path fill="#87958d" d="'+''.join(paths)+'"/></svg>\n')
    print(json.dumps({'map':args.id,'triangles':manifest['triangleCount'],'collisionTriangles':len(collision),'extent':extent,'bounds':manifest['bounds'],'origin':origin.tolist(),'texturesBytes':sum(t['bytes']for t in texture_stats),'geometryGzipBytes':(destination/'geometry.bin.gz').stat().st_size}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('id',choices=['compound','province','italy','assault','office']);p.add_argument('source',type=Path)
    p.add_argument('--scale',type=float,default=1);p.add_argument('--origin',type=float,nargs=3);p.add_argument('--texture-size',type=int,default=2048)
    p.add_argument('--output',type=Path);p.add_argument('--collision',type=Path);p.add_argument('--exclude-collision-material',action='append',default=[])
    convert(p.parse_args())
