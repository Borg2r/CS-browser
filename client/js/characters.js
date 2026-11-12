// Original tactical operators. Static details are baked per material and joint;
// every instance shares its team's geometry/materials rather than rebuilding it.
import * as THREE from '../vendor/three.module.min.js';

const primitives = {
  box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
  sphere: new THREE.SphereGeometry(1, 12, 8).toNonIndexed(),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 10).toNonIndexed(),
  helmet: new THREE.SphereGeometry(1, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.56).toNonIndexed(),
  ring: new THREE.TorusGeometry(1, 0.18, 5, 14).toNonIndexed(),
};
const templates = new Map();
const palettes = new Map();
const fabrics = new Map();
const Y = new THREE.Vector3(0, 1, 0);

function fabric(team, kind) {
  // Canvas is optional so geometry validation can also run directly in Node.
  if (typeof document === 'undefined') return null;
  const key = `${team}:${kind}`;
  if (fabrics.has(key)) return fabrics.get(key);
  let seed = team * 13579 + (kind === 'camo' ? 81 : kind === 'webbing' ? 325 : 711);
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const size = 256, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = kind === 'weave' ? '#909090' : '#deded8';
  ctx.fillRect(0, 0, size, size);
  if (kind === 'camo') {
    const pigments = team === 1 ? ['#b8b5a3', '#efdfbd', '#979b86', '#d4cfb9'] : ['#9ba9a7', '#cbd3cc', '#819393', '#d4d9cf'];
    for (let i = 0; i < 72; i++) {
      const x = random() * size, y = random() * size;
      const rx = 8 + random() * 32, ry = 6 + random() * 23;
      ctx.fillStyle = pigments[i % pigments.length];
      // Wrapped irregular islands avoid hard seams on the cloth's UV boundary.
      const points = Array.from({ length: 9 }, (_, j) => {
        const angle = j / 9 * Math.PI * 2, scale = 0.5 + random() * 0.7;
        return [Math.cos(angle) * rx * scale, Math.sin(angle) * ry * scale];
      });
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        ctx.beginPath();
        points.forEach(([px, py], j) => j ? ctx.lineTo(x + ox + px, y + oy + py) : ctx.moveTo(x + ox + px, y + oy + py));
        ctx.closePath(); ctx.fill();
      }
    }
  }
  const step = kind === 'webbing' ? 4 : 3;
  for (let x = 0; x < size; x += step) {
    ctx.fillStyle = kind === 'weave' ? '#b1b1b1' : 'rgba(255,255,245,.18)';
    ctx.fillRect(x, 0, 1, size);
    ctx.fillStyle = kind === 'weave' ? '#777777' : 'rgba(45,43,34,.12)';
    ctx.fillRect(x + 1, 0, 1, size);
  }
  for (let y = 0; y < size; y += step) {
    ctx.fillStyle = kind === 'weave' ? 'rgba(215,215,215,.32)' : 'rgba(250,248,232,.14)';
    ctx.fillRect(0, y, size, 1);
    for (let x = (y / step % 2) * step; x < size; x += step * 2) {
      ctx.fillStyle = kind === 'weave' ? 'rgba(30,30,30,.28)' : 'rgba(35,36,29,.12)';
      ctx.fillRect(x, y + 1, step, 1);
    }
  }
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,240,.12)' : 'rgba(20,25,20,.10)';
    ctx.fillRect(random() * size, random() * size, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  if (kind !== 'weave') texture.colorSpace = THREE.SRGBColorSpace;
  // One camo repeat gives readable broad patches; weave repeats more tightly.
  texture.repeat.setScalar(kind === 'weave' ? 2 : 1);
  fabrics.set(key, texture);
  return texture;
}

function palette(team) {
  if (palettes.has(team)) return palettes.get(team);
  const desert = team === 1;
  const values = {
    cloth: [desert ? 0x9a744d : 0x335264, 0.97, 0],
    clothDark: [desert ? 0x71543a : 0x233641, 0.95, 0],
    vest: [desert ? 0x594737 : 0x172b35, 0.92, 0],
    straps: [desert ? 0x392e25 : 0x101b22, 0.92, 0],
    skin: [desert ? 0xb77f57 : 0xcd9c74, 0.78, 0],
    gloves: [desert ? 0x41382e : 0x222b30, 0.92, 0],
    hardware: [0x727b79, 0.4, 0.62],
    accent: [desert ? 0xe2ac59 : 0x59b1c2, 0.73, 0.1],
    lens: [desert ? 0x624b25 : 0x173e4e, 0.17, 0.65],
  };
  const p = Object.fromEntries(Object.entries(values).map(([key, [color, roughness, metalness]]) =>
    [key, new THREE.MeshStandardMaterial({ color, roughness, metalness })]));
  const camo = fabric(team, 'camo'), canvas = fabric(team, 'webbing'), weave = fabric(team, 'weave');
  if (camo) {
    for (const key of ['cloth', 'clothDark']) {
      p[key].map = camo;
      p[key].bumpMap = weave;
      p[key].bumpScale = 0.0015;
    }
    for (const key of ['vest', 'gloves', 'straps']) {
      p[key].map = canvas;
      p[key].bumpMap = weave;
      p[key].bumpScale = 0.0009;
    }
  }
  palettes.set(team, p);
  return p;
}

class Batch {
  constructor(materials) { this.materials = materials; this.parts = new Map(); }
  part(shape, mat, position, scale, rotation = null) {
    const matrix = new THREE.Matrix4();
    const quaternion = rotation instanceof THREE.Quaternion ? rotation : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation || [0, 0, 0])));
    matrix.compose(new THREE.Vector3(...position), quaternion, new THREE.Vector3(...scale));
    const geometry = primitives[shape].clone().applyMatrix4(matrix);
    let bucket = this.parts.get(mat);
    if (!bucket) { bucket = { position: [], normal: [], uv: [] }; this.parts.set(mat, bucket); }
    for (const key of ['position', 'normal', 'uv']) bucket[key].push(...geometry.attributes[key].array);
    geometry.dispose();
    return this;
  }
  box(mat, position, scale, rotation) { return this.part('box', mat, position, scale, rotation); }
  sphere(mat, position, scale, rotation) { return this.part('sphere', mat, position, scale, rotation); }
  segment(mat, a, b, radiusX, radiusZ = radiusX) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    return this.part('sphere', mat, start.add(end).multiplyScalar(0.5).toArray(),
      [radiusX, direction.length() * 0.65, radiusZ], new THREE.Quaternion().setFromUnitVectors(Y, direction.normalize()));
  }
  finish(name) {
    const group = new THREE.Group(); group.name = name;
    for (const [mat, data] of this.parts) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.materials[mat]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

function leg(p, side) {
  const thigh = new Batch(p);
  thigh.sphere('cloth', [0, -0.21, 0], [0.112, 0.24, 0.112]);
  thigh.box('clothDark', [side * 0.093, -0.23, 0.018], [0.045, 0.17, 0.12]);
  thigh.box('straps', [side * 0.098, -0.19, -0.046], [0.05, 0.026, 0.13]);
  // Wrinkles are dimensional seams, not an extra texture or draw per seam.
  for (let i = 0; i < 3; i++) thigh.box('clothDark', [side * 0.04, -0.11 - i * 0.10, -0.102], [0.12, 0.012, 0.009], [0, 0, side * 0.12]);
  const root = thigh.finish(side < 0 ? 'legL' : 'legR');
  root.position.set(side * 0.125, 0.85, 0);

  const shin = new Batch(p);
  shin.sphere('cloth', [0, -0.17, 0.012], [0.095, 0.20, 0.094]);
  shin.sphere('vest', [0, -0.014, -0.094], [0.095, 0.107, 0.037]);
  shin.box('straps', [0, -0.013, -0.119], [0.106, 0.032, 0.017]);
  shin.box('clothDark', [0, -0.18, -0.08], [0.10, 0.014, 0.012]);
  shin.sphere('gloves', [0, -0.327, -0.041], [0.105, 0.10, 0.147]);
  shin.box('straps', [0, -0.407, -0.047], [0.218, 0.04, 0.29]);
  shin.box('gloves', [0, -0.31, 0.027], [0.19, 0.15, 0.14]);
  for (let i = 0; i < 4; i++) shin.box('clothDark', [0, -0.287 - i * 0.017, -0.11 + i * 0.012], [0.12, 0.008, 0.009], [0, 0, i % 2 ? 0.13 : -0.13]);
  const knee = shin.finish(side < 0 ? 'kneeL' : 'kneeR');
  knee.position.y = -0.42; root.add(knee);
  return root;
}

function arm(p, side, dual = false) {
  const b = new Batch(p);
  const shoulder = [side * 0.26, 0.025, 0.01];
  const elbow = [side * 0.30, -0.18, -0.115];
  const hand = side > 0 ? [0.16, -0.035, -0.35] : dual ? [-0.20, -0.035, -0.35] : [-0.015, -0.055, -0.53];
  b.segment('cloth', shoulder, elbow, 0.09, 0.087);
  b.sphere('clothDark', elbow, [0.082, 0.09, 0.075]);
  b.segment('cloth', elbow, hand, 0.076, 0.069);
  b.box('vest', [side * 0.318, -0.015, 0.005], [0.035, 0.14, 0.13], [0, 0, side * 0.20]);
  b.box('accent', [side * 0.338, 0.012, -0.012], [0.009, 0.058, 0.072], [0, 0, side * 0.20]);
  // Reinforced glove, knuckle plate, curled fingers, thumb and wrist cuff.
  b.sphere('gloves', hand, [0.065, 0.071, 0.069]);
  b.box('vest', [hand[0], hand[1] + 0.036, hand[2] - 0.015], [0.09, 0.025, 0.074], [-0.15, 0, 0]);
  for (let i = 0; i < 4; i++) {
    b.sphere('gloves', [hand[0] - 0.037 + i * 0.024, hand[1] - 0.025, hand[2] - 0.052], [0.017, 0.035, 0.027]);
  }
  b.sphere('gloves', [hand[0] - side * 0.056, hand[1] + 0.005, hand[2] - 0.018], [0.027, 0.026, 0.041], [0, side * 0.25, 0]);
  b.box('clothDark', [hand[0], hand[1] - 0.005, hand[2] + 0.057], [0.125, 0.073, 0.025]);
  return b.finish(side > 0 ? 'rightArm' : dual ? 'leftArmDual' : 'leftArm');
}

function head(p, team) {
  const h = new Batch(p);
  h.part('cylinder', 'skin', [0, 0.64, 0], [0.072, 0.14, 0.073]);
  h.sphere('skin', [0, 0.775, 0], [0.113, 0.145, 0.108]);
  h.sphere('skin', [-0.112, 0.76, -0.002], [0.026, 0.044, 0.018]);
  h.sphere('skin', [0.112, 0.76, -0.002], [0.026, 0.044, 0.018]);
  h.sphere('skin', [0, 0.765, -0.109], [0.025, 0.035, 0.031]);
  h.sphere('skin', [0, 0.691, -0.027], [0.079, 0.043, 0.074]);
  // Both teams wear eye protection, with different helmet/head-wrap silhouettes.
  h.sphere('straps', [0, 0.807, -0.079], [0.128, 0.050, 0.062]);
  for (const side of [-1, 1]) h.sphere('lens', [side * 0.052, 0.81, -0.13], [0.048, 0.028, 0.015]);
  h.box('hardware', [0, 0.811, -0.137], [0.025, 0.014, 0.013]);
  h.box('straps', [0, 0.81, 0.105], [0.18, 0.025, 0.013]);

  if (team === 1) {
    h.part('helmet', 'clothDark', [0, 0.775, 0.01], [0.126, 0.151, 0.123]);
    h.sphere('cloth', [0, 0.687, -0.039], [0.131, 0.067, 0.106]);
    h.part('ring', 'cloth', [0, 0.622, 0.005], [0.139, 0.117, 0.13], [Math.PI / 2, 0, 0]);
    h.part('ring', 'clothDark', [0, 0.647, 0.008], [0.128, 0.107, 0.068], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 4; i++) h.box('accent', [-0.073 + i * 0.044, 0.686, -0.139], [0.013, 0.046, 0.005], [0, 0, -0.20]);
    h.box('cloth', [-0.11, 0.57, 0.094], [0.10, 0.22, 0.025], [0.14, 0, -0.12]);
  } else {
    h.part('helmet', 'vest', [0, 0.775, 0.013], [0.139, 0.158, 0.137]);
    h.box('clothDark', [0, 0.865, 0.021], [0.20, 0.028, 0.20]);
    h.box('hardware', [0, 0.853, -0.129], [0.044, 0.054, 0.017]);
    h.box('vest', [0, 0.887, -0.113], [0.055, 0.039, 0.050]);
    h.sphere('clothDark', [0, 0.708, -0.043], [0.103, 0.066, 0.096]);
    h.sphere('straps', [0.139, 0.767, 0.005], [0.026, 0.060, 0.043]);
    h.sphere('straps', [-0.139, 0.767, 0.005], [0.026, 0.060, 0.043]);
    h.segment('hardware', [0.15, 0.735, -0.022], [0.11, 0.718, -0.13], 0.007, 0.007);
    h.sphere('straps', [0.105, 0.718, -0.14], [0.016, 0.012, 0.020]);
  }
  return h.finish('head');
}

function build(team) {
  const p = palette(team), root = new THREE.Group(), body = new THREE.Group();
  root.name = 'operator'; body.name = 'body'; root.add(body);
  const torsoBatch = new Batch(p);
  torsoBatch.sphere('cloth', [0, 0.10, 0], [0.207, 0.155, 0.145]);
  torsoBatch.sphere('cloth', [0, 0.365, 0.005], [0.235, 0.293, 0.148]);
  torsoBatch.box('vest', [0, 0.36, -0.112], [0.385, 0.375, 0.105]);
  torsoBatch.box('vest', [0, 0.37, 0.133], [0.355, 0.38, 0.075]);
  // Shoulder straps, waist belt, quick-release buckles and chest badge.
  for (const side of [-1, 1]) {
    torsoBatch.box('straps', [side * 0.149, 0.541, -0.006], [0.065, 0.04, 0.302], [0, 0, side * 0.08]);
    torsoBatch.box('hardware', [side * 0.137, 0.475, -0.173], [0.038, 0.037, 0.013]);
    torsoBatch.box('straps', [side * 0.135, 0.315, -0.172], [0.022, 0.31, 0.013]);
    torsoBatch.box('clothDark', [side * 0.23, 0.21, 0.005], [0.072, 0.18, 0.135]);
  }
  torsoBatch.box('straps', [0, 0.065, 0], [0.421, 0.063, 0.31]);
  torsoBatch.box('hardware', [0, 0.066, -0.167], [0.058, 0.043, 0.018]);
  torsoBatch.box('clothDark', [0, 0.468, -0.174], [0.115, 0.048, 0.014]);
  torsoBatch.box('accent', [0, 0.470, -0.184], [0.082, 0.012, 0.004]);
  torsoBatch.box('accent', [0, 0.452, -0.184], [0.05, 0.007, 0.004]);
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.106;
    torsoBatch.box('clothDark', [x, 0.248, -0.197], [0.091, 0.162, 0.068]);
    torsoBatch.box('straps', [x, 0.321, -0.204], [0.096, 0.024, 0.075]);
    torsoBatch.box('vest', [x, 0.245, -0.235], [0.012, 0.141, 0.005]);
  }
  for (let i = 0; i < 3; i++) torsoBatch.box('straps', [0, 0.353 + i * 0.029, -0.17], [0.33, 0.012, 0.012]);
  // Radio with antenna, a clipped tool, and an identifiable shoulder light.
  torsoBatch.box('straps', [-0.145, 0.435, 0.184], [0.085, 0.16, 0.067]);
  torsoBatch.part('cylinder', 'straps', [-0.156, 0.586, 0.187], [0.008, 0.195, 0.008]);
  torsoBatch.box('hardware', [0.211, 0.15, -0.07], [0.028, 0.13, 0.025], [0, 0, -0.14]);
  torsoBatch.box('accent', [0.162, 0.538, -0.095], [0.038, 0.022, 0.023]);
  const torso = torsoBatch.finish('torso'); torso.position.y = 0.85;
  torso.add(head(p, team));

  const arms = new THREE.Group(); arms.name = 'arms'; arms.position.set(0, 0.49, 0);
  arms.add(arm(p, 1), arm(p, -1));
  const dualArm = arm(p, -1, true); dualArm.visible = false; arms.add(dualArm);
  const gunSlot = new THREE.Group(); gunSlot.name = 'gunSlot'; gunSlot.position.set(0.16, 0, -0.35); arms.add(gunSlot);
  const gunSlotL = new THREE.Group(); gunSlotL.name = 'gunSlotL'; gunSlotL.position.set(-0.20, 0, -0.35); arms.add(gunSlotL);
  torso.add(arms);

  const backpack = new Batch(p);
  backpack.box('clothDark', [0, 0.365, 0.246], [0.30, 0.32, 0.15]);
  backpack.box('vest', [0, 0.265, 0.325], [0.24, 0.12, 0.032]);
  for (const x of [-0.105, 0.105]) backpack.box('straps', [x, 0.365, 0.328], [0.028, 0.315, 0.013]);
  backpack.box('accent', [0.055, 0.415, 0.326], [0.065, 0.021, 0.011]);
  const pack = backpack.finish('pack'); pack.visible = false; torso.add(pack);
  body.add(leg(p, -1), leg(p, 1), torso);
  return root;
}

export function playerModel(team) {
  const key = team === 1 ? 1 : 2;
  if (!templates.has(key)) templates.set(key, build(key));
  const root = templates.get(key).clone(true);
  const named = name => root.getObjectByName(name);
  return {
    root, body: named('body'), legL: named('legL'), legR: named('legR'),
    kneeL: named('kneeL'), kneeR: named('kneeR'), torso: named('torso'),
    arms: named('arms'), rightArm: named('rightArm'), leftArm: named('leftArm'),
    leftArmDual: named('leftArmDual'), gunSlot: named('gunSlot'), gunSlotL: named('gunSlotL'),
    pack: named('pack'), phase: 0, weapon: null, deadT: 0, last: null,
  };
}
