// Original procedural weapon assets. Static details are baked by material and
// shared between instances; only slides, hands and magazines need transforms.
import * as THREE from '../vendor/three.module.min.js';
import { buildTitan } from './titan.js';

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
// One shared brushed finish adds machining texture without per-gun downloads.
if (typeof document !== 'undefined') {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const g=canvas.getContext('2d');g.fillStyle='#f4f4f4';g.fillRect(0,0,512,128);
  for(let i=0;i<1500;i++){
    g.fillStyle=`rgba(65,70,74,${.018+(i%7)*.006})`;
    g.fillRect((i*137)%512,(i*37)%128,8+(i%41),.5);
  }
  const finish=new THREE.CanvasTexture(canvas);finish.colorSpace=THREE.SRGBColorSpace;finish.anisotropy=4;
  for(const name of ['steel','black','edge','silver'])MAT[name].map=finish;
}
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
// Attachments travel with the gun through purchases, drops and remote snapshots.
export function withOptic(weapon, optic = weapon?.optic || 0, definitions) {
  const w = weaponInfo(weapon), nativeZoom = w.nativeZoom ?? w.baseZoom ?? w.zoom ?? 0;
  const supported = !w.dual && w.cls >= 1 && w.cls <= 6 && w.cls !== 5 && (!Array.isArray(w.optics) || w.optics.includes(optic));
  const selected = supported && (optic === 1 || optic === 2) ? optic : 0;
  const fromServer = definitions?.find?.(item => item.index === selected || item.value === selected);
  const zoom = selected ? fromServer?.zoom || (selected === 1 ? 1.5 : 4) : nativeZoom;
  return { ...w, nativeZoom, optic: selected, zoom, opticName: selected ? fromServer?.name || (selected === 1 ? 'Red dot' : 'ACOG 4×') : '' };
}
export function weaponModelKey(weapon) {
  const w = weaponInfo(weapon);
  return `${w.id}/${w.cls}/${w.optic || 0}/${w.zoom || 0}`;
}

// Etched screw slots and machining lines are baked into their receiver batch.
function screw(p, x, y, z, radius = .0035) {
  p.add('cylinder', MAT.edge, [radius,.0018,radius], [x,y,z], [0,0,Math.PI/2]);
  p.box(MAT.black, .002, radius * .28, radius * 1.35, x + Math.sign(x) * .001, y, z, .6);
}
function lathe(p, center, length, radius, count = 8) {
  for (let i = 0; i < count; i++) p.tube(MAT.black, radius, .0015, center[0], center[1], center[2] - length / 2 + length * i / (count - 1));
}

function opticModel(type, y, z = -.10, pistolMount = false) {
  const p = new Parts(), g = new THREE.Group(); g.name = type === 1 ? 'red_dot' : 'acog';
  const body = mat(0x273238, .48, .33), edge = mat(0x76817d, .55, .36);
  const base = pistolMount ? .088 : .08;
  p.box(body, .052, .012, type === 1 ? .07 : .13, 0, base + .006, z);
  p.box(edge, .038, Math.max(.008,y - base - .035), .027, 0, (base + y - .027) / 2, z);
  for (const side of [-1,1]) {
    p.box(body,.012,.015,.025,side*.026,base+.008,z+.016);
    screw(p,side*.033,base+.01,z+.016,.004);
  }
  if (type === 1) {
    // Open tube: rings and side struts never paint over the sight picture.
    for (const dz of [-.021,.021]) p.add('ring',body,[.030,.030,.020],[0,y,z+dz]);
    for (const side of [-1,1]) p.box(body,.008,.024,.046,side*.030,y,z);
    p.box(body,.037,.007,.047,0,y+.030,z);
    p.add('cylinder',body,[.010,.012,.010],[.039,y,z],[0,0,Math.PI/2]);
    p.box(edge,.008,.003,.013,.046,y,z);
    p.box(body,.018,.012,.028,0,y-.033,z+.004);
    p.box(mat(0xb44a35,.12,.5),.006,.002,.012,0,y+.034,z-.005);
  } else {
    // Compact prism body, large objective bell and fiber-optic light collector.
    p.tube(body,.028,.134,0,y,z-.015);
    for (const dz of [-.091,.065]) p.add('ring',body,[.034,.034,.027],[0,y,z+dz]);
    p.box(body,.065,.039,.077,0,y-.023,z-.012);
    p.box(edge,.008,.008,.065,-.034,y-.016,z-.01);
    p.add('cylinder',body,[.015,.014,.015],[0,y+.036,z-.005]);
    p.add('cylinder',body,[.012,.015,.012],[.036,y,z+.005],[0,0,Math.PI/2]);
    for (let i=0;i<4;i++) p.box(edge,.003,.011,.002,.045,y-.004,z-.002+i*.004);
    p.box(body,.015,.009,.099,0,y+.035,z-.024);
    p.box(mat(0xa43125,.1,.3),.006,.005,.09,0,y+.041,z-.024);
    p.box(MAT.black,.012,.006,.032,0,y+.042,z+.007);
  }
  g.add(p.build());
  const lensZ = z + (type === 1 ? .020 : .065);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(type === 1 ? .026 : .029,32),new THREE.MeshBasicMaterial({color:0x76c6c2,transparent:true,opacity:type===1?.07:.3,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
  lens.name='optic_lens';lens.position.set(0,y,lensZ);g.add(lens);
  if (type === 1) {
    const dot = new THREE.Group();dot.name='optic_reticle';dot.position.set(0,y,lensZ+.001);dot.visible=false;
    for (const [r,opacity] of [[.0018,.25],[.0008,1]]) {
      const disc=new THREE.Mesh(new THREE.CircleGeometry(r,16),new THREE.MeshBasicMaterial({color:0xff291b,transparent:true,opacity,depthWrite:false,depthTest:false,toneMapped:false}));disc.renderOrder=20;dot.add(disc);
    }
    g.add(dot);
  }
  return g;
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
  g.font = '20px monospace'; g.fillStyle = '#869385'; g.fillText(`BP  •  ${w.id === 'twin_lever' ? '12 GA  ·  LEVER ACTION' : w.id === 'titan' ? '.50 BMG  ·  BOLT ACTION' : w.cls === 1 ? '9 × 19' : 'PRECISION SYSTEMS'}  •  0047`, 10, 82);
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
  if (!w.optic) ironSights(slide, -.105 - length / 2 + .025, -.105 + length / 2 - .015, .09);
  for (const side of [-1,1]) {
    screw(body, side * .025, -.07, .018, .003);
    body.box(MAT.edge,.002,.004,.026,side*.027,.01,-.021);
    for(let k=0;k<4;k++)body.box(MAT.black,.002,.016,.002,side*.026,-.116+k*.009,.04);
  }
  lathe(body,[0,.045,-.11-length/2+.02],.018,.0135,5);
  marking(w, slide, .0281, .055, -.12, length*.63);
  const g = body.build(); g.add(slide.build('slide'));
  if (w.optic) g.add(opticModel(w.optic, w.optic === 1 ? .135 : .155, -.085, true));
  g.userData = { muzzle: [0, .045, -.124 - length / 2], sightY: w.optic === 1 ? .135 : w.optic === 2 ? .155 : .095, length };
  return g;
}
function longGun(w) {
  const p = new Parts(), magazine = new Parts();
  const cls = w.cls, bullpup = /bastion|volt/.test(w.id), wood = /rook|ram|jackal/.test(w.id);
  const suppressed = /cricket/.test(w.id), heavy = cls === 6, sniper = cls === 5, smg = cls === 3, shotgun = cls === 2;
  const attached = !sniper && (w.optic === 1 || w.optic === 2);
  const scoped = sniper || (!attached && (w.nativeZoom ?? w.zoom ?? 0) >= 2);
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
  if (!wood || scoped || attached) rails(p, .25, -.12, .078, heavy ? .072 : .053);
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
  } else if (!attached) ironSights(p, -.31 - handguardLength / 2, .015, .105, .06);
  if (attached) sightY = w.optic === 1 ? .15 : .17;
  if (sniper || heavy) for (const x of [-.025, .025]) {
    p.box(MAT.black, .012, .19, .015, x, -.05, -.43, -.22, 0, x > 0 ? -.15 : .15);
    p.box(MAT.rubber, .025, .012, .035, x * 1.7, -.14, -.41);
  }
  for (const side of [-1,1]) {
    screw(p,side*.039,.012,-.015,.004);screw(p,side*.039,.012,-.224,.003);
    p.box(MAT.edge,.0015,.002,.12,side*.035,.055,-.095);
    p.box(MAT.black,.0015,.002,.09,side*.035,-.013,-.09);
  }
  lathe(p,[0,.045,muzzleZ],.035,.0195,6);
  marking(w, p, .035, .024, -.105, .16);
  const g = p.build(); g.add(magazine.build('magazine'));
  if (attached) g.add(opticModel(w.optic, sightY));
  g.userData = { muzzle: [0, .045, muzzleZ - (suppressed ? .16 : .042)], sightY, length: -muzzleZ };
  return g;
}
// Compact grip-fed PDW. The folded foregrip and collapsed stock keep each
// complete gun legible when two are held at once.
function mp7(w) {
  const p = new Parts(), magazine = new Parts(), bolt = new Parts();
  const polymer = mat(0x3e4747, .12, .57), slideSteel = mat(0x718084, .52, .34);
  p.box(polymer, .063, .096, .295, 0, .035, -.105);
  p.box(MAT.black, .048, .037, .254, 0, -.024, -.11);
  p.box(slideSteel, .061, .018, .23, 0, .087, -.12);
  addGrip(p, polymer, .012, -.099, .157); triggerGuard(p, -.004, -.043);
  magazine.box(MAT.black, .034, .118, .043, 0, -.181, .034, -.16);
  magazine.box(MAT.edge, .043, .012, .054, 0, -.241, .044, -.16);
  for (const x of [-.018, .018]) for (let k = 0; k < 3; k++) {
    magazine.box(slideSteel, .002, .052, .003, x, -.197, .022 + k * .011, -.16);
  }
  // Hinged foregrip folded below the front receiver.
  p.box(polymer, .036, .029, .102, 0, -.031, -.205, -.04);
  p.add('cylinder', MAT.edge, [.012,.068,.012], [0,-.013,-.154], [0,0,Math.PI/2]);
  for (let k = 0; k < 5; k++) p.box(MAT.black, .038, .004, .006, 0, -.045, -.24 + k * .017);
  p.tube(MAT.steel, .014, .07, 0, .04, -.28);
  p.tube(MAT.black, .022, .036, 0, .04, -.321);
  p.tube(MAT.edge, .018, .008, 0, .04, -.341);
  p.tube(MAT.black, .010, .010, 0, .04, -.347);
  for (const x of [-.023, .023]) {
    p.box(slideSteel, .008, .014, .17, x, .044, .058);
    p.box(MAT.black, .012, .015, .036, x, .044, .133);
  }
  p.box(polymer, .06, .105, .025, 0, .005, .152);
  p.box(MAT.black, .064, .09, .012, 0, .002, .167);
  rails(p, .26, -.117, .102, .048);
  ironSights(p, -.235, -.002, .127, .104);
  for (const side of [-1, 1]) {
    p.box(MAT.black, .003, .024, .055, side * .032, .047, -.13);
    for (let k = 0; k < 4; k++) p.box(MAT.black, .003, .019, .008, side * .032, .037, -.209 + k * .016);
    p.box(MAT.edge, .004, .009, .022, side * .034, -.008, -.005, 0, 0, side * .22);
    for (const z of [-.23, -.17, .018]) p.bead(MAT.edge, side * .033, .008, z, .0035);
  }
  // Reciprocating bolt is independently animated for each hand.
  bolt.box(slideSteel, .003, .018, .048, .034, .047, -.128);
  bolt.box(MAT.black, .013, .008, .012, .04, .049, -.116);
  p.box(MAT.black, .04, .012, .018, 0, .072, .054);
  p.box(MAT.edge, .061, .009, .014, 0, .074, .055);
  marking(w, p, .0327, .053, -.058, .105);
  const g = p.build(); g.add(magazine.build('magazine'), bolt.build('slide'));
  g.userData = { muzzle:[0,.04,-.354], sightY:.13, length:.52, dualHip:[.235,-.175,-.44] };
  return g;
}

let walnutMaterial;
function walnutFinish() {
  if (!walnutMaterial && typeof document === 'undefined') return mat(0x805235,.06,.48);
  if (!walnutMaterial) {
    const canvas = document.createElement('canvas'); canvas.width=512;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#704329';ctx.fillRect(0,0,512,256);
    for(let row=0;row<150;row++){
      ctx.strokeStyle=row%3===0?'rgba(38,18,10,.32)':'rgba(194,137,78,.15)';ctx.lineWidth=row%7===0?1.4:.55;
      ctx.beginPath();
      for(let x=0;x<=512;x+=8){const y=row*1.9+Math.sin(x*.017+row*.25)*3+Math.sin(x*.043+row)*1.2;if(!x)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();
    }
    for(let i=0;i<450;i++){ctx.fillStyle='rgba(35,17,8,.14)';ctx.fillRect((i*197)%512,(i*67)%256,1,2);}
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    walnutMaterial=new THREE.MeshStandardMaterial({map:texture,color:0xe4c4a0,metalness:.06,roughness:.48});
  }
  return walnutMaterial;
}
function receiverProfiles() {
  if (primitive.m1887Receiver) return;
  const profile=new THREE.Shape();
  profile.moveTo(-.086,-.049);profile.lineTo(.108,-.049);
  profile.quadraticCurveTo(.14,-.04,.14,.013);profile.lineTo(.14,.065);
  profile.quadraticCurveTo(.13,.105,.064,.12);profile.lineTo(-.006,.12);
  profile.quadraticCurveTo(-.084,.12,-.105,.056);profile.lineTo(-.104,-.017);
  profile.quadraticCurveTo(-.102,-.045,-.086,-.049);profile.closePath();
  const create=(shape,width)=>{const g=new THREE.ExtrudeGeometry(shape,{depth:width,bevelEnabled:true,bevelThickness:.0025,bevelSize:.0025,bevelSegments:2,steps:1,curveSegments:12});g.translate(0,0,-width/2);g.rotateY(Math.PI/2);return g;};
  primitive.m1887Receiver=create(profile,.074);
  const breech=new THREE.Shape();breech.moveTo(-.05,-.025);breech.lineTo(.075,-.025);breech.lineTo(.075,.016);
  breech.quadraticCurveTo(.044,.071,-.013,.071);breech.quadraticCurveTo(-.058,.063,-.05,-.025);breech.closePath();
  primitive.m1887Breech=create(breech,.055);
  const grip=new THREE.Shape();grip.moveTo(-.065,.022);
  grip.bezierCurveTo(-.112,.028,-.155,.003,-.176,-.03);
  grip.bezierCurveTo(-.187,-.063,-.203,-.093,-.236,-.108);
  grip.bezierCurveTo(-.253,-.117,-.243,-.135,-.224,-.14);
  grip.bezierCurveTo(-.193,-.15,-.163,-.122,-.145,-.086);
  grip.bezierCurveTo(-.129,-.053,-.117,-.024,-.065,-.02);grip.closePath();
  primitive.m1887Grip=create(grip,.059);
}
// M1887 silhouette: tall, rounded receiver with a rolling top breech, a short
// barrel above the magazine tube, a bird's-head walnut grip and large loop.
function leverShotgun(w) {
  receiverProfiles();
  const p=new Parts(), action=new Parts(), lever=new Parts();
  const wood=walnutFinish(), blued=mat(0x4b555b,.42,.36), worn=mat(0x838c88,.52,.35);
  for(const side of [-1,1]){
    p.add('m1887Receiver',blued,[.12,1,1],[side*.033,0,-.02]);
    // Curved sideplate outline and carefully positioned action screws.
    p.add('m1887Receiver',worn,[.016,.84,.92],[side*.039,0,-.014]);
    p.add('m1887Receiver',blued,[.018,.805,.885],[side*.040,.002,-.014]);
    for(const [y,z,r] of [[.055,.045,.0045],[-.022,-.107,.004],[.023,-.065,.0032],[.008,.061,.0035]])screw(p,side*.042,y,z,r);
    p.box(MAT.black,.0015,.003,.052,side*.043,.061,-.078);
    p.box(worn,.0015,.001,.041,side*.043,.058,-.078);
  }
  p.box(blued,.061,.028,.214,0,-.034,-.02);
  p.add('sphere',blued,[.034,.066,.041],[0,.017,.058]);
  // Deep black top-loading port stays visible as the rolling breech opens.
  p.box(MAT.black,.058,.012,.12,0,.055,-.036);
  p.box(worn,.005,.013,.106,-.029,.064,-.044);
  p.box(worn,.005,.013,.106,.029,.064,-.044);
  action.add('m1887Breech',blued,[1,1,1],[0,.033,-.014]);
  action.box(worn,.012,.003,.065,.019,.104,-.043);
  action.box(MAT.black,.005,.008,.034,-.022,.087,-.054);
  // Large bore and parallel tube, with a period-correct bead instead of rails.
  p.tube(blued,.0235,.36,0,.074,-.32);
  p.tube(worn,.0245,.014,0,.074,-.506);
  p.tube(MAT.black,.0185,.017,0,.074,-.516);
  p.tube(blued,.0175,.335,0,.011,-.309);
  p.tube(worn,.0182,.012,0,.011,-.482);
  p.bead(MAT.brass,0,.101,-.481,.0037);
  p.box(blued,.009,.005,.012,0,.097,-.481);
  for(const z of [-.171,-.414]){
    p.add('ring',worn,[.025,.026,.032],[0,.073,z]);
    p.box(blued,.073,.075,.012,0,.035,z);
  }
  // Rounded walnut fore-end, not the squared pump handguard of a modern gun.
  p.add('sphere',wood,[.038,.035,.135],[0,.009,-.297]);
  p.box(wood,.068,.045,.208,0,.013,-.297);
  p.box(worn,.067,.003,.008,0,-.012,-.406);
  p.box(worn,.065,.003,.008,0,-.012,-.188);
  // Sawn-off stock with a curved wrist and bird's-head butt.
  p.add('m1887Grip',wood,[1,1,1]);
  p.box(blued,.056,.005,.045,0,-.136,.221,-.22);
  for(const side of [-1,1])screw(p,side*.032,-.048,.163,.004);
  p.box(blued,.012,.034,.062,0,-.014,.09,-.3);
  // Exposed hammer, extractor and trigger give the action its old mechanism.
  p.box(blued,.019,.034,.018,0,.088,.071,-.4);
  p.box(worn,.026,.006,.021,0,.105,.078,-.4);
  for(let i=0;i<4;i++)p.box(MAT.black,.024,.002,.0015,0,.108+i*.0004,.07+i*.0035,-.4);
  p.box(worn,.007,.036,.010,0,-.047,.008,.22);
  lever.add('ring',blued,[.082,.054,.026],[0,-.059,.079],[0,Math.PI/2,0]);
  lever.box(blued,.013,.045,.016,0,-.021,.006,-.28);
  lever.box(worn,.013,.005,.073,0,-.111,.077);
  p.add('cylinder',worn,[.009,.075,.009],[0,-.018,-.102],[0,0,Math.PI/2]);
  // Small stamped maker marks suit a historic receiver; no modern tactical plate.
  const engraving={...w,name:'MODEL 1887  ·  12 GA'};marking(engraving,p,.0431,.026,-.013,.10);
  const g=p.build(),loop=lever.build('lever'),breech=action.build('bolt');
  loop.position.set(0,-.018,-.102);breech.position.set(0,.015,.025);breech.userData.rest=[0,.015,.025];
  g.add(loop,breech);
  g.userData={muzzle:[0,.074,-.526],sightY:.105,length:.78,dualHip:[.25,-.16,-.56],leverAction:true,rollingBreech:true};
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
  const w = withOptic(weapon), key = weaponModelKey(w);
  if (!templates.has(key)) templates.set(key, w.id === 'titan' ? buildTitan(w, { Parts, MAT, mat, rails, marking }) : w.id === 'twin_mp7' ? mp7(w) : w.id === 'twin_lever' ? leverShotgun(w) : w.cls === 1 ? pistol(w) : w.cls >= 2 && w.cls <= 6 ? longGun(w) : equipment(w));
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
