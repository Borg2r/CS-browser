// Original tactical operators. Static details are baked per material and joint;
// every instance shares its team's geometry/materials rather than rebuilding it.
import * as THREE from '../vendor/three.module.min.js';
import { buildOperatorHead } from './character-head.js';

const bevelShape = new THREE.Shape();
bevelShape.moveTo(-.42,-.5); bevelShape.lineTo(.42,-.5); bevelShape.lineTo(.5,-.42);
bevelShape.lineTo(.5,.42); bevelShape.lineTo(.42,.5); bevelShape.lineTo(-.42,.5);
bevelShape.lineTo(-.5,.42); bevelShape.lineTo(-.5,-.42); bevelShape.closePath();
const roundedBox = new THREE.ExtrudeGeometry(bevelShape,{depth:.84,bevelEnabled:true,bevelSegments:1,bevelSize:.035,bevelThickness:.08,steps:1,curveSegments:1});
roundedBox.translate(0,0,-.42);
const primitives = {
  box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
  roundedBox,
  sphere: new THREE.SphereGeometry(1, 14, 10).toNonIndexed(),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 10).toNonIndexed(),
  helmet: new THREE.SphereGeometry(1, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.56).toNonIndexed(),
  ring: new THREE.TorusGeometry(1, 0.18, 5, 14).toNonIndexed(),
};
const templates = new Map();
const palettes = new Map();
const fabrics = new Map();
const Y = new THREE.Vector3(0, 1, 0);

function fabric(team, kind) {
  // Canvas is optional so geometry validation can also run directly in Node.
  if (typeof document === 'undefined') return null;
  const key = `${team}:${kind}`;
  if (fabrics.has(key)) return fabrics.get(key);
  let seed = team * 13579 + (kind === 'camo' ? 81 : kind === 'webbing' ? 325 : 711);
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const size = 256, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = kind === 'weave' ? '#909090' : '#deded8';
  ctx.fillRect(0, 0, size, size);
  if (kind === 'camo') {
    const pigments = team === 1 ? ['#b8b5a3', '#efdfbd', '#979b86', '#d4cfb9'] : ['#9ba9a7', '#cbd3cc', '#819393', '#d4d9cf'];
    for (let i = 0; i < 72; i++) {
      const x = random() * size, y = random() * size;
      const rx = 8 + random() * 32, ry = 6 + random() * 23;
      ctx.fillStyle = pigments[i % pigments.length];
      // Wrapped irregular islands avoid hard seams on the cloth's UV boundary.
      const points = Array.from({ length: 9 }, (_, j) => {
        const angle = j / 9 * Math.PI * 2, scale = 0.5 + random() * 0.7;
        return [Math.cos(angle) * rx * scale, Math.sin(angle) * ry * scale];
      });
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        ctx.beginPath();
        points.forEach(([px, py], j) => j ? ctx.lineTo(x + ox + px, y + oy + py) : ctx.moveTo(x + ox + px, y + oy + py));
        ctx.closePath(); ctx.fill();
      }
    }
  }
  const step = kind === 'webbing' ? 4 : 3;
  for (let x = 0; x < size; x += step) {
    ctx.fillStyle = kind === 'weave' ? '#b1b1b1' : 'rgba(255,255,245,.18)';
    ctx.fillRect(x, 0, 1, size);
    ctx.fillStyle = kind === 'weave' ? '#777777' : 'rgba(45,43,34,.12)';
    ctx.fillRect(x + 1, 0, 1, size);
  }
  for (let y = 0; y < size; y += step) {
    ctx.fillStyle = kind === 'weave' ? 'rgba(215,215,215,.32)' : 'rgba(250,248,232,.14)';
    ctx.fillRect(0, y, size, 1);
    for (let x = (y / step % 2) * step; x < size; x += step * 2) {
      ctx.fillStyle = kind === 'weave' ? 'rgba(30,30,30,.28)' : 'rgba(35,36,29,.12)';
      ctx.fillRect(x, y + 1, step, 1);
    }
  }
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,240,.12)' : 'rgba(20,25,20,.10)';
    ctx.fillRect(random() * size, random() * size, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  if (kind !== 'weave') texture.colorSpace = THREE.SRGBColorSpace;
  // One camo repeat gives readable broad patches; weave repeats more tightly.
  texture.repeat.setScalar(kind === 'weave' ? 2 : 1);
  fabrics.set(key, texture);
  return texture;
}

function palette(team) {
  if (palettes.has(team)) return palettes.get(team);
  const desert = team === 1;
  const values = {
    cloth: [desert ? 0xb18d62 : 0x3b596c, 0.96, 0],
    clothDark: [desert ? 0x8b704f : 0x2b4355, 0.94, 0],
    vest: [desert ? 0x695a43 : 0x243542, 0.9, 0],
    straps: [desert ? 0x463c2e : 0x17232d, 0.9, 0],
    skin: [desert ? 0xb77f57 : 0xcd9c74, 0.82, 0],
    gloves: [desert ? 0x504637 : 0x2a333a, 0.88, 0],
    hardware: [0x727b79, 0.4, 0.62],
    accent: [desert ? 0xd9ae6b : 0x70b0c2, 0.78, 0.05],
    lens: [desert ? 0x624b25 : 0x173e4e, 0.17, 0.65],
  };
  const p = Object.fromEntries(Object.entries(values).map(([key, [color, roughness, metalness]]) =>
    [key, new THREE.MeshStandardMaterial({ color, roughness, metalness })]));
  const camo = fabric(team, 'camo'), canvas = fabric(team, 'webbing'), weave = fabric(team, 'weave');
  if (camo) {
    for (const key of ['cloth', 'clothDark']) {
      p[key].map = camo;
      p[key].bumpMap = weave;
      p[key].bumpScale = 0.0015;
    }
    for (const key of ['vest', 'gloves', 'straps']) {
      p[key].map = canvas;
      p[key].bumpMap = weave;
      p[key].bumpScale = 0.0009;
    }
  }
  palettes.set(team, p);
  return p;
}

function loftGeometry(inputRows) {
  const rows=inputRows[0][0]>inputRows.at(-1)[0]?[...inputRows].reverse():inputRows;
  const segments=16, positions=[], uvs=[], indices=[];
  rows.forEach(([y,rx,rz,zc=0,xc=0],row)=>{
    for(let i=0;i<=segments;i++){
      const a=i/segments*Math.PI*2;
      positions.push(xc+Math.cos(a)*rx,y,zc+Math.sin(a)*rz);
      uvs.push(i/segments,row/(rows.length-1));
      if(row&&i){const c=row*(segments+1)+i,p=c-segments-1;indices.push(c-1,p,p-1,c-1,c,p);}
    }
  });
  for(const row of [0,rows.length-1]){
    const [y,,,zc=0,xc=0]=rows[row],center=positions.length/3;
    positions.push(xc,y,zc);uvs.push(.5,.5);
    for(let i=0;i<segments;i++){
      const n=row*(segments+1)+i;
      if(row)indices.push(center,n+1,n);else indices.push(center,n,n+1);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);
  geometry.computeVertexNormals();return geometry;
}

class Batch {
  constructor(materials) { this.materials = materials; this.parts = new Map(); }
  part(shape, mat, position, scale, rotation = null) {
    const matrix = new THREE.Matrix4();
    const quaternion = rotation instanceof THREE.Quaternion ? rotation : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation || [0, 0, 0])));
    matrix.compose(new THREE.Vector3(...position), quaternion, new THREE.Vector3(...scale));
    const source = typeof shape === 'string' ? primitives[shape] : shape;
    const geometry = (source.index ? source.toNonIndexed() : source.clone()).applyMatrix4(matrix);
    let bucket = this.parts.get(mat);
    if (!bucket) { bucket = { position: [], normal: [], uv: [] }; this.parts.set(mat, bucket); }
    for (const key of ['position', 'normal', 'uv']) bucket[key].push(...geometry.attributes[key].array);
    geometry.dispose();
    return this;
  }
  box(mat, position, scale, rotation) { return this.part('box', mat, position, scale, rotation); }
  sphere(mat, position, scale, rotation) { return this.part('sphere', mat, position, scale, rotation); }
  roundedBox(mat, position, scale, rotation) { return this.part('roundedBox',mat,position,scale,rotation); }
  tube(mat, a, b, radiusX, radiusZ=radiusX) {
    const start=new THREE.Vector3(...a), end=new THREE.Vector3(...b), direction=end.clone().sub(start);
    return this.part('cylinder',mat,start.add(end).multiplyScalar(.5).toArray(),[radiusX,direction.length(),radiusZ],new THREE.Quaternion().setFromUnitVectors(Y,direction.normalize()));
  }
  loft(mat, rows, position=[0,0,0], rotation=null) {
    const geometry=loftGeometry(rows);
    this.part(geometry,mat,position,[1,1,1],rotation);geometry.dispose();return this;
  }
  segment(mat, a, b, radiusX, radiusZ = radiusX) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    return this.part('sphere', mat, start.add(end).multiplyScalar(0.5).toArray(),
      [radiusX, direction.length() * 0.65, radiusZ], new THREE.Quaternion().setFromUnitVectors(Y, direction.normalize()));
  }
  finish(name) {
    const group = new THREE.Group(); group.name = name;
    for (const [mat, data] of this.parts) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.materials[mat]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

let plate;
function plateGeometry() {
  if(plate)return plate;
  const s=new THREE.Shape();
  s.moveTo(-.14,.16);s.lineTo(.14,.16);s.lineTo(.178,.20);s.lineTo(.178,.435);
  s.lineTo(.11,.54);s.lineTo(-.11,.54);s.lineTo(-.178,.435);s.lineTo(-.178,.20);s.closePath();
  plate=new THREE.ExtrudeGeometry(s,{depth:.055,bevelEnabled:true,bevelSegments:2,bevelSize:.012,bevelThickness:.01,steps:1,curveSegments:1});
  plate.translate(0,0,-.0275);return plate;
}

// Shaped cloth volumes meet at their joints; small folds and seams stay baked
// into the same material batch instead of adding objects to each operator.
function leg(p,side) {
  const thigh=new Batch(p);
  thigh.loft('cloth',[
    [.038,.109,.112],[-.035,.116,.12],[-.13,.112,.116,.006],[-.23,.101,.106,.005],
    [-.30,.095,.096,-.004],[-.38,.089,.089,-.005],[-.445,.085,.085],
  ]);
  thigh.roundedBox('clothDark',[side*.102,-.195,.014],[.038,.177,.13],[0,0,side*.04]);
  thigh.roundedBox('cloth',[side*.123,-.127,.014],[.015,.043,.14],[0,0,side*.04]);
  thigh.box('straps',[side*.133,-.128,-.015],[.005,.025,.025]);
  // Double-stitched cargo seams, front dart and compression folds.
  for(const z of [-.042,.071])thigh.box('vest',[side*.123,-.2,z],[.005,.13,.004]);
  thigh.box('clothDark',[side*.045,-.20,-.103],[.006,.26,.006],[.015,0,side*.08]);
  for(const [y,w,angle]of[[-.08,.14,.13],[-.285,.13,-.14],[-.335,.11,.18]]){
    thigh.roundedBox('clothDark',[side*.012,y,-.092],[w,.012,.012],[0,0,side*angle]);
  }
  if(side>0){
    // Compact retention holster sits inside the body's normal silhouette.
    thigh.roundedBox('straps',[.127,-.17,.008],[.065,.205,.11],[0,0,-.08]);
    thigh.roundedBox('gloves',[.145,-.094,.026],[.055,.083,.064],[0,0,-.16]);
    thigh.roundedBox('vest',[.167,-.19,-.011],[.015,.111,.072],[0,0,-.08]);
    thigh.box('straps',[.027,-.28,.09],[.184,.035,.025]);
    thigh.roundedBox('hardware',[.164,-.236,.013],[.013,.025,.032]);
  }
  const root=thigh.finish(side<0?'legL':'legR');root.position.set(side*.118,.85,0);
  const shin=new Batch(p);
  shin.loft('cloth',[[.035,.088,.09],[-.06,.083,.091,.01],[-.145,.083,.085,.016],[-.225,.073,.075,.012],[-.285,.068,.066,.012]]);
  shin.roundedBox('clothDark',[0,-.008,-.081],[.16,.155,.038]);
  shin.roundedBox('vest',[0,-.004,-.105],[.138,.142,.032]);
  shin.roundedBox('gloves',[0,-.006,-.125],[.105,.087,.013]);
  for(const x of [-.051,.051])shin.box('straps',[x,-.008,-.136],[.008,.071,.004]);
  shin.box('straps',[0,.005,.093],[.153,.027,.019]);
  for(const [y,angle]of[[-.112,.18],[-.205,-.12],[-.237,.17]])
    shin.roundedBox('clothDark',[0,y,-.071],[.11,.011,.011],[0,0,side*angle]);
  const boot=new Batch(p);
  // A contoured combat boot: level sole, long toe, heel and fitted ankle cuff.
  boot.loft('gloves',[
    [-.405,.083,.143,-.046],[-.376,.088,.145,-.046],[-.341,.085,.142,-.044],
    [-.302,.072,.09,.004],[-.262,.071,.072,.016],[-.225,.070,.067,.012],
  ]);
  boot.loft('straps',[[-.429,.087,.149,-.045],[-.413,.091,.152,-.045],[-.394,.088,.147,-.045]]);
  boot.roundedBox('gloves',[0,-.342,-.145],[.141,.055,.067],[.12,0,0]);
  boot.roundedBox('clothDark',[0,-.269,-.058],[.09,.096,.018],[.18,0,0]);
  for(let i=0;i<5;i++){
    const y=-.236-i*.019,z=-.06-i*.009;
    for(const side of [-1,1]){
      boot.roundedBox('hardware',[side*.044,y,z],[.01,.01,.008]);
      boot.tube('straps',[side*.036,y+.005,z-.003],[-side*.036,y-.009,z-.008],.003);
    }
  }
  for(let i=0;i<5;i++)for(const side of [-1,1])
    boot.box('gloves',[side*.087,-.42,-.135+i*.047],[.009,.012,.023]);
  boot.roundedBox('straps',[0,-.228,.073],[.025,.072,.015]);
  const knee=shin.finish(side<0?'kneeL':'kneeR');knee.position.y=-.42;root.add(knee);
  const foot=new THREE.Group();foot.name=side<0?'footL':'footR';foot.position.y=-.275;
  const footwear=boot.finish('foot_geometry');footwear.position.y=.275;foot.add(footwear);knee.add(foot);
  return root;
}

function sleeve(batch,a,b,r0,r1) {
  const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),direction=end.clone().sub(start),length=direction.length();
  batch.loft('cloth',[[0,r0*.88,r0*.82],[length*.14,r0,r0*.9],[length*.40,r0*.96,r0*.86],
    [length*.68,r1*1.1,r1],[length*.84,r1*1.02,r1*.93],[length,r1,r1*.9]],a,
    new THREE.Quaternion().setFromUnitVectors(Y,direction.normalize()));
}

function arm(p,side,dual=false,pistol=false) {
  const b=new Batch(p),shoulder=[side*.245,.025,.006];
  const elbow=side<0&&!dual&&!pistol?[-.105,-.16,-.32]:[side*.286,-.165,-.125];
  const hand=side>0?[.16,-.035,-.35]:dual?[-.20,-.035,-.35]:pistol?[.10,-.045,-.39]:[.13,-.055,-.64];
  sleeve(b,shoulder,elbow,.086,.074);
  b.sphere('clothDark',elbow,[.076,.071,.068]);
  sleeve(b,elbow,[hand[0],hand[1]-.005,hand[2]+.045],.073,.052);
  b.roundedBox('clothDark',[side*.303,-.032,-.008],[.025,.139,.105],[0,0,side*.2]);
  b.roundedBox('vest',[side*.319,-.015,-.014],[.013,.082,.074],[0,0,side*.2]);
  // Two short recognition bars are readable without oversized luminous patches.
  for(const y of [-.003,.018])b.roundedBox('accent',[side*.327,y,-.017],[.006,.008,.047],[0,0,side*.2]);
  for(const y of [-.058,.032])b.box('clothDark',[side*.312,y,-.012],[.012,.004,.10],[0,0,side*.2]);
  b.roundedBox('vest',[elbow[0]+side*.023,elbow[1],elbow[2]+.024],[.049,.092,.08],[0,0,side*.08]);
  b.roundedBox('gloves',[elbow[0]+side*.044,elbow[1],elbow[2]+.021],[.012,.063,.055],[0,0,side*.08]);
  // Sewn glove panels, cuff, individual knuckles and curled fingertips.
  b.sphere('gloves',hand,[.054,.058,.064]);
  b.roundedBox('clothDark',[hand[0],hand[1]-.002,hand[2]+.051],[.105,.069,.035],[-.12,0,0]);
  b.roundedBox('vest',[hand[0],hand[1]+.043,hand[2]-.006],[.079,.021,.072],[-.12,0,0]);
  for(let i=0;i<4;i++){
    const x=hand[0]-.032+i*.021;
    b.sphere('gloves',[x,hand[1]-.022,hand[2]-.05],[.014,.029,.022]);
    b.roundedBox('straps',[x,hand[1]+.025,hand[2]-.033],[.017,.021,.022],[-.2,0,0]);
    b.box('clothDark',[x,hand[1]-.026,hand[2]-.07],[.013,.004,.005]);
  }
  b.sphere('gloves',[hand[0]-side*.049,hand[1]-.005,hand[2]-.008],[.019,.024,.035],[0,side*.35,0]);
  b.roundedBox('straps',[hand[0],hand[1]+.016,hand[2]+.067],[.084,.012,.018]);
  if(side<0){
    b.roundedBox('straps',[hand[0],hand[1]+.049,hand[2]+.07],[.047,.025,.048]);
    b.roundedBox('hardware',[hand[0],hand[1]+.063,hand[2]+.07],[.035,.008,.035]);
    b.roundedBox('vest',[hand[0],hand[1]+.069,hand[2]+.07],[.026,.004,.026]);
  }
  return b.finish(side>0?'rightArm':dual?'leftArmDual':pistol?'leftArmPistol':'leftArm');
}

function build(team) {
  const p=palette(team),root=new THREE.Group(),body=new THREE.Group();
  root.name='operator';body.name='body';root.add(body);
  const b=new Batch(p);
  b.loft('cloth',[
    [-.045,.17,.117], [.005,.195,.141], [.09,.197,.144], [.18,.178,.123],
    [.28,.187,.132], [.40,.22,.144], [.50,.232,.132], [.555,.195,.111], [.597,.087,.081],
  ]);
  // Shaped clipped-corner front/back plate bags follow the chest contour.
  b.part(plateGeometry(),'vest',[0,0,-.133],[1,1,1]);
  b.part(plateGeometry(),'vest',[0,.005,.128],[.94,1,.85]);
  b.roundedBox('clothDark',[0,.365,-.18],[.31,.26,.013]);
  for(const side of [-1,1]){
    b.roundedBox('vest',[side*.202,.29,.008],[.055,.15,.24],[0,0,side*.035]);
    for(let y=.245;y<.35;y+=.038)b.box('straps',[side*.234,y,.008],[.008,.015,.22]);
    b.roundedBox('straps',[side*.153,.537,.001],[.063,.027,.30],[0,0,side*.07]);
    b.roundedBox('vest',[side*.155,.553,.018],[.075,.017,.16],[0,0,side*.07]);
    b.roundedBox('hardware',[side*.14,.48,-.175],[.036,.036,.016]);
    b.roundedBox('straps',[side*.14,.48,-.185],[.021,.018,.008]);
    b.tube('straps',[side*.144,.53,-.14],[side*.136,.405,-.19],.006);
    b.box('clothDark',[side*.168,.114,-.078],[.007,.095,.009],[0,0,side*.2]);
  }
  // Fitted waist belt, loops, low-profile buckle and utility pouches.
  b.loft('straps',[[.028,.202,.148],[.073,.203,.149],[.084,.197,.144]]);
  b.roundedBox('hardware',[0,.057,-.154],[.054,.039,.014]);
  b.roundedBox('vest',[0,.057,-.165],[.035,.024,.006]);
  for(const x of [-.15,-.075,.075,.15])b.roundedBox('clothDark',[x,.057,-.142],[.019,.068,.014]);
  b.roundedBox('vest',[-.213,.075,.02],[.075,.107,.122],[0,0,.03]);
  b.roundedBox('clothDark',[-.228,.111,.02],[.055,.026,.125]);
  for(const x of [-.13,.13]){
    b.roundedBox('vest',[x,.078,.156],[.095,.105,.054]);
    b.box('straps',[x,.083,.19],[.014,.079,.009]);
  }
  // Three individual magazine pouches with shaped flaps, retention cord,
  // stitching and exposed feed lips. Six rows of webbing are geometry-batched.
  for(let i=0;i<3;i++){
    const x=(i-1)*.105;
    b.roundedBox('clothDark',[x,.244,-.201],[.093,.155,.066]);
    b.roundedBox('vest',[x,.312,-.208],[.095,.035,.074]);
    b.roundedBox('straps',[x,.329,-.198],[.075,.023,.042]);
    b.box('hardware',[x,.34,-.198],[.056,.006,.031]);
    for(const xx of [x-.034,x+.034])b.box('straps',[xx,.24,-.238],[.005,.122,.005]);
    b.box('straps',[x,.244,-.24],[.012,.117,.008]);
    b.roundedBox('vest',[x,.178,-.238],[.08,.013,.008]);
  }
  for(let row=0;row<4;row++)for(let col=0;col<5;col++){
    b.roundedBox('straps',[(col-2)*.058,.358+row*.026,-.193],[.046,.010,.009]);
  }
  b.roundedBox('straps',[0,.494,-.184],[.119,.042,.012]);
  for(const side of [-1,1])b.box('accent',[side*.025,.495,-.193],[.03,.007,.004],[0,0,side*-.2]);
  b.roundedBox('clothDark',[.103,.405,-.204],[.038,.046,.012]);
  b.tube('hardware',[.087,.411,-.215],[.099,.429,-.215],.003);
  b.tube('hardware',[.099,.429,-.215],[.113,.411,-.215],.003);
  // Radio, antenna and a restrained coiled lead tuck against the rear plate.
  b.roundedBox('straps',[-.157,.416,.167],[.078,.154,.058]);
  b.roundedBox('vest',[-.157,.432,.199],[.055,.071,.016]);
  b.box('hardware',[-.157,.473,.209],[.038,.011,.004]);
  b.tube('straps',[-.174,.487,.169],[-.174,.658,.169],.005);
  for(let i=0;i<8;i++)b.part('ring','straps',[-.153,.48+i*.009,.184],[.011,.011,.009],[Math.PI/2,0,0]);
  b.roundedBox('vest',[.144,.489,-.18],[.029,.055,.019]);
  // Back panel webbing, hydration ports and a stitched rescue handle.
  for(let row=0;row<5;row++)for(let col=0;col<5;col++)
    b.box('straps',[(col-2)*.057,.24+row*.04,.17],[.044,.012,.008]);
  b.roundedBox('straps',[0,.512,.171],[.117,.017,.022]);
  for(const side of [-1,1])b.roundedBox('straps',[side*.053,.489,.17],[.015,.049,.02],[0,0,side*.1]);
  const torso=b.finish('torso');torso.position.y=.85;torso.add(buildOperatorHead(p,team,{Batch}));
  const arms=new THREE.Group();arms.name='arms';arms.position.set(0,.49,0);
  arms.add(arm(p,1),arm(p,-1));const dualArm=arm(p,-1,true);dualArm.visible=false;arms.add(dualArm);
  const pistolArm=arm(p,-1,false,true);pistolArm.visible=false;arms.add(pistolArm);
  const gunSlot=new THREE.Group();gunSlot.name='gunSlot';gunSlot.position.set(.16,0,-.35);arms.add(gunSlot);
  const gunSlotL=new THREE.Group();gunSlotL.name='gunSlotL';gunSlotL.position.set(-.20,0,-.35);arms.add(gunSlotL);torso.add(arms);
  const backpack=new Batch(p);
  backpack.roundedBox('clothDark',[0,.349,.232],[.285,.35,.135]);
  backpack.roundedBox('vest',[0,.263,.311],[.235,.126,.034]);
  backpack.roundedBox('vest',[0,.472,.277],[.25,.034,.07]);
  for(const x of [-.098,.098]){
    backpack.roundedBox('straps',[x,.348,.307],[.021,.30,.014]);
    backpack.roundedBox('hardware',[x,.299,.322],[.029,.024,.009]);
  }
  for(let row=0;row<3;row++)for(let col=0;col<3;col++)backpack.box('straps',[(col-1)*.061,.355+row*.032,.313],[.047,.011,.01]);
  backpack.roundedBox('straps',[0,.545,.224],[.105,.018,.025]);
  backpack.box('accent',[0,.416,.322],[.057,.012,.006]);
  const pack=backpack.finish('pack');pack.visible=false;torso.add(pack);
  body.add(leg(p,-1),leg(p,1),torso);
  return root;
}


export function playerModel(team) {
  const key = team === 1 ? 1 : 2;
  if (!templates.has(key)) templates.set(key, build(key));
  const root = templates.get(key).clone(true);
  const named = name => root.getObjectByName(name);
  return {
    root, body: named('body'), legL: named('legL'), legR: named('legR'),
    kneeL: named('kneeL'), kneeR: named('kneeR'), footL: named('footL'), footR: named('footR'), torso: named('torso'), head: named('head'),
    arms: named('arms'), rightArm: named('rightArm'), leftArm: named('leftArm'),
    leftArmDual: named('leftArmDual'), leftArmPistol: named('leftArmPistol'), gunSlot: named('gunSlot'), gunSlotL: named('gunSlotL'),
    pack: named('pack'), phase: 0, poseTime: 0, weapon: null, deadT: 0, last: null,
  };
}
