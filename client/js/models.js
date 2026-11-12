// Original procedural weapon assets. Static details are baked by material and
// shared between instances; only slides, hands and magazines need transforms.
import * as THREE from '../vendor/three.module.min.js';

const bevelShape = new THREE.Shape();
bevelShape.moveTo(-.46, -.46); bevelShape.lineTo(.46, -.46); bevelShape.lineTo(.46, .46); bevelShape.lineTo(-.46, .46); bevelShape.closePath();
const bevelBox = new THREE.ExtrudeGeometry(bevelShape, { depth: .92, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .04, bevelThickness: .04, curveSegments: 1 });
bevelBox.translate(0, 0, -.46);
const primitive = {
  box: bevelBox,
  plane: new THREE.PlaneGeometry(1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
  sphere: new THREE.SphereGeometry(1, 12, 8),
  ring: new THREE.TorusGeometry(1, 0.16, 5, 20),
};
const materials = new Map(), templates = new Map();
function mat(color, metalness = 0, roughness = 0.7) {
  const key = `${color}/${metalness}/${roughness}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, metalness, roughness }));
  return materials.get(key);
}
const MAT = {
  steel: mat(0x69757c, 0.35, 0.42), black: mat(0x303b42, 0.22, 0.46),
  edge: mat(0x9aa7aa, 0.42, 0.38), rubber: mat(0x303733),
  brass: mat(0xd0a85d, 0.42, 0.3), silver: mat(0xc5cdcb, 0.5, 0.3),
  glove: mat(0x494b3c), gloveDark: mat(0x262c29), sleeve: mat(0x687361),
  leather: mat(0x654c32), sight: mat(0xc4dd91, 0.2, 0.32),
};
const scratch = new THREE.Object3D();
class Parts {
  constructor() { this.buckets = new Map(); }
  add(shape, material, size, position = [0, 0, 0], rotation = [0, 0, 0]) {
    const key = material.uuid;
    if (!this.buckets.has(key)) this.buckets.set(key, { material, positions: [], normals: [], uvs: [], indices: [] });
    const b = this.buckets.get(key), g = primitive[shape];
    scratch.position.set(...position); scratch.rotation.set(...rotation); scratch.scale.set(...size); scratch.updateMatrix();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(scratch.matrix);
    const p = new THREE.Vector3(), n = new THREE.Vector3(), a = g.attributes, offset = b.positions.length / 3;
    for (let i = 0; i < a.position.count; i++) {
      p.fromBufferAttribute(a.position, i).applyMatrix4(scratch.matrix); b.positions.push(p.x, p.y, p.z);
      n.fromBufferAttribute(a.normal, i).applyMatrix3(normalMatrix).normalize(); b.normals.push(n.x, n.y, n.z);
      b.uvs.push(a.uv.getX(i), a.uv.getY(i));
    }
    if (g.index) { for (const index of g.index.array) b.indices.push(index + offset); }
    else { for (let i = 0; i < a.position.count; i++) b.indices.push(i + offset); }
  }
  box(m, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { this.add('box', m, [w, h, d], [x, y, z], [rx, ry, rz]); }
  tube(m, radius, length, x, y, z) { this.add('cylinder', m, [radius, length, radius], [x, y, z], [Math.PI / 2, 0, 0]); }
  bead(m, x, y, z, radius = .006) { this.add('sphere', m, [radius, radius, radius], [x, y, z]); }
  build(name = '') {
    const group = new THREE.Group(); group.name = name;
    for (const b of this.buckets.values()) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2)); geometry.setIndex(b.indices);
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, b.material); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
    }
    return group;
  }
}

export function weaponInfo(weapon) {
  return typeof weapon === 'number' ? { cls: weapon, id: `class_${weapon}`, zoom: 0, dual: false } : weapon || { cls: 0, id: 'knife' };
}
function ironSights(p, frontZ, rearZ, y, frontBase = .078) {
  p.box(MAT.black, .029, .008, .012, 0, y - .010, rearZ);
  for (const x of [-.011, .011]) {
    p.box(MAT.steel, .006, .012, .012, x, y + .001, rearZ);
    p.bead(MAT.sight, x, y + .005, rearZ + .0065, .0015);
  }
  p.box(MAT.black, .005, .014, .009, 0, y - .001, frontZ);
  const pedestalHeight = y - .004 - frontBase;
  if (pedestalHeight > 0) p.box(MAT.black, .01, pedestalHeight, .012, 0, frontBase + pedestalHeight / 2, frontZ);
  p.bead(MAT.sight, 0, y + .005, frontZ + .005, .0015);
}
function rails(p, length, z, y, width = .055) {
  p.box(MAT.black, width, .008, length, 0, y, z);
  for (let q = -length / 2; q < length / 2; q += .022) p.box(MAT.steel, width + .004, .012, .011, 0, y + .006, z + q);
}
function triggerGuard(p, z = .035, y = -.055) {
  p.box(MAT.black, .012, .055, .014, 0, y, z - .055);
  p.box(MAT.black, .012, .012, .08, 0, y - .026, z - .022);
  p.box(MAT.silver, .008, .03, .009, 0, y, z - .023, -.28);
}
function addGrip(p, furniture, z = .05, y = -.09, height = .15) {
  p.box(furniture, .045, height, .062, 0, y, z, -.2);
  for (let k = 0; k < 5; k++) p.box(MAT.black, .048, .004, .05, 0, y - height * .3 + k * height * .12, z + .013, -.2);
  p.bead(MAT.edge, .025, y + height * .25, z, .004);
  p.bead(MAT.edge, -.025, y - height * .22, z + .014, .004);
}
function marking(w, p, x, y, z, width = .13) {
  if (typeof document === 'undefined') return;
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#c0c6b5'; g.font = 'bold 31px monospace'; g.fillText((w.name || w.id).replace('Twin ', '').toUpperCase(), 8, 39);
  g.font = '20px monospace'; g.fillStyle = '#869385'; g.fillText(`BP  •  ${w.cls === 1 ? '9 × 19' : 'PRECISION SYSTEMS'}  •  0047`, 10, 82);
  g.fillRect(10, 103, 190, 3);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, depthWrite: false, roughness: .52, metalness: .25, polygonOffset: true, polygonOffsetFactor: -1 });
  p.add('plane', material, [width,.032,1], [x,y,z], [0,Math.PI/2,0]);
}
function pistol(w) {
  const body = new Parts(), slide = new Parts();
  const heavy = /mammoth|viper/.test(w.id), long = /hornet/.test(w.id);
  const length = heavy ? .29 : long ? .265 : .235;
  const finish = heavy ? MAT.silver : /bulwark/.test(w.id) ? mat(0x827966, .65, .34) : MAT.steel;
  const furniture = heavy ? MAT.leather : MAT.rubber;
  body.box(MAT.black, .048, .043, length * .72, 0, .008, -.085);
  addGrip(body, furniture, .014, -.09, .14); triggerGuard(body, .005, -.047);
  body.box(MAT.steel, .048, .012, .067, 0, -.16, .026);
  body.tube(MAT.black, .013, length, 0, .045, -.11);
  body.tube(MAT.silver, .015, .018, 0, .045, -.11 - length / 2);
  body.tube(MAT.black, .010, .020, 0, .045, -.121 - length / 2);
  body.box(MAT.edge, .009, .008, .038, -.027, .012, -.015);
  body.box(MAT.black, .016, .02, .017, 0, .047, .036, .3);
  slide.box(finish, .055, .052, length, 0, .053, -.105);
  slide.box(MAT.black, .058, .008, length * .78, 0, .022, -.107);
  slide.box(MAT.black, .023, .007, .052, .02, .082, -.09);
  slide.box(MAT.brass, .012, .004, .027, .02, .084, -.085);
  for (let i = 0; i < 8; i++) for (const side of [-1, 1]) slide.box(MAT.black, .002, .032, .003, side * .028, .055, -.016 - i * .006, 0, 0, -.16 * side);
  ironSights(slide, -.105 - length / 2 + .025, -.105 + length / 2 - .015, .09);
  marking(w, slide, .0281, .055, -.12, length*.63);
  const g = body.build(); g.add(slide.build('slide'));
  g.userData = { muzzle: [0, .045, -.124 - length / 2], sightY: .095, length };
  return g;
}
function longGun(w) {
  const p = new Parts(), magazine = new Parts();
  const cls = w.cls, bullpup = /bastion|volt/.test(w.id), wood = /rook|ram|jackal/.test(w.id);
  const suppressed = /cricket/.test(w.id), heavy = cls === 6, sniper = cls === 5, smg = cls === 3, shotgun = cls === 2;
  const scoped = sniper || (w.zoom || 0) >= 2;
  const furniture = wood ? mat(0x795034, .05, .73) : /sentinel|sabre|drifter/.test(w.id) ? mat(0x7a7b58, .12, .68) : /cinder|bastion/.test(w.id) ? mat(0x9e8b67, .13, .63) : MAT.rubber;
  const receiver = /longbow|viper/.test(w.id) ? mat(0x8b947b, .55, .4) : MAT.steel;
  const barrelLength = sniper ? .52 : shotgun ? .44 : smg ? .22 : .35;
  const handguardLength = sniper ? .28 : smg ? .23 : shotgun ? .27 : .33;
  const bodyLength = bullpup ? .36 : smg ? .3 : heavy ? .48 : .39;
  const muzzleZ = -.36 - barrelLength;
  p.box(receiver, heavy ? .10 : .067, .085, bodyLength, 0, .027, -.10);
  p.box(MAT.black, .052, .036, bodyLength * .85, 0, -.027, -.08);
  p.box(furniture, .068, .077, handguardLength, 0, .025, -.32);
  p.tube(MAT.black, shotgun ? .02 : .014, barrelLength, 0, .045, -.36 - barrelLength / 2);
  p.tube(MAT.steel, .019, .055, 0, .045, muzzleZ);
  p.tube(MAT.black, .012, .015, 0, .045, muzzleZ - .034);
  for (const side of [-1, 1]) {
    p.box(MAT.edge, .004, .011, .09, side * .035, .027, -.125);
    p.box(MAT.black, .006, .022, .075, side * .037, .035, -.19);
    for (let i = 0; i < 6; i++) p.box(MAT.black, .004, .017, .018, side * .036, .035, -.27 - i * .026);
    for (const z of [-.01, -.09, -.22]) p.bead(MAT.edge, side * .037, .008, z, .004);
  }
  p.box(MAT.black, .022, .012, .014, .043, .027, -.04);
  p.box(MAT.steel, .06, .012, .012, 0, .067, -.005);
  addGrip(p, furniture, bullpup ? -.09 : .065); triggerGuard(p, bullpup ? -.12 : .045);
  const stockLength = bullpup ? .21 : smg ? .18 : .28;
  p.box(furniture, .052, .085, stockLength, 0, -.005, .17);
  p.box(MAT.black, .063, .13, .023, 0, -.015, .17 + stockLength / 2);
  p.box(furniture, .064, .035, stockLength * .7, 0, .048, .17);
  p.tube(MAT.steel, .014, .10, 0, .015, .055);
  if (wood) for (let k = 0; k < 3; k++) p.box(MAT.leather, .055, .004, stockLength * .6, 0, -.028 + k * .014, .18, .02);
  if (heavy) {
    magazine.box(mat(0x5e664b), .14, .17, .15, .015, -.10, -.12);
    for (let k = 0; k < 7; k++) magazine.tube(MAT.brass, .006, .035, .067, -.025, -.16 + k * .012);
  } else if (!shotgun) {
    const mz = bullpup ? .065 : -.16;
    magazine.box(MAT.black, .042, smg && /volt/.test(w.id) ? .10 : .20, .075, 0, -.11, mz, -.13);
    magazine.box(MAT.steel, .047, .014, .079, 0, -.21, mz + .014, -.13);
    for (let k = 0; k < 4; k++) for (const side of [-1, 1]) magazine.box(MAT.steel, .003, .14, .004, side * .022, -.12, mz - .024 + k * .016, -.13);
  }
  if (shotgun) {
    p.tube(MAT.steel, .017, .42, 0, -.002, -.40);
    p.box(furniture, .075, .065, .18, 0, -.008, -.36);
    for (let k = 0; k < 9; k++) p.box(MAT.black, .078, .005, .008, 0, .025, -.43 + k * .018);
    for (let k = 0; k < 4; k++) p.tube(MAT.brass, .009, .046, -.043, .01, -.055 - k * .023);
  }
  if (suppressed) {
    p.tube(MAT.black, .031, .20, 0, .045, muzzleZ - .055);
    for (let k = 0; k < 5; k++) p.tube(MAT.steel, .032, .005, 0, .045, muzzleZ - .12 + k * .035);
  }
  if (!wood || scoped) rails(p, .25, -.12, .078, heavy ? .072 : .053);
  let sightY = .110;
  if (scoped) {
    sightY = sniper ? .172 : .15;
    for (const z of [-.22, -.07]) p.box(MAT.black, .05, .05, .026, 0, .103, z);
    if (sniper) {
      p.tube(MAT.black, .032, .26, 0, .164, -.14);
      p.tube(MAT.steel, .043, .065, 0, .164, -.285);
      p.tube(MAT.black, .04, .046, 0, .164, .001);
      p.tube(mat(0x284c52, .55, .19), .031, .002, 0, .164, .025);
      p.add('cylinder', MAT.black, [.018, .024, .018], [0, .205, -.15]);
      p.box(MAT.steel, .055, .018, .037, .02, .167, -.15);
    } else {
      p.add('ring', MAT.black, [.034, .034, .06], [0, .145, -.12]);
      p.box(MAT.black, .065, .013, .085, 0, .108, -.12);
      p.bead(mat(0xe04c36, .2, .3), 0, .15, -.16, .0025);
    }
  } else ironSights(p, -.31 - handguardLength / 2, .015, .105, .06);
  if (sniper || heavy) for (const x of [-.025, .025]) {
    p.box(MAT.black, .012, .19, .015, x, -.05, -.43, -.22, 0, x > 0 ? -.15 : .15);
    p.box(MAT.rubber, .025, .012, .035, x * 1.7, -.14, -.41);
  }
  marking(w, p, .035, .024, -.105, .16);
  const g = p.build(); g.add(magazine.build('magazine'));
  g.userData = { muzzle: [0, .045, muzzleZ - (suppressed ? .16 : .042)], sightY, length: -muzzleZ };
  return g;
}
function equipment(w) {
  const p = new Parts(), cls = w.cls;
  if (cls === 0) {
    p.box(MAT.silver, .013, .047, .22, 0, .005, -.17);
    p.box(MAT.steel, .009, .028, .055, 0, -.002, -.299, .18);
    p.box(MAT.black, .047, .018, .022, 0, -.012, -.052);
    p.box(MAT.leather, .032, .052, .12, 0, -.012, .015);
    for (let i = 0; i < 7; i++) p.box(MAT.black, .036, .055, .004, 0, -.012, -.036 + i * .016);
  } else if (cls === 10) {
    p.box(MAT.leather, .24, .09, .18, 0, 0, -.12);
    for (let i = 0; i < 3; i++) p.tube(mat(0xb29c6f), .027, .16, -.075 + i * .075, .025, -.12);
    p.box(MAT.black, .105, .025, .12, .018, .072, -.12);
    p.box(mat(0x82b878), .064, .003, .036, .018, .086, -.15);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) p.box(MAT.edge, .013, .004, .01, -.004 + col * .02, .087, -.115 + row * .016);
    for (const x of [-.075, .074]) p.box(MAT.black, .013, .094, .18, x, .008, -.12);
  } else {
    const color = cls === 7 ? 0x5a6645 : cls === 8 ? 0xc5c4ad : 0x65767b;
    p.add('cylinder', mat(color,.35,.6), [.043,.12,.043], [0,.005,-.11]);
    for (let i = 0; i < 4; i++) p.tube(MAT.black,.044,.005,0,-.042+i*.027,-.11);
    p.box(MAT.steel,.025,.027,.03,0,.08,-.11);
    p.box(MAT.edge,.014,.12,.023,.04,.035,-.11,0,0,-.12);
    p.add('ring', MAT.steel, [.021,.021,.021], [-.026,.073,-.11], [0,Math.PI/2,0]);
    p.box(mat(0xd4ad4b),.075,.018,.003,0,.015,-.154);
  }
  const g = p.build(); g.userData = { muzzle:[0,0,-.3], sightY:.1, length:.3 }; return g;
}

export function gunModel(weapon) {
  const w = weaponInfo(weapon), key = `${w.id}/${w.cls}/${w.zoom || 0}`;
  if (!templates.has(key)) templates.set(key, w.cls === 1 ? pistol(w) : w.cls >= 2 && w.cls <= 6 ? longGun(w) : equipment(w));
  return templates.get(key).clone(true);
}

const handTemplates = new Map();
export function handModel(side = 1, supporting = false) {
  const key = `${side}/${supporting}`;
  if (!handTemplates.has(key)) {
    const p = new Parts(), mirror = side === 0 ? -1 : 1;
    p.add('sphere', MAT.glove, [.038,.049,.036], [0,-.082,.028]);
    p.box(MAT.gloveDark,.055,.023,.045,0,-.063,.038);
    for (let i=0;i<4;i++) {
      p.add('sphere', MAT.glove, [.010,.010,.023], [mirror*(.025-i*.015),-.076,-.006]);
      p.box(MAT.gloveDark,.009,.011,.018,mirror*(.025-i*.015),-.073,-.021);
    }
    p.add('sphere',MAT.glove,[.016,.035,.018],[mirror*-.03,-.068,.025],[0,0,mirror*-.4]);
    p.add('cylinder',MAT.sleeve,[.039,.29,.047],[0,-.135,.19],[1.20,0,mirror*.09]);
    p.add('cylinder',MAT.gloveDark,[.039,.028,.046],[0,-.095,.065],[1.20,0,0]);
    p.box(MAT.leather,.057,.018,.046,0,-.108,.13,1.20);
    const hand = p.build(); if(supporting) { hand.rotation.z = -.35; hand.rotation.y = .35; }
    handTemplates.set(key,hand);
  }
  return handTemplates.get(key).clone(true);
}
