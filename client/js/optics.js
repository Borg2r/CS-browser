// Compact, physically sized reflex and prism sights. These are original game
// models; lenses have real apertures and the mounting datum stays on the rail.
import * as THREE from '../vendor/three.module.min.js';
import { profile, hollowTube, finish } from './weapon-detail.js';

const PI = Math.PI, UNIT = [1, 1, 1], geometries = new Map();
let palette;
function materials() {
  if (palette) return palette;
  const metal = (kind, color, roughness) => {
    const material = finish(kind, color).clone();
    material.name = `optic/${kind}/${color}`;
    material.roughness = roughness;
    material.normalScale.setScalar(.055);
    material.userData.photorealWeapon = true;
    return material;
  };
  const glass = new THREE.MeshPhysicalMaterial({
    name:'optic/coated-glass',color:0x9baea4,metalness:0,roughness:.08,
    transparent:true,opacity:.075,depthWrite:false,side:THREE.DoubleSide,
    clearcoat:1,clearcoatRoughness:.07,envMapIntensity:.65,
  });
  glass.userData.photorealWeapon = true;
  const fiber = new THREE.MeshStandardMaterial({
    name:'optic/fiber-collector',color:0x9d2920,roughness:.27,metalness:.05,
    emissive:0x751309,emissiveIntensity:.11,
  });
  fiber.userData.photorealWeapon = true;
  palette = {
    body:metal('blued',0x353a3b,.44), edge:metal('steel',0x535b5d,.4),
    screw:metal('steel',0x4a5153,.37), dark:metal('blued',0x171d20,.48),
    rubber:metal('rubber',0x252b2b,.76), glass, fiber,
  };
  return palette;
}

function geometry(key, create) {
  if (!geometries.has(key)) geometries.set(key, create());
  return geometries.get(key);
}

function cylinder(radius, length, segments=24) {
  return geometry(`cylinder/${radius}/${length}/${segments}`,
    () => new THREE.CylinderGeometry(radius, radius, length, segments));
}

function circleRing(outer, inner, length) {
  return geometry(`ring/${outer}/${inner}/${length}`,()=>hollowTube(outer,inner,length,40));
}

function pin(p, material, x, y, z, radius=.0022, axis='x') {
  p.add(cylinder(radius,.0012,20),material,UNIT,[x,y,z],axis==='x'?[0,0,PI/2]:axis==='z'?[PI/2,0,0]:[0,0,0]);
}

function slottedScrew(p,m,x,y,z,r=.0022,axis='x') {
  pin(p,m.screw,x,y,z,r,axis);
  if (axis==='x') p.box(m.dark,.00035,.00055,r*1.3,x+Math.sign(x)*.00075,y,z);
  else if (axis==='y') p.box(m.dark,r*1.3,.00035,.00055,x,y+.00075,z);
  else p.box(m.dark,r*1.3,.00055,.00035,x,y,z+.00075);
}

// Rounded rectangle with chamfered top corners, not the circular tube of the
// old red dot. The RMR-like hood and its lens share this exact opening.
function windowPath(path, halfWidth, bottom, top, corner) {
  path.moveTo(-halfWidth+corner,bottom);
  path.lineTo(halfWidth-corner,bottom);
  path.quadraticCurveTo(halfWidth,bottom,halfWidth,bottom+corner);
  path.lineTo(halfWidth,top-corner*1.5);
  path.quadraticCurveTo(halfWidth,top,halfWidth-corner*1.5,top);
  path.lineTo(-halfWidth+corner*1.5,top);
  path.quadraticCurveTo(-halfWidth,top,-halfWidth,top-corner*1.5);
  path.lineTo(-halfWidth,bottom+corner);
  path.quadraticCurveTo(-halfWidth,bottom,-halfWidth+corner,bottom);
  path.closePath(); return path;
}

function reflexHood(pistol) {
  return geometry(`hood/${pistol}`,()=>{
    const s=pistol?1:1.2, outline=new THREE.Shape();
    outline.moveTo(-.015*s,-.012*s);
    outline.lineTo(.015*s,-.012*s);
    outline.lineTo(.0155*s,.0068*s);
    outline.quadraticCurveTo(.0159*s,.0118*s,.0125*s,.0125*s);
    outline.quadraticCurveTo(.0098*s,.0127*s,.0079*s,.0102*s);
    outline.quadraticCurveTo(0,.0114*s,-.0079*s,.0102*s);
    outline.quadraticCurveTo(-.0098*s,.0127*s,-.0125*s,.0125*s);
    outline.quadraticCurveTo(-.0159*s,.0118*s,-.0155*s,.0068*s);
    outline.lineTo(-.015*s,-.012*s);outline.closePath();
    outline.holes.push(windowPath(new THREE.Path(),.0112*s,-.0086*s,.0077*s,.0024*s));
    const g=new THREE.ExtrudeGeometry(outline,{
      depth:.0034*s,bevelEnabled:true,bevelSize:.00055*s,
      bevelThickness:.0005*s,bevelSegments:3,steps:1,curveSegments:12,
    });
    g.translate(0,0,-.0017*s);return g;
  });
}

function reflexLens(pistol) {
  return geometry(`reflex-lens/${pistol}`,()=>{
    const s=pistol?1:1.2;
    const shape=windowPath(new THREE.Shape(),.01115*s,-.00855*s,.00765*s,.0024*s);
    const g=new THREE.ShapeGeometry(shape,18), p=g.attributes.position;
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i), y=p.getY(i);
      // Very shallow curvature gives the coated glass moving highlights.
      p.setZ(i,-.00065*(1-x*x/(.0112*s)**2-y*y/(.012*s)**2));
    }
    g.computeVertexNormals();return g;
  });
}

function addReflex(type,z,pistol,base,api) {
  const {Parts}=api, m=materials(), p=new Parts(), g=new THREE.Group();
  g.name='red_dot';
  const s=pistol?1:1.2, y=opticAxisHeight(type,pistol,base), hoodZ=z-.009*s;
  const mountTop=base+(pistol?.003:.009);
  // Low mounting plate and tapered battery/emitter housing. No riser column.
  p.add(profile([[z-.023*s,base],[z+.022*s,base],[z+.022*s,mountTop-.0005],
    [z+.018*s,mountTop+.001],[z-.020*s,mountTop+.001]],.030*s,.0007),m.body,UNIT);
  p.add(profile([[z-.020*s,mountTop],[z-.014*s,mountTop+.006*s],
    [z+.011*s,mountTop+.009*s],[z+.021*s,mountTop+.006*s],
    [z+.022*s,mountTop+.001]],.026*s,.0012),m.body,UNIT);
  // Recessed emitter well remains below the line of sight behind the glass.
  p.box(m.dark,.011*s,.0018,.011*s,0,mountTop+.008*s,z+.009*s,-.14);
  p.box(m.edge,.008*s,.001,.006*s,0,mountTop+.0087*s,z+.009*s,-.14);
  p.add(new THREE.SphereGeometry(.0012*s,12,8),m.fiber,UNIT,[0,mountTop+.0088*s,z+.009*s]);
  p.add(reflexHood(pistol),m.body,UNIT,[0,y,hoodZ]);
  // The hood feet are swept back into the housing rather than perched on it.
  for(const side of [-1,1]) {
    p.add(profile([[hoodZ-.0015*s,y-.010*s],[hoodZ+.003*s,y-.005*s],
      [z+.013*s,mountTop+.008*s],[z+.020*s,mountTop+.004*s],
      [hoodZ-.003*s,mountTop+.002*s]],.0027*s,.0005),m.body,UNIT,[side*.014*s,0,0]);
    // A narrow molded seam traces the battery tray on the lower housing.
    p.box(m.dark,.0004,.0006,.026*s,side*.0139*s,mountTop+.0035*s,z+.002*s);
    slottedScrew(p,m,side*.009*s,mountTop+.0014,z+.015*s,.0021*s,'y');
  }
  // Battery tray, rounded side buttons, windage/elevation adjusters and marks.
  p.add(profile([[z-.002*s,mountTop+.0015],[z+.018*s,mountTop+.0015],
    [z+.019*s,mountTop+.006],[z+.017*s,mountTop+.007],[z-.003*s,mountTop+.007]],
    .001,.0003),m.edge,UNIT,[.014*s,0,0]);
  slottedScrew(p,m,.015*s,mountTop+.0044,z+.009*s,.0017*s);
  for(const dz of [-.004,.007]) {
    p.add(new THREE.SphereGeometry(1,16,8),m.rubber,[.0014,.0032*s,.0041*s],[-.0144*s,mountTop+.005*s,z+dz*s]);
  }
  p.box(m.edge,.00025,.0005,.003,-.0161*s,mountTop+.005*s,z-.004*s);
  p.box(m.edge,.00025,.003,.0005,-.0161*s,mountTop+.005*s,z-.004*s);
  p.box(m.edge,.00025,.0005,.003,-.0161*s,mountTop+.005*s,z+.007*s);
  slottedScrew(p,m,.0161*s,y-.0035*s,hoodZ,.002*s);
  for(let i=0;i<3;i++)p.box(m.edge,.0003,.00035,.0011,.0165*s,y-.0055*s+i*.0018,hoodZ+.003*s);
  // Rifle rail clamp uses a low cross bolt; pistols mount directly to the slide.
  if(!pistol) {
    for(const side of [-1,1])p.add(profile([[z-.020,base+.001],[z+.017,base+.001],
      [z+.017,base+.006],[z-.020,base+.006]],.003,.0006),m.body,UNIT,[side*.0175,0,0]);
    p.add(cylinder(.003,.040,24),m.screw,UNIT,[0,base+.004,z+.004],[0,0,PI/2]);
    slottedScrew(p,m,.021,base+.004,z+.004,.0042);
  }
  g.add(p.build('optic_housing'));
  const lens=new THREE.Mesh(reflexLens(pistol),m.glass);
  lens.name='optic_lens';lens.position.set(0,y,hoodZ+.0004);g.add(lens);
  const dot=new THREE.Group();dot.name='optic_reticle';dot.visible=false;
  dot.position.set(0,y,hoodZ+.0009);
  for(const [radius,opacity]of [[.0005,.18],[.00022,.95]]) {
    const mat=new THREE.MeshBasicMaterial({color:0xff331c,transparent:true,opacity,depthWrite:false,depthTest:false,toneMapped:false});
    const disc=new THREE.Mesh(new THREE.CircleGeometry(radius,20),mat);disc.renderOrder=20;dot.add(disc);
  }
  g.add(dot);
  g.userData={sightY:y,opticMountBase:base,opticFamily:'open-reflex',pistolMount:pistol,
    lensWidth:.0224*s,lensHeight:.0163*s,physicalLength:.045*s};
  return g;
}

// The prism body changes cross section along its length. A round optical bore
// passes through the asymmetric forged shell and the scalloped lower cheeks.
function prismBody() {
  return geometry('prism-body',()=>{
    const stations=[
      [-.077,.0232,.0228,.0240,.0164],[-.073,.0236,.0232,.0242,.0164],
      [-.064,.0230,.0228,.0260,.0160],[-.046,.0208,.0208,.0280,.0148],
      [-.023,.0193,.0198,.0290,.0130],[.003,.0188,.0190,.0280,.0126],
      [.023,.0180,.0180,.0250,.0126],[.034,.0162,.0162,.0180,.0126],
      [.042,.0158,.0158,.0158,.0126],[.061,.0164,.0164,.0164,.0126],
      [.074,.0171,.0171,.0171,.0126],
    ], n=40, positions=[],uv=[],indices=[];
    // Separate outer/inner vertices keep both wall normals physically correct.
    for(const inner of [false,true]) {
      const start=positions.length/3;
      for(let j=0;j<stations.length;j++) {
        const [z,rx,top,bottom,bore]=stations[j];
        for(let i=0;i<=n;i++) {
          const a=i/n*2*PI,c=Math.cos(a),s=Math.sin(a);
          const x=inner?bore*c:rx*Math.sign(c)*Math.pow(Math.abs(c),.91);
          const y=inner?bore*s:(s>=0?top:bottom)*Math.sign(s)*Math.pow(Math.abs(s),.91);
          positions.push(x,y,z);uv.push(i/n,j/(stations.length-1));
          if(j&&i<n) {
            const a=start+(j-1)*(n+1)+i,b=a+1,c=a+n+1,d=c+1;
            if(inner)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
          }
        }
      }
    }
    // End faces have their own vertices so the machined rim remains sharp.
    for(const end of [0,stations.length-1]) {
      const [z,rx,top,bottom,bore]=stations[end],start=positions.length/3;
      for(let i=0;i<=n;i++) {
        const a=i/n*2*PI,c=Math.cos(a),s=Math.sin(a);
        const x=rx*Math.sign(c)*Math.pow(Math.abs(c),.91);
        const y=(s>=0?top:bottom)*Math.sign(s)*Math.pow(Math.abs(s),.91);
        positions.push(x,y,z,bore*c,bore*s,z);uv.push(.5+x/.05,.5+y/.06,.5+bore*c/.05,.5+bore*s/.06);
        if(i<n) {
          const a=start+i*2,b=a+1,c=a+2,d=a+3;
          if(end===0)indices.push(a,b,c,b,d,c);else indices.push(a,c,b,b,c,d);
        }
      }
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
  });
}

function turret(p,m,axis,x,y,z,r=.009) {
  const rotation=axis==='x'?[0,0,PI/2]:[0,0,0];
  p.add(cylinder(r*.88,.007,32),m.body,UNIT,[x,y,z],rotation);
  const capOffset=.004;
  const cx=x+(axis==='x'?capOffset:0),cy=y+(axis==='y'?capOffset:0);
  p.add(cylinder(r,.0035,40),m.body,UNIT,[cx,cy,z],rotation);
  p.add(cylinder(r*.86,.0006,40),m.edge,UNIT,[cx+(axis==='x'?.002:0),cy+(axis==='y'?.002:0),z],rotation);
  for(let i=0;i<24;i++) {
    const a=i*2*PI/24;
    if(axis==='y')p.box(m.dark,.00065,.0035,.0009,x+Math.cos(a)*r,cy,z+Math.sin(a)*r,0,-a,0);
    else p.box(m.dark,.0035,.00065,.0009,cx,y+Math.cos(a)*r,z+Math.sin(a)*r,a,0,0);
  }
  if(axis==='y')p.box(m.dark,r*1.1,.0004,.0008,cx,cy+.0024,z);
  else p.box(m.dark,.0004,.0008,r*1.1,cx+.0024,cy,z);
}

function addPrism(z,base,api) {
  const {Parts}=api,m=materials(),p=new Parts(),g=new THREE.Group();g.name='acog';
  const y=opticAxisHeight(2,false,base);
  p.add(prismBody(),m.body,UNIT,[0,y,z]);
  // Lower forged webs follow the housing's belly, separated by a real arch.
  for(const side of [-1,1]) {
    p.add(profile([[z-.052,y-.022],[z+.024,y-.021],[z+.027,base+.008],
      [z-.052,base+.008]],.0045,.0009,
      [[[z-.039,base+.012],[z+.013,base+.012],[z+.010,y-.023],[z-.036,y-.024]]]),m.body,UNIT,[side*.0125,0,0]);
    p.add(profile([[z-.056,base+.002],[z+.034,base+.002],[z+.034,base+.008],
      [z+.028,base+.010],[z-.049,base+.010],[z-.056,base+.007]],.0035,.0006),m.body,UNIT,[side*.016,0,0]);
    // Thin cast stiffening ribs meet the objective skirt along its lower side.
    p.add(profile([[z-.061,y-.019],[z-.048,y-.022],[z-.026,base+.010],
      [z-.021,base+.010],[z-.041,y-.021],[z-.055,y-.015]],.002,.0005),m.edge,UNIT,[side*.016,0,0]);
  }
  p.add(profile([[z-.057,base],[z+.035,base],[z+.035,base+.004],
    [z+.028,base+.0055],[z-.050,base+.0055]],.034,.0006),m.body,UNIT);
  for(const dz of [-.031,.017]) {
    p.add(cylinder(.0032,.043,28),m.screw,UNIT,[0,base+.005,z+dz],[0,0,PI/2]);
    p.add(cylinder(.0059,.005,32),m.body,UNIT,[.023,base+.005,z+dz],[0,0,PI/2]);
    slottedScrew(p,m,.026,base+.005,z+dz,.0048);
    for(let i=0;i<12;i++) {
      const a=i*PI/6;
      p.box(m.dark,.004,.0008,.001,.023,base+.005+Math.cos(a)*.006,z+dz+Math.sin(a)*.006,a,0,0);
    }
  }
  // Objective skirt, exposed internal step and knurled ocular focus sleeve.
  p.add(circleRing(.0239,.0162,.0048),m.body,UNIT,[0,y,z-.076]);
  p.add(circleRing(.0184,.0160,.0011),m.edge,UNIT,[0,y,z-.0777]);
  p.add(circleRing(.0173,.0124,.0042),m.body,UNIT,[0,y,z+.074]);
  p.add(circleRing(.0140,.01235,.001),m.edge,UNIT,[0,y,z+.0764]);
  for(const dz of [.047,.064])p.add(circleRing(.0172,.0155,.0025),m.dark,UNIT,[0,y,z+dz]);
  for(let i=0;i<36;i++) {
    const a=i*2*PI/36;
    p.box(m.body,.0008,.0008,.014,Math.cos(a)*.0169,y+Math.sin(a)*.0169,z+.056,0,0,a);
  }
  turret(p,m,'y',0,y+.0237,z+.004,.0095);
  turret(p,m,'x',.023,y-.002,z+.004,.0085);
  // Tiny tether eyes and the retaining strap anchor below the adjustment cap.
  p.add(new THREE.TorusGeometry(.0031,.00085,6,16),m.body,UNIT,[-.019,y-.005,z+.014],[0,PI/2,0]);
  p.add(new THREE.TorusGeometry(.0027,.0007,6,16),m.body,UNIT,[.021,y-.010,z-.009],[0,PI/2,0]);
  // Curved fiber collector with physical saddles and a thin protective channel.
  const collector=geometry('fiber-curve',()=>new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.009,.0208,-.065),new THREE.Vector3(-.010,.0240,-.050),
    new THREE.Vector3(-.010,.0248,-.026),new THREE.Vector3(-.011,.0230,.006),
    new THREE.Vector3(-.010,.0200,.028),
  ]),40,.0013,8,false));
  const support=geometry('fiber-channel',()=>new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.009,.0198,-.065),new THREE.Vector3(-.010,.0223,-.050),
    new THREE.Vector3(-.010,.0231,-.026),new THREE.Vector3(-.011,.0213,.006),
    new THREE.Vector3(-.010,.0184,.028),
  ]),32,.0022,8,false));
  p.add(support,m.body,UNIT,[0,y,z]);p.add(collector,m.fiber,UNIT,[0,y,z]);
  for(const [dz,dy]of [[-.058,.0215],[.023,.0197]]){
    p.box(m.edge,.009,.0018,.005,-.01,y+dy,z+dz);
    slottedScrew(p,m,-.01,y+dy+.0013,z+dz,.0012,'y');
  }
  // Small engraved adjustment ticks, kept subtle and free of magnification text.
  for(let i=0;i<5;i++)p.box(m.edge,.00035,.0013,.00045,.0195,y-.010,z-.030+i*.0022);
  for(const side of [-1,1])slottedScrew(p,m,side*.0178,base+.009,z-.044,.0017);
  g.add(p.build('optic_housing'));
  for(const [name,radius,dz]of [['optic_lens',.01235,.0757],['optic_objective',.0160,-.0748]]){
    const lens=new THREE.Mesh(new THREE.CircleGeometry(radius,48),m.glass);
    lens.name=name;lens.position.set(0,y,z+dz);g.add(lens);
  }
  g.userData={sightY:y,opticMountBase:base,opticFamily:'forged-prism',physicalLength:.155,
    lensWidth:.0247,lensHeight:.0247};
  return g;
}

export function opticAxisHeight(type,pistolMount=false,mountBase=0) {
  return mountBase+(type===1?(pistolMount?.019:.0285):.041);
}

// The old requested y is accepted for source compatibility. Physical mount and
// lens geometry determine the real sight axis, returned in userData.sightY.
export function buildOptic(type,y,z=-.10,pistolMount=false,mountBase,api) {
  const base=mountBase??(pistolMount?.088:.08);
  return type===1?addReflex(type,z,pistolMount,base,api):addPrism(z,base,api);
}
