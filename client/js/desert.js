// Sirocco's architectural dressing. Collision remains entirely in sim::map.
// Repeated details are instanced: hundreds of shutters, stones and slats cost
// only a handful of draw calls. The same seeded details appear for every player.
import * as THREE from '../vendor/three.module.min.js';

const TAU = Math.PI * 2;
const noise = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

function texture(draw, w = 256, h = w) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function plasterTexture() {
  return texture((g, w, h) => {
    g.fillStyle = '#f4eee1'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      const n = noise(i);
      g.fillStyle = `rgba(74,54,30,${0.03 + n * 0.12})`;
      g.fillRect(noise(i + 17) * w, noise(i + 42) * h, 1 + n * 3, 1 + n * 2);
    }
    for (let i = 0; i < 14; i++) {
      const x = noise(i + 32) * w, y = noise(i + 64) * h;
      g.strokeStyle = 'rgba(93,70,46,.09)'; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y + 13); g.lineTo(x + 4, y + 20); g.stroke();
    }
  });
}

function timberTexture() {
  return texture((g, w, h) => {
    g.fillStyle = '#d5c7ac'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      g.strokeStyle = `rgba(50,34,18,${0.05 + noise(i) * 0.18})`;
      const x = noise(i + 10) * w;
      g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 3, h * .3, x - 3, h * .7, x + 2, h); g.stroke();
    }
    for (let i = 0; i < 9; i++) {
      g.fillStyle = 'rgba(255,250,229,.18)';
      g.fillRect(noise(i + 700) * w, noise(i + 800) * h, 3, 15 + noise(i + 3) * 40);
    }
  });
}

function clothTexture() {
  return texture((g, w, h) => {
    g.fillStyle = '#f2e8cf'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 64) { g.fillStyle = '#a7775b'; g.fillRect(x, 0, 32, h); }
    g.fillStyle = 'rgba(40,30,20,.12)';
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
    for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h);
  });
}

function leafGeometry() {
  const points = [], normals = [], uv = [], indices = [];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9, x = t * 3.6, y = Math.sin(t * Math.PI) * .55 - t * t * 1.4;
    const width = Math.sin(t * Math.PI) * .34 + .025;
    for (const side of [-1, 1]) {
      points.push(x, y + (i % 2 ? .045 : 0), side * width);
      normals.push(0, 1, 0); uv.push(t, (side + 1) / 2);
    }
    if (i < 9) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function signAtlas() {
  const labels = [
    ['SIROCCO', 'THE OLD QUARTER'], ['A  →', 'LONG STREET'], ['←  B', 'COVERED MARKET'], ['MID', 'THE DOUBLE GATE'],
    ['SOUK', 'SPICES & TEXTILES'], ['MEDINA', 'OLD TOWN'], ['A  ↑', 'SHORT ARCADE'], ['B', 'TUNNEL ENTRANCE'],
    ['← B       A →', 'TUNNELS                 LONG STREET'],
    ['← A       B →', 'A COURTYARD            B COURTYARD'],
  ];
  return texture((g, w) => {
    labels.forEach(([title, subtitle], i) => {
      const x = i % 4 * 512, y = Math.floor(i / 4) * 160;
      g.fillStyle = i % 3 === 0 ? '#245359' : '#d7bd8d'; g.fillRect(x + 3, y + 3, 506, 154);
      g.strokeStyle = i % 3 === 0 ? '#d5caa8' : '#734b32'; g.lineWidth = 3; g.strokeRect(x + 12, y + 12, 488, 136);
      g.fillStyle = i % 3 === 0 ? '#f7ebcb' : '#733d2e';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 61px Georgia, serif';
      g.fillText(title, x + 256, y + 64, 460);
      g.font = '16px sans-serif'; g.fillText(subtitle, x + 256, y + 120);
      for (let j = 0; j < 180; j++) {
        g.fillStyle = 'rgba(80,54,28,.1)';
        g.fillRect(x + noise(i * 500 + j) * 512, y + noise(i * 500 + j + 200) * 160, 2, 1);
      }
    });
  }, 2048, 480);
}

export function buildDesert(scene, map) {
  if (!map?.boxes?.length) return null;
  const group = new THREE.Group(); group.name = 'Sirocco architectural details';
  const bounds = { x: map.w, z: map.h };
  const wallBoxes = map.boxes.filter(b => b[6] === 1 && b[1] < 1);
  const mats = {
    stone: new THREE.MeshStandardMaterial({ map: plasterTexture(), roughness: .94, metalness: 0 }),
    timber: new THREE.MeshStandardMaterial({ map: timberTexture(), roughness: .86, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ roughness: .62, metalness: .65 }),
    shadow: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    fabric: new THREE.MeshStandardMaterial({ map: clothTexture(), roughness: 1, side: THREE.DoubleSide }),
    leaf: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
    light: new THREE.MeshBasicMaterial({ color: 0xffd699 }),
    skyline: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  };
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(.5, .5, 1, 12),
    trunk: new THREE.CylinderGeometry(.32, .48, 1, 8),
    dome: new THREE.SphereGeometry(.5, 18, 10, 0, TAU, 0, Math.PI / 2),
    dish: new THREE.SphereGeometry(.5, 12, 6, 0, TAU, 0, Math.PI / 2),
    leaf: leafGeometry(),
    mountain: new THREE.ConeGeometry(.5, 1, 6),
  };
  const batches = new Map(), dummy = new THREE.Object3D(), color = new THREE.Color();
  let instanceCount = 0;
  function stamp(shape, material, tint, p, scale, rotation = [0, 0, 0]) {
    const key = `${shape}:${material}`;
    let batch = batches.get(key);
    if (!batch) { batch = { shape, material, matrices: [], colors: [] }; batches.set(key, batch); }
    dummy.position.set(...p); dummy.scale.set(...scale); dummy.rotation.set(...rotation); dummy.updateMatrix();
    batch.matrices.push(dummy.matrix.clone()); batch.colors.push(tint); instanceCount++;
  }
  const box = (mat, tint, p, size, rot) => stamp('box', mat, tint, p, size, rot);
  const solidAt = (x, y, z) => wallBoxes.some(b => x > b[0] && x < b[3] && y > b[1] && y < b[4] && z > b[2] && z < b[5]);
  const inBounds = (x, z) => Math.abs(x) < bounds.x - .01 && Math.abs(z) < bounds.z - .01;
  const surfacePoint = (f, u, y, depth = 0) => [f.x + f.tx * u + f.nx * depth, y, f.z + f.tz * u + f.nz * depth];
  const faceBox = (f, u, y, depth, w, h, d, mat, tint, tilt = 0) =>
    box(mat, tint, surfacePoint(f, u, y, depth), [w, h, d], [tilt, f.yaw, 0]);
  const signPositions = [], signUvs = [], signIndices = [];
  function sign(f, u, y, w, h, label) {
    const offset = signPositions.length / 3;
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) signPositions.push(...surfacePoint(f, u + dx * w / 2, y + dy * h / 2, .15));
    const col = label % 4, row = Math.floor(label / 4), u0 = col / 4, u1 = (col + 1) / 4;
    const v0 = 1 - (row + 1) / 3, v1 = 1 - row / 3;
    signUvs.push(u0, v0, u1, v0, u1, v1, u0, v1); signIndices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }

  let windows = 0, awnings = 0;
  const rooftops = [], exposed = [];
  wallBoxes.forEach((b, index) => {
    const [x0, , z0, x1, top, z1] = b, w = x1 - x0, d = z1 - z0;
    const faces = [
      { x: (x0 + x1) / 2, z: z1, nx: 0, nz: 1, len: w },
      { x: (x0 + x1) / 2, z: z0, nx: 0, nz: -1, len: w },
      { x: x1, z: (z0 + z1) / 2, nx: 1, nz: 0, len: d },
      { x: x0, z: (z0 + z1) / 2, nx: -1, nz: 0, len: d },
    ];
    faces.forEach((f, faceIndex) => {
      f.tx = f.nz; f.tz = -f.nx; f.yaw = Math.atan2(-f.tz, f.tx);
      const count = Math.max(1, Math.floor(f.len / 4.6)), segment = f.len / count;
      for (let i = 0; i < count; i++) {
        const u = -f.len / 2 + segment * (i + .5), p = surfacePoint(f, u, 3, .15);
        if (!inBounds(p[0], p[2]) || solidAt(...p)) continue;
        const seed = index * 127 + faceIndex * 31 + i;
        const width = Math.min(segment - .12, 5.8);
        exposed.push({ ...f, u, top, seed });
        // Layered stone foundation, painted cornice, crenellated coping.
        faceBox(f, u, .18, .045, width, .35, .13, 'stone', 0xb9a27a);
        faceBox(f, u, top - .19, .07, width, .22, .22, 'stone', 0xe3cd9f);
        faceBox(f, u, top + .07, -.03, width + .05, .15, .40, 'stone', 0xb69468);
        if (width > 2.6) {
          faceBox(f, u - width / 2 + .1, top / 2, .035, .20, top - .55, .15, 'stone', 0xcbb082);
          faceBox(f, u + width / 2 - .1, top / 2, .035, .20, top - .55, .15, 'stone', 0xcbb082);
        }
        // A dark recessed aperture, wood frame, shutter louvers and stone sill.
        if (width >= 2 && windows < 140 && noise(seed) > .14) {
          const wy = top > 8 ? 4.6 : 3.65, ww = 1.10 + noise(seed + 7) * .3, wh = 1.6;
          const shutter = [0x44716d, 0x6c806a, 0x8b6144, 0x546974][Math.floor(noise(seed + 8) * 4)];
          faceBox(f, u, wy, .03, ww + .24, wh + .26, .10, 'stone', 0xe3cfac);
          faceBox(f, u, wy, .09, ww, wh, .10, 'shadow', 0x242f2c);
          for (const side of [-1, 1]) {
            faceBox(f, u + side * (ww / 2 - .12), wy, .16, .08, wh, .13, 'timber', shutter);
            for (let l = 0; l < 7; l++) faceBox(f, u + side * ww / 4, wy - .63 + l * .21, .16, ww / 2 - .11, .16, .10, 'timber', shutter, -.13);
          }
          faceBox(f, u, wy, .18, .08, wh, .12, 'timber', 0x70543d);
          faceBox(f, u, wy - wh / 2 - .13, .13, ww + .4, .15, .38, 'stone', 0xc0a275);
          faceBox(f, u, wy + wh / 2 + .09, .12, ww + .34, .14, .30, 'stone', 0xe7d4ae);
          windows++;
        }
        // Canvas shades cantilever from solid walls, safely above the route.
        if (width > 3.4 && awnings < 12 && noise(seed + 30) > .88) {
          faceBox(f, u, 4.90, .75, width * .82, .055, 1.6, 'fabric', 0xffffff, .12);
          faceBox(f, u, 4.81, 1.48, width * .84, .20, .045, 'fabric', 0xffffff);
          for (const side of [-1, 1]) faceBox(f, u + side * width * .36, 4.85, .70, .055, .055, 1.6, 'metal', 0x594b38);
          awnings++;
        }
      }
    });
    // Only reachable sky silhouettes are furnished; nothing is placed in a lane.
    if (w >= 4 && d >= 4 && rooftops.length < 22) {
      const x = (x0 + x1) / 2, z = (z0 + z1) / 2;
      if (!solidAt(x, top + .1, z)) rooftops.push({ x, z, y: top, seed: index });
    }
  });

  rooftops.forEach((r, i) => {
    const { x, y, z } = r;
    if (i % 3 === 0) {
      box('stone', 0xb8a17c, [x, y + .25, z], [1.7, .5, 1.7]);
      stamp('cylinder', 'metal', 0x6b817d, [x, y + 1.2, z], [1.35, 1.5, 1.35]);
      for (const h of [.55, 1.85]) stamp('cylinder', 'metal', 0xa5b4a9, [x, y + h, z], [1.41, .08, 1.41]);
      stamp('cylinder', 'metal', 0x3e4c49, [x, y + 2.02, z], [.33, .2, .33]);
    } else if (i % 3 === 1) {
      box('stone', 0xc5a982, [x, y + .8, z], [.7, 1.6, .7]);
      box('stone', 0xe5c99a, [x, y + 1.64, z], [.98, .16, .98]);
      box('shadow', 0x352d22, [x, y + 1.73, z], [.62, .02, .62]);
    } else {
      box('stone', 0xbca582, [x, y + .12, z], [.85, .24, .85]);
      stamp('cylinder', 'metal', 0x4e5858, [x, y + .55, z], [.07, 1, .07]);
      stamp('dish', 'metal', 0xc5c8bb, [x, y + 1, z], [1.35, 1.35, 1.35], [.65, i, .2]);
      box('metal', 0x626e6b, [x + .12, y + 1.1, z], [.04, .04, 1.2], [.8, i, 0]);
    }
  });

  // Timber gate panels, studded straps, crate battens and worn stone edging.
  for (const b of map.boxes) {
    const [x0, y0, z0, x1, y1, z1, type] = b, w = x1 - x0, d = z1 - z0;
    if (type === 2) {
      for (const z of [z0 - .025, z1 + .025]) {
        const slats = Math.max(2, Math.round(w / .24));
        for (let i = 0; i < slats; i++) box('timber', i % 2 ? 0x7c5739 : 0x9b734b, [x0 + (i + .5) * w / slats, y1 / 2, z], [w / slats - .018, y1 - .06, .06]);
        for (const y of [.65, y1 - .65]) {
          box('metal', 0x424c48, [(x0 + x1) / 2, y, z], [w, .14, .09]);
          for (const x of [x0 + .18, x1 - .18]) stamp('cylinder', 'metal', 0xaaa28b, [x, y, z + (z > z1 ? .055 : -.055)], [.065, .04, .065], [Math.PI / 2, 0, 0]);
        }
      }
      for (const x of [x0, x1]) box('stone', 0xc6ac80, [x, y1 / 2, (z0 + z1) / 2], [.12, y1, d + .05]);
    } else if (type === 3) {
      for (const x of [x0 + .12, x1 - .12]) box('timber', 0x7b5736, [x, (y0 + y1) / 2, (z0 + z1) / 2], [.16, y1 - y0 + .04, d + .06]);
      for (const z of [z0 + .12, z1 - .12]) box('metal', 0x61685b, [(x0 + x1) / 2, (y0 + y1) / 2, z], [w + .06, y1 - y0 + .07, .10]);
      for (let x = x0 + .25; x < x1; x += .5) box('timber', 0xb69a6b, [x, y1 + .018, (z0 + z1) / 2], [.38, .035, d - .13]);
    } else if (type === 4) {
      box('stone', 0xe3c796, [(x0 + x1) / 2, y1 + .06, (z0 + z1) / 2], [w + .10, .12, d + .10]);
    }
  }

  // Thin ceiling trim sits beneath the roof, above a jumping player's head.
  for (let z = -17; z <= 11; z += 4) {
    box('timber', 0x68513b, [-34, 3.55, z], [12, .22, .28]);
    for (const x of [-39.75, -28.25]) box('stone', 0xb69d77, [x, 3.56, z], [.35, .28, .7]);
  }
  for (const z of [-14, -4, 6]) {
    box('metal', 0x3c4239, [-34, 3.49, z], [.04, .22, .04]);
    stamp('cylinder', 'metal', 0x5c5744, [-34, 3.37, z], [.42, .08, .42]);
    stamp('cylinder', 'light', 0xffd59b, [-34, 3.32, z], [.21, .10, .21]);
  }

  // Signboards are all packed into one atlas and one geometry.
  let signCount = 0;
  for (const f of exposed) {
    if (f.len < 2.7 || noise(f.seed + 77) < .88 || signCount >= 24) continue;
    const p = surfacePoint(f, f.u, 2.25);
    let label = p[0] < -24 ? 2 : p[0] > 24 ? 1 : p[2] < -8 ? 3 : 5;
    if (p[2] > 18) label = 0;
    if (p[0] < -20 && p[2] > -18 && p[2] < 15) label = 7;
    if (p[0] > 4 && p[0] < 22 && p[2] < 4) label = 6;
    sign(f, f.u, 2.1, Math.min(2.5, f.len - .5), .78, label); signCount++;
  }
  // Mark both exits on the buildings screening the spawn courtyards. The
  // defender board reverses the directions because that team faces south.
  for (const south of [true, false]) {
    const screen = wallBoxes.find(b => b[0] < 0 && b[3] > 0 && b[4] >= 7 &&
      (south ? b[2] > bounds.z * .5 && b[5] < bounds.z - 3 : b[5] < -bounds.z * .5 && b[2] > -bounds.z + 3));
    if (!screen) continue;
    const direction = south ? 1 : -1;
    sign({ x: 0, z: south ? screen[5] : screen[2], tx: direction, tz: 0, nx: 0, nz: direction },
      0, 2.3, 6.4, 1.2, south ? 8 : 9);
    signCount++;
  }
  if (signCount) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(signPositions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(signUvs, 2)); geometry.setIndex(signIndices); geometry.computeVertexNormals();
    const material = new THREE.MeshLambertMaterial({ map: signAtlas(), transparent: true, alphaTest: .2, side: THREE.DoubleSide });
    const signs = new THREE.Mesh(geometry, material); signs.name = 'Painted district signs'; signs.receiveShadow = true; group.add(signs);
  }

  // High utility lines connect existing rooftop anchors, with a gentle sag.
  const wireVertices = [];
  for (let i = 0; i < rooftops.length - 1; i++) {
    const a = rooftops[i], b = rooftops[i + 1], length = Math.hypot(a.x - b.x, a.z - b.z);
    if (length < 5 || length > 30) continue;
    const at = t => [a.x + (b.x - a.x) * t, Math.max(a.y, b.y) + 1.6 - Math.sin(t * Math.PI) * .9, a.z + (b.z - a.z) * t];
    for (let j = 0; j < 12; j++) wireVertices.push(...at(j / 12), ...at((j + 1) / 12));
  }
  if (wireVertices.length) {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(wireVertices, 3));
    const wires = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x3c4039, transparent: true, opacity: .8 }));
    wires.name = 'Rooftop utility cables'; group.add(wires);
  }

  // A sand backdrop seats the town and skyline in the desert. The playable
  // floor stays above it, and the boundary walls keep this scenery unreachable.
  const sandTexture = plasterTexture(); sandTexture.repeat.set(160, 160);
  const desertGround = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshLambertMaterial({ color: 0xd6bd92, map: sandTexture }),
  );
  desertGround.name = 'Desert beyond the town';
  desertGround.rotation.x = -Math.PI / 2; desertGround.position.y = -.06;
  desertGround.receiveShadow = true; group.add(desertGround);

  // Everything in the skyline sits beyond the impassable boundary walls.
  for (let i = 0; i < 24; i++) {
    const angle = i / 24 * TAU, radius = Math.hypot(bounds.x, bounds.z) + 32 + noise(i + 180) * 25;
    const h = 14 + noise(i + 90) * 24;
    stamp('mountain', 'skyline', [0xc9ae86, 0xd5b990, 0xbda783][i % 3], [Math.cos(angle) * radius, h * .28 - 4, Math.sin(angle) * radius], [25 + noise(i) * 30, h, 27 + noise(i + 1) * 25], [0, angle, .05]);
  }
  for (let i = 0; i < 16; i++) {
    const x = -(bounds.x - 7) + i * (bounds.x - 7) * 2 / 15, z = -bounds.z - 6 - noise(i + 90) * 6;
    const h = 8 + noise(i + 70) * 7;
    box('stone', [0xc5ad86, 0xd5bd95, 0xbda27d][i % 3], [x, h / 2, z], [4 + noise(i + 1) * 3, h, 5 + noise(i + 2) * 3]);
    box('stone', 0xdfc59b, [x, h + .15, z], [4.5 + noise(i + 1) * 3, .3, 5.5 + noise(i + 2) * 3]);
    for (const y of [h - 2, h - 4]) for (const dx of [-1.1, 1.1]) box('shadow', 0x475147, [x + dx, y, z + (5 + noise(i + 2) * 3) / 2 + .03], [.65, 1.1, .06]);
  }
  // A distinctive tiled dome and slender tower orient the northern skyline.
  const landmarkZ = -bounds.z - 13;
  box('stone', 0xdbc39a, [-12, 6, landmarkZ], [8, 12, 8]);
  stamp('dome', 'stone', 0x70958b, [-12, 12, landmarkZ], [9, 7, 9]);
  stamp('cylinder', 'metal', 0xcfb67b, [-12, 15.8, landmarkZ], [.12, 1.4, .12]);
  box('stone', 0xd6bd92, [-20, 9, landmarkZ - 1], [2.5, 18, 2.5]);
  box('stone', 0xe7cfa7, [-20, 16.3, landmarkZ - 1], [3.4, .5, 3.4]);
  stamp('dome', 'stone', 0x789887, [-20, 18, landmarkZ - 1], [3.2, 2.3, 3.2]);

  for (let i = 0; i < 10; i++) {
    const side = i < 5 ? -1 : 1, x = side * (bounds.x + 3.5 + noise(i) * 4), z = -bounds.z + 10 + i % 5 * (bounds.z * 2 - 20) / 4;
    const h = 8 + noise(i + 80) * 2.4;
    stamp('trunk', 'timber', 0x8f7750, [x, h / 2, z], [.7, h, .7], [0, 0, side * .035]);
    for (let ring = 0; ring < 9; ring++) stamp('cylinder', 'timber', 0x9a835b, [x - side * .035 * (ring - 4), .8 + ring * (h - 1) / 9, z], [.45 - ring * .013, .10, .45 - ring * .013]);
    for (let j = 0; j < 10; j++) stamp('leaf', 'leaf', [0x647c4c, 0x798a4e, 0x526c43][j % 3], [x - side * h * .018, h, z], [.85 + noise(j + i) * .25, .85, 1], [0, j * TAU / 10 + i, 0]);
  }

  for (const [key, batch] of batches) {
    const mesh = new THREE.InstancedMesh(geometries[batch.shape], mats[batch.material], batch.matrices.length);
    mesh.name = `Sirocco ${key}`;
    batch.matrices.forEach((matrix, i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, color.set(batch.colors[i])); });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = batch.material !== 'light' && batch.material !== 'skyline';
    mesh.receiveShadow = batch.material !== 'light';
    mesh.computeBoundingSphere(); group.add(mesh);
  }
  group.userData = { decorativeOnly: true, instances: instanceCount, instanceBatches: batches.size, windows, awnings, signs: signCount };
  scene.add(group);
  return group;
}
