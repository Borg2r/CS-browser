// Sabre's compact Swiss-style rifle is modelled in grip space, in metres.
// Rounded, varying cross-sections form the receiver, furniture and magazine;
// immutable details are baked by material, leaving only the action/magazine
// as movable transforms. The weapon's simulation definition is unchanged.
import * as THREE from '../vendor/three.module.min.js';
import { profile, hollowTube, turned, finish } from './weapon-detail.js';

const P = Math.PI, ONE = [1, 1, 1], geometryCache = new Map();
const cached = (key, make) => {
  if (!geometryCache.has(key)) geometryCache.set(key, make());
  return geometryCache.get(key);
};

// Each section is [z, centreY, halfWidth, halfHeight, exponent]. An exponent
// below one rounds a rectangular section without turning it into a cylinder.
function loft(key, sections, segments = 32, begin = 0, end = P * 2, caps = true) {
  return cached(key, () => {
    const positions = [], uv = [], indices = [], span = sections.at(-1)[0] - sections[0][0];
    for (let k = 0; k < sections.length; k++) {
      const [z, y, width, height, exponent = .5] = sections[k];
      for (let j = 0; j <= segments; j++) {
        const a = begin + (end - begin) * j / segments, c = Math.cos(a), s = Math.sin(a);
        positions.push(Math.sign(c) * Math.abs(c) ** exponent * width,
          y + Math.sign(s) * Math.abs(s) ** exponent * height, z);
        uv.push((z - sections[0][0]) / span, j / segments);
      }
      if (k) for (let j = 0; j < segments; j++) {
        const a = (k - 1) * (segments + 1) + j, b = a + segments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    if (caps && Math.abs(end - begin - P * 2) < .001) {
      for (const k of [0, sections.length - 1]) {
        const start = k * (segments + 1), centre = positions.length / 3;
        positions.push(0, sections[k][1], sections[k][0]); uv.push(.5, .5);
        for (let j = 0; j < segments; j++) {
          if (k) indices.push(centre, start + j, start + j + 1);
          else indices.push(centre, start + j + 1, start + j);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices);
    g.computeVertexNormals(); return g;
  });
}

function roundedPolygon(z, y, width, height, radius = .003, steps = 4) {
  const points = [];
  for (const [cx, cy, start] of [[z + width / 2 - radius, y + height / 2 - radius, 0],
    [z - width / 2 + radius, y + height / 2 - radius, 90],
    [z - width / 2 + radius, y - height / 2 + radius, 180],
    [z + width / 2 - radius, y - height / 2 + radius, 270]]) {
    for (let i = 0; i <= steps; i++) {
      const a = (start + i * 90 / steps) * P / 180;
      points.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
  }
  return points;
}

function sectionAt(sections, z) {
  let i = 0;
  while (i < sections.length - 2 && z > sections[i + 1][0]) i++;
  const a = sections[i], b = sections[i + 1], t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  return a.map((v, n) => v + (b[n] - v) * t);
}

// Side shells have genuine apertures. Their otherwise planar vertices are
// wrapped onto the same rounded cross-section as the roof and underside.
function curvedPanel(key, points, holes, sections, side, thickness = .003) {
  return cached(key, () => {
    const g = profile(points, thickness, .001, holes), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i), y = p.getY(i), [, centre, width, height] = sectionAt(sections, z);
      const v = Math.min(.96, Math.abs((y - centre) / height));
      p.setX(i, side * width * Math.pow(1 - v ** 4, .25) + p.getX(i));
    }
    g.computeVertexNormals(); return g;
  });
}

function pin(p, material, x, y, z, radius = .003, length = .003) {
  p.add(cached(`pin/${radius}/${length}`, () => new THREE.CylinderGeometry(radius, radius, length, 24)),
    material, ONE, [x, y, z], [0, 0, P / 2]);
}

function tube(p, material, r, bore, length, x, y, z) {
  p.add(cached(`tube/${r}/${bore}/${length}`, () => hollowTube(r, bore, length, 32)), material, ONE, [x, y, z]);
}

function gripGeometry() {
  // Rotate a loft onto the pistol-grip axis. The backstrap widens towards its
  // palm swell and then tapers into the recessed base cap.
  const g = loft('grip-loft', [[-.141,-.052,.019,.025,.6],[-.134,-.05,.022,.029,.6],
    [-.105,-.039,.024,.032,.6],[-.065,-.025,.024,.031,.6],[-.033,-.015,.021,.027,.65],
    [-.012,-.010,.019,.024,.65]], 36).clone();
  g.rotateX(-P / 2); return g;
}

function materials() {
  const steel = finish('steel', 0x626b6d), phosphate = finish('blued', 0x424a4e);
  const polymer = finish('polymer', 0x4c563f), darkPolymer = finish('polymer', 0x333b2f);
  const edge = finish('steel', 0x7d8889), rubber = finish('rubber', 0x252b28);
  for (const material of [steel, phosphate, polymer, darkPolymer, edge, rubber]) material.userData.photorealWeapon = true;
  return { steel, phosphate, polymer, darkPolymer, edge, rubber };
}

let magazineMaterial;
function magazineSkin() {
  if (!magazineMaterial) {
    magazineMaterial = finish('polymer', 0x645b3b).clone();
    magazineMaterial.name = 'Sabre smoked polymer magazine';
    magazineMaterial.roughness = .43; magazineMaterial.metalness = .03;
    magazineMaterial.transparent = true; magazineMaterial.opacity = .79;
    magazineMaterial.depthWrite = false;
    magazineMaterial.userData.photorealWeapon = true;
  }
  return magazineMaterial;
}

const stampMaterials = new Map();
function stamp(p, text, x, y, z, width = .065) {
  if (typeof document === 'undefined') return;
  if (!stampMaterials.has(text)) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = '26px monospace'; ctx.fillStyle = '#9ca29a'; ctx.fillText(text, 8, 35);
    ctx.font = '17px monospace'; ctx.fillStyle = '#7f8981'; ctx.fillText('5.56 × 45   ·   047', 9, 72);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    stampMaterials.set(text, new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false,
      metalness: .4, roughness: .53, polygonOffset: true, polygonOffsetFactor: -1 }));
  }
  p.add('plane', stampMaterials.get(text), [width, .016, 1], [x, y, z], [0, Math.sign(x) * P / 2, 0]);
}

export function buildSabre(w, api) {
  const { Parts, MAT, opticModel } = api;
  const { steel, phosphate, polymer, darkPolymer, edge, rubber } = materials();
  const body = new Parts(), slide = new Parts(), magazine = new Parts();
  const barrelY = .045;

  // Stamped upper: tapering cheeks, folded shoulders and a long rolled top.
  // The right shell is open at the ejection port instead of using a dark decal.
  const receiverSections = [[-.267,.042,.031,.039,.5],[-.246,.044,.034,.040,.5],
    [-.174,.044,.0335,.041,.5],[-.046,.044,.032,.041,.5],[.056,.040,.030,.037,.5],[.073,.037,.027,.032,.5]];
  const panelOutline = [[-.266,.013],[-.255,.072],[-.229,.079],[.046,.077],[.068,.066],
    [.070,.014],[.048,.005],[-.217,.004],[-.255,.008]];
  const port = roundedPolygon(-.131,.047,.113,.030,.005,5);
  for (const side of [-1, 1]) {
    body.add(curvedPanel(`receiver-${side}`,panelOutline,side > 0 ? [port] : [],receiverSections,side), steel, ONE);
  }
  body.add(loft('upper-roof',receiverSections,24,.73,P-.73,false),steel,ONE);
  body.add(loft('upper-floor',receiverSections,20,P+.73,P*2-.73,false),phosphate,ONE);
  // A rolled seam below the sidewall and receiver takedown pins.
  for (const side of [-1,1]) {
    body.add(loft(`receiver-seam-${side}`, [[-.252,.009,.0014,.0016,.8],[.048,.009,.0014,.0016,.8]],12),
      phosphate,ONE,[side*.030,0,0]);
    for (const [y,z] of [[.016,-.239],[.017,-.035],[.018,.054]]) {
      pin(body,phosphate,side*.033,y,z,.0046,.003);pin(body,edge,side*.035,y,z,.002,.001);
    }
  }
  body.add(profile([[-.222,.006],[-.214,-.027],[-.175,-.040],[-.099,-.036],[-.073,-.014],
    [.055,-.015],[.067,.012]],.053,.004),phosphate,ONE);

  // Rounded grip and an actual curved open trigger bow. The finger recesses
  // follow the front strap, while the stipple is a subtle normal-map finish.
  body.add(cached('grip-final',gripGeometry),polymer,ONE);
  body.add(loft('grip-cap',[[.023,-.139,.022,.005,.5],[.066,-.139,.020,.005,.5]],20),darkPolymer,ONE);
  for (const side of [-1,1]) {
    for (let i=0;i<9;i++) body.box(darkPolymer,.0013,.001,.033,side*.0234,-.043-i*.009,.024+i*.0018,-.14);
    pin(body,phosphate,side*.024,-.095,.043,.0032,.0018);
  }
  body.add(profile([[-.062,-.019],[-.068,-.038],[-.064,-.074],[-.048,-.086],[.018,-.084],
    [.030,-.071],[.031,-.026],[.021,-.017]],.014,.002,
    [[[-.050,-.031],[-.054,-.042],[-.050,-.067],[-.042,-.073],[.014,-.072],[.019,-.064],[.019,-.031]]]),phosphate,ONE);
  body.add(profile([[-.015,-.022],[-.025,-.045],[-.019,-.062],[-.009,-.065],[-.015,-.048],[-.007,-.024]],.008,.0015),steel,ONE);

  // The handguard is a rounded shell with a genuine pair of four-slot vents.
  // Its narrow front collar, palm swell and rear collar are separate sections.
  const handguardSections=[[-.497,.026,.024,.032,.5],[-.485,.026,.029,.036,.5],[-.462,.027,.034,.039,.5],
    [-.420,.028,.037,.041,.5],[-.357,.028,.037,.041,.5],[-.297,.028,.035,.040,.5],[-.273,.028,.031,.036,.5]];
  const handguardOutline=[...handguardSections.map(([z,y,,h])=>[z,y+h*.79]),
    ...[...handguardSections].reverse().map(([z,y,,h])=>[z,y-h*.79])];
  const vents=[-.452,-.410,-.368,-.326].map(z=>roundedPolygon(z,.040,.025,.015,.004,5));
  for (const side of [-1,1]) {
    body.add(curvedPanel(`handguard-side-${side}`,handguardOutline,vents,handguardSections,side,.0035),polymer,ONE);
    for(const z of[-.486,-.286])pin(body,phosphate,side*.030,.015,z,.0034,.0024);
  }
  body.add(loft('handguard-roof',handguardSections,28,.67,P-.67,false),polymer,ONE);
  body.add(loft('handguard-under',handguardSections,28,P+.67,2*P-.67,false),polymer,ONE);
  // Five softly raised transverse finger ribs sit around the lower half only.
  for(let i=0;i<5;i++) {
    const z=-.449+i*.031,section=sectionAt(handguardSections,z);
    body.add(loft(`handguard-rib-${i}`,[[z-.0015,section[1],section[2]+.0007,section[3]+.001,.5],
      [z,section[1],section[2]+.0017,section[3]+.002,.5],
      [z+.0015,section[1],section[2]+.0007,section[3]+.001,.5]],24,P+.3,2*P-.3,false),darkPolymer,ONE);
  }
  // Receiver/handguard joint and a forward steel nose band.
  body.add(loft('handguard-rear-band',[[-.282,.028,.034,.039,.5],[-.273,.028,.034,.039,.5]],32),phosphate,ONE);
  body.add(loft('handguard-front-band',[[-.503,.026,.025,.033,.5],[-.495,.026,.025,.033,.5]],32),phosphate,ONE);

  // Barrel, separate upper gas tube, gas regulator and hooded front sight.
  body.add(turned([[-.621,.011],[-.597,.011],[-.585,.0125],[-.509,.0125],[-.493,.017],[-.268,.017]],36),phosphate,ONE,[0,barrelY,0]);
  body.add(turned([[-.507,.011],[-.485,.011],[-.477,.0125],[-.272,.0125]],28),steel,ONE,[0,.081,0]);
  for(const z of[-.515,-.505])tube(body,phosphate,.019,.013,.007,0,barrelY,z);
  body.add(profile([[-.520,.049],[-.520,.088],[-.503,.113],[-.489,.109],[-.484,.063],[-.489,.049]],.024,.003),phosphate,ONE);
  tube(body,steel,.010,.004,.022,0,.086,-.523);
  for(let i=0;i<10;i++) {
    const a=i*P/5;body.add('sphere',phosphate,[.0011,.0011,.005],[Math.cos(a)*.0105,.086+Math.sin(a)*.0105,-.531]);
  }
  tube(body,phosphate,.0145,.0115,.009,0,.127,-.500);
  body.box(steel,.0026,.020,.005,0,.118,-.500);
  body.add('ring',phosphate,[.008,.012,.014],[-.023,.055,-.498],[0,P/2,0]);

  // Open slotted flash hider and an annular muzzle crown.
  tube(body,phosphate,.0155,.006,.013,0,barrelY,-.617);
  for(let i=0;i<6;i++) {
    const a=i*P/3;
    body.add(loft(`flash-prong-${i}`, [[-.656,barrelY+Math.sin(a)*.013,.0016,.0016,.7],
      [-.622,barrelY+Math.sin(a)*.013,.0022,.0022,.7]],12),phosphate,ONE,[Math.cos(a)*.013,0,0]);
  }
  tube(body,steel,.0155,.006,.004,0,barrelY,-.657);
  tube(body,phosphate,.0102,.005,.008,0,barrelY,-.656);

  // Folding stock: round hinge, one tapered comb rail and a diagonal lower
  // brace. Its cross-sections vary in every axis instead of extruding a plate.
  body.add(new THREE.CylinderGeometry(.015,.015,.080,32),phosphate,ONE,[.004,.029,.083]);
  for(const y of[-.006,.064])body.add(new THREE.CylinderGeometry(.016,.016,.006,32),steel,ONE,[.004,y,.083]);
  body.add(loft('stock-comb',[[.087,.043,.019,.019,.6],[.108,.046,.025,.023,.55],
    [.146,.047,.024,.024,.55],[.244,.040,.023,.024,.55],[.320,.032,.023,.023,.55],[.337,.026,.024,.019,.55]],32),polymer,ONE);
  body.add(loft('stock-brace',[[.099,.001,.015,.011,.65],[.116,-.006,.015,.012,.6],
    [.175,-.028,.014,.013,.6],[.268,-.067,.013,.014,.6],[.325,-.091,.016,.016,.55]],28),polymer,ONE);
  body.add(loft('stock-butt-core',[[.319,-.029,.023,.068,.55],[.331,-.029,.025,.073,.55],
    [.341,-.029,.026,.074,.55]],32),darkPolymer,ONE);
  body.add(loft('stock-rubber',[[.341,-.029,.026,.074,.55],[.349,-.029,.027,.074,.55],
    [.355,-.029,.026,.071,.55]],32),rubber,ONE);
  for(let i=0;i<12;i++)body.box(darkPolymer,.044,.0018,.0013,0,-.093+i*.011,.3555);
  body.box(phosphate,.009,.023,.019,.026,.027,.090);
  pin(body,edge,.032,.027,.090,.003,.002);
  body.add('ring',phosphate,[.009,.014,.012],[-.028,-.032,.310],[0,P/2,0]);

  // A swept magazine has a curved front and back and slightly bowed sidewalls.
  // Cartridge silhouettes sit inside the smoked polymer, with opaque feed lips
  // and reinforcement ribs providing depth cues instead of bright painted bars.
  // The magazine's long axis is Y; rotate the local Z sweep into that axis.
  const magazineGeometry=cached('magazine-body',()=>{
    const g=loft('magazine-sweep',[[-.248,.208,.023,.041,.52],[-.223,.198,.023,.043,.52],
      [-.183,.178,.023,.046,.52],[-.131,.161,.024,.048,.52],[-.077,.153,.024,.049,.52],[-.031,.151,.024,.048,.52]],36).clone();
    g.rotateX(-P/2);return g;
  });
  magazine.add(magazineGeometry,magazineSkin(),ONE);
  for(const side of[-1,1]) {
    for(const offset of[-.029,0,.029]) {
      const rib=loft(`mag-rib-${offset}`, [[-.246,.208+offset,.0016,.0015,.6],[-.223,.198+offset,.0019,.002,.6],
        [-.183,.178+offset,.0019,.002,.6],[-.131,.161+offset,.0019,.002,.6],[-.077,.153+offset,.0019,.002,.6],[-.044,.151+offset,.0016,.0015,.6]],12).clone();
      rib.rotateX(-P/2);magazine.add(rib,darkPolymer,ONE,[side*.024,0,0]);
    }
    for(const [y,z]of[[-.063,-.142],[-.096,-.149]]) {
      magazine.box(darkPolymer,.008,.015,.011,side*.028,y,z);
      pin(magazine,steel,side*.033,y,z,.0024,.001);
    }
  }
  // Base and feed-lip assemblies share the removable magazine transform.
  magazine.add(profile([[-.252,-.242],[-.249,-.253],[-.171,-.257],[-.165,-.245]],.052,.002),darkPolymer,ONE);
  for(const side of[-1,1])magazine.box(phosphate,.007,.019,.079,side*.021,-.033,-.151);
  for(let row=0;row<11;row++) {
    const y=-.045-row*.016,z=-.15-Math.pow(row/10,1.7)*.047;
    magazine.add(turned([[-.027,.0036],[-.020,.0046],[.019,.0046],[.027,.0022]],20),MAT.brass,ONE,[row%2?.006:-.006,y,z]);
  }
  // Magazine catch pivots behind the magwell.
  body.add(profile([[-.101,-.025],[-.096,-.054],[-.083,-.063],[-.077,-.057],[-.086,-.033]],.016,.002),phosphate,ONE);
  pin(body,steel,.030,-.027,-.094,.0037,.003);

  // Visible bolt face, charging-handle stem and knurled knob.
  slide.add(loft('bolt', [[-.199,.049,.021,.017,.5],[-.184,.049,.024,.018,.5],[-.084,.049,.024,.018,.5]],24),phosphate,ONE);
  slide.box(steel,.003,.008,.078,.025,.055,-.137);
  slide.add(new THREE.CylinderGeometry(.0045,.0045,.038,24),steel,ONE,[.044,.048,-.091],[0,0,P/2]);
  slide.add(new THREE.CylinderGeometry(.0085,.0085,.025,32),darkPolymer,ONE,[.071,.048,-.091],[0,0,P/2]);
  for(let i=0;i<9;i++) {
    const a=i*P*2/9;
    slide.box(phosphate,.023,.0012,.0012,.071,.048+Math.sin(a)*.0086,-.091+Math.cos(a)*.0086,0,0,0);
  }

  // Safety selector, receiver pins, spring-cover seam and sling fittings.
  for(const side of[-1,1]) {
    pin(body,phosphate,side*.030,-.004,.026,.0065,.003);
    body.add(profile([[.019,-.003],[.001,-.009],[-.002,-.015],[.003,-.018],[.028,-.009]],.003,.0008),steel,ONE,[side*.034,0,0]);
    for(const z of[.012,.030,.043])body.bead(edge,side*.034,.011,z,.0008);
    body.box(phosphate,.0015,.002,.167,side*.032,.074,-.144);
  }
  // Correct-width 21mm receiver rail with 10mm cross-slot spacing.
  body.add(profile([[-.250,.088],[-.245,.095],[-.029,.095],[-.024,.088]],.021,.001),phosphate,ONE);
  for(let i=0;i<22;i++) {
    const z=-.241+i*.0098;
    body.add(profile([[z-.0024,.095],[z-.0024,.101],[z+.0024,.101],[z+.0024,.095]],.0218,.0006),steel,ONE);
  }
  // Folded rear sight remains below the optics rather than blocking the lens.
  body.box(phosphate,.031,.006,.023,0,.087,.042);
  body.add(new THREE.CylinderGeometry(.009,.009,.021,24),steel,ONE,[0,.093,.042],[0,0,P/2]);
  stamp(body,'SABRE  SG',.0343,.029,-.228,.066);
  stamp(body,'SABRE  SG',-.0344,.035,-.183,.073);

  const model=body.build();model.add(slide.build('slide'),magazine.build('magazine'));
  const mountBase=.1016, type=w.optic||2;
  const optic=opticModel(type,mountBase+.040,-.116,false,mountBase);
  // Native Sabre magnification stays 2x in the simulation; only its physical
  // prism sight shares the new ACOG-style housing. Purchased ACOG remains 4x.
  if(!w.optic){
    optic.name='native_scope';optic.userData.nativeZoom=2;
    // The native 2x sight stays visible when aiming (unlike the purchased 4x
    // overlay), so it needs its own fine chevron with its tip on the bore aim.
    const shape=new THREE.Shape();
    shape.moveTo(0,0);shape.lineTo(-.0014,-.0016);shape.lineTo(-.0008,-.0016);
    shape.lineTo(0,-.00065);shape.lineTo(.0008,-.0016);shape.lineTo(.0014,-.0016);shape.closePath();
    const reticle=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({
      color:0xee4434,transparent:true,opacity:.9,depthTest:false,depthWrite:false,toneMapped:false,
    }));
    reticle.name='native_reticle';reticle.position.copy(optic.getObjectByName('optic_lens').position);
    reticle.position.z+=.0005;reticle.renderOrder=20;reticle.visible=false;optic.add(reticle);
  }
  model.add(optic);
  model.userData={authoredDetail:true,detailFamily:'sabre-swiss-rifle',
    muzzle:[0,barrelY,-.662],sightY:optic.userData.sightY??mountBase+.040,length:1.018,
    hip:[.185,-.164,-.49],adsZ:-.28,supportGrip:[-.024,.002,-.399]};
  return model;
}
