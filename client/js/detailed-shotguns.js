// Three original shotgun silhouettes. Geometry is baked into material batches;
// only the pump/bolt and each M1887 lever retain independent transforms.
import * as THREE from '../vendor/three.module.min.js';
import { profile, hollowTube, turned, finish } from './weapon-detail.js';

const UNIT = [1, 1, 1], PI = Math.PI;
const geometryCache = new Map();
function cached(key, create) {
  if (!geometryCache.has(key)) geometryCache.set(key, create());
  return geometryCache.get(key);
}
function addProfile(p, material, points, width, bevel = .002, holes = [], position = [0,0,0]) {
  p.add(profile(points, width, bevel, holes), material, UNIT, position);
}
function bore(p, material, outer, inner, length, y, z) {
  p.add(hollowTube(outer, inner, length, 28), material, UNIT, [0, y, z]);
}
function ring(p, material, outer, inner, length, y, z) {
  p.add(hollowTube(outer, inner, length, 24), material, UNIT, [0,y,z]);
}

// A rounded cross section changes width, height and rake along the stock.
// Unlike an extruded side slab, the comb and palm swell catch moving light.
function furniture(key, stations) {
  return cached(key, () => {
    const pos = [], uv = [], indices = [], segments = 16;
    for (let j = 0; j < stations.length; j++) {
      const [z, top, bottom, width] = stations[j];
      for (let i = 0; i <= segments; i++) {
        const a = i / segments * PI * 2;
        const x = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), .65) * width;
        const y = (top + bottom) / 2 + Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), .65) * (top - bottom) / 2;
        pos.push(x, y, z);
        uv.push((z - stations[0][0]) / (stations[stations.length - 1][0] - stations[0][0]), i / segments);
        if (j && i < segments) {
          const k = j * (segments + 1) + i, previous = k - segments - 1;
          indices.push(previous, k, previous + 1, previous + 1, k, k + 1);
        }
      }
    }
    // The loft follows increasing Z, with exterior faces and capped ends.
    for (const end of [0, stations.length - 1]) {
      const start = end * (segments + 1), center = pos.length / 3;
      const [z, top, bottom] = stations[end];
      pos.push(0,(top+bottom)/2,z); uv.push(.5,.5);
      for (let i = 0; i < segments; i++) {
        if (end === 0) indices.push(center,start+i,start+i+1);
        else indices.push(center,start+i+1,start+i);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);
    // Above winding is inward for the positive-Z loft; reverse all triangles.
    const a = g.index.array; for (let i=0;i<a.length;i+=3) [a[i+1],a[i+2]]=[a[i+2],a[i+1]];
    g.computeVertexNormals(); return g;
  });
}

function receiver(p, action, api, tactical) {
  const { screw } = api;
  const steel = finish('blued', tactical ? 0x454b4e : 0x424b50);
  const edge = finish('steel',0x7b8587), dark = finish('blued',0x20292d);
  const outline = [[-.267,-.028],[-.267,.045],[-.251,.066],[-.214,.081],[-.026,.081],[.011,.062],[.027,.036],[.027,-.027],[.012,-.036],[-.24,-.036]];
  const port = [[-.199,.021],[-.199,.054],[-.19,.061],[-.074,.061],[-.065,.051],[-.065,.021],[-.075,.015],[-.19,.015]];
  // Left shell is solid. The right shell has a through-cut ejection window.
  addProfile(p,steel,outline,.009,.002,[],[-.030,0,0]);
  addProfile(p,steel,outline,.009,.002,[port],[.030,0,0]);
  p.box(steel,.061,.012,.211,0,.072,-.113);
  p.box(dark,.060,.011,.205,0,-.026,-.122);
  p.box(steel,.061,.070,.019,0,.018,-.254);
  p.box(steel,.060,.073,.023,0,.015,.015);
  p.box(dark,.050,.024,.110,0,.023,-.13);
  // Port floor and extractor live inside the cavity, not painted on its face.
  action.box(edge,.044,.032,.104,0,.043,-.145);
  action.box(dark,.006,.014,.040,.026,.046,-.108);
  action.box(edge,.005,.005,.070,.026,.059,-.147);
  if(tactical) {
    action.add('cylinder',steel,[.005,.035,.005],[.044,.039,-.095],[0,0,PI/2]);
    action.add('cylinder',dark,[.010,.020,.010],[.064,.039,-.095],[0,0,PI/2]);
    for(let i=0;i<5;i++) action.box(edge,.002,.012,.002,.072,.039,-.102+i*.003);
  }
  for(const side of [-1,1]) {
    for(const [y,z] of [[-.009,-.224],[-.014,-.047],[.025,.009]]) screw(p,side*.037,y,z,.004);
    p.box(edge,.0018,.002,.178,side*.036,.069,-.122);
    p.box(dark,.003,.007,.034,side*.037,-.017,-.017);
  }
  // Carrier/loading gate sits in a recessed underside, with a visible latch.
  addProfile(p,dark,[[-.205,-.037],[-.205,-.045],[-.08,-.045],[-.061,-.037]],.043,.002);
  p.box(edge,.024,.002,.095,0,-.046,-.136);
  p.box(steel,.010,.009,.021,.025,-.040,-.079);
  return {steel,edge,dark};
}

function triggerAssembly(p,api,materials,tactical) {
  const {steel,edge,dark}=materials;
  const outline=[[-.047,-.033],[-.043,-.084],[-.029,-.103],[.034,-.103],[.055,-.087],[.053,-.034]];
  const hole=[[-.034,-.045],[-.03,-.077],[-.021,-.089],[.029,-.089],[.041,-.079],[.040,-.045]];
  addProfile(p,steel,outline,.019,.0025,[hole]);
  addProfile(p,edge,[[.015,-.042],[.01,-.056],[-.002,-.072],[-.01,-.075],[-.005,-.062],[.002,-.043]],.009,.0015);
  p.add('cylinder',dark,[.006,.034,.006],[0,-.048,.036],[0,0,PI/2]);
  p.add('cylinder',tactical?finish('polymer',0xa04633):edge,[.004,.002,.004],[.019,-.048,.036],[0,0,PI/2]);
}

function sightAssembly(p,api,materials,frontZ,rearZ,ironY,w) {
  const {steel,edge,dark}=materials;
  // Front blade ends exactly at the sight line, with two protecting ears.
  p.box(steel,.033,.011,.028,0,.082,frontZ);
  p.box(edge,.004,ironY-.087,.008,0,(ironY+.087)/2,frontZ);
  for(const side of [-1,1]) {
    p.box(steel,.005,.027,.020,side*.013,ironY-.006,frontZ,0,0,side*.12);
    p.box(dark,.006,.021,.018,side*.016,ironY-.012,rearZ);
  }
  p.box(steel,.038,.022,.033,0,ironY-.038,rearZ);
  p.box(steel,.007,.015,.008,0,ironY-.020,rearZ);
  ring(p,steel,.009,.006,.007,ironY,rearZ);
  p.bead(api.MAT.sight,0,ironY-.002,frontZ+.005,.0013);
  if(w.optic) {
    api.rails(p,.165,-.118,.090,.046);
    return w.optic===1?.153:.172;
  }
  return ironY;
}

function ram(w,api) {
  const {Parts,MAT,screw,opticModel,marking}=api;
  const p=new Parts(),pump=new Parts();
  const materials=receiver(p,pump,api,false),{steel,edge,dark}=materials;
  const wood=finish('wood',0x96663f),rubber=finish('rubber',0x292b2b);
  // Tapered sporting stock with raised comb, thin wrist and curved shoulder pad.
  p.add(furniture('ram-stock',[[.022,.025,-.035,.026],[.06,.015,-.049,.025],[.105,-.006,-.103,.029],[.154,.005,-.105,.031],[.214,.029,-.108,.035],[.30,.034,-.121,.039],[.386,.022,-.144,.041]]),wood,UNIT);
  p.add(furniture('ram-pad',[[.386,.022,-.144,.041],[.396,.025,-.146,.043],[.410,.021,-.144,.042]]),rubber,UNIT);
  for(const side of [-1,1]) {
    screw(p,side*.034,-.059,.137,.004);
    for(let i=0;i<10;i++) p.box(dark,.0014,.003,.045,side*.030,-.065+i*.0035,.13,side*.45);
    p.add('ring',steel,[.010,.014,.012],[side*.030,-.116,.31],[0,PI/2,0]);
  }
  triggerAssembly(p,api,materials,false);
  bore(p,steel,.0195,.0092,.637,.055,-.584);
  ring(p,edge,.0202,.0092,.012,.055,-.901);
  // Tubular magazine remains fixed while the walnut pump and bars reciprocate.
  p.add(turned([[-.715,.015],[-.706,.017],[-.26,.017],[-.251,.019]],24),dark,UNIT,[0,-.002,0]);
  ring(p,steel,.019,.009,.021,-.002,-.709);
  p.tube(dark,.008,.004,0,-.002,-.722);
  p.box(steel,.031,.063,.013,0,.027,-.697);
  const stations=[[-.586,.027],[-.578,.035]];
  for(let i=0;i<10;i++) {
    const z=-.565+i*.016;
    stations.push([z,.038],[z+.007,.039],[z+.009,.034],[z+.013,.034]);
  }
  stations.push([-.402,.034],[-.392,.027]);
  pump.add(turned(stations,28),wood,UNIT,[0,-.003,0]);
  for(const side of [-1,1]) {
    pump.box(edge,.008,.009,.330,side*.023,-.020,-.295);
    pump.box(dark,.006,.004,.150,side*.024,-.014,-.187);
  }
  for(const z of [-.684,-.592,-.494,-.391])p.box(dark,.011,.012,.009,0,.079,z);
  p.box(steel,.012,.005,.454,0,.086,-.565);
  const sightY=sightAssembly(p,api,materials,-.842,-.02,.119,w);
  // Three spare shells on the far receiver side, with visible brass rims.
  p.box(rubber,.011,.044,.130,-.044,.004,-.157);
  for(let i=0;i<3;i++) {
    const z=-.20+i*.043;
    p.add('cylinder',finish('polymer',0x773b31),[.011,.047,.011],[-.055,-.007,z]);
    p.add('cylinder',MAT.brass,[.012,.010,.012],[-.055,.023,z]);
    p.box(dark,.017,.011,.026,-.059,.003,z);
  }
  marking({...w,name:'RAM 12  ·  12 GA'},p,.0372,-.001,-.143,.145);
  const g=p.build();g.add(pump.build('slide'));
  if(w.optic)g.add(opticModel(w.optic,sightY,-.107,false,.097));
  g.userData={muzzle:[0,.055,-.909],sightY,length:1.32,hip:[.21,-.155,-.64],supportGrip:[-.025,.025,-.445],authoredDetail:true};
  return g;
}

function tempest(w,api) {
  const {Parts,screw,opticModel,marking}=api;
  const p=new Parts(),action=new Parts();
  const materials=receiver(p,action,api,true),{steel,edge,dark}=materials;
  const polymer=finish('polymer',0x80745c),rubber=finish('rubber',0x303330);
  // A separate vertical grip and skeletal adjustable stock distinguish it
  // from Ram's continuous wood furniture and the short M1887 wrist.
  addProfile(p,polymer,[[.009,-.021],[.060,-.030],[.090,-.147],[.077,-.171],[.032,-.166],[-.006,-.046]],.044,.006);
  for(const side of [-1,1]) {
    addProfile(p,rubber,[[.025,-.064],[.052,-.063],[.073,-.145],[.045,-.146]],.003,.001,[],[side*.026,0,0]);
    screw(p,side*.029,-.109,.049,.004);
  }
  p.add(turned([[.025,.024],[.064,.024],[.069,.019],[.291,.019],[.298,.016]],24),dark,UNIT,[0,.016,0]);
  for(const z of [.075,.097,.119])ring(p,edge,.0205,.018,.005,.016,z);
  addProfile(p,polymer,[[.140,.038],[.288,.043],[.337,.021],[.347,-.128],[.298,-.129],[.235,-.072],[.157,-.053]],.064,.005,
    [[[.176,.002],[.277,.010],[.299,-.017],[.297,-.071],[.258,-.041],[.178,-.025]]]);
  p.box(rubber,.074,.028,.145,0,.048,.243);
  p.box(rubber,.075,.161,.020,0,-.046,.351,-.10);
  for(let i=0;i<7;i++)p.box(dark,.077,.003,.021,0,-.111+i*.020,.354,-.10);
  p.box(steel,.031,.012,.034,0,-.069,.203);
  triggerAssembly(p,api,materials,true);
  bore(p,dark,.0205,.0094,.561,.055,-.537);
  // The gas system's stepped collars and open clamp join the two parallel tubes.
  p.add(turned([[-.782,.017],[-.767,.019],[-.719,.019],[-.714,.017],[-.270,.017]],24),steel,UNIT,[0,-.003,0]);
  p.tube(dark,.014,.006,0,-.003,-.785);
  for(let i=0;i<12;i++) {
    const a=i*PI/6;
    p.box(edge,.0018,.0018,.014,Math.cos(a)*.020,-.003+Math.sin(a)*.020,-.775,0,0,a);
  }
  ring(p,steel,.025,.020,.021,.055,-.795);
  ring(p,edge,.0215,.0094,.009,.055,-.817);
  p.box(dark,.035,.053,.025,0,.024,-.735);
  // Through-cut vent slots in both side shells reveal the barrel and tube.
  const forend=[[-.660,-.034],[-.674,-.019],[-.659,.031],[-.606,.044],[-.297,.040],[-.277,.021],[-.282,-.033]];
  const slots=Array.from({length:6},(_,i)=>{const z=-.626+i*.049;return [[z,-.002],[z,.018],[z+.028,.018],[z+.033,.013],[z+.029,-.002]];});
  for(const side of [-1,1]) {
    addProfile(p,polymer,forend,.011,.003,slots,[side*.034,0,0]);
    for(let i=0;i<4;i++)p.box(rubber,.004,.016,.021,side*.043,-.020,-.537+i*.057);
    for(const z of [-.637,-.304])screw(p,side*.043,-.018,z,.0035);
  }
  addProfile(p,polymer,[[-.664,-.036],[-.656,-.045],[-.295,-.045],[-.28,-.035]],.064,.004);
  p.box(rubber,.057,.011,.231,0,-.045,-.452);
  for(let i=0;i<9;i++)p.box(dark,.059,.003,.007,0,-.053,-.555+i*.025);
  const sightY=sightAssembly(p,api,materials,-.762,-.013,.129,w);
  marking({...w,name:'TEMPEST  ·  12 GA'},p,.0372,-.001,-.145,.147);
  const g=p.build();g.add(action.build('slide'));
  if(w.optic)g.add(opticModel(w.optic,sightY,-.107,false,.097));
  g.userData={muzzle:[0,.055,-.824],sightY,length:1.19,hip:[.215,-.155,-.60],supportGrip:[-.025,.025,-.397],authoredDetail:true};
  return g;
}

function lever1887(w,api) {
  const {Parts,MAT,screw,marking}=api;
  const p=new Parts(),action=new Parts(),lever=new Parts();
  const blued=finish('blued',0x414a50),steel=finish('steel',0x79817e);
  const dark=finish('blued',0x20292e),wood=finish('wood',0x98633c);
  const outline=[[-.136,-.041],[-.145,-.027],[-.145,.025],[-.133,.068],[-.113,.092],[-.086,.110],[-.049,.117],[.014,.110],[.047,.092],[.064,.067],[.069,.022],[.058,-.022],[.038,-.044]];
  const inset=[[-.120,-.026],[-.129,.002],[-.125,.047],[-.105,.073],[-.078,.089],[-.041,.094],[.011,.087],[.037,.068],[.047,.035],[.039,-.011],[.020,-.026]];
  for(const side of [-1,1]) {
    addProfile(p,blued,outline,.008,.003,[],[side*.032,0,0]);
    addProfile(p,steel,inset,.002,.0015,[],[side*.038,0,0]);
    const inner=inset.map(([z,y])=>[z*.96-.001,y*.94+.002]);
    addProfile(p,blued,inner,.002,.0015,[],[side*.040,0,0]);
    for(const [y,z,r] of [[.048,.025,.0047],[.025,-.102,.004],[-.014,-.076,.0044],[-.009,.029,.0037]])screw(p,side*.043,y,z,r);
    // Fine receiver border and hand-cut screw slot detail remain understated.
    p.box(steel,.001,.0013,.057,side*.043,.075,-.040);
  }
  p.box(blued,.062,.018,.168,0,-.036,-.039);
  p.add('sphere',blued,[.028,.037,.025],[0,.002,.052]);
  // Open top with a dark carrier below the rotating rolling block.
  p.box(dark,.052,.012,.119,0,.034,-.038);
  for(const side of [-1,1])p.box(steel,.003,.008,.113,side*.027,.082,-.043);
  p.box(blued,.058,.043,.026,0,.060,-.127);
  const breech=[[-.107,.025],[-.107,.049],[-.094,.071],[-.071,.085],[-.041,.090],[-.009,.081],[.008,.062],[.011,.025]];
  addProfile(action,blued,breech,.047,.003);
  action.box(steel,.011,.002,.065,.016,.085,-.056);
  action.box(dark,.007,.008,.043,-.021,.060,-.069);
  action.box(steel,.003,.006,.046,-.025,.064,-.067);
  // Short barrel, rolled muzzle and a distinct full-length magazine tube.
  bore(p,blued,.0235,.0095,.392,.074,-.327);
  ring(p,steel,.0245,.0095,.008,.074,-.523);
  p.add(turned([[-.489,.017],[-.479,.018],[-.164,.018],[-.146,.020]],28),blued,UNIT,[0,.008,0]);
  ring(p,steel,.019,.008,.010,.008,-.488);
  p.tube(dark,.008,.003,0,.008,-.494);
  for(const z of [-.168,-.431]) {
    ring(p,steel,.0255,.023,.009,.074,z);
    p.box(blued,.011,.052,.012,0,.035,z);
    for(const side of [-1,1])screw(p,side*.014,.034,z,.003);
  }
  p.add(furniture('m1887-forend',[[-.425,.028,-.015,.027],[-.414,.039,-.024,.034],[-.369,.041,-.027,.037],[-.243,.040,-.027,.037],[-.188,.029,-.017,.029]]),wood,UNIT);
  for(const side of [-1,1]) {
    for(let i=0;i<11;i++) {
      const z=-.390+i*.016;
      p.box(dark,.001,.009,.0017,side*.038,.004,z,.55);
      p.box(dark,.001,.009,.0017,side*.038,.004,z,-.55);
    }
    screw(p,side*.036,.002,-.293,.004);
  }
  // Sculpted birdshead grip: narrow wrist swells into a round sawn-off butt.
  p.add(furniture('m1887-grip',[[.058,.013,-.025,.025],[.087,.011,-.035,.029],[.115,-.003,-.061,.032],[.142,-.026,-.092,.034],[.176,-.063,-.128,.036],[.210,-.095,-.145,.033],[.228,-.111,-.143,.022]]),wood,UNIT);
  addProfile(p,blued,[[.088,.016],[.117,.001],[.153,-.033],[.157,-.039],[.116,-.005],[.087,.011]],.015,.001);
  for(const side of [-1,1]) {
    screw(p,side*.035,-.069,.148,.0045);
    for(let i=0;i<6;i++)p.box(dark,.001,.002,.030,side*.034,-.070-i*.005,.162+i*.002,.55);
  }
  p.add('sphere',blued,[.023,.006,.015],[0,-.143,.214]);
  // Exposed spur hammer, curved trigger and broad loop, all with actual voids.
  addProfile(p,blued,[[.047,.074],[.051,.096],[.074,.119],[.086,.118],[.080,.104],[.065,.085]],.017,.002);
  p.box(steel,.024,.005,.020,0,.116,.079,-.35);
  for(let i=0;i<5;i++)p.box(dark,.024,.0015,.0015,0,.120,.072+i*.003,-.35);
  addProfile(p,steel,[[-.006,-.031],[-.002,-.048],[-.015,-.070],[-.024,-.073],[-.015,-.052],[-.016,-.033]],.008,.0015);
  const outer=[[.022,.001],[.034,-.039],[.064,-.092],[.088,-.112],[.174,-.114],[.210,-.094],[.225,-.063],[.214,-.034],[.183,-.014],[.096,-.007],[.050,.013]];
  const hole=[[.048,-.020],[.066,-.062],[.090,-.094],[.171,-.095],[.196,-.080],[.207,-.060],[.198,-.046],[.178,-.034],[.094,-.026]];
  addProfile(lever,blued,outer,.017,.003,[hole]);
  lever.box(steel,.018,.003,.071,0,-.116,.132);
  p.add('cylinder',steel,[.008,.080,.008],[0,-.018,-.102],[0,0,PI/2]);
  p.box(blued,.011,.005,.016,0,.099,-.488);
  p.bead(MAT.brass,0,.104,-.488,.0031);
  marking({...w,name:'MODEL 1887  ·  12 GA'},p,.0432,.041,-.043,.104);
  const g=p.build(),loop=lever.build('lever'),breechGroup=action.build('bolt');
  loop.position.set(0,-.018,-.102);
  breechGroup.position.set(0,.014,.022);breechGroup.userData.rest=[0,.014,.022];
  g.add(loop,breechGroup);
  g.userData={muzzle:[0,.074,-.531],sightY:.104,length:.77,dualHip:[.245,-.155,-.57],leverAction:true,rollingBreech:true,authoredDetail:true};
  return g;
}

export function buildDetailedShotgun(w,api) {
  if(w.id==='ram')return ram(w,api);
  if(w.id==='tempest')return tempest(w,api);
  if(w.id==='twin_lever')return lever1887(w,api);
  throw new Error(`Unknown detailed shotgun: ${w.id}`);
}
