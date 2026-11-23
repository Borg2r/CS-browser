// Original pistol meshes. Profiles, open guards and barrel bores are actual
// geometry; only the slide and magazine need separate animation transforms.
import * as THREE from '../vendor/three.module.min.js';
import { profile, hollowTube, turned, finish } from './weapon-detail.js';

const specs = {
  kestrel: { label: 'P9S', caliber: '9 × 19', front: -.173, rear: .034, half: .024, top: .074,
    metal: 0x465058, frame: 0x303735, grip: 0x3c4440, sight: .088, port: [-.078,-.034] },
  bulwark: { label: 'BULWARK', caliber: '.45 ACP', front: -.190, rear: .038, half: .023, top: .074,
    metal: 0x9aa4a5, frame: 0x68777d, grip: 0x784733, sight: .088, port: [-.091,-.040] },
  viper: { label: 'VIPER', caliber: '.357 SIG', front: -.211, rear: .040, half: .027, top: .080,
    metal: 0x4c5c65, frame: 0x30383b, grip: 0x59614c, sight: .094, port: [-.093,-.035] },
};
const barrelAxis = .045;
const unit = [1,1,1];
let engraving;

// An XY cross section, with optional true through-holes, swept along Z.
function crossSection(points, from, to, holes = [], bevel = .00065) {
  const shape = new THREE.Shape(points.map(([x,y]) => new THREE.Vector2(x,y)));
  shape.closePath();
  for (const ring of holes) {
    const h = new THREE.Path();
    h.absarc(ring[0],ring[1],ring[2],0,Math.PI*2,true);
    shape.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(shape,{depth:to-from,steps:1,bevelEnabled:bevel>0,
    bevelSegments:2,bevelSize:bevel,bevelThickness:bevel,curveSegments:16});
  g.translate(0,0,from);
  return g;
}

function pin(p,m,dark,x,y,z,r=.0026) {
  p.add('cylinder',m,[r,.0018,r],[x,y,z],[0,0,Math.PI/2]);
  // Slots are short and recessed in appearance, not decorative screw heads
  // along the whole slide. Crosspins on the frame remain almost flush.
  p.box(dark,.0006,.00065,r*1.35,x+Math.sign(x)*.0011,y,z,.25);
}

function label(p,id,x,y,z) {
  if (typeof document === 'undefined') return;
  if (!engraving) {
    const canvas = document.createElement('canvas'); canvas.width=1024;canvas.height=384;
    const ctx=canvas.getContext('2d');
    Object.values(specs).forEach((s,i) => {
      const top=i*128;
      ctx.fillStyle='#bcc2bb';ctx.font='500 37px sans-serif';ctx.letterSpacing='5px';
      ctx.fillText(s.label,20,top+48);
      ctx.fillStyle='#a5ada7';ctx.font='21px monospace';ctx.letterSpacing='1px';
      ctx.fillText(`${s.caliber}  ·  BP   02714`,22,top+88);
      ctx.fillRect(22,top+105,240,1);
    });
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=4;
    engraving=new THREE.MeshStandardMaterial({map:texture,color:0xb9c3c4,transparent:true,
      metalness:.55,roughness:.45,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  }
  const row=Object.keys(specs).indexOf(id), plane=new THREE.PlaneGeometry(.077,.0135);
  const uv=plane.attributes.uv;
  for(let i=0;i<uv.count;i++)uv.setY(i,(uv.getY(i)+2-row)/3);
  p.add(plane,engraving,unit,[x,y,z],[0,Math.PI/2,0]);
  plane.dispose();
}

// Each little diamond is a shallow four-sided pyramid, sharing the grip batch.
// It catches grazing light without a separate mesh or material per ridge.
function checkering(p,material,half,rows,columns,baseZ,baseY,dz,dy,lean=0) {
  const position=[],normal=[],uv=[];
  for(const side of [-1,1])for(let r=0;r<rows;r++)for(let c=0;c<columns;c++) {
    const y=baseY+r*dy,z=baseZ+c*dz+lean*(y-baseY)+(r%2)*dz*.5;
    const x=side*half,peak=[x+side*.0007,y,z];
    const ring=[[x,y-dy*.40,z],[x,y,z-dz*.40],[x,y+dy*.40,z],[x,y,z+dz*.40]];
    for(let n=0;n<4;n++) {
      const a=ring[n],b=ring[(n+1)%4],points=side>0?[peak,a,b]:[peak,b,a];
      const v1=new THREE.Vector3(...points[1]).sub(new THREE.Vector3(...points[0]));
      const v2=new THREE.Vector3(...points[2]).sub(new THREE.Vector3(...points[0]));
      const norm=v1.cross(v2).normalize();
      for(const q of points){position.push(...q);normal.push(norm.x,norm.y,norm.z);uv.push(q[2]*20,q[1]*20);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));p.add(g,material,unit);g.dispose();
}

function serrations(p,s,m,dark,front,count,step,angle=0) {
  for(const side of [-1,1])for(let i=0;i<count;i++){
    const z=front+i*step, x=side*(s.half+.0006);
    // Stepped groove floors and the adjacent beveled cutting lip read as
    // milled flutes under direct and environmental light.
    p.box(dark,.00065,.026,.00135,x,.046,z,angle);
    p.box(m,.00135,.026,.00115,x+side*.00035,.046,z+.0011,angle);
  }
}

function sights(p,s,m,dark,light) {
  const rear=s.rear-.013,front=s.front+.021,y=s.sight;
  p.box(m,.032,.005,.013,0,s.top+.003,rear);
  // Two shoulders leave the actual rear notch open down the optical axis.
  for(const side of [-1,1]){
    p.add(profile([[rear-.006,s.top+.004],[rear+.007,s.top+.004],
      [rear+.006,y+.001],[rear-.004,y+.001]],.008,.0006),dark,unit,[side*.011,0,0]);
    p.bead(light,side*.0106,y-.002,rear+.0075,.00135);
  }
  p.box(dark,.007,.005,.016,0,s.top+.002,front);
  p.box(m,.0037,y-s.top-.001,.008,0,(s.top+y)/2,front);
  p.bead(light,0,y-.0012,front+.0048,.0011);
  // Fine anti-glare ribs on the rear sight's shooter-facing surface.
  for(let i=0;i<3;i++)for(const side of [-1,1])
    p.box(m,.006,.00035,.0006,side*.011,s.top+.005+i*.0015,rear+.008);
}

function frameAndGrip(w,s,p,mag,m,api) {
  const classic=w.id==='bulwark',large=w.id==='viper';
  const nose=classic?s.front+.025:s.front+.008;
  const lower=classic?-.003:-.009;
  const frameOutline=[[nose,.023],[s.rear-.005,.023],[s.rear+.006,.013],[.046,.002],
    [.035,-.024],[.022,-.034],[-.011,-.028],[-.033,-.006],[-.099,-.006],[nose+.009,lower]];
  p.add(profile(frameOutline,classic?.039:.043,.0014),m.frame,unit);
  // Molded rear beavertail, clean dust cover lip and true frame/slide seam.
  p.add(profile([[.014,.020],[.049,.020],[.055,.010],[.046,.003],[.024,.007]],.041,.0011),m.frame,unit);
  for(const side of [-1,1]){
    p.box(m.dark,.0009,.003,s.rear-nose,side*.0221,.023,(nose+s.rear)/2);
    p.box(m.edge,.001,.0017,.073,side*.0228,.025,-.084);
  }
  const grip = classic?
    [[-.014,-.016],[.036,-.011],[.065,-.128],[.055,-.143],[.009,-.138],[-.009,-.104],[-.022,-.044]]:
    [[-.017,-.018],[.034,-.012],[.051,-.029],[.068,-.124],[.058,-.143],[.008,-.139],
      [-.002,-.124],[-.009,-.093],[-.016,-.069],[-.024,-.040]];
  p.add(profile(grip,classic?.032:.034,.0035),m.frame,unit);
  const panel=classic?
    [[-.007,-.043],[.027,-.031],[.053,-.124],[.013,-.126],[-.006,-.071]]:
    [[-.009,-.049],[.031,-.032],[.049,-.063],[.058,-.124],[.014,-.129],[-.005,-.102]];
  for(const side of [-1,1]){
    p.add(profile(panel,.0023,.0017),m.grip,unit,[side*.019,0,0]);
    if(classic){pin(p,m.edge,m.dark,side*.0227,-.052,.015,.0036);pin(p,m.edge,m.dark,side*.0227,-.117,.030,.0036);}
  }
  checkering(p,m.grip,.02195,classic?17:18,classic?6:7,.014,-.121,.0045,.0043,-.20);
  // The backstrap uses small flattened ribs, and the front strap has contour
  // changes for the fingers; neither is a floating rectangular grip plate.
  for(let i=0;i<12;i++){
    const y=-.127+i*.0062,z=.063-(y+.127)*.22;
    p.box(m.dark,.027,.0013,.0013,0,y,z);
  }
  if(!classic)for(let i=0;i<3;i++){
    const y=-.116+i*.023,z=-.004-(y+.116)*.23;
    p.add(profile([[z-.001,y-.006],[z-.004,y-.004],[z-.004,y+.001],[z+.002,y+.004]],.025,.001),m.frame,unit);
  }
  const guardOuter=[[-.098,-.004],[-.108,-.015],[-.105,-.045],[-.089,-.058],[-.032,-.058],[-.015,-.045],[-.008,-.012]];
  const guardHole=[[-.090,-.010],[-.096,-.020],[-.094,-.038],[-.084,-.047],[-.037,-.047],[-.026,-.039],[-.018,-.012]];
  p.add(profile(guardOuter,.024,.0017,[guardHole]),m.frame,unit);
  if(large)for(let i=0;i<5;i++)p.box(m.dark,.025,.0015,.001,-.0001,-.019-i*.004,-.107);
  const trigger=[[-.052,-.010],[-.042,-.010],[-.043,-.024],[-.053,-.039],[-.061,-.042],[-.064,-.038],[-.055,-.030]];
  p.add(profile(trigger,.009,.0008),classic?m.edge:m.dark,unit);
  if(!classic)p.add(profile([[-.054,-.016],[-.051,-.018],[-.057,-.033],[-.061,-.035]],.003,.0003),m.edge,unit);

  // Controls: pins, textured magazine button, takedown paddle and slide stop.
  for(const side of [-1,1]){
    for(const [y,z] of [[.006,-.024],[.010,.014],[-.031,.016]])pin(p,m.edge,m.dark,side*.024,y,z,classic?.002:.0024);
    p.add('cylinder',m.dark,[.005,.003,.005],[side*.024,-.027,-.012],[0,0,Math.PI/2]);
    for(let i=0;i<3;i++)p.box(m.edge,.0008,.001,.006,side*.0257,-.029+i*.002,-.012);
    p.add(profile([[-.034,.011],[-.007,.011],[-.006,.017],[-.017,.018],[-.021,.015],[-.035,.015]],.003,.0007),m.dark,unit,[side*.024,0,0]);
    p.box(m.edge,.0014,.001,.012,side*.026,.016,-.015);
    if(!classic){
      p.box(m.dark,.0035,.009,.011,side*.024,.005,-.069);
      for(let i=0;i<3;i++)p.box(m.edge,.0005,.0007,.009,side*.0261,.002+i*.002,-.069);
    }
  }
  if(classic){
    // Exposed ring hammer, grip safety and frame safety distinguish the .45.
    p.add(profile([[.036,.024],[.053,.025],[.061,.050],[.054,.058],[.040,.052]],.012,.001,
      [[[.045,.036],[.049,.048],[.054,.047],[.052,.035]]]),m.dark,unit);
    p.add(profile([[.032,-.014],[.039,-.017],[.051,-.060],[.042,-.063]],.031,.001),m.edge,unit);
    p.box(m.dark,.004,.009,.025,-.025,.006,.014,-.08);
    p.box(m.edge,.005,.003,.018,-.027,.010,.014);
  } else {
    // Short accessory rail carved into the dust cover, with a flat base.
    p.box(m.frame,.035,.005,.057,0,-.009,nose+.037);
    for(let i=0;i<3;i++)p.box(m.dark,.038,.0024,.0035,0,-.012,nose+.019+i*.014);
  }

  // Magazine lives in its own zero-origin group: world.js supplies travel.
  mag.add(profile([[.001,-.052],[.032,-.046],[.059,-.135],[.012,-.138]],.028,.0012),m.dark,unit);
  mag.add(profile([[.007,-.139],[.060,-.143],[.061,-.150],[.010,-.147],[.004,-.143]],classic?.039:.044,.001),m.frame,unit);
  mag.box(m.dark,classic?.037:.042,.002,.039,0,-.149,.036);
  for(const side of [-1,1]){
    for(let i=0;i<4;i++)mag.add('cylinder',m.edge,[.0013,.0004,.0013],
      [side*.0148,-.067-i*.014,.025+i*.003],[0,0,Math.PI/2]);
    mag.box(m.edge,.0008,.001,.019,side*.022,-.145,.034);
  }
}

export function buildDetailedPistol(w,api) {
  const s=specs[w.id];
  if(!s)throw new Error(`No detailed pistol definition for ${w.id}`);
  const {Parts,mat,opticModel}=api, classic=w.id==='bulwark',large=w.id==='viper';
  const m={
    slide:finish(classic?'stainless':'blued',s.metal),
    frame:finish(classic?'steel':'polymer',s.frame),
    grip:finish(classic?'wood':'rubber',s.grip),
    edge:finish('stainless',classic?0xb6bfc0:0x83918f),
    dark:finish('blued',0x242d32),
    barrel:finish(classic?'stainless':'steel',large?0x75654d:0x76838a),
    light:mat(0xe0e7c1,.08,.35),
  };
  const body=new Parts(),slide=new Parts(),magazine=new Parts();
  frameAndGrip(w,s,body,magazine,m,api);
  const h=s.half,top=s.top,xy=[[-h,.026],[h,.026],[h,.057],
    [h-.006,top-.002],[h-.010,top],[-h+.010,top],[-h+.006,top-.002],[-h,.057]];
  const [portFront,portRear]=s.port;
  // Main slide is a hollow forward shroud. Its open port spans BOTH the top
  // and the right side, leaving a bridge on the left and rails underneath.
  slide.add(crossSection(xy,s.front,portFront,[[0,barrelAxis,.0109]]),m.slide,unit);
  slide.add(crossSection(xy,portRear,s.rear),m.slide,unit);
  slide.add(crossSection([[-h,.026],[-h+.006,.026],[-h+.006,.061],[-h+.010,top],[-h+.006,top-.002],[-h,.057]],portFront,portRear),m.slide,unit);
  slide.add(crossSection([[h-.004,.026],[h,.026],[h,.039],[h-.004,.039]],portFront,portRear),m.slide,unit);
  slide.box(m.dark,h*1.55,.002,portRear-portFront,0,.027,(portRear+portFront)/2);
  // Barrel hood and chamber are visibly deeper than the cut port's rim.
  body.add(turned([[s.front-.004,.0088],[s.front,.0096],[portFront-.005,.0096],
    [portFront+.004,.0125],[portRear-.005,.0125]],32),m.barrel,unit,[0,barrelAxis,0]);
  // A true annulus, recessed dark bore and small lands catch light at muzzle.
  body.add(hollowTube(.0097,classic?.0057:.0046,.016,40),m.barrel,unit,[0,barrelAxis,s.front+.002]);
  body.add(hollowTube(classic?.0057:.0046,classic?.0053:.0042,.018,32),m.dark,unit,[0,barrelAxis,s.front+.005]);
  body.add(profile([[portFront+.003,.048],[portRear-.003,.048],[portRear-.003,.060],
    [portFront+.006,.060]],.024,.00075),m.barrel,unit);
  body.box(m.dark,.020,.001,.022,0,.061,portRear-.014);
  body.box(m.edge,.0015,.002,.026,.013,.059,portFront+.019);
  // Extractor rides on the slide, with a tiny visible spring pin.
  slide.add(profile([[portRear-.017,.041],[portRear+.022,.041],[portRear+.025,.050],
    [portRear-.012,.052]],.003,.0005),m.dark,unit,[h+.0003,0,0]);
  pin(slide,m.edge,m.dark,h+.0027,.047,portRear+.013,.0018);
  // Recoil-spring plug is below the muzzle, separate from the barrel bore.
  body.add(turned([[s.front+.001,.005],[s.front+.009,.0058],[s.front+.034,.0058]],24),m.dark,unit,[0,.013,0]);
  body.add(hollowTube(.0063,.0044,.003,24),m.edge,unit,[0,.013,s.front+.001]);

  serrations(slide,s,m.slide,m.dark,s.rear-.057,classic?9:10,.0045,classic?0:-.17);
  if(!classic)serrations(slide,s,m.slide,m.dark,s.front+.015,large?6:5,.0052,-.17);
  // Faceted side flats, machined recoil rail and a modest front bevel.
  for(const side of [-1,1]){
    slide.box(m.dark,.00065,.002,s.rear-s.front-.005,side*(h+.0005),.030,(s.rear+s.front)/2);
    slide.box(m.edge,.00045,.00065,.059,side*(h+.0009),.058,s.front+.061);
    if(large)slide.add(profile([[s.front+.047,.034],[s.front+.097,.034],
      [s.front+.108,.040],[s.front+.055,.040]],.0008,.00035),m.dark,unit,[side*(h+.00055),0,0]);
  }
  label(slide,w.id,h+.0012,.048,(s.front+portFront)/2+.004);
  // Rounded backplate with striker indicator, bounded by the rear slide face.
  slide.box(m.dark,h*1.30,.028,.002,0,.044,s.rear+.0012);
  slide.bead(m.edge,0,.043,s.rear+.003,.0017);
  for(let i=0;i<5;i++)slide.box(m.slide,h*1.12,.0005,.0005,0,.034+i*.004,s.rear+.0025);
  sights(slide,s,m.slide,m.dark,m.light);
  const gun=body.build(),movingSlide=slide.build('slide');
  gun.add(movingSlide,magazine.build('magazine'));
  let sightY=s.sight;
  if(w.optic){
    sightY=w.optic===1?top+.052:top+.074;
    // Direct slide-mounted optic. It reciprocates with the slide on firing.
    movingSlide.add(opticModel(w.optic,sightY,s.rear-.039,true,top+.003));
  }
  gun.userData={authoredDetail:true,muzzle:[0,barrelAxis,s.front-.007],sightY,
    length:s.rear-s.front+.030,hip:[.175,-.14,-.405],adsZ:-.255,
    detailFamily:'original-pistol',slideMountedOptic:!!w.optic};
  return gun;
}
