// Fixed-stock, carry-handle M16 with the early triangular handguard profile.
// Static details share material batches; magazine and carrier remain movable.
import * as THREE from '../vendor/three.module.min.js';
import { profile, hollowTube, turned, finish } from './weapon-detail.js';

let stock;
function furnitureGeometry() {
  if (!stock) {
    const s=new THREE.Shape();
    s.moveTo(.078,.038);s.lineTo(.419,.046);s.quadraticCurveTo(.437,.043,.437,.022);
    s.lineTo(.437,-.119);s.quadraticCurveTo(.43,-.127,.416,-.12);
    s.lineTo(.139,-.048);s.lineTo(.078,-.035);s.closePath();
    stock=new THREE.ExtrudeGeometry(s,{depth:.058,bevelEnabled:true,bevelSegments:3,bevelSize:.006,bevelThickness:.005,steps:1,curveSegments:8});
    stock.translate(0,0,-.029);stock.rotateY(-Math.PI/2);
  }
  return {stock};
}

export function buildM16(w,{Parts,MAT,mat,screw,opticModel,marking}) {
  const body=new Parts(), magazine=new Parts(), carrier=new Parts();
  const parkerized=finish('steel',0x58666b), dark=finish('blued',0x30383c), polymer=finish('polymer',0x333c39);
  const furniture=furnitureGeometry();
  // Forged receiver contours and a hollow upper. The right wall has a real
  // ejection cutout; the carrier is an independently animated part inside it.
  const upperOutline=[[-.228,.025],[-.224,.056],[-.203,.073],[.038,.073],[.062,.055],[.062,.025]];
  const port=[[-.127,.035],[-.127,.060],[-.024,.060],[-.016,.052],[-.016,.035]];
  body.add(profile(upperOutline,.007,.0012),parkerized,[1,1,1],[-.031,0,0]);
  body.add(profile(upperOutline,.007,.0012,[port]),parkerized,[1,1,1],[.031,0,0]);
  body.box(parkerized,.056,.010,.252,0,.069,-.083);
  body.box(dark,.052,.009,.254,0,.025,-.083);
  body.add(profile([[.063,.025],[-.22,.025],[-.219,-.062],[-.126,-.075],[-.114,-.026],[-.021,-.026],[.007,-.043],[.047,-.032]],.063,.003),parkerized,[1,1,1]);
  body.box(dark,.071,.004,.245,0,.025,-.075);
  body.add(profile([[-.219,-.049],[-.126,-.055],[-.125,-.073],[-.218,-.069]],.075,.0015),dark,[1,1,1]);
  for(const side of [-1,1]){
    for(const z of [-.204,.018])screw(body,side*.037,.005,z,.005);
    body.box(MAT.edge,.0015,.002,.085,side*.033,.018,-.071);
    body.add(profile([[-.206,-.004],[-.136,-.004],[-.133,-.039],[-.207,-.035]],.002,.001),dark,[1,1,1],[side*.033,0,0]);
    body.box(parkerized,.003,.004,.052,side*.036,-.009,-.17);
  }
  // Ejection port and hinged cover, charging latch, forward assist and selector.
  body.box(parkerized,.003,.027,.103,.036,.024,-.079,0,0,.22);
  body.box(dark,.008,.008,.105,.036,.011,-.079);
  body.add(profile([[-.014,.038],[-.012,.062],[.018,.066],[.033,.047],[.031,.030]],.020,.002),parkerized,[1,1,1],[.038,0,0]);
  body.add('cylinder',parkerized,[.011,.029,.011],[.049,.049,.018],[0,0,Math.PI/2]);
  body.box(dark,.072,.008,.022,0,.074,.051);
  body.box(MAT.edge,.025,.008,.008,-.033,.074,.054);
  body.box(dark,.004,.017,.024,-.037,.01,.027);
  body.box(parkerized,.007,.006,.032,-.041,.008,.015,0,.34);
  for(let i=0;i<3;i++)body.box(MAT.edge,.0015,.002,.006,-.045,.019-i*.009,.031);
  body.box(dark,.008,.021,.018,-.041,.012,-.123);

  // Sculpted A1 grip: narrow neck, flared heel and recessed side panels.
  const grip=[[-.010,-.029],[.037,-.025],[.073,-.150],[.064,-.172],[.013,-.167],[.004,-.139]];
  body.add(profile(grip,.045,.004),polymer,[1,1,1]);
  for(const side of [-1,1]){
    body.add(profile([[.013,-.064],[.036,-.061],[.060,-.146],[.023,-.151]],.002,.001),dark,[1,1,1],[side*.025,0,0]);
    for(let i=0;i<7;i++) body.box(polymer,.002,.003,.024,side*.027,-.139+i*.010,.039-i*.002,-.23);
  }
  body.add(profile([[-.091,-.027],[-.091,-.078],[-.074,-.095],[-.012,-.093],[.004,-.073],[.001,-.029]],.015,.0016,
    [[[-.079,-.037],[-.078,-.074],[-.067,-.083],[-.018,-.082],[-.008,-.070],[-.010,-.037]]]),dark,[1,1,1]);
  body.add(profile([[-.034,-.031],[-.039,-.049],[-.035,-.071],[-.027,-.077],[-.029,-.063],[-.027,-.043]],.008,.0008),parkerized,[1,1,1]);

  // Full black stock, buttplate texture and sling loop. No telescoping stock.
  body.add(furniture.stock,polymer,[1,1,1]);
  body.tube(dark,.025,.045,0,.011,.082);
  body.box(dark,.076,.171,.015,0,-.039,.447);
  for(let i=0;i<10;i++)body.box(parkerized,.065,.002,.002,0,-.113+i*.016,.456);
  for(const y of [-.094,.014])body.add('cylinder',MAT.edge,[.004,.002,.004],[0,y,.457],[Math.PI/2,0,0]);
  body.add('ring',dark,[.014,.022,.017],[0,-.11,.394],[0,Math.PI/2,0]);

  // Two tapered, beveled handguard shells. Vent holes are cut through the
  // surfaces so the barrel can be seen behind them, including in close reloads.
  const vents=[];
  for(let i=0;i<8;i++){
    const z=-.285-i*.042;
    vents.push([[z-.011,-.012],[z+.011,-.012],[z+.011,.004],[z-.011,.004]]);
  }
  for(const side of [-1,1]){
    const shell=profile([[-.638,-.028],[-.638,.028],[-.259,.035],[-.259,-.035]],.004,.0012,vents);
    shell.rotateZ(side*.42);shell.translate(side*.032,.027,0);
    const positions=shell.attributes.position;
    for(let i=0;i<positions.count;i++) positions.setX(i,positions.getX(i)*(.76+Math.max(0,Math.min(1,(positions.getZ(i)+.638)/.379))*.24));
    shell.computeVertexNormals();
    body.add(shell,polymer,[1,1,1]);
  }
  body.box(polymer,.044,.006,.368,0,-.007,-.449);
  body.box(polymer,.034,.007,.366,0,.062,-.45);
  for(const z of [-.235,-.244,-.253])body.add(hollowTube(.048,.020,.007),dark,[1,1,1],[0,.027,z]);
  body.add(hollowTube(.035,.016,.010),parkerized,[1,1,1],[0,.03,-.648]);
  // Turned barrel and a genuine open birdcage. No dark cylinder plugs its slots.
  body.add(turned([[-.883,.013],[-.870,.013],[-.858,.015],[-.681,.015],[-.675,.019],[-.658,.019],[-.653,.014],[-.235,.014]]),parkerized,[1,1,1],[0,.042,0]);
  body.add(hollowTube(.019,.009,.011),dark,[1,1,1],[0,.042,-.882]);
  body.add(hollowTube(.019,.010,.008),parkerized,[1,1,1],[0,.042,-.942]);
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3;
    body.box(dark,.006,.006,.055,Math.sin(a)*.016,.042+Math.cos(a)*.016,-.912,0,0,-a);
  }
  body.add(hollowTube(.013,.007,.019),dark,[1,1,1],[0,.042,-.888]);

  // Carry handle is genuinely open underneath, with rear windage wheel/aperture.
  body.add(profile([[.044,.060],[.039,.123],[-.143,.123],[-.159,.059],[-.139,.059],[-.125,.104],[.019,.104],[.024,.060]],.039,.002),parkerized,[1,1,1]);
  body.box(dark,.035,.003,.138,0,.126,-.049);
  body.add('cylinder',dark,[.015,.012,.015],[.028,.129,.026],[0,0,Math.PI/2]);
  for(let i=0;i<8;i++){
    const a=i*Math.PI/4;
    body.box(MAT.edge,.002,.003,.003,.035,.129+Math.cos(a)*.014,.026+Math.sin(a)*.014);
  }
  body.box(parkerized,.009,.018,.01,0,.135,.018);
  body.add('ring',dark,[.010,.010,.012],[0,.151,.018]);
  for(const side of [-1,1])body.box(parkerized,.007,.032,.016,side*.017,.14,.018);
  // The A-frame gas block and protective ears meet the same sight plane.
  body.box(dark,.035,.034,.048,0,.052,-.667);
  for(const side of [-1,1]){
    body.box(parkerized,.01,.086,.025,side*.016,.094,-.667,0,0,side*.24);
    body.box(dark,.007,.028,.015,side*.014,.148,-.668,0,0,-side*.24);
  }
  body.box(dark,.018,.01,.029,0,.129,-.667);
  body.box(MAT.edge,.0038,.018,.008,0,.141,-.667);
  body.box(parkerized,.014,.011,.027,0,.014,-.668);
  body.add('ring',dark,[.011,.016,.018],[0,.007,-.68],[0,Math.PI/2,0]);

  // A continuous curved STANAG profile with stamped ribs, spot-welded seam,
  // feed lips and follower. It remains a single separately animated magazine.
  const magOutline=[[-.207,-.047],[-.127,-.047],[-.124,-.135],[-.106,-.228],[-.095,-.251],[-.169,-.267],[-.188,-.224],[-.205,-.139]];
  magazine.add(profile(magOutline,.047,.002),parkerized,[1,1,1]);
  magazine.add(profile([[-.170,-.256],[-.095,-.241],[-.091,-.253],[-.171,-.270]],.053,.001),dark,[1,1,1]);
  for(const side of [-1,1])for(let i=0;i<3;i++){
    const z=-.193+i*.024;
    magazine.add(profile([[z,-.065],[z+.003,-.065],[z+.004,-.136],[z+.023,-.235],[z+.020,-.236],[z,-.138]],.0015,.0005),dark,[1,1,1],[side*.025,0,0]);
  }
  for(const side of [-1,1]) magazine.box(dark,.006,.009,.068,side*.019,-.047,-.167);
  magazine.tube(MAT.brass,.006,.051,0,-.043,-.167);
  carrier.add(profile([[-.129,.035],[-.129,.061],[-.032,.061],[-.026,.052],[-.026,.035]],.031,.001),parkerized,[1,1,1]);
  carrier.box(MAT.silver,.003,.013,.067,.018,.049,-.075);
  carrier.box(dark,.004,.005,.055,.020,.045,-.073);
  for(const z of [-.083,-.068,-.053]) carrier.bead(dark,.021,.049,z,.0022);
  marking({...w,name:'M16  ·  5.56'},body,.0371,-.006,-.058,.124);
  const model=body.build();model.add(magazine.build('magazine'),carrier.build('slide'));
  let sightY=.151;
  if(w.optic){
    sightY=w.optic===1?.215:.235;
    const mount=new Parts();mount.box(dark,.045,.015,.113,0,.139,-.064);
    model.add(mount.build('optic_mount'),opticModel(w.optic,sightY,-.064,false,.145));
  }
  model.userData={muzzle:[0,.042,-.95],sightY,length:1.41,hip:[.205,-.16,-.69],supportGrip:[-.025,.015,-.35],authoredDetail:true};
  return model;
}
