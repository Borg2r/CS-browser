// Authored tactical receivers and furniture. Geometry is baked by material in
// Parts; the bolt/charging handle and detachable magazine retain transforms.
import * as THREE from '../vendor/three.module.min.js';
import { profile, hollowTube, turned, finish } from './weapon-detail.js';

const P = Math.PI;
function panel(p, material, points, width, bevel=.002, holes=[], pos=[0,0,0]) {
  p.add(profile(points,width,bevel,holes),material,[1,1,1],pos);
}
function tube(p, material, radius, bore, length, y, z, x=0) {
  p.add(hollowTube(radius,bore,length,24),material,[1,1,1],[x,y,z]);
}
function shaft(p, material, stations, y, x=0) {
  p.add(turned(stations,24),material,[1,1,1],[x,y,0]);
}
function pin(p, material, x, y, z, r=.004) {
  p.add(new THREE.CylinderGeometry(r,r,.003,16),material,[1,1,1],[x,y,z],[0,0,P/2]);
}
function grip(p, polymer, dark, z=.035, height=.145) {
  panel(p,polymer,[[z-.028,-.012],[z+.026,-.012],[z+.05,-height+.018],[z+.039,-height],
    [z+.004,-height],[z-.011,-height+.012],[z-.034,-.047]],.045,.004);
  for(const side of [-1,1]) {
    panel(p,dark,[[z-.018,-.046],[z+.019,-.045],[z+.035,-height+.023],
      [z+.008,-height+.02],[z-.003,-height+.034]],.002,.001,[],[side*.025,0,0]);
    for(let j=0;j<6;j++) p.box(polymer,.002,.003,.027,side*.027,-.061-j*.011,z+.004+j*.0018,-.12);
  }
}
function guard(p, metal, z=.025) {
  panel(p,metal,[[z-.01,-.017],[z-.087,-.018],[z-.095,-.032],[z-.088,-.081],
    [z-.073,-.09],[z-.017,-.085],[z-.003,-.073]],.018,.002,
    [[[z-.02,-.032],[z-.071,-.031],[z-.079,-.039],[z-.074,-.069],[z-.021,-.069]]]);
  panel(p,metal,[[z-.045,-.027],[z-.05,-.047],[z-.042,-.062],[z-.032,-.064],
    [z-.039,-.051],[z-.036,-.029]],.009,.001);
}
function sights(p, metal, edge, frontZ, rearZ, y, base=.09) {
  // Aperture hole and a fine blade meet the same visual aim line.
  p.box(metal,.035,.012,.032,0,base,rearZ);
  p.box(metal,.013,Math.max(.005,y-base-.012),.012,0,(y+base-.012)/2,rearZ);
  p.add(hollowTube(.011,.0067,.007,24),metal,[1,1,1],[0,y,rearZ]);
  for(const side of [-1,1]) {
    p.box(metal,.006,.035,.027,side*.019,y-.008,rearZ);
    p.box(metal,.006,.034,.021,side*.016,y-.004,frontZ,0,0,-side*.17);
  }
  p.box(metal,.038,.012,.035,0,y-.027,frontZ);
  p.box(edge,.0035,.024,.007,0,y-.012,frontZ);
}
function controls(p, metal, edge, screw, x, z, y=.013) {
  for(const side of [-1,1]) {
    screw(p,side*x,y,z,.004);
    p.box(metal,.005,.010,.029,side*(x+.002),y+.015,z-.014,.18);
    pin(p,edge,side*(x+.003),y-.012,z-.034,.0035);
    p.box(edge,.0018,.002,.008,side*(x+.004),y+.025,z-.033);
  }
}
function curvedMag(p, dark, metal, z, width=.04, h=.19, bend=.025) {
  panel(p,dark,[[z-.036,-.032],[z+.036,-.032],[z+.04,-.095],[z+.04+bend,-h+.01],
    [z+.03+bend,-h],[z-.033+bend,-h],[z-.046+bend,-h+.013],[z-.044,-.087]],width,.003);
  panel(p,metal,[[z-.044+bend,-h+.012],[z+.043+bend,-h+.012],
    [z+.043+bend,-h-.002],[z-.044+bend,-h-.002]],width+.006,.001);
  for(const side of [-1,1]) {
    for(const f of [-.019,.014]) panel(p,metal,[[z+f,-.062],[z+f+.004,-.062],
      [z+f+bend+.006,-h+.025],[z+f+bend+.002,-h+.025]],.0015,.0005,[],[side*(width/2+.003),0,0]);
    for(let i=0;i<3;i++) pin(p,metal,side*(width/2+.003),-.081-i*.026,z+.023+i*bend*.13,.0017);
  }
}
function muzzle(p, steel, dark, y, z, radius=.018, bore=.005) {
  tube(p,steel,radius,bore,.014,y,z+.025);
  // Separated webs and open end rings form the flash hider's actual slots.
  for(let i=0;i<6;i++) {
    const a=i*P/3;
    p.box(dark,.0045,.0045,.04,Math.cos(a)*(radius-.003),y+Math.sin(a)*(radius-.003),z,0,0,a);
  }
  tube(p,steel,radius,bore,.007,y,z-.022);
}
function attach(w,g,p,api,{iron=.137,front=-.4,rear=.015,base=.09,native=false,mountZ=-.12}={}) {
  const steel=finish('blued',0x374047), edge=finish('steel',0x727c7d);
  let sightY=iron;
  if(w.optic) {
    sightY=w.optic===1?base+.075:base+.095;
    g.add(api.opticModel(w.optic,sightY,mountZ,false,base));
  } else if(native) {
    sightY=base+.078;
    // Small 2x prism optic: hollow optical tube, separate eyepiece and turrets.
    const optic=new api.Parts();
    for(const z of [mountZ-.054,mountZ+.045]) {
      optic.box(steel,.038,.025,.026,0,base+.021,z);
      tube(optic,edge,.032,.027,.01,sightY,z);
    }
    tube(optic,steel,.029,.023,.137,sightY,mountZ);
    tube(optic,steel,.035,.026,.024,sightY,mountZ-.08);
    tube(optic,steel,.033,.024,.023,sightY,mountZ+.079);
    optic.add('cylinder',steel,[.012,.017,.012],[0,sightY+.036,mountZ]);
    optic.add('cylinder',steel,[.011,.017,.011],[.035,sightY,mountZ],[0,0,P/2]);
    const scope=optic.build('native_scope');
    const glass=new THREE.Mesh(new THREE.CircleGeometry(.023,28),
      new THREE.MeshStandardMaterial({color:0x48747c,metalness:.4,roughness:.13,transparent:true,opacity:.26,depthWrite:false,side:THREE.DoubleSide}));
    glass.position.set(0,sightY,mountZ+.09); scope.add(glass);g.add(scope);
  } else sights(p,steel,edge,front,rear,iron,base);
  return sightY;
}

function qk9(w,api) {
  const {Parts,MAT,screw,rails,marking}=api;
  const body=new Parts(), action=new Parts(), magazine=new Parts();
  const steel=finish('blued',0x384349), edge=finish('steel',0x6d797c);
  const polymer=finish('polymer',0x303839), rubber=finish('rubber',0x202728);
  // Stamped, arched receiver with a genuine side ejection cutout.
  const hull=[[-.271,-.012],[-.271,.055],[-.245,.078],[.071,.078],[.09,.062],[.09,-.012]];
  for(const side of [-1,1]) panel(body,steel,hull,.007,.002,
    side===1?[[[-.163,.024],[-.065,.024],[-.065,.061],[-.163,.061]]]:[],[side*.03,0,0]);
  body.box(steel,.055,.013,.344,0,.077,-.087);
  body.box(steel,.059,.015,.35,0,-.012,-.088);
  shaft(body,steel,[[-.447,.014],[-.419,.014],[-.406,.019],[-.267,.019],[-.254,.025]],.049);
  panel(body,polymer,[[-.271,-.014],[-.219,-.034],[-.175,-.042],[-.056,-.039],
    [.072,-.012],[.072,.012],[-.271,.012]],.062,.004);
  grip(body,polymer,rubber);guard(body,steel,.022);
  panel(body,polymer,[[-.411,-.003],[-.415,.057],[-.396,.069],[-.277,.062],
    [-.257,.033],[-.274,-.023],[-.376,-.03]],.075,.005,
    [[[-.385,.024],[-.352,.024],[-.352,.047],[-.385,.047]],
     [[-.337,.024],[-.301,.024],[-.301,.047],[-.337,.047]]]);
  for(const side of [-1,1]) {
    screw(body,side*.04,.003,-.294,.004);
    for(let i=0;i<4;i++) body.box(rubber,.002,.018,.005,side*.04,-.009,-.371+i*.022);
  }
  // Telescoping stock rails and a rounded, skeletonized shoulder rest.
  for(const side of [-1,1]) {
    body.box(steel,.008,.013,.288,side*.039,.025,.114);
    body.box(edge,.002,.004,.19,side*.044,.03,.142);
  }
  panel(body,polymer,[[.215,.057],[.282,.048],[.294,.024],[.287,-.103],[.271,-.12],
    [.241,-.12],[.227,-.084]],.055,.004,[[[.244,.016],[.269,.016],[.263,-.075],[.246,-.075]]]);
  panel(body,rubber,[[.277,.039],[.298,.032],[.292,-.116],[.274,-.122]],.063,.003);
  for(let j=0;j<6;j++)body.box(steel,.064,.003,.003,0,-.096+j*.021,.295-j*.0008);
  curvedMag(magazine,steel,edge,-.141,.036,.233,.044);
  controls(body,steel,edge,screw,.036,.034);
  // Visible bolt inside the window, extractor and independent charging handle.
  action.box(edge,.043,.026,.09,0,.041,-.11);
  action.box(steel,.005,.008,.04,.024,.041,-.123);
  action.box(steel,.044,.009,.018,-.027,.061,-.311);
  action.add('cylinder',rubber,[.009,.035,.009],[-.059,.061,-.311],[0,0,P/2]);
  body.box(steel,.008,.009,.078,-.037,.058,-.297);
  // Integral suppressor has an open bore and machined front cap, not a black disc.
  tube(body,steel,.03,.007,.176,.049,-.506);
  tube(body,rubber,.031,.027,.12,.049,-.504);
  for(const z of [-.591,-.567,-.444])tube(body,edge,.0307,.026,.004,.049,z);
  tube(body,steel,.027,.0055,.007,.049,-.597);
  rails(body,.204,-.068,.094,.046);
  const model=new THREE.Group();
  const sightY=attach(w,model,body,api,{iron:.133,front:-.392,rear:.032,base:.103,mountZ:-.084});
  marking({...w,name:'QK-9mm  •  9×19'},body,.0355,.043,-.205,.082);
  model.add(body.build(),magazine.build('magazine'),action.build('slide'));
  model.userData={muzzle:[0,.049,-.603],sightY,length:.91,hip:[.205,-.158,-.55],supportGrip:[-.025,.012,-.325],authoredDetail:true};
  return model;
}

function cinder(w,api) {
  const {Parts,MAT,screw,rails,marking}=api;
  const body=new Parts(), action=new Parts(), magazine=new Parts();
  const polymer=finish('polymer',0x8c8064), dark=finish('polymer',0x333b3b);
  const steel=finish('blued',0x414c51), edge=finish('steel',0x778084);
  const outline=[[-.34,-.025],[-.34,.051],[-.304,.081],[.069,.081],[.104,.047],[.098,-.011],
    [.048,-.028],[-.053,-.023],[-.086,-.042],[-.205,-.042],[-.219,-.022]];
  for(const side of [-1,1]) panel(body,polymer,outline,.008,.003,
    side===1?[[[-.222,.014],[-.088,.014],[-.088,.054],[-.222,.054]]]:[],[side*.033,0,0]);
  body.box(polymer,.06,.018,.389,0,.075,-.112);
  body.box(dark,.06,.014,.285,0,-.026,-.077);
  panel(body,polymer,[[-.343,.05],[-.415,.035],[-.415,-.017],[-.389,-.044],[-.239,-.044],[-.239,.05]],.076,.003,
    [[[-.388,.001],[-.351,.001],[-.351,.024],[-.388,.024]],
     [[-.335,.001],[-.299,.001],[-.299,.024],[-.335,.024]],
     [[-.284,.001],[-.254,.001],[-.254,.024],[-.284,.024]]]);
  grip(body,dark,steel);guard(body,dark,.027);
  curvedMag(magazine,steel,edge,-.151,.042,.258,.003);
  magazine.box(dark,.052,.019,.089,0,-.257,-.148);
  for(const side of [-1,1])for(let i=0;i<4;i++)
    magazine.box(dark,.002,.021,.044,side*.024,-.099-i*.035,-.147);
  // Folding stock has open triangular rails, hinge axle and latch.
  body.add('cylinder',steel,[.016,.086,.016],[0,.02,.105]);
  panel(body,polymer,[[.109,.058],[.362,.033],[.382,.013],[.37,-.111],[.334,-.114],
    [.127,-.039],[.109,-.026]],.043,.004,[[[.145,.024],[.332,.006],[.33,-.073],[.145,-.014]]]);
  panel(body,dark,[[.356,.03],[.385,.014],[.379,-.115],[.351,-.117]],.063,.003);
  for(let i=0;i<6;i++)body.box(steel,.064,.003,.003,0,-.1+i*.019,.382);
  body.box(steel,.012,.024,.029,.038,.007,.105);
  controls(body,steel,edge,screw,.04,.039);
  for(const side of [-1,1]) {
    for(const z of [-.284,-.014,.076])screw(body,side*.039,.006,z,.0036);
    body.box(dark,.004,.007,.061,side*.04,.062,-.042);
    pin(body,edge,side*.043,-.029,-.179,.004);
  }
  action.box(edge,.05,.027,.12,0,.033,-.153);
  action.box(steel,.008,.01,.063,.027,.04,-.158);
  action.box(steel,.049,.012,.019,-.041,.046,-.248);
  action.box(dark,.025,.022,.028,-.069,.046,-.25);
  shaft(body,steel,[[-.494,.014],[-.475,.014],[-.465,.019],[-.393,.019],[-.381,.027]],.048);
  muzzle(body,steel,dark,.048,-.508,.02,.006);
  rails(body,.373,-.136,.096,.054);
  // Short accessory rail under the handguard and sling eyelet.
  for(let i=0;i<7;i++)body.box(steel,.05,.008,.009,0,-.051,-.38+i*.018);
  body.add(hollowTube(.011,.006,.009,20),steel,[1,1,1],[.045,-.009,.076],[0,P/2,0]);
  const model=new THREE.Group();
  const sightY=attach(w,model,body,api,{iron:.142,front:-.361,rear:.039,base:.105,mountZ:-.122});
  marking({...w,name:'CINDER 45  •  .45 AUTO'},body,.0395,.044,-.046,.09);
  model.add(body.build(),magazine.build('magazine'),action.build('slide'));
  model.userData={muzzle:[0,.048,-.535],sightY,length:.93,hip:[.205,-.16,-.58],supportGrip:[-.025,.004,-.315],authoredDetail:true};
  return model;
}

function volt(w,api) {
  const {Parts,MAT,screw,rails,marking}=api;
  const body=new Parts(), action=new Parts(), magazine=new Parts();
  const polymer=finish('polymer',0x525d49), dark=finish('polymer',0x293435);
  const steel=finish('blued',0x465157), edge=finish('steel',0x7d8584);
  // Continuous sculpted thumbhole stock and front hand opening establish the
  // horizontal-magazine PDW silhouette instead of a conventional SMG receiver.
  panel(body,polymer,[[-.358,.022],[-.35,.071],[-.322,.092],[.28,.092],[.319,.071],[.335,.026],
    [.332,-.101],[.319,-.126],[.273,-.139],[.134,-.119],[.087,-.088],[.055,-.147],
    [.016,-.151],[-.013,-.118],[-.042,-.087],[-.174,-.092],[-.191,-.067],[-.316,-.06],[-.351,-.032]],.074,.007,
    [[[.083,-.032],[.12,.045],[.263,.039],[.28,.012],[.261,-.07],[.153,-.077]],
     [[-.299,-.02],[-.282,.024],[-.151,.024],[-.114,-.019],[-.126,-.049],[-.283,-.047]]]);
  // Soft overmolded grip panels remain inset from the rounded shell edges.
  for(const side of [-1,1]) {
    panel(body,dark,[[.002,-.049],[.045,-.065],[.067,-.127],[.049,-.142],[.021,-.137],[-.001,-.096]],.002,.002,[],[side*.041,0,0]);
    panel(body,dark,[[.164,-.085],[.271,-.08],[.301,-.095],[.286,-.114],[.173,-.103]],.002,.002,[],[side*.041,0,0]);
    for(const z of [-.324,-.101,.101,.286])screw(body,side*.042,.041,z,.0035);
    for(let i=0;i<6;i++)body.box(polymer,.002,.003,.032,side*.044,-.067-i*.011,.019+i*.003);
  }
  panel(body,dark,[[.312,.066],[.336,.042],[.34,-.1],[.321,-.127],[.304,-.128]],.083,.003);
  for(let i=0;i<8;i++)body.box(steel,.084,.003,.004,0,-.105+i*.02,.339);
  // A real transparent top magazine shows its carrier, feed disk and cartridges.
  // Alpha is kept low enough for the ammo detail to read without black sorting artifacts.
  const amber=new THREE.MeshStandardMaterial({color:0x8a7750,roughness:.36,metalness:.04,transparent:true,opacity:.42,depthWrite:false});
  panel(magazine,amber,[[-.295,.097],[-.28,.121],[.219,.121],[.248,.107],[.251,.083],[-.295,.083]],.063,.003);
  magazine.box(dark,.075,.011,.522,0,.083,-.023);
  for(const z of [-.286,.235])magazine.box(dark,.076,.031,.022,0,.102,z);
  magazine.box(steel,.006,.007,.472,0,.104,-.025);
  for(let i=0;i<22;i++) {
    const z=-.258+i*.02;
    magazine.add('cylinder',MAT.brass,[.0047,.044,.0047],[0,.103,z],[0,0,P/2]);
    magazine.add('sphere',edge,[.005,.0045,.0045],[-.023,.103,z]);
  }
  magazine.add('cylinder',dark,[.027,.008,.027],[0,.104,.203]);
  magazine.add('cylinder',edge,[.007,.011,.007],[0,.111,.203]);
  // The forward bridge carries sights above, and clear of, the magazine.
  for(const side of [-1,1]) panel(body,steel,[[-.325,.079],[-.311,.159],[-.17,.159],[-.156,.078],
    [-.177,.078],[-.188,.132],[-.288,.132],[-.3,.079]],.009,.002,[],[side*.038,0,0]);
  rails(body,.168,-.24,.165,.055);
  shaft(body,steel,[[-.429,.014],[-.38,.014],[-.366,.023],[-.329,.023]],.048);
  muzzle(body,steel,dark,.048,-.446,.02,.0045);
  // Ambidextrous charging handles run in the exposed slots below the bridge.
  action.box(steel,.06,.024,.085,0,.069,-.278);
  for(const side of [-1,1]) {
    action.box(dark,.025,.019,.037,side*.047,.069,-.29);
    for(let i=0;i<4;i++)action.box(edge,.002,.009,.002,side*.061,.07,-.303+i*.008);
  }
  // Downward ejection aperture, trigger and selector integrated into the hand loop.
  body.box(dark,.047,.003,.057,0,-.13,.232);
  body.box(steel,.009,.039,.009,0,-.04,-.053,-.25);
  body.add('cylinder',steel,[.011,.057,.011],[0,-.065,-.031],[0,0,P/2]);
  for(const side of [-1,1])pin(body,edge,side*.031,-.065,-.031,.006);
  const model=new THREE.Group();
  const sightY=attach(w,model,body,api,{iron:.207,front:-.31,rear:-.168,base:.174,mountZ:-.239});
  marking({...w,name:'VOLT 90  •  5.7×28'},body,.042,.009,.205,.115);
  model.add(body.build(),magazine.build('magazine'),action.build('slide'));
  model.userData={muzzle:[0,.048,-.474],sightY,length:.82,hip:[.205,-.192,-.59],adsZ:-.31,supportGrip:[-.025,-.009,-.226],magazineReloadDirection:[0,1,0],authoredDetail:true};
  return model;
}

function bastion(w,api) {
  const {Parts,MAT,screw,rails,marking}=api;
  const body=new Parts(), action=new Parts(), magazine=new Parts();
  const sand=finish('polymer',0x9d9072), dark=finish('polymer',0x404841);
  const steel=finish('blued',0x566169), edge=finish('steel',0x8c9490);
  // Seamless bullpup shell slopes into a deep rear magazine well; the large
  // hand opening is cut through the geometry rather than painted dark.
  const shell=[[-.272,.02],[-.255,.075],[-.199,.09],[.303,.09],[.354,.067],[.372,.026],
    [.366,-.132],[.327,-.15],[.191,-.141],[.142,-.105],[.114,-.048],
    [.067,-.051],[.052,-.153],[.019,-.158],[-.007,-.13],[-.026,-.058],[-.183,-.064],[-.247,-.032]];
  const ejection=[[.138,.018],[.271,.018],[.271,.059],[.138,.059]];
  for(const side of [-1,1])panel(body,sand,shell,.009,.005,
    [ ... (side===1?[ejection]:[]), [[-.175,-.034],[-.159,.013],[-.047,.013],[-.025,-.014],[-.041,-.039]] ],[side*.037,0,0]);
  // The shell is hollow through the operating mechanism and magazine opening.
  body.box(sand,.065,.016,.551,0,.083,.034);
  body.box(sand,.065,.025,.184,0,-.109,.258);
  body.box(sand,.063,.018,.211,0,-.042,-.128);
  grip(body,sand,dark,.029,.153);
  body.box(steel,.009,.039,.01,0,-.019,-.029,-.23);
  for(const side of [-1,1]) {
    panel(body,dark,[[.161,-.084],[.283,-.103],[.318,-.126],[.203,-.119]],.002,.002,[],[side*.044,0,0]);
    for(const z of [-.217,.072,.31])screw(body,side*.044,.014,z,.004);
    pin(body,edge,side*.045,-.024,.067,.004);
    // Recessed cheekpiece and the removable left/right ejection-port cover.
    panel(body,sand,[[.105,.067],[.302,.067],[.309,.049],[.296,.039],[.105,.039]],.003,.002,[],[side*.044,0,0]);
  }
  panel(body,dark,[[.35,.069],[.375,.043],[.38,-.133],[.36,-.151],[.337,-.15]],.088,.003);
  for(let i=0;i<8;i++)body.box(steel,.089,.003,.003,0,-.128+i*.024,.379);
  // Rear-loading magazine sits behind the trigger, well clear of the palm.
  curvedMag(magazine,dark,steel,.196,.051,.281,.027);
  for(const side of [-1,1])for(let i=0;i<4;i++)
    magazine.box(sand,.002,.026,.034,side*.029,-.133-i*.034,.197+i*.004);
  body.box(dark,.079,.012,.108,0,-.119,.208);
  body.box(steel,.025,.031,.012,0,-.132,.145,-.18);
  action.box(edge,.054,.03,.122,0,.039,.202);
  action.box(steel,.007,.007,.038,.03,.037,.154);
  action.box(steel,.048,.011,.018,-.039,.063,-.212);
  action.box(dark,.021,.022,.032,-.069,.063,-.214);
  // Quick-change barrel and gas block above the folding vertical foregrip.
  shaft(body,steel,[[-.726,.014],[-.706,.014],[-.691,.017],[-.365,.017],[-.343,.026],[-.254,.026]],.049);
  body.box(steel,.048,.058,.045,0,.051,-.351);
  tube(body,edge,.029,.025,.012,.049,-.287);
  body.tube(steel,.011,.143,.022,.068,-.432);
  panel(body,dark,[[-.365,-.007],[-.316,-.007],[-.317,-.146],[-.33,-.162],[-.357,-.157],[-.365,-.138]],.038,.004);
  for(let i=0;i<7;i++)body.box(steel,.042,.003,.035,0,-.131+i*.016,-.342);
  body.add('cylinder',edge,[.011,.052,.011],[0,-.007,-.339],[0,0,P/2]);
  muzzle(body,steel,dark,.049,-.741,.019,.0045);
  // Low receiver bridge supports either the native 2x prism or purchased optics.
  for(const z of [-.16,.021])body.box(steel,.05,.027,.041,0,.103,z);
  rails(body,.262,-.075,.125,.055);
  body.add(hollowTube(.013,.008,.007,20),steel,[1,1,1],[-.047,-.065,.316],[0,P/2,0]);
  const model=new THREE.Group();
  const sightY=attach(w,model,body,api,{iron:.166,front:-.191,rear:.036,base:.134,native:true,mountZ:-.073});
  marking({...w,name:'BASTION BP  •  5.56'},body,.043,.008,-.101,.144);
  model.add(body.build(),magazine.build('magazine'),action.build('slide'));
  model.userData={muzzle:[0,.049,-.768],sightY,length:1.15,hip:[.215,-.181,-.64],supportGrip:[-.025,-.02,-.338],authoredDetail:true};
  return model;
}

export function buildDetailedTactical(w,api) {
  switch(w.id) {
    case 'cricket': return qk9(w,api);
    case 'cinder': return cinder(w,api);
    case 'volt': return volt(w,api);
    case 'bastion': return bastion(w,api);
    default: throw new Error(`No detailed tactical model: ${w.id}`);
  }
}
