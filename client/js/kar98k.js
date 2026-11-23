// A classic long bolt rifle. The stock is one continuous walnut profile and
// the military sights remain uncluttered until the player buys an optic.
import * as THREE from '../vendor/three.module.min.js';
import { profile, hollowTube, turned, finish } from './weapon-detail.js';

let stockProfile;
function stockGeometry() {
  if (stockProfile) return stockProfile;
  // Variable-width elliptical sections give the walnut a rounded comb, a
  // narrow wrist and a tapered fore-end; UVs follow the long grain direction.
  const sections=[[-.704,.023,-.031,.009],[-.685,.029,-.038,.012],
    [-.57,.031,-.044,.008],[-.43,.033,-.048,.005],[-.29,.034,-.055,.003],
    [-.15,.035,-.061,.002],[-.035,.032,-.058,-.004],[.035,.026,-.072,-.012],
    [.085,.024,-.09,-.009],[.138,.029,-.109,.005],[.202,.036,-.121,.018],
    [.29,.038,-.124,.017],[.347,.036,-.123,.012],[.358,.033,-.118,.006]];
  const p=[],uv=[],idx=[],n=20;
  for(let i=0;i<sections.length;i++){
    const [z,width,lo,hi]=sections[i];
    for(let j=0;j<=n;j++){
      const a=j*2*Math.PI/n,c=Math.cos(a),t=Math.sin(a);
      p.push(Math.sign(c)*Math.pow(Math.abs(c),.72)*width,
        (lo+hi)/2+Math.sign(t)*Math.pow(Math.abs(t),.84)*(hi-lo)/2,z);
      uv.push((z+.704)/1.062,j/n);
    }
  }
  for(let i=0;i<sections.length-1;i++)for(let j=0;j<n;j++){
    const a=i*(n+1)+j,b=a+n+1;idx.push(a,a+1,b,b,a+1,b+1);
  }
  // End caps sit below the nose ferrule and buttplate.
  for(const i of [0,sections.length-1]){
    const [z,,lo,hi]=sections[i],k=p.length/3;p.push(0,(lo+hi)/2,z);uv.push(i?1:0,.5);
    for(let j=0;j<n;j++){const a=i*(n+1)+j;if(i)idx.push(k,a,a+1);else idx.push(k,a+1,a);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
  return stockProfile=g;
}

export function buildKar98k(w, { Parts, MAT, mat, screw, opticModel, marking }) {
  const body=new Parts(), bolt=new Parts(), handle=new Parts();
  const wood=finish('wood',0x795036), blued=finish('blued',0x3b474d), worn=finish('steel',0x8a9391);
  const bright=finish('stainless',0xb8bfba);
  body.add(stockGeometry(),wood,[1,1,1]);
  // Rounded wooden handguard and the exposed taper of the military barrel.
  body.add(turned([[-.669,.026],[-.643,.034],[-.32,.034],[-.265,.027]]),wood,[1,.5,1],[0,.014,0]);
  body.add(turned([[-.882,.014],[-.70,.0148],[-.43,.017],[-.263,.021]]),blued,[1,1,1],[0,.05,0]);
  body.add(hollowTube(.0148,.0053,.038),blued,[1,1,1],[0,.05,-.901]);
  body.add(hollowTube(.0155,.006,.004),worn,[1,1,1],[0,.05,-.919]);
  // Two receiver rings and thin side rails leave the loading/ejection opening
  // genuinely open above the bolt, including while it travels rearward.
  body.add(hollowTube(.031,.022,.072),blued,[1,1,1],[0,.05,-.226]);
  body.add(hollowTube(.030,.022,.031),blued,[1,1,1],[0,.05,.016]);
  body.add(profile([[-.194,.025],[-.194,.006],[.031,.006],[.031,.026]],.052,.001),blued,[1,1,1]);
  for(const side of [-1,1]){
    body.add(profile([[-.195,.023],[-.195,.056],[-.175,.059],[-.164,.031],
      [-.025,.031],[-.013,.054],[.008,.055],[.008,.02]],.006,.001),blued,[1,1,1],[side*.027,0,0]);
    body.box(worn,.002,.003,.129,side*.031,.032,-.093);
    for(const z of [-.237,-.015])screw(body,side*.036,-.021,z,.004);
    body.box(blued,.002,.003,.114,side*.033,-.017,-.135);
  }
  body.tube(blued,.029,.032,0,.05,.04);
  body.box(worn,.013,.036,.008,0,.075,.059,0,0,-.22);
  body.box(blued,.025,.006,.011,.004,.092,.059,0,0,-.22);
  // Flush internal magazine floorplate and a proper rounded trigger guard.
  body.box(blued,.051,.009,.142,0,-.063,-.132);
  for(const z of [-.19,-.077])body.add('cylinder',worn,[.004,.002,.004],[0,-.069,z]);
  body.add(profile([[-.052,-.055],[-.047,-.084],[-.03,-.106],[.021,-.106],[.043,-.082],[.042,-.055]],.024,.0015,[[[-.038,-.063],[-.034,-.081],[-.022,-.093],[.014,-.093],[.03,-.078],[.03,-.063]]]),blued,[1,1,1]);
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
  bolt.add(turned([[-.16,.017],[-.154,.022],[-.14,.022],[-.138,.0195],[.012,.0195],[.026,.021]]),bright,[1,1,1],[0,.05,0]);
  for(const z of [-.149,-.142])bolt.add(hollowTube(.0226,.02,.002),worn,[1,1,1],[0,.05,z]);
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
  model.userData={muzzle:[0,.05,-.924],sightY,length:1.29,boltAction:true,boltTravel:.132,hip:[.205,-.155,-.64],supportGrip:[-.025,.005,-.345],authoredDetail:true};
  return model;
}
