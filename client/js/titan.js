// Titan's heavy rifle silhouette is authored separately from the lighter
// rifles. Immutable detail is baked by material; only its bolt and magazine
// retain movable transforms for the firing and reload animations.
import { profile, hollowTube, turned, finish } from './weapon-detail.js';

export function buildTitan(w, { Parts, MAT, mat, rails, marking }) {
  const body = new Parts(), magazine = new Parts(), bolt = new Parts(), handle = new Parts();
  const chassis = finish('polymer',0x77806b);
  const steel = finish('steel',0x657078);
  const darkSteel = finish('blued',0x303b43);
  const lens = mat(0x335b66, .62, .14), rubber=finish('rubber',0x2d3535);
  const PI = Math.PI;

  // Large machined receiver and separate lower chassis, with an open ejection
  // window above the magazine well instead of a solid slab on the right side.
  body.add(profile([[-.287,.042],[-.273,.052],[.067,.048],[.085,.027],
    [.074,-.025],[-.01,-.042],[-.245,-.042],[-.284,-.027]],.096,.004),chassis,[1,1,1]);
  body.add(turned([[-.286,.039],[-.27,.045],[-.151,.045]]),darkSteel,[1,1,1],[0,.065,0]);
  body.add(hollowTube(.043,.024,.041),darkSteel,[1,1,1],[0,.065,.043]);
  // Open side windows reveal the translating bolt. The upper bridge and rails
  // are independent, so the openings remain empty when the bolt retracts.
  for(const side of [-1,1]) body.add(profile([[-.157,.039],[-.157,.103],
    [.029,.103],[.029,.039]],.009,.0015,
    [[[-.135,.051],[-.135,.088],[.008,.088],[.008,.051]]]),steel,[1,1,1],[side*.042,0,0]);
  body.box(darkSteel,.078,.007,.181,0,.105,-.065);
  body.add(profile([[-.267,-.041],[-.233,-.056],[-.019,-.056],[.076,-.027],
    [.064,-.017],[-.024,-.04]],.106,.002),darkSteel,[1,1,1]);
  // Receiver screws, selector, trigger and glove-sized trigger guard.
  for (const side of [-1, 1]) {
    for (const z of [-.235, -.145, -.018, .063]) {
      body.bead(steel, side * .055, .008, z, .0047);
      body.box(darkSteel, .0015, .0018, .007, side * .059, .008, z);
    }
    body.box(darkSteel, .004, .025, .074, side * .055, -.007, -.18);
    body.box(steel, .002, .002, .065, side * .058, -.016, -.18);
    body.box(steel, .007, .01, .031, side * .057, .023, .042, 0, 0, side * .25);
  }
  body.add(profile([[.017,-.04],[.073,-.043],[.092,-.164],[.08,-.193],
    [.034,-.193],[.015,-.175],[-.002,-.073]],.052,.006),rubber,[1,1,1]);
  for (let k = 0; k < 7; k++) body.box(darkSteel, .055, .004, .064, 0, -.17 + k * .017, .049, -.18);
  body.add(profile([[-.055,-.035],[-.061,-.069],[-.046,-.105],[.029,-.107],
    [.05,-.072],[.034,-.044]],.024,.002,
    [[[-.044,-.048],[-.047,-.067],[-.034,-.091],[.023,-.092],[.035,-.069],[.026,-.053]]]),steel,[1,1,1]);
  body.box(steel, .009, .033, .009, 0, -.07, -.014, -.3);
  body.box(chassis, .073, .016, .086, 0, -.06, -.153);

  // Deep five-round magazine with ribbed sidewalls and brass visible at the
  // feed lips only when the magazine is lowered during a reload.
  magazine.add(profile([[-.222,-.048],[-.102,-.048],[-.103,-.165],
    [-.116,-.182],[-.205,-.183],[-.221,-.17]],.078,.003),darkSteel,[1,1,1]);
  magazine.box(steel, .086, .016, .131, 0, -.184, -.157, -.035);
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
    magazine.box(steel, .003, .089, .009, side * .041, -.119, -.198 + k * .04, -.035);
  }
  magazine.tube(MAT.brass, .011, .093, 0, -.049, -.163);

  // Ventilated forend surrounds the thick barrel without hiding its profile.
  body.add(profile([[-.711,-.015],[-.692,-.037],[-.282,-.037],
    [-.267,-.025],[-.274,-.012]],.097,.003),chassis,[1,1,1]);
  for(const side of [-1,1]) {
    const ports=[];
    for(let k=0;k<6;k++) {
      const z=-.677+k*.066;ports.push([[z-.021,-.002],[z-.021,.025],
        [z+.02,.025],[z+.023,.019],[z+.023,-.002]]);
      body.bead(steel,side*.061,-.016,z+.024,.0026);
    }
    body.add(profile([[-.712,-.025],[-.712,.032],[-.698,.044],[-.278,.044],
      [-.268,.031],[-.268,-.025]],.014,.0018,ports),chassis,[1,1,1],[side*.05,0,0]);
  }
  rails(body, .47, -.28, .115, .058);
  body.tube(darkSteel, .039, .179, 0, .065, -.339);
  body.add(turned([[-1.105,.024],[-1.072,.026],[-.47,.0275],[-.391,.032]]),steel,[1,1,1],[0,.065,0]);
  // Long shallow flutes and stepped barrel collars catch light at oblique angles.
  for (let k = 0; k < 8; k++) {
    const a = k * PI / 4;
    body.box(darkSteel, .0032, .0032, .508,
      Math.cos(a) * .0265, .065 + Math.sin(a) * .0265, -.797, 0, 0, a);
  }
  for (const z of [-.434, -.468, -1.063]) body.tube(steel, .029, .009, 0, .065, z);

  // Rectangular multi-port muzzle brake: actual open side channels between the
  // top/bottom plates and separating webs make its scale obvious in profile.
  const brakeZ = -1.163;
  body.box(darkSteel,.112,.012,.174,0,.103,brakeZ);
  body.box(darkSteel,.112,.012,.174,0,.027,brakeZ);
  for(const z of [-1.088,-1.139,-1.19,-1.239]) {
    // Split separating webs keep a clear central bore through every baffle.
    for(const side of [-1,1])body.box(steel,.029,.064,.011,side*.042,.065,z);
    body.add(hollowTube(.025,.013,.011),steel,[1,1,1],[0,.065,z]);
  }
  body.add(hollowTube(.025,.013,.021),darkSteel,[1,1,1],[0,.065,-1.253]);
  body.add(hollowTube(.026,.014,.004),steel,[1,1,1],[0,.065,-1.265]);

  // Compact adjustable stock with a separate cheekpiece, twin support rods and
  // padded buttplate. Its near end remains clear of the viewmodel camera.
  body.box(steel, .074, .073, .052, 0, .007, .111);
  body.add('cylinder', steel, [.013,.088,.013], [0,.009,.11], [0,0,PI/2]);
  for (const side of [-1, 1]) body.box(darkSteel, .012, .028, .167, side * .027, -.014, .209);
  body.add(profile([[.12,.02],[.135,.065],[.278,.069],[.296,.049],[.277,.022]],.076,.004),chassis,[1,1,1]);
  body.add(profile([[.137,.064],[.154,.088],[.273,.091],[.289,.07]],.079,.004),rubber,[1,1,1]);
  for (const z of [.174, .246]) body.box(steel, .013, .042, .018, 0, .011, z);
  body.box(steel, .073, .143, .024, 0, -.013, .302);
  body.box(rubber, .086, .151, .025, 0, -.013, .325);
  for (let k = 0; k < 7; k++) body.box(darkSteel, .086, .004, .027, 0, -.069 + k * .018, .326);
  body.box(darkSteel, .026, .042, .027, 0, -.071, .261);
  body.add('cylinder', steel, [.012,.021,.012], [.049,.026,.209], [0,0,PI/2]);

  // Wide 12x telescopic optic, two real scope rings, adjustment turrets, knurled
  // focus collars and coated objective/ocular lenses.
  const scopeY = .216;
  for (const z of [-.267, -.071]) {
    body.box(darkSteel, .057, .053, .034, 0, .145, z);
    body.add('ring', steel, [.041,.041,.083], [0,scopeY,z]);
    for (const side of [-1, 1]) body.bead(steel, side * .042, scopeY, z, .004);
  }
  body.add(turned([[-.45,.054],[-.37,.054],[-.32,.035],[.001,.035],[.018,.041]]),darkSteel,[1,1,1],[0,scopeY,0]);
  body.tube(darkSteel, .059, .032, 0, scopeY, -.453);
  body.tube(lens, .048, .003, 0, scopeY, -.471);
  body.add('ring', steel, [.052,.052,.032], [0,scopeY,-.472]);
  body.tube(darkSteel, .043, .074, 0, scopeY, .031);
  body.tube(lens, .034, .003, 0, scopeY, .07);
  body.add('ring', steel, [.039,.039,.023], [0,scopeY,.071]);
  for (let k = 0; k < 15; k++) {
    const a = k * PI * 2 / 15;
    for (const [z, radius] of [[-.42, .055], [.032, .045]]) {
      body.box(steel, .004, .004, .022,
        Math.cos(a) * radius, scopeY + Math.sin(a) * radius, z, 0, 0, a);
    }
  }
  body.add('cylinder', darkSteel, [.027,.045,.027], [0,.266,-.17]);
  body.add('cylinder', steel, [.029,.012,.029], [0,.291,-.17]);
  body.add('cylinder', darkSteel, [.024,.045,.024], [.042,scopeY,-.17], [0,0,PI/2]);
  body.add('cylinder', steel, [.026,.012,.026], [.068,scopeY,-.17], [0,0,PI/2]);
  for (let k = 0; k < 9; k++) {
    const a = k * PI * 2 / 9;
    body.box(steel, .002, .011, .003, Math.cos(a) * .029, .286, -.17 + Math.sin(a) * .029, 0, a, 0);
  }
  body.box(steel, .009, .002, .032, 0, .254, -.21);

  // Folded bipod legs follow the barrel forward, with pivots, spring housings,
  // telescoping sections and rubber feet rather than crossing the sightline.
  for (const side of [-1, 1]) {
    body.add('cylinder', steel, [.017,.028,.017], [side * .061,-.033,-.51], [0,0,PI/2]);
    body.box(darkSteel, .021, .027, .235, side * .077, -.069, -.625, -.08, side * .08);
    body.box(steel, .013, .018, .109, side * .086, -.079, -.779, -.08, side * .08);
    body.box(rubber, .042, .024, .029, side * .091, -.086, -.833, -.08);
    for (let k = 0; k < 5; k++) body.box(steel, .024, .004, .004, side * .074, -.07, -.55 - k * .013, -.08);
  }

  // The action translates along Z. Handle rotation is around the bolt axis;
  // its arm geometry starts at that axis so a Z rotation lifts the knob.
  bolt.tube(steel, .022, .18, 0, .065, -.065);
  bolt.box(darkSteel, .017, .014, .095, 0, .08, -.067);
  bolt.tube(steel, .029, .033, 0, .065, .027);
  handle.box(steel, .081, .013, .014, .041, -.003, 0, 0, 0, -.12);
  handle.add('sphere', darkSteel, [.021,.023,.022], [.088,-.009,0]);
  for (let k = 0; k < 4; k++) handle.box(steel, .022, .002, .023, .088, -.023 + k * .008, 0);
  const action = bolt.build('bolt_action'), lever = handle.build('bolt_handle');
  lever.position.set(0, .065, .027);
  action.add(lever);
  action.userData = { travel:.145, handleLift:1.05 };

  marking(w, body, .0552, .031, -.142, .224);
  const model = body.build(); model.add(magazine.build('magazine'), action);
  model.userData = {
    muzzle:[0,.065,-1.272], sightY:scopeY, length:1.61,
    boltAction:true, boltTravel:.145, hip:[.215,-.175,-.58],
    supportGrip:[-.025,.015,-.35],authoredDetail:true,
  };
  return model;
}
