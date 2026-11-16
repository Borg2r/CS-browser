// Fixed-stock, carry-handle M16 with the early triangular handguard profile.
// Static details share material batches; magazine and carrier remain movable.
import * as THREE from '../vendor/three.module.min.js';

let stock, handguard;
function furnitureGeometry() {
  if (!stock) {
    const s=new THREE.Shape();
    s.moveTo(.078,.038);s.lineTo(.419,.046);s.quadraticCurveTo(.437,.043,.437,.022);
    s.lineTo(.437,-.119);s.quadraticCurveTo(.43,-.127,.416,-.12);
    s.lineTo(.139,-.048);s.lineTo(.078,-.035);s.closePath();
    stock=new THREE.ExtrudeGeometry(s,{depth:.058,bevelEnabled:true,bevelSegments:3,bevelSize:.006,bevelThickness:.005,steps:1,curveSegments:8});
    stock.translate(0,0,-.029);stock.rotateY(-Math.PI/2);
    handguard=new THREE.CylinderGeometry(.05,.035,.39,3,1,false,Math.PI);
    handguard.rotateX(Math.PI/2);
  }
  return {stock,handguard};
}

export function buildM16(w,{Parts,MAT,mat,screw,opticModel,marking}) {
  const body=new Parts(), magazine=new Parts(), carrier=new Parts();
  const parkerized=mat(0x55626a,.52,.42), dark=mat(0x2d373c,.35,.47), polymer=mat(0x343e3e,.08,.66);
  const furniture=furnitureGeometry();
  // Rounded upper, flat-sided lower, flared magazine well and receiver seam.
  body.tube(parkerized,.033,.285,0,.041,-.08);
  body.box(parkerized,.068,.069,.241,0,.002,-.071);
  body.box(dark,.071,.008,.25,0,.033,-.075);
  body.box(parkerized,.073,.071,.093,0,-.035,-.17,-.055);
  body.box(dark,.079,.009,.102,0,-.07,-.168,-.055);
  for(const side of [-1,1]){
    for(const z of [-.204,.018])screw(body,side*.037,.005,z,.005);
    body.box(MAT.edge,.002,.003,.105,side*.035,.019,-.1);
    body.box(dark,.003,.005,.041,side*.037,-.046,-.17);
  }
  // Ejection port and hinged cover, charging latch, forward assist and selector.
  body.box(MAT.black,.003,.025,.105,.033,.046,-.079);
  body.box(parkerized,.003,.027,.103,.036,.024,-.079,0,0,.22);
  body.box(dark,.008,.008,.105,.036,.011,-.079);
  body.box(dark,.015,.027,.028,.041,.04,.003,0,-.35);
  body.add('cylinder',parkerized,[.011,.029,.011],[.049,.049,.018],[0,0,Math.PI/2]);
  body.box(dark,.072,.008,.022,0,.074,.051);
  body.box(MAT.edge,.025,.008,.008,-.033,.074,.054);
  body.box(dark,.004,.017,.024,-.037,.01,.027);
  body.box(parkerized,.007,.006,.032,-.041,.008,.015,0,.34);
  for(let i=0;i<3;i++)body.box(MAT.edge,.0015,.002,.006,-.045,.019-i*.009,.031);
  body.box(dark,.008,.021,.018,-.041,.012,-.123);

  // Separate pistol grip with molded ribs and a rounded trigger guard.
  body.box(polymer,.05,.14,.061,0,-.103,.036,-.23);
  for(let i=0;i<6;i++)for(const side of [-1,1]){
    body.box(dark,.002,.003,.039,side*.026,-.155+i*.018,.046,-.23);
  }
  body.box(dark,.054,.008,.067,0,-.17,.052,-.23);
  body.add('ring',dark,[.045,.026,.025],[0,-.074,-.04],[0,Math.PI/2,0]);
  body.box(MAT.edge,.008,.033,.01,0,-.062,-.042,-.24);

  // Full black stock, buttplate texture and sling loop. No telescoping stock.
  body.add(furniture.stock,polymer,[1,1,1]);
  body.tube(dark,.025,.045,0,.011,.082);
  body.box(dark,.076,.171,.015,0,-.039,.447);
  for(let i=0;i<10;i++)body.box(parkerized,.065,.002,.002,0,-.113+i*.016,.456);
  for(const y of [-.094,.014])body.add('cylinder',MAT.edge,[.004,.002,.004],[0,y,.457],[Math.PI/2,0,0]);
  body.add('ring',dark,[.014,.022,.017],[0,-.11,.394],[0,Math.PI/2,0]);

  // Triangular handguard, cap and delta ring. Vent slots follow its taper.
  body.add(furniture.handguard,polymer,[1,1,1],[0,.026,-.447]);
  for(const z of [-.235,-.244,-.253])body.tube(dark,.048,.007,0,.027,z);
  body.tube(parkerized,.035,.01,0,.03,-.648);
  for(let i=0;i<8;i++){
    const z=-.285-i*.044,half=.041-i*.0015;
    for(const side of [-1,1])body.box(MAT.black,.0025,.012,.022,side*half,.006,z,0,0,side*.45);
    body.box(dark,.012,.002,.017,0,.072-i*.0017,z);
  }
  // Exposed barrel and birdcage flash hider with individual open-looking slots.
  body.tube(parkerized,.014,.667,0,.042,-.558);
  body.tube(dark,.017,.022,0,.042,-.664);
  body.tube(dark,.019,.058,0,.042,-.912);
  for(const z of [-.884,-.939])body.add('ring',MAT.edge,[.018,.018,.022],[0,.042,z]);
  for(let i=0;i<5;i++){
    const a=i*Math.PI*2/5;
    body.box(MAT.black,.006,.003,.034,Math.sin(a)*.019,.042+Math.cos(a)*.019,-.913,0,0,-a);
  }
  body.tube(MAT.black,.010,.008,0,.042,-.945);

  // Carry handle is genuinely open underneath, with rear windage wheel/aperture.
  body.box(parkerized,.043,.014,.173,0,.117,-.05);
  for(const [z,height,y] of [[.025,.051,.088],[-.137,.055,.087]]){
    body.box(parkerized,.043,height,.021,0,y,z, z>0?.12:-.16);
  }
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

  // Ribbed thirty-round magazine, slight forward curve and separate feed lips.
  magazine.box(parkerized,.049,.122,.077,0,-.113,-.167,-.075);
  magazine.box(parkerized,.049,.092,.076,0,-.207,-.147,-.28);
  magazine.box(dark,.055,.012,.083,0,-.253,-.132,-.28);
  for(const side of [-1,1])for(let i=0;i<3;i++){
    magazine.box(dark,.002,.112,.005,side*.026,-.112,-.192+i*.024,-.075);
    magazine.box(dark,.002,.069,.005,side*.026,-.209,-.173+i*.024,-.28);
  }
  magazine.box(MAT.brass,.022,.005,.055,0,-.048,-.167);
  carrier.box(MAT.silver,.003,.016,.071,.035,.049,-.075);
  carrier.box(dark,.004,.005,.06,.037,.045,-.071);
  marking({...w,name:'M16  ·  5.56'},body,.0371,-.006,-.058,.124);
  const model=body.build();model.add(magazine.build('magazine'),carrier.build('slide'));
  let sightY=.151;
  if(w.optic){
    sightY=w.optic===1?.215:.235;
    const mount=new Parts();mount.box(dark,.045,.015,.113,0,.139,-.064);
    model.add(mount.build('optic_mount'),opticModel(w.optic,sightY,-.064,false,.145));
  }
  model.userData={muzzle:[0,.042,-.95],sightY,length:1.41,hip:[.205,-.16,-.69]};
  return model;
}
