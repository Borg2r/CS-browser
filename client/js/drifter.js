// Original lightweight marksman rifle: sculpted composite furniture, an open
// receiver and a compact fixed-power optic. Static parts share material batches.
import { profile, hollowTube, turned, finish } from './weapon-detail.js';

export function buildDrifter(w, { Parts, MAT, screw, marking }) {
  const body = new Parts(), magazine = new Parts(), action = new Parts();
  const steel = finish('blued', 0x39454c), edge = finish('steel', 0x727e82);
  const stock = finish('polymer', 0x626b4d), dark = finish('rubber', 0x252c2c);
  const stainless = finish('stainless', 0x9ba5a6);
  // A thumbhole stock has an actual opening and a curved wrist. Its raised comb
  // flows into the narrow receiver bed instead of a separate rectangular butt.
  const furniture = [[.335,.038],[.29,.046],[.175,.048],[.107,.027],[.038,.014],
    [-.215,.005],[-.53,-.004],[-.56,-.019],[-.55,-.049],[-.34,-.067],
    [-.177,-.062],[-.092,-.058],[-.045,-.098],[.002,-.157],
    [.045,-.166],[.084,-.132],[.13,-.114],[.31,-.119],[.337,-.103]];
  const thumb = [[.063,-.034],[.116,-.03],[.19,-.039],[.203,-.066],
    [.187,-.085],[.125,-.091],[.089,-.09],[.061,-.062]];
  body.add(profile(furniture,.066,.005,[thumb]),stock,[1,1,1]);
  // Thin contoured cheekpiece and a separate compliant buttpad.
  body.add(profile([[.305,.044],[.28,.064],[.165,.064],[.126,.047],
    [.138,.031],[.296,.031]],.074,.004),dark,[1,1,1]);
  body.add(profile([[.341,.039],[.352,.027],[.354,-.106],[.337,-.125],
    [.319,-.119],[.326,.035]],.076,.004),dark,[1,1,1]);
  for (let k=0;k<6;k++) body.box(steel,.078,.003,.003,0,-.092+k*.021,.355);
  for (const side of [-1,1]) {
    // Raised grip pads and cast-in finger grooves follow the angled wrist.
    body.add(profile([[.03,-.057],[.055,-.075],[.042,-.14],[.015,-.145],
      [-.024,-.099]],.002,.001),dark,[1,1,1],[side*.036,0,0]);
    for(let k=0;k<4;k++) body.box(stock,.003,.003,.032,side*.038,-.085-k*.014,.018+k*.004,-.22);
    body.add(profile([[-.495,-.016],[-.265,-.02],[-.256,-.046],[-.488,-.044]],.002,.001),dark,[1,1,1],[side*.037,0,0]);
    for (const z of [-.49,-.27,.257]) screw(body,side*.04,-.029,z,.0035);
  }
  // Separate receiver rings and side rails leave a real open action window.
  body.add(hollowTube(.031,.023,.062),steel,[1,1,1],[0,.043,-.227]);
  body.add(hollowTube(.031,.022,.044),steel,[1,1,1],[0,.043,.007]);
  for(const side of [-1,1]) {
    body.add(profile([[-.195,.018],[-.195,.052],[-.176,.055],[-.176,.029],
      [-.022,.029],[-.022,.053],[-.014,.052],[-.014,.015]],.009,.001),steel,[1,1,1],[side*.026,0,0]);
    body.box(edge,.002,.003,.157,side*.031,.029,-.099);
  }
  body.add(profile([[-.235,.011],[-.233,-.026],[-.052,-.036],[-.025,-.022],
    [.027,-.016],[.027,.012]],.059,.002),steel,[1,1,1]);
  action.add(turned([[-.18,.019],[-.173,.022],[-.027,.022],[-.019,.018]]),stainless,[1,1,1],[0,.043,0]);
  action.box(steel,.012,.008,.132,.019,.057,-.10);
  action.box(steel,.047,.011,.021,.042,.042,-.025,0,0,-.1);
  action.bead(dark,.066,.038,-.025,.011);
  body.box(edge,.012,.009,.027,-.034,.041,.013);
  // Tapered barrel and recessed crown. The bore extends behind the crown so
  // oblique inspection sees a tube, rather than a dark circle on a solid cap.
  body.add(turned([[-.829,.014],[-.80,.0145],[-.405,.021],[-.29,.023],[-.252,.025]]),steel,[1,1,1],[0,.043,0]);
  body.add(hollowTube(.0148,.0058,.057),steel,[1,1,1],[0,.043,-.849]);
  body.add(hollowTube(.0155,.0064,.005),edge,[1,1,1],[0,.043,-.879]);
  for(const z of [-.28,-.32])body.add(hollowTube(.0255,.022,.006),edge,[1,1,1],[0,.043,z]);
  // Contoured trigger bow, with a clear opening around the curved trigger.
  body.add(profile([[-.059,-.039],[-.069,-.063],[-.058,-.099],[-.035,-.109],
    [.011,-.102],[.033,-.064],[.025,-.042]],.023,.0015,
    [[[-.05,-.051],[-.054,-.064],[-.044,-.088],[-.029,-.094],
      [.002,-.088],[.018,-.062],[.012,-.051]]]),steel,[1,1,1]);
  body.add(profile([[-.018,-.043],[-.027,-.05],[-.027,-.071],[-.013,-.085],
    [-.006,-.08],[-.016,-.067],[-.013,-.051]],.008,.001),edge,[1,1,1]);
  // Ten-round detachable box magazine retains an independent reload transform.
  magazine.add(profile([[-.198,-.027],[-.083,-.027],[-.087,-.136],
    [-.101,-.152],[-.185,-.153],[-.201,-.137]],.052,.002),steel,[1,1,1]);
  magazine.box(dark,.061,.012,.119,0,-.153,-.143);
  for(const side of [-1,1])for(const z of [-.173,-.135,-.098]) {
    magazine.add(profile([[z-.004,-.052],[z+.004,-.052],[z+.004,-.128],
      [z-.004,-.128]],.002,.001),edge,[1,1,1],[side*.028,0,0]);
  }
  magazine.tube(MAT.brass,.007,.08,0,-.025,-.14);
  // The compact optic has tapered bells, open rims, recessed coated glass,
  // capped turrets, separate split-ring mounts and focus-ring machining.
  const scopeY=.179;
  for(const z of [-.214,-.036]) {
    body.box(steel,.041,.019,.026,0,.088,z);
    body.box(steel,.021,.057,.023,0,.126,z);
    body.add(hollowTube(.031,.026,.025),edge,[1,1,1],[0,scopeY,z]);
    for(const side of [-1,1])screw(body,side*.034,scopeY,z,.003);
  }
  body.add(turned([[-.359,.038],[-.312,.038],[-.271,.026],[-.015,.026],
    [.012,.033],[.056,.033]]),steel,[1,1,1],[0,scopeY,0]);
  body.add(hollowTube(.039,.033,.021),dark,[1,1,1],[0,scopeY,-.364]);
  body.add(hollowTube(.0345,.028,.017),dark,[1,1,1],[0,scopeY,.059]);
  const glass=finish('stainless',0x315866);
  body.tube(glass,.032,.0015,0,scopeY,-.366);
  body.tube(glass,.027,.0015,0,scopeY,.061);
  body.add('cylinder',steel,[.018,.027,.018],[0,scopeY+.032,-.135]);
  body.add('cylinder',edge,[.019,.005,.019],[0,scopeY+.048,-.135]);
  body.add('cylinder',steel,[.014,.022,.014],[.032,scopeY,-.135],[0,0,Math.PI/2]);
  for(let k=0;k<16;k++) {
    const a=k*Math.PI/8;
    body.box(edge,.002,.002,.017,Math.cos(a)*.034,scopeY+Math.sin(a)*.034,.029,0,0,a);
    body.box(dark,.002,.010,.002,Math.cos(a)*.019,scopeY+.04,-.135+Math.sin(a)*.019,0,a,0);
  }
  // Sling sockets and a folded narrow bipod stay below the barrel sightline.
  for(const z of [-.48,.281]) {
    body.box(steel,.016,.008,.018,0,-.066,z);
    body.add('ring',edge,[.012,.017,.011],[0,-.073,z],[Math.PI/2,0,0]);
  }
  for(const side of [-1,1]) {
    body.add('cylinder',edge,[.012,.014,.012],[side*.04,-.045,-.43],[0,0,Math.PI/2]);
    body.add(profile([[-.433,-.046],[-.627,-.06],[-.638,-.072],[-.44,-.066]],.015,.002),steel,[1,1,1],[side*.048,0,0]);
    body.box(dark,.023,.023,.027,side*.048,-.067,-.637);
  }
  marking({...w,name:'DRIFTER LR  ·  7.62'},body,.033,.003,-.15,.16);
  const model=body.build();model.add(magazine.build('magazine'),action.build('slide'));
  model.userData={muzzle:[0,.043,-.883],sightY:scopeY,length:1.24,
    hip:[.205,-.165,-.66],supportGrip:[-.025,.014,-.34],authoredDetail:true};
  return model;
}
