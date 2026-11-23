#!/usr/bin/env python3
"""Bake the licensed Dust 2 GLB into little-endian float32 collision triangles.

Usage: python3 import_dust2_collision.py SOURCE.glb OUTPUT.bin
No third-party packages are needed. Each output triangle contains three XYZ
vertices (36 bytes). Traversal and primitive/index ordering match the GLB.

Source: vrchris, "de_dust2 - CS map", CC BY 4.0
https://sketchfab.com/3d-models/de-dust2-cs-map-056008d59eb849a29c0ab6884c0c3d87

The Sketchfab root matrix applies a 1/75 scale, flips Y/Z and translates
by [0,1008,1232]. Remove that presentation origin and multiply by 1.875,
so a source Hammer unit represents 0.025 m. Scene children remain intact.
This yields game X [-64,48], Y [-4.8,10.4], Z [-94.4,38.4].
"""
import argparse
import json
from pathlib import Path
import struct

IDENTITY = [[float(x == y) for x in range(4)] for y in range(4)]
COMPONENT = {5120:'b',5121:'B',5122:'h',5123:'H',5125:'I',5126:'f'}
WIDTH = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def matrix(node):
    if 'matrix' in node:
        v=node['matrix']
        return [[v[c*4+r] for c in range(4)] for r in range(4)]
    x,y,z,w=node.get('rotation',[0,0,0,1])
    scale=node.get('scale',[1,1,1]); pos=node.get('translation',[0,0,0])
    rot=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
         [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
         [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
    return [[rot[r][c]*scale[c] for c in range(3)]+[pos[r]] for r in range(3)]+[[0,0,0,1]]

def product(a,b):
    return [[sum(a[r][k]*b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]

def bake(source):
    raw=Path(source).read_bytes()
    magic,version,total=struct.unpack_from('<III',raw)
    if magic!=0x46546c67 or version!=2 or total!=len(raw):
        raise ValueError('Expected a complete GLB 2 file')
    off=12;g=None;buf=None
    while off<len(raw):
        length,kind=struct.unpack_from('<II',raw,off);off+=8
        chunk=raw[off:off+length];off+=length
        if kind==0x4e4f534a:g=json.loads(chunk)
        elif kind==0x004e4942:buf=chunk
    if g is None or buf is None:raise ValueError('GLB JSON/BIN chunk missing')
    def accessor(index):
        a=g['accessors'][index];v=g['bufferViews'][a['bufferView']]
        if 'sparse' in a or v.get('buffer',0)!=0:raise ValueError('Unsupported accessor')
        fmt='<'+COMPONENT[a['componentType']]*WIDTH[a['type']]
        size=struct.calcsize(fmt);stride=v.get('byteStride',size)
        start=v.get('byteOffset',0)+a.get('byteOffset',0)
        return [struct.unpack_from(fmt,buf,start+i*stride) for i in range(a['count'])]
    output=bytearray();count=0;bounds=[[float('inf')]*3,[-float('inf')]*3]
    def visit(index,parent):
        nonlocal count
        node=g['nodes'][index];transform=product(parent,matrix(node))
        if 'mesh' in node:
            for primitive in g['meshes'][node['mesh']]['primitives']:
                if primitive.get('mode',4)!=4:raise ValueError('Only triangle primitives supported')
                positions=accessor(primitive['attributes']['POSITION'])
                ids=[x[0] for x in accessor(primitive['indices'])] if 'indices'in primitive else list(range(len(positions)))
                if len(ids)%3:raise ValueError('Incomplete triangle indices')
                vertices=[]
                for vertex in positions:
                    world=[sum(transform[r][c]*(*vertex,1)[c] for c in range(4)) for r in range(3)]
                    game=[(world[r]-[0,1008,1232][r])*1.875 for r in range(3)]
                    vertices.append(game)
                for vertex_id in ids:
                    v=vertices[vertex_id]
                    output.extend(struct.pack('<fff',*v))
                    for axis in range(3):bounds[0][axis]=min(bounds[0][axis],v[axis]);bounds[1][axis]=max(bounds[1][axis],v[axis])
                count+=len(ids)//3
        for child in node.get('children',[]):visit(child,transform)
    for root in g['scenes'][g.get('scene',0)]['nodes']:visit(root,IDENTITY)
    return output,{'triangles':count,'bounds':bounds,'source':g.get('asset',{}),'origin':[0,1008,1232],'world_scale':1.875}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source');parser.add_argument('output');parser.add_argument('--metadata')
    args=parser.parse_args();binary,metadata=bake(args.source)
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(binary)
    if args.metadata:Path(args.metadata).write_text(json.dumps(metadata,indent=2)+'\n')
    print(f'Wrote {metadata["triangles"]} triangles ({len(binary)} bytes) to {out}')
    print('Bounds:',metadata['bounds'])
if __name__=='__main__':main()
