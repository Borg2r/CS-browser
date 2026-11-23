// Original M14 silhouette: continuous walnut furniture, exposed receiver and
// gas-operated action. Only the bolt/operating rod and magazine move.
import * as THREE from '../vendor/three.module.min.js';
import { profile, hollowTube, turned, finish } from './weapon-detail.js';

let stockProfile;
function stockGeometry() {
  if (stockProfile) return stockProfile;
  const s = new THREE.Shape();
  // X is distance forward; rotate the extrusion onto the weapon's Z axis.
  s.moveTo(-.368, .009);
  s.lineTo(-.229, .017);
  s.bezierCurveTo(-.173, .017, -.145, -.003, -.111, -.013);
  s.quadraticCurveTo(-.061, -.021, .002, -.009);
  s.lineTo(.182, -.005);
  s.bezierCurveTo(.301, -.006, .492, -.009, .602, -.002);
  s.quadraticCurveTo(.623, -.006, .619, -.031);
  s.lineTo(.398, -.055);
  s.quadraticCurveTo(.278, -.070, .171, -.065);
  s.lineTo(.045, -.066);
  s.quadraticCurveTo(-.012, -.070, -.048, -.091);
  // The short pistol-grip wrist blends into the long raised stock comb.
  s.bezierCurveTo(-.078, -.112, -.089, -.144, -.116, -.144);
  s.quadraticCurveTo(-.137, -.141, -.158, -.113);
  s.quadraticCurveTo(-.196, -.128, -.243, -.137);
  s.lineTo(-.366, -.141);
  s.quadraticCurveTo(-.382, -.139, -.382, -.119);
  s.lineTo(-.382, -.009);
  s.quadraticCurveTo(-.382, .006, -.368, .009);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth:.066, bevelEnabled:true, bevelSegments:3, bevelSize:.006,
    bevelThickness:.005, steps:1, curveSegments:14,
  });
  g.translate(0, 0, -.033); g.rotateY(Math.PI / 2);
  return stockProfile = g;
}

export function buildM14(w, { Parts, MAT, mat, screw, opticModel, marking }) {
  const body = new Parts(), magazine = new Parts(), action = new Parts();
  const wood = finish('wood',0x805234), steel = finish('steel',0x48585c);
  const phosphate = finish('blued',0x303b3c), worn = finish('steel',0x7d8987);
  const handguard = finish('polymer',0x573e2e);
  body.add(stockGeometry(), wood, [1,1,1]);

  // Machined receiver sidewalls and an open top above the actual bolt. The
  // visible opening continues into the magazine well when the bolt retracts.
  const receiver=[[-.209,.007],[-.210,.052],[-.194,.069],[-.020,.069],[.015,.052],[.056,.051],[.056,.008]];
  for (const side of [-1,1]) {
    body.add(profile(receiver,.008,.0015),steel,[1,1,1],[side*.034,0,0]);
    body.box(worn,.0018,.003,.160,side*.039,.067,-.091);
    for (const z of [-.182,-.022]) screw(body,side*.041,.015,z,.004);
    body.add(profile([[-.19,.009],[-.039,.009],[-.029,-.016],[-.189,-.016]],.002,.001),phosphate,[1,1,1],[side*.038,0,0]);
  }
  body.box(phosphate,.060,.010,.220,0,.006,-.081);
  body.add(turned([[-.235,.030],[-.220,.030],[-.215,.027],[-.199,.027]]),steel,[1,1,1],[0,.043,0]);
  body.add(profile([[.013,.008],[.013,.056],[.025,.067],[.055,.067],[.063,.047],[.061,.008]],.060,.002),phosphate,[1,1,1]);

  // The fiberglass upper handguard has open side vents under a rounded crown.
  // Barrel machining remains visible through the vents and ahead of the wood.
  body.add(turned([[-.889,.014],[-.864,.014],[-.859,.0155],[-.612,.0155],[-.604,.018],[-.592,.018],[-.574,.015],[-.229,.015]]),steel,[1,1,1],[0,.044,0]);
  const vents=[];
  for(let i=0;i<9;i++){
    const z=-.548+i*.035;
    vents.push([[z-.010,.025],[z+.010,.025],[z+.010,.036],[z-.010,.036]]);
  }
  for(const side of [-1,1]) body.add(profile([[-.584,.017],[-.584,.043],[-.238,.043],[-.238,.017]],.004,.001,vents),handguard,[1,1,1],[side*.031,0,0]);
  const crown=new THREE.Shape();
  crown.absellipse(0,0,.034,.023,0,Math.PI,false,0);
  crown.lineTo(-.030,0);crown.absellipse(0,0,.030,.019,Math.PI,0,true,0);crown.closePath();
  const crownGeometry=new THREE.ExtrudeGeometry(crown,{depth:.346,bevelEnabled:false,curveSegments:16,steps:1});
  body.add(crownGeometry,handguard,[1,1,1],[0,.043,-.584]);
  // Barrel band, front ferrule and exposed gas-cylinder assembly underneath.
  for (const z of [-.248,-.595]) {
    body.box(phosphate,.078,.007,.019,0,-.049,z);
    for (const side of [-1,1]) body.box(phosphate,.007,.080,.019,side*.036,-.01,z);
    body.box(steel,.077,.007,.019,0,.027,z);
    screw(body,.042,-.012,z,.0035);
  }
  body.tube(phosphate,.017,.221,0,-.003,-.718);
  body.tube(worn,.0185,.019,0,-.003,-.824);
  body.tube(steel,.010,.144,0,-.004,-.593);
  body.box(phosphate,.033,.044,.028,0,.016,-.795);
  body.box(steel,.027,.020,.023,0,-.023,-.796);
  body.add('ring',steel,[.010,.014,.018],[0,-.03,-.603],[Math.PI/2,0,0]);

  // Open six-slot flash suppressor: end collars and thin webs surround a
  // genuine bore. The visible void also reads correctly in dropped/world guns.
  body.add(hollowTube(.0185,.008,.029),phosphate,[1,1,1],[0,.044,-.879]);
  for (let i=0;i<6;i++) {
    const a=i*Math.PI/3;
    body.box(steel,.0045,.0045,.065,Math.cos(a)*.0165,.044+Math.sin(a)*.0165,-.916,0,0,a);
  }
  body.add(hollowTube(.019,.011,.008),worn,[1,1,1],[0,.044,-.950]);

  // Pressed twenty-round steel magazine: rolled shoulder, recessed stampings,
  // folded floorplate and separate feed lips, all carried by the reload group.
  magazine.add(profile([[-.192,-.046],[-.079,-.046],[-.075,-.211],[-.083,-.223],[-.187,-.228],[-.193,-.215]],.061,.003),phosphate,[1,1,1]);
  magazine.add(profile([[-.193,-.218],[-.076,-.214],[-.076,-.227],[-.193,-.232]],.070,.001),steel,[1,1,1]);
  for (const side of [-1,1]) {
    magazine.add(profile([[-.176,-.075],[-.093,-.075],[-.090,-.201],[-.176,-.205]],.0015,.001),steel,[1,1,1],[side*.033,0,0]);
    for (const z of [-.166,-.127,-.091]) magazine.box(phosphate,.002,.115,.004,side*.035,-.139,z);
    magazine.box(worn,.0015,.003,.085,side*.033,-.063,-.135);
    magazine.box(phosphate,.008,.012,.085,side*.023,-.046,-.135);
  }
  magazine.tube(MAT.brass,.007,.076,0,-.044,-.132);
  body.add(profile([[-.201,-.043],[-.071,-.043],[-.068,-.061],[-.201,-.061]],.076,.002),phosphate,[1,1,1]);
  body.box(steel,.019,.038,.012,0,-.075,-.066,-.3);

  // Forged trigger guard with an actual opening and an inward-curving trigger.
  body.add(profile([[-.035,-.047],[-.036,-.092],[-.021,-.115],[.046,-.113],[.061,-.092],[.060,-.048]],.018,.002,
    [[[-.024,-.058],[-.024,-.089],[-.014,-.103],[.039,-.102],[.049,-.087],[.049,-.058]]]),phosphate,[1,1,1]);
  body.add(profile([[.010,-.047],[.003,-.062],[.006,-.084],[.018,-.092],[.020,-.086],[.014,-.076],[.014,-.055]],.009,.001),worn,[1,1,1]);
  body.box(steel,.014,.029,.008,0,-.065,-.028,.35);
  body.box(phosphate,.042,.006,.079,0,-.052,.02);

  // Hinged steel buttplate, sling fittings and stock screws.
  body.box(phosphate,.079,.154,.014,0,-.065,.385);
  body.box(worn,.081,.007,.015,0,.008,.388);
  body.box(steel,.083,.010,.018,0,-.137,.388);
  for (const y of [-.112,-.017]) body.add('cylinder',worn,[.004,.003,.004],[0,y,.395],[Math.PI/2,0,0]);
  for (let i=0;i<7;i++) body.box(steel,.072,.003,.002,0,-.116+i*.016,.395);
  body.add('ring',steel,[.013,.023,.018],[-.044,-.047,.282],[0,Math.PI/2,0]);
  body.add('ring',steel,[.011,.021,.018],[-.046,-.032,-.596],[0,Math.PI/2,0]);
  for (const side of [-1,1]) {
    screw(body,side*.04,-.041,.12,.005);
    body.box(phosphate,.0025,.015,.037,side*.039,-.065,.277);
    body.box(MAT.black,.003,.008,.027,side*.041,-.065,.277);
  }

  // Rear aperture and protected front blade share the exact sight height.
  const ironY=.145;
  body.box(phosphate,.064,.045,.044,0,.085,.035);
  for (const side of [-1,1]) {
    body.add('cylinder',steel,[.018,.011,.018],[side*.038,.088,.035],[0,0,Math.PI/2]);
    for (let i=0;i<8;i++) {
      const a=i*Math.PI/4;
      body.box(worn,.003,.003,.004,side*.045,.088+Math.sin(a)*.017,.035+Math.cos(a)*.017);
    }
    body.box(phosphate,.009,.032,.018,side*.022,.119,.039);
  }
  body.box(steel,.013,.034,.009,0,.120,.047);
  body.add('ring',phosphate,[.0105,.0105,.009],[0,ironY,.047]);
  body.box(phosphate,.034,.056,.037,0,.088,-.834);
  body.box(steel,.038,.008,.038,0,.116,-.834);
  body.box(worn,.004,.039,.009,0,ironY-.0195,-.837);
  for (const side of [-1,1]) body.box(steel,.007,.039,.016,side*.015,.138,-.836,0,0,-side*.19);

  // Visible bolt and operating rod reciprocate with each semi-auto shot.
  action.add(profile([[-.133,.048],[-.133,.071],[-.122,.080],[-.040,.080],[-.029,.064],[-.029,.048]],.052,.0015),worn,[1,1,1]);
  action.add(profile([[-.132,.072],[-.132,.086],[-.048,.086],[-.038,.077]],.016,.001),steel,[1,1,1],[-.013,0,0]);
  action.box(phosphate,.003,.005,.035,.028,.063,-.071);
  action.box(phosphate,.013,.017,.210,.043,.042,-.160);
  action.box(steel,.042,.014,.023,.058,.048,-.041,0,0,-.12);
  action.add('sphere',phosphate,[.017,.011,.018],[.079,.043,-.04]);
  action.box(worn,.004,.006,.137,.05,.053,-.16);

  const model=body.build(); model.add(magazine.build('magazine'),action.build('slide'));
  let sightY=ironY;
  if(w.optic) {
    sightY=w.optic===1?.205:.22;
    const mount=new Parts();
    // A side-mounted bridge clears the operating action and rear iron sight.
    mount.box(phosphate,.012,.064,.132,-.046,.085,-.068);
    mount.box(steel,.082,.010,.132,-.012,.115,-.068);
    for(const z of [-.112,-.023]) screw(mount,-.054,.067,z,.0045);
    model.add(mount.build('optic_mount'),opticModel(w.optic,sightY,-.095,false,.120));
  }
  const stamp=new Parts();
  marking({...w,name:'M14  ·  7.62'},stamp,.0415,.023,-.103,.13);
  model.add(stamp.build());
  model.userData={muzzle:[0,.044,-.963],sightY,length:1.36,hip:[.215,-.165,-.68],supportGrip:[-.025,.012,-.35],authoredDetail:true};
  return model;
}
