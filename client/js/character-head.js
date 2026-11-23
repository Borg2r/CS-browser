// Sculpted headgear shared by both operator templates. Every small fitting is
// baked into the existing material batches, so details add no individual draws.
import * as THREE from '../vendor/three.module.min.js';

const shapes = new Map();
function cached(key, make) {
  if (!shapes.has(key)) shapes.set(key, make());
  return shapes.get(key);
}

function visorShape() {
  return cached('visor', () => {
    const s = new THREE.Shape();
    s.moveTo(-.048,.015); s.quadraticCurveTo(-.025,.029,.027,.021);
    s.quadraticCurveTo(.048,.017,.047,.003); s.lineTo(.038,-.018);
    s.quadraticCurveTo(.015,-.027,-.027,-.021);
    s.quadraticCurveTo(-.047,-.018,-.048,.015);
    const g = new THREE.ExtrudeGeometry(s, {depth:.005,bevelEnabled:true,
      bevelSegments:2,steps:1,bevelSize:.002,bevelThickness:.002,curveSegments:5});
    g.translate(0,0,-.0025);
    return g;
  });
}

function shellShape(soft) {
  return cached(soft?'wrap-shell':'helmet-shell', () => {
    const segments=24, levels=10, positions=[],uv=[],indices=[];
    for(let j=0;j<=levels;j++)for(let i=0;i<=segments;i++){
      const theta=i/segments*Math.PI*2,side=Math.abs(Math.sin(theta));
      // A high-cut helmet clears the ear cups; the soft wrap sits lower.
      const bottom=soft?1.60+.10*Math.cos(theta):1.58-.28*side**4+.10*Math.max(0,Math.cos(theta));
      const phi=j/levels*bottom;
      positions.push(Math.sin(theta)*Math.sin(phi),Math.cos(phi),Math.cos(theta)*Math.sin(phi));
      uv.push(i/segments,j/levels);
      if(j<levels&&i<segments){
        const a=j*(segments+1)+i,b=a+segments+1;
        indices.push(a,b,a+1,a+1,b,b+1);
      }
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
    return g;
  });
}

function pipe(points,radius=.003,closed=false) {
  const key=JSON.stringify([points,radius,closed]);
  return cached(key,()=>new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),closed),
    Math.max(10,points.length*3),radius,5,closed));
}

function line(b,mat,points,radius=.003,closed=false) {
  b.part(pipe(points,radius,closed),mat,[0,0,0],[1,1,1]);
}

function helmetRim(soft) {
  const points=[];
  for(let i=0;i<24;i++){
    const theta=i/24*Math.PI*2,side=Math.abs(Math.sin(theta));
    const phi=soft?1.60+.10*Math.cos(theta):1.58-.28*side**4+.10*Math.max(0,Math.cos(theta));
    const rx=soft?.122:.130,ry=soft?.130:.143,rz=soft?.119:.130;
    points.push([Math.sin(theta)*Math.sin(phi)*rx,.792+Math.cos(phi)*ry,.015+Math.cos(theta)*Math.sin(phi)*rz]);
  }
  return points;
}

function goggles(h) {
  // Closely fitted, swept lenses replace the old protruding spherical eyes.
  h.loft('straps',[[.788,.118,.111,.008],[.806,.119,.112,.008],[.811,.117,.111,.008]]);
  for(const side of [-1,1]){
    const position=[side*.052,.796,-.106],rotation=[0,-side*.21,side*.025];
    h.part(visorShape(),'straps',position,[1.10,1.15,1.5],rotation);
    h.part(visorShape(),'lens',[position[0],position[1]+.001,position[2]-.0065],[.89,.83,.65],rotation);
    h.roundedBox('hardware',[side*.104,.795,-.084],[.014,.021,.010],[0,-side*.25,0]);
    // Tiny strap adjusters sit behind the goggles at the temples.
    h.roundedBox('clothDark',[side*.119,.798,-.035],[.008,.026,.034]);
    h.box('hardware',[side*.124,.798,-.036],[.003,.018,.022]);
  }
  h.roundedBox('straps',[0,.802,-.123],[.023,.015,.016],[.12,0,0]);
  h.box('hardware',[0,.807,-.132],[.014,.003,.003]);
}

function face(h) {
  // Tapered jaw, cheek plane, forehead and cranium form one continuous surface.
  h.loft('skin',[[.638,.041,.045,-.008],[.660,.063,.066,-.014],
    [.690,.084,.081,-.008],[.733,.101,.092,.004],[.780,.108,.098,.007],
    [.825,.104,.093,.015],[.867,.082,.076,.022],[.896,.036,.035,.025],[.903,.005,.005,.025]]);
  h.loft('skin',[[.554,.061,.062,.014],[.605,.063,.066,.009],[.675,.066,.067,.003]]);
  // The narrow nose ridge and angular nostril base sit beneath the bridge.
  h.loft('skin',[[.742,.016,.012,-.108],[.751,.022,.021,-.115],
    [.763,.017,.028,-.114],[.787,.010,.017,-.108],[.807,.007,.006,-.102]]);
  for(const side of [-1,1]){
    h.sphere('skin',[side*.106,.759,.004],[.018,.037,.020]);
    h.sphere('clothDark',[side*.117,.758,-.002],[.004,.020,.010]);
  }
}

function softWrap(h) {
  h.part(shellShape(true),'clothDark',[0,.792,.015],[.122,.130,.119]);
  line(h,'cloth',helmetRim(true),.004,true);
  // Draped scarf joins the neck and chest instead of floating as separate rings.
  h.loft('cloth',[[.555,.105,.079,.014],[.585,.124,.092,.006],
    [.619,.122,.100,-.002],[.652,.111,.104,-.007],
    [.690,.112,.112,-.008],[.722,.114,.111,-.007],[.741,.104,.106,-.004]]);
  for(const [y,depth]of [[.602,.091],[.648,.108],[.699,.116]]){
    line(h,'clothDark',[[-.104,y+.012,-.043],[-.080,y+.002,-depth*.85],
      [0,y-.006,-depth],[.078,y+.009,-depth*.85],[.109,y+.019,-.038]],.0025);
  }
  // Bias seams and a gathered rear knot make the fabric read as wrapped cloth.
  for(const side of [-1,1]){
    line(h,'cloth',[[side*.112,.805,-.036],[side*.103,.859,-.020],
      [side*.066,.907,.010],[side*.019,.921,.039]],.0022);
    line(h,'cloth',[[side*.087,.830,.093],[side*.057,.859,.108],[0,.874,.111]],.0023);
  }
  h.roundedBox('cloth',[.039,.742,.119],[.066,.042,.035],[.14,0,-.20]);
  h.roundedBox('clothDark',[.056,.650,.119],[.055,.177,.020],[.10,-.10,-.18]);
  h.roundedBox('cloth',[.019,.660,.127],[.041,.140,.016],[-.06,.10,.10]);
  for(let i=0;i<4;i++)h.box('clothDark',[.039+i*.006,.571,.118],[.002,.025,.012],[0,0,-.16]);
  // A subdued woven identification tab, with stitched edges.
  h.roundedBox('vest',[-.075,.708,-.097],[.031,.025,.008],[0,-.52,-.10]);
  h.box('accent',[-.077,.708,-.102],[.018,.003,.003],[0,-.52,-.10]);
}

function helmet(h) {
  h.part(shellShape(false),'vest',[0,.792,.015],[.130,.143,.130]);
  line(h,'straps',helmetRim(false),.0045,true);
  // Narrow moulded crown ribs, fabric hook-and-loop patches, and a front shroud.
  for(const side of [-1,1]){
    line(h,'clothDark',[[side*.066,.829,-.092],[side*.069,.883,-.059],
      [side*.058,.917,-.008],[side*.047,.916,.060],[side*.040,.880,.116]],.0032);
    h.roundedBox('clothDark',[side*.074,.898,.040],[.044,.008,.059],[0,0,-side*.49]);
    h.roundedBox('hardware',[side*.128,.831,.014],[.011,.028,.081]);
    h.roundedBox('straps',[side*.134,.831,.014],[.008,.014,.066]);
    for(const z of [-.009,.013,.035])h.box('hardware',[side*.139,.830,z],[.004,.006,.010]);
    h.sphere('hardware',[side*.119,.810,-.052],[.004,.004,.003]);
  }
  h.roundedBox('hardware',[0,.844,-.113],[.045,.055,.009],[.17,0,0]);
  h.roundedBox('straps',[0,.847,-.122],[.023,.034,.009],[.17,0,0]);
  h.roundedBox('vest',[0,.872,-.109],[.030,.014,.024],[.20,0,0]);
  for(const x of [-.015,.015])for(const y of [.827,.861])h.sphere('hardware',[x,y,-.122],[.003,.003,.002]);
  // Articulated ear-cup shells and their helmet rail mounts.
  for(const side of [-1,1]){
    h.sphere('straps',[side*.122,.757,.011],[.019,.055,.043]);
    h.roundedBox('clothDark',[side*.137,.757,.014],[.028,.078,.064],[.06,0,side*.07]);
    h.roundedBox('vest',[side*.153,.758,.014],[.009,.056,.044],[.06,0,side*.07]);
    h.box('hardware',[side*.160,.759,.014],[.003,.022,.016]);
    line(h,'hardware',[[side*.130,.823,.034],[side*.145,.803,.029],[side*.146,.788,.020]],.003);
    line(h,'straps',[[side*.095,.796,.062],[side*.094,.733,.036],[side*.074,.680,-.024],[0,.665,-.055]],.0045);
  }
  h.roundedBox('hardware',[.075,.692,-.009],[.019,.024,.012],[0,0,.25]);
  // Fitted balaclava covers the jaw but leaves the nose and temples visible.
  h.loft('clothDark',[[.565,.077,.069,.014],[.615,.081,.080,.005],
    [.658,.084,.092,-.005],[.698,.100,.105,-.006],[.734,.101,.106,-.005]]);
  line(h,'straps',[[-.080,.713,-.071],[0,.727,-.112],[.080,.713,-.071]],.0018);
  // Communication lead follows the rear shell; the short boom meets the mask.
  line(h,'straps',[[.144,.755,.037],[.125,.785,.086],[.069,.803,.124],[-.072,.802,.123],[-.139,.774,.049]],.003);
  line(h,'hardware',[[-.145,.744,-.014],[-.130,.729,-.072],[-.087,.727,-.119],[-.067,.729,-.125]],.003);
  h.roundedBox('straps',[-.065,.729,-.127],[.024,.013,.016],[0,-.18,0]);
  h.roundedBox('accent',[0,.874,.137],[.030,.012,.006]);
}

export function buildOperatorHead(p,team,{Batch}) {
  const h=new Batch(p);
  face(h);
  if(team===1)softWrap(h);else helmet(h);
  goggles(h);
  // Aim around the neck/head rather than the torso origin. The authored points
  // stay in the established bind space, while world.js can rotate this pivot.
  const head=new THREE.Group();head.name='head';head.position.y=.775;
  const geometry=h.finish('head_geometry');geometry.position.y=-.775;head.add(geometry);
  return head;
}
