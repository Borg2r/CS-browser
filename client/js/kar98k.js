// A classic long bolt rifle. The stock is one continuous walnut profile and
// the military sights remain uncluttered until the player buys an optic.
import * as THREE from '../vendor/three.module.min.js';

let stockProfile;
function stockGeometry() {
  if (stockProfile) return stockProfile;
  // Shape is drawn as (forward, height), then extruded across the rifle's width.
  const s = new THREE.Shape();
  s.moveTo(-.345,.012);
  s.lineTo(-.205,.018); s.bezierCurveTo(-.151,.016,-.102,-.014,-.055,-.009);
  s.lineTo(.10,-.004); s.bezierCurveTo(.27,-.002,.56,-.003,.687,.006);
  s.quadraticCurveTo(.706,-.005,.695,-.031);
  s.lineTo(.325,-.052); s.quadraticCurveTo(.19,-.063,.052,-.059);
  s.bezierCurveTo(-.009,-.058,-.057,-.065,-.092,-.085);
  s.bezierCurveTo(-.133,-.11,-.164,-.119,-.205,-.122);
  s.lineTo(-.342,-.123); s.quadraticCurveTo(-.358,-.121,-.357,-.104);
  s.lineTo(-.358,-.008); s.quadraticCurveTo(-.356,.01,-.345,.012);s.closePath();
  const g = new THREE.ExtrudeGeometry(s,{depth:.064,bevelEnabled:true,bevelSegments:3,bevelSize:.006,bevelThickness:.005,steps:1,curveSegments:14});
  g.translate(0,0,-.032);g.rotateY(Math.PI/2);stockProfile=g;
  return g;
}

export function buildKar98k(w, { Parts, MAT, mat, walnutFinish, screw, opticModel, marking }) {
  const body=new Parts(), bolt=new Parts(), handle=new Parts();
  const wood=walnutFinish(), blued=mat(0x465158,.5,.38), worn=mat(0x8a9391,.55,.36);
  body.add(stockGeometry(),wood,[1,1,1]);
  // Slim top handguard, rising just above the wood while leaving the receiver bare.
  body.add('sphere',wood,[.035,.019,.221],[0,.013,-.455]);
  body.box(wood,.066,.022,.39,0,.009,-.457);
  body.tube(blued,.028,.257,0,.05,-.104);
  body.tube(worn,.030,.033,0,.05,-.248);
  body.tube(blued,.015,.653,0,.05,-.574);
  body.tube(worn,.0164,.012,0,.05,-.899);
  body.tube(MAT.black,.0105,.016,0,.05,-.909);
  // Receiver opening, long extractor, shroud and flag safety.
  body.box(MAT.black,.057,.015,.121,0,.071,-.08);
  for(const side of [-1,1]){
    body.box(blued,.006,.018,.128,side*.029,.058,-.078);
    body.box(worn,.003,.003,.119,side*.033,.068,-.079);
    for(const z of [-.237,-.015])screw(body,side*.036,-.021,z,.004);
    body.box(blued,.002,.003,.114,side*.033,-.017,-.135);
  }
  body.tube(blued,.029,.032,0,.05,.04);
  body.box(worn,.013,.036,.008,0,.075,.059,0,0,-.22);
  body.box(blued,.025,.006,.011,.004,.092,.059,0,0,-.22);
  // Flush internal magazine floorplate and a proper rounded trigger guard.
  body.box(blued,.051,.009,.142,0,-.063,-.132);
  for(const z of [-.19,-.077])body.add('cylinder',worn,[.004,.002,.004],[0,-.069,z]);
  body.add('ring',blued,[.042,.027,.031],[0,-.081,.001],[0,Math.PI/2,0]);
  body.box(blued,.011,.035,.009,0,-.062,-.005,-.32);
  body.box(worn,.009,.022,.006,0,-.069,-.007,-.4);
  // The barrel bands, band spring and nose-cap distinguish the full military stock.
  for(const [z,width] of [[-.427,.016],[-.672,.022]]){
    body.box(blued,.075,.006,width,0,-.047,z);
    for(const side of [-1,1])body.box(blued,.007,.064,width,side*.036,-.016,z);
    body.box(blued,.075,.007,width,0,.018,z);
    screw(body,.041,-.009,z,.003);
  }
  body.box(worn,.002,.006,.153,.035,-.017,-.556);
  body.box(blued,.017,.014,.067,0,-.047,-.716);
  body.tube(worn,.0028,.274,0,-.043,-.721); // Cleaning rod under the exposed muzzle.
  // Steel buttplate follows the edge of the continuous wood stock.
  body.box(blued,.077,.137,.012,0,-.052,.36);
  body.box(worn,.079,.006,.015,0,.012,.361);
  for(const y of [-.092,-.013])body.add('cylinder',worn,[.004,.003,.004],[0,y,.368],[Math.PI/2,0,0]);
  // Sling hardware and the inset bolt-disassembly disc are machined into the stock.
  body.add('ring',blued,[.013,.025,.018],[-.042,-.022,.24],[0,Math.PI/2,0]);
  body.add('ring',blued,[.011,.018,.018],[-.044,-.026,-.427],[0,Math.PI/2,0]);
  for(const side of [-1,1]){
    body.add('cylinder',worn,[.014,.002,.014],[side*.039,-.054,.263],[0,0,Math.PI/2]);
    body.add('cylinder',MAT.black,[.006,.0025,.006],[side*.041,-.054,.263],[0,0,Math.PI/2]);
    body.box(blued,.002,.016,.039,side*.037,-.045,.191);
    body.box(MAT.black,.0025,.009,.029,side*.039,-.045,.191);
  }
  // Tangent sight with a fine central V notch. There is no factory rail or scope.
  body.box(blued,.033,.009,.112,0,.081,-.291,-.045);
  body.box(worn,.021,.003,.081,0,.087,-.295,-.045);
  for(let i=0;i<7;i++)for(const side of [-1,1])body.box(MAT.black,.008,.0018,.0015,side*.009,.09,-.327+i*.008);
  body.box(blued,.043,.011,.016,0,.091,-.246);
  for(const side of [-1,1]){
    body.box(worn,.015,.012,.008,side*.0115,.105,-.226);
    body.box(blued,.006,.009,.009,side*.019,.109,-.226);
  }
  body.box(blued,.027,.019,.031,0,.076,-.847);
  body.box(worn,.004,.021,.008,0,.1015,-.852);
  body.add('ring',blued,[.022,.022,.018],[0,.113,-.852]);
  // A bent-down bolt handle lifts before the action slides rearward.
  bolt.tube(MAT.silver,.022,.186,0,.05,-.067);
  bolt.box(worn,.008,.009,.159,.019,.065,-.065);
  bolt.tube(blued,.027,.028,0,.05,.036);
  handle.box(blued,.051,.013,.013,.026,-.004,0,0,0,-.2);
  handle.box(blued,.016,.042,.013,.051,-.026,0,0,0,-.2);
  handle.add('sphere',blued,[.019,.018,.019],[.057,-.05,0]);
  handle.add('sphere',worn,[.008,.006,.009],[.059,-.046,.011]);
  const action=bolt.build('bolt_action'), lever=handle.build('bolt_handle');
  lever.position.set(0,.05,.036);action.add(lever);
  const model=body.build();model.add(action);
  let sightY=.113;
  if(w.optic){
    sightY=w.optic===1?.15:.17;
    const mount=new Parts();mount.box(blued,.043,.012,.118,0,.083,-.103);
    for(const z of [-.143,-.067])mount.box(blued,.011,.037,.015,-.032,.064,z);
    model.add(mount.build('optic_mount'),opticModel(w.optic,sightY,-.103));
  }
  // Markings are baked separately because the action is already assembled.
  const stamp=new Parts();marking({...w,name:'KAR98K  ·  7.92'},stamp,.0331,.043,-.164,.115);model.add(stamp.build());
  model.userData={muzzle:[0,.05,-.918],sightY,length:1.29,boltAction:true,boltTravel:.132,hip:[.205,-.155,-.64]};
  return model;
}
