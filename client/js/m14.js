// Original M14 silhouette: continuous walnut furniture, exposed receiver and
// gas-operated action. Only the bolt/operating rod and magazine move.
import * as THREE from '../vendor/three.module.min.js';

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

export function buildM14(w, { Parts, MAT, mat, walnutFinish, screw, opticModel, marking }) {
  const body = new Parts(), magazine = new Parts(), action = new Parts();
  const wood = walnutFinish(), steel = mat(0x435057,.48,.43);
  const phosphate = mat(0x2c393d,.32,.53), worn = mat(0x85918f,.51,.36);
  const handguard = mat(0x674836,.12,.62);
  body.add(stockGeometry(), wood, [1,1,1]);

  // Open-top receiver. Thin sidewalls keep the sliding bolt visible.
  body.box(phosphate,.073,.051,.227,0,.023,-.089);
  body.box(MAT.black,.061,.011,.161,0,.053,-.079);
  for (const side of [-1,1]) {
    body.box(steel,.009,.033,.187,side*.035,.052,-.084);
    body.box(worn,.003,.004,.176,side*.04,.068,-.084);
    for (const z of [-.182,-.022]) screw(body,side*.041,.015,z,.004);
    body.box(phosphate,.003,.010,.112,side*.04,-.014,-.115);
  }
  body.tube(steel,.031,.036,0,.043,-.215);
  body.box(phosphate,.065,.048,.040,0,.036,.038);
  body.box(steel,.055,.009,.043,0,.067,.037);

  // Long ventilated upper handguard over the barrel, separate from the stock.
  body.tube(steel,.0148,.673,0,.044,-.554);
  body.add('sphere',handguard,[.035,.028,.187],[0,.031,-.407]);
  body.box(handguard,.060,.029,.345,0,.03,-.411);
  for (const side of [-1,1]) {
    for (let i=0;i<9;i++) {
      const z=-.548+i*.035;
      body.box(MAT.black,.004,.009,.018,side*.031,.032,z);
      body.box(worn,.002,.002,.018,side*.033,.024,z);
    }
  }
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

  // Slotted flash suppressor with a muzzle opening and thin separating webs.
  body.tube(phosphate,.0185,.029,0,.044,-.879);
  body.tube(MAT.black,.0116,.076,0,.044,-.914);
  for (let i=0;i<6;i++) {
    const a=i*Math.PI/3;
    body.box(steel,.005,.005,.065,Math.cos(a)*.018,.044+Math.sin(a)*.018,-.916,0,0,a);
  }
  body.tube(worn,.019,.008,0,.044,-.95);
  body.tube(MAT.black,.0122,.010,0,.044,-.957);

  // Twenty-round box magazine: independent so reloads can lower it from the well.
  magazine.box(phosphate,.067,.170,.116,0,-.141,-.135,.055);
  magazine.box(steel,.073,.012,.123,0,-.225,-.13,.055);
  for (const side of [-1,1]) {
    for (const z of [-.175,-.127,-.079]) magazine.box(steel,.003,.131,.007,side*.035,-.137,z,.055);
    magazine.box(worn,.002,.004,.085,side*.037,-.063,-.135,.055);
  }
  magazine.tube(MAT.brass,.009,.076,0,-.048,-.132);
  body.box(phosphate,.080,.018,.132,0,-.052,-.135);
  body.box(steel,.019,.038,.012,0,-.075,-.066,-.3);

  // Rounded trigger guard and the safety inside its front edge.
  body.add('ring',phosphate,[.048,.031,.029],[0,-.085,.016],[0,Math.PI/2,0]);
  body.box(worn,.009,.030,.009,0,-.073,.009,-.3);
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
  action.box(worn,.052,.023,.104,0,.067,-.077);
  action.box(steel,.020,.009,.111,-.014,.084,-.079);
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
  model.userData={muzzle:[0,.044,-.963],sightY,length:1.36,hip:[.215,-.165,-.68]};
  return model;
}
