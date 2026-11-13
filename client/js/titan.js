// Titan's heavy rifle silhouette is authored separately from the lighter
// rifles. Immutable detail is baked by material; only its bolt and magazine
// retain movable transforms for the firing and reload animations.
export function buildTitan(w, { Parts, MAT, mat, rails, marking }) {
  const body = new Parts(), magazine = new Parts(), bolt = new Parts(), handle = new Parts();
  const chassis = mat(0x6c7564, .38, .53);
  const steel = mat(0x54616b, .65, .32);
  const darkSteel = mat(0x29343e, .58, .35);
  const lens = mat(0x335b66, .62, .14);
  const PI = Math.PI;

  // Large machined receiver and separate lower chassis, with an open ejection
  // window above the magazine well instead of a solid slab on the right side.
  body.box(chassis, .106, .086, .365, 0, .005, -.104);
  body.tube(steel, .047, .345, 0, .065, -.104);
  body.box(darkSteel, .113, .018, .315, 0, -.044, -.11);
  body.box(darkSteel, .004, .039, .128, .049, .065, -.047);
  body.box(MAT.edge, .004, .006, .131, .052, .086, -.047);
  body.box(steel, .009, .007, .132, .053, .044, -.047);
  for (const z of [-.121, .025]) body.box(steel, .01, .042, .012, .051, .065, z);
  // Receiver screws, selector, trigger and glove-sized trigger guard.
  for (const side of [-1, 1]) {
    for (const z of [-.235, -.145, -.018, .063]) {
      body.bead(MAT.edge, side * .055, .008, z, .0047);
      body.box(darkSteel, .0015, .0018, .007, side * .059, .008, z);
    }
    body.box(darkSteel, .004, .025, .074, side * .055, -.007, -.18);
    body.box(MAT.edge, .002, .002, .065, side * .058, -.016, -.18);
    body.box(MAT.edge, .007, .01, .031, side * .057, .023, .042, 0, 0, side * .25);
  }
  body.box(MAT.rubber, .052, .157, .071, 0, -.119, .045, -.18);
  for (let k = 0; k < 7; k++) body.box(darkSteel, .055, .004, .064, 0, -.17 + k * .017, .049, -.18);
  body.box(steel, .015, .055, .015, 0, -.071, -.037);
  body.box(steel, .015, .014, .096, 0, -.094, -.001);
  body.box(MAT.edge, .009, .033, .009, 0, -.07, -.014, -.3);
  body.box(chassis, .073, .016, .086, 0, -.06, -.153);

  // Deep five-round magazine with ribbed sidewalls and brass visible at the
  // feed lips only when the magazine is lowered during a reload.
  magazine.box(darkSteel, .079, .127, .121, 0, -.118, -.16, -.035);
  magazine.box(steel, .086, .016, .131, 0, -.184, -.157, -.035);
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
    magazine.box(steel, .003, .089, .009, side * .041, -.119, -.198 + k * .04, -.035);
  }
  magazine.tube(MAT.brass, .011, .093, 0, -.049, -.163);

  // Ventilated forend surrounds the thick barrel without hiding its profile.
  body.box(chassis, .102, .023, .43, 0, -.025, -.487);
  for (const side of [-1, 1]) {
    body.box(chassis, .016, .062, .431, side * .052, .008, -.487);
    for (let k = 0; k < 6; k++) {
      const z = -.665 + k * .066;
      body.box(darkSteel, .0025, .02, .043, side * .061, .015, z);
      body.box(MAT.edge, .002, .002, .034, side * .063, .003, z);
      body.bead(MAT.edge, side * .061, -.014, z + .022, .0026);
    }
  }
  rails(body, .47, -.28, .115, .058);
  body.tube(darkSteel, .039, .179, 0, .065, -.339);
  body.tube(steel, .0275, .718, 0, .065, -.747);
  // Long shallow flutes and stepped barrel collars catch light at oblique angles.
  for (let k = 0; k < 8; k++) {
    const a = k * PI / 4;
    body.box(darkSteel, .0032, .0032, .508,
      Math.cos(a) * .0265, .065 + Math.sin(a) * .0265, -.797, 0, 0, a);
  }
  for (const z of [-.434, -.468, -1.063]) body.tube(MAT.edge, .029, .009, 0, .065, z);

  // Rectangular multi-port muzzle brake: actual open side channels between the
  // top/bottom plates and separating webs make its scale obvious in profile.
  const brakeZ = -1.163;
  body.box(darkSteel, .112, .013, .174, 0, .103, brakeZ);
  body.box(darkSteel, .112, .013, .174, 0, .027, brakeZ);
  for (const z of [-1.088, -1.139, -1.19, -1.239]) {
    body.box(steel, .112, .073, .014, 0, .065, z);
    body.tube(MAT.black, .021, .018, 0, .065, z - .002);
  }
  body.tube(MAT.black, .018, .023, 0, .065, -1.249);
  body.add('ring', MAT.edge, [.022,.022,.024], [0,.065,-1.257]);

  // Compact adjustable stock with a separate cheekpiece, twin support rods and
  // padded buttplate. Its near end remains clear of the viewmodel camera.
  body.box(steel, .074, .073, .052, 0, .007, .111);
  body.add('cylinder', MAT.edge, [.013,.088,.013], [0,.009,.11], [0,0,PI/2]);
  for (const side of [-1, 1]) body.box(darkSteel, .012, .028, .167, side * .027, -.014, .209);
  body.box(chassis, .079, .056, .164, 0, .041, .21);
  body.box(MAT.rubber, .082, .026, .146, 0, .077, .212);
  for (const z of [.174, .246]) body.box(MAT.edge, .013, .042, .018, 0, .011, z);
  body.box(steel, .073, .143, .024, 0, -.013, .302);
  body.box(MAT.rubber, .086, .151, .025, 0, -.013, .325);
  for (let k = 0; k < 7; k++) body.box(darkSteel, .086, .004, .027, 0, -.069 + k * .018, .326);
  body.box(MAT.black, .026, .042, .027, 0, -.071, .261);
  body.add('cylinder', MAT.edge, [.012,.021,.012], [.049,.026,.209], [0,0,PI/2]);

  // Wide 12x telescopic optic, two real scope rings, adjustment turrets, knurled
  // focus collars and coated objective/ocular lenses.
  const scopeY = .216;
  for (const z of [-.267, -.071]) {
    body.box(darkSteel, .057, .053, .034, 0, .145, z);
    body.add('ring', steel, [.041,.041,.083], [0,scopeY,z]);
    for (const side of [-1, 1]) body.bead(MAT.edge, side * .042, scopeY, z, .004);
  }
  body.tube(darkSteel, .035, .346, 0, scopeY, -.17);
  body.tube(steel, .054, .109, 0, scopeY, -.394);
  body.tube(darkSteel, .059, .032, 0, scopeY, -.453);
  body.tube(lens, .048, .003, 0, scopeY, -.471);
  body.add('ring', MAT.edge, [.052,.052,.032], [0,scopeY,-.472]);
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
    body.box(MAT.edge, .002, .011, .003, Math.cos(a) * .029, .286, -.17 + Math.sin(a) * .029, 0, a, 0);
  }
  body.box(MAT.edge, .009, .002, .032, 0, .254, -.21);

  // Folded bipod legs follow the barrel forward, with pivots, spring housings,
  // telescoping sections and rubber feet rather than crossing the sightline.
  for (const side of [-1, 1]) {
    body.add('cylinder', steel, [.017,.028,.017], [side * .061,-.033,-.51], [0,0,PI/2]);
    body.box(darkSteel, .021, .027, .235, side * .077, -.069, -.625, -.08, side * .08);
    body.box(steel, .013, .018, .109, side * .086, -.079, -.779, -.08, side * .08);
    body.box(MAT.rubber, .042, .024, .029, side * .091, -.086, -.833, -.08);
    for (let k = 0; k < 5; k++) body.box(MAT.edge, .024, .004, .004, side * .074, -.07, -.55 - k * .013, -.08);
  }

  // The action translates along Z. Handle rotation is around the bolt axis;
  // its arm geometry starts at that axis so a Z rotation lifts the knob.
  bolt.tube(MAT.silver, .022, .18, 0, .065, -.065);
  bolt.box(darkSteel, .017, .014, .095, 0, .08, -.067);
  bolt.tube(steel, .029, .033, 0, .065, .027);
  handle.box(steel, .081, .013, .014, .041, -.003, 0, 0, 0, -.12);
  handle.add('sphere', darkSteel, [.021,.023,.022], [.088,-.009,0]);
  for (let k = 0; k < 4; k++) handle.box(MAT.edge, .022, .002, .023, .088, -.023 + k * .008, 0);
  const action = bolt.build('bolt_action'), lever = handle.build('bolt_handle');
  lever.position.set(0, .065, .027);
  action.add(lever);
  action.userData = { travel:.145, handleLift:1.05 };

  marking(w, body, .0552, .031, -.142, .224);
  const model = body.build(); model.add(magazine.build('magazine'), action);
  model.userData = {
    muzzle:[0,.065,-1.272], sightY:scopeY, length:1.61,
    boltAction:true, boltTravel:.145, hip:[.215,-.175,-.58],
  };
  return model;
}
