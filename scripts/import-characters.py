#!/usr/bin/env python3
"""Convert the supplied static CS 1.6 operator collection to shared skinned meshes.

Usage: python scripts/import-characters.py /path/to/cs-16-models.zip
Original texture images and UVs are preserved. Invalid all-black source vertex
colors are deliberately omitted. A compact skeleton and smooth skin weights
are added because the source has neither bones nor animation.
"""
import argparse, gzip, json, math, struct, zipfile
from pathlib import Path

OPERATORS=[('urban',2,[0,1,2]),('arctic',1,[3,4]),('gign',2,[5,6]),('sas',2,[7,8,9,10]),('terror',1,[11,12,13]),('leet',1,[14,15,16,17]),('guerilla',1,[18,19,20]),('gsg9',2,[21,22,23])]
BONES=[('hips',-1,[0,.85,0]),('spine',0,[0,1.17,0]),('chest',1,[0,1.36,0]),('head',2,[0,1.52,0]),
 ('legL',0,[-.11,.85,0]),('kneeL',4,[-.145,.43,0]),('footL',5,[-.17,.13,0]),
 ('legR',0,[.11,.85,0]),('kneeR',7,[.145,.43,0]),('footR',8,[.17,.13,0]),
 ('upperL',2,[-.20,1.37,0]),('lowerL',10,[-.49,1.37,0]),('handL',11,[-.78,1.37,0]),
 ('upperR',2,[.20,1.37,0]),('lowerR',13,[.49,1.37,0]),('handR',14,[.78,1.37,0])]

def convert(source,destination):
    with zipfile.ZipFile(source) as archive:raw=archive.read('source/CS 1_6 models.glb')
    assert raw[:4]==b'glTF'
    n,t=struct.unpack_from('<II',raw,12);g=json.loads(raw[20:20+n]);offset=20+n;length,kind=struct.unpack_from('<II',raw,offset);binary=raw[offset+8:offset+8+length]
    assert not g.get('skins') and not g.get('animations'), 'Expected the static uploaded collection'
    def read(index):
        a=g['accessors'][index];v=g['bufferViews'][a['bufferView']]
        code,size={5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1)}[a['componentType']]
        width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];stride=v.get('byteStride',size*width);start=v.get('byteOffset',0)+a.get('byteOffset',0)
        return [struct.unpack_from('<'+code*width,binary,start+i*stride) for i in range(a['count'])]
    destination.mkdir(parents=True,exist_ok=True);(destination/'textures').mkdir(exist_ok=True)
    for i,image in enumerate(g['images']):
        v=g['bufferViews'][image['bufferView']];start=v.get('byteOffset',0)
        (destination/'textures'/f'{i:02}.png').write_bytes(binary[start:start+v['byteLength']])
    blob=bytearray()
    def append(rows,kind):
        while len(blob)%4:blob.append(0)
        flat=[value for row in rows for value in row];offset=len(blob)
        blob.extend(struct.pack('<'+kind*len(flat),*flat));return {'offset':offset,'length':len(flat)}
    def smooth(v,a,b):
        t=max(0,min(1,(v-a)/(b-a)));return t*t*(3-2*t)
    def blend(a,b,t):return ([a,b,0,0],[1-t,t,0,0])
    def weights(p,hand=False,backpack=False):
        x,y,z=p;side=1 if x>=0 else -1;ax=abs(x)
        if hand:return ([15 if side>0 else 12,0,0,0],[1,0,0,0])
        if backpack:return ([2,0,0,0],[1,0,0,0])
        if y>1.46 and ax<.24:return blend(2,3,smooth(y,1.46,1.56))
        if y>1.1 and ax>.20:
            upper,lower,wrist=(13,14,15) if side>0 else (10,11,12)
            if ax<.29:return blend(2,upper,smooth(ax,.20,.29))
            if ax<.57:return blend(upper,lower,smooth(ax,.42,.57))
            return blend(lower,wrist,smooth(ax,.70,.81))
        if y>.90:return blend(1,2,smooth(y,1.10,1.29))
        thigh,knee,foot=(7,8,9) if side>0 else (4,5,6)
        if y>.75:return blend(thigh,0,smooth(y,.75,.92))
        if y>.25:return blend(knee,thigh,smooth(y,.37,.51))
        return blend(foot,knee,smooth(y,.13,.23))
    operators=[]
    for name,team,meshes in OPERATORS:
        native_y_up=name in ('arctic','gign')
        allpos=[]
        primitives=[]
        for mi in meshes:
            for primitive in g['meshes'][mi]['primitives']:
                source_positions=read(primitive['attributes']['POSITION'])
                pos=[[-p[0],p[1],-p[2]] if native_y_up else [-p[0],p[2],p[1]] for p in source_positions]
                norm=[[-p[0],p[1],-p[2]] if native_y_up else [-p[0],p[2],p[1]] for p in read(primitive['attributes']['NORMAL'])]
                primitives.append((primitive,pos,norm,mi));allpos.extend(pos)
        low=min(p[1] for p in allpos);high=max(p[1] for p in allpos);scale=1.78/(high-low)
        feet=[p for p in allpos if p[1]<low+(high-low)*.12]
        centerx=(min(p[0] for p in feet)+max(p[0] for p in feet))/2
        middle=[p for p in allpos if abs((p[0]-centerx)*scale)<.16 and .7<(p[1]-low)*scale<1.05]
        centerz=(min(p[2] for p in middle)+max(p[2] for p in middle))/2
        batches=[];triangles=0
        for primitive,pos,norm,mi in primitives:
            points=[[(p[0]-centerx)*scale,(p[1]-low)*scale+.006,(p[2]-centerz)*scale] for p in pos]
            hand=mi in [1,2,9,10,12,13,16,17,19,20,22,23];pack=mi in [4,5]
            skin=[weights(p,hand,pack) for p in points]
            index=read(primitive['indices']) if 'indices'in primitive else [(i,) for i in range(len(points))]
            # Swapping source Y/Z in OBJ coordinates reverses winding; the -X
            # reflection cancels that, so both normalizations preserve it.
            batches.append({'material':primitive.get('material',0),'position':append(points,'f'),'normal':append(norm,'f'),'uv':append(read(primitive['attributes']['TEXCOORD_0']),'f'),'skinIndex':append([s[0] for s in skin],'H'),'skinWeight':append([s[1] for s in skin],'f'),'index':append(index,'I')})
            triangles+=len(index)//3
        operators.append({'id':name,'name':{'urban':'Urban','arctic':'Arctic','gign':'GIGN','sas':'SAS','terror':'Phoenix','leet':'Elite Crew','guerilla':'Guerilla','gsg9':'GSG-9'}[name],'team':team,'triangles':triangles,'batches':batches})
    materials=[]
    for m in g['materials']:
        pbr=m.get('pbrMetallicRoughness',{});materials.append({'name':m.get('name',''), 'color':pbr.get('baseColorFactor',[1,1,1,1]),'texture':pbr.get('baseColorTexture',{}).get('index')})
    data={'version':1,'geometry':'geometry.bin','bones':[{'name':n,'parent':p,'position':v} for n,p,v in BONES],'operators':operators,'materials':materials,'textures':[{'uri':f'textures/{t["source"]:02}.png'} for t in g['textures']],
          'source':{'file':'cs-16-models.zip / source/CS 1_6 models.glb','asset':g['asset'],'modifications':'Normalized to1.78m, removed invalid vertex colors, added skin weights and procedural skeleton.'}}
    (destination/'geometry.bin').write_bytes(blob);(destination/'geometry.bin.gz').write_bytes(gzip.compress(bytes(blob),mtime=0));(destination/'scene.json').write_text(json.dumps(data,separators=(',',':'))+'\n')
    print('Operators:',[(o['id'],o['triangles']) for o in operators]);print('Geometry bytes:',len(blob))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source',type=Path);parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'client/assets/characters');args=parser.parse_args();convert(args.source,args.output)
