// Location-specific dressing. The authoritative collision boxes remain in Rust.
// Furniture sits on existing cover; scenery beyond the boundary is unreachable.
// Repeated details share instanced batches, and everything belongs to mapGroup.
import * as THREE from '../vendor/three.module.min.js';

const TAU = Math.PI * 2;
const STEEL = [0xa44837, 0x386b88, 0x477566, 0xb69a50, 0xba7043, 0x4a7f88];
const noise = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function texture(draw, size = 256) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function grain(g, size, count, opacity = .12) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = `rgba(${i % 2 ? '255,255,255' : '0,0,0'},${noise(i + 5) * opacity})`;
    g.fillRect(noise(i + 2) * size, noise(i + 3) * size, 1 + noise(i) * 2, 1 + noise(i + 7) * 2);
  }
}

export function locationTexture(theme, type) {
  return texture((g, s) => {
    g.fillStyle = '#e8e8e3'; g.fillRect(0, 0, s, s);
    if (type === 'ground') {
      g.fillStyle = theme === 'ship' ? '#98ada4' : theme === 'office' ? '#acaeab' : '#777b7c';
      g.fillRect(0, 0, s, s); grain(g, s, 6000, .32);
      g.strokeStyle = theme === 'ship' ? 'rgba(21,48,43,.22)' : 'rgba(30,30,30,.11)';
      g.lineWidth = 2; g.strokeRect(1, 1, s - 2, s - 2);
      if (theme === 'ship') for (let x = 8; x < s; x += 20) for (let y = 6; y < s; y += 20) {
        g.fillStyle = 'rgba(210,230,217,.22)'; g.fillRect(x, y, 6, 2);
      }
    } else if (type === 'wall') {
      g.fillStyle = theme === 'office' ? '#f1eee7' : theme === 'ship' ? '#e2e8e4' : '#c8c5b9';
      g.fillRect(0, 0, s, s); grain(g, s, 2000, .10);
      if (theme !== 'office') {
        for (let x = 0; x < s; x += 32) {
          g.fillStyle = 'rgba(24,35,40,.12)'; g.fillRect(x, 0, 2, s);
          g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x + 2, 0, 2, s);
        }
      }
      g.fillStyle = 'rgba(36,42,42,.13)'; g.fillRect(0, s - 10, s, 10);
    } else if (type === 'container') {
      if (theme === 'office') {
        g.fillStyle = '#38414a'; g.fillRect(0, 0, s, s);
        for (let y = 5; y < s; y += 21) {
          g.fillStyle = '#69737b'; g.fillRect(12, y, s - 24, 16);
          g.fillStyle = '#222c35'; g.fillRect(25, y + 3, s - 54, 2);
          g.fillRect(25, y + 8, s - 54, 2); g.fillStyle = '#96d2a2'; g.fillRect(s - 23, y + 6, 4, 4);
        }
      } else {
        for (let x = 0; x < s; x += 24) {
          const gr = g.createLinearGradient(x, 0, x + 24, 0);
          gr.addColorStop(0, 'rgba(0,0,0,.3)'); gr.addColorStop(.38, 'rgba(255,255,255,.17)'); gr.addColorStop(.7, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.3)');
          g.fillStyle = gr; g.fillRect(x, 0, 24, s);
        }
        grain(g, s, 1800, .22);
      }
    } else if (type === 'crate') {
      g.fillStyle = theme === 'office' ? '#cfbc96' : '#a78b5d'; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 32) { g.fillStyle = 'rgba(53,32,18,.19)'; g.fillRect(0, y, s, 2); }
      grain(g, s, 1800, .19);
      if (theme !== 'office') { g.strokeStyle = '#665638'; g.lineWidth = 12; g.strokeRect(8, 8, s - 16, s - 16); }
    } else {
      g.fillStyle = theme === 'ship' ? '#dae0db' : '#bbbcb4'; g.fillRect(0, 0, s, s); grain(g, s, 3500, .2);
      if (theme !== 'office') for (let x = -s; x < s; x += 60) {
        g.fillStyle = '#c1a34f'; g.beginPath(); g.moveTo(x, 30); g.lineTo(x + 26, 30); g.lineTo(x + 56, 0); g.lineTo(x + 30, 0); g.fill();
      }
    }
  });
}

export function locationTint(theme, mat, v, b) {
  if (theme === 'office') {
    if (mat === 1) {
      const x = (b[0] + b[3]) / 2, z = (b[2] + b[5]) / 2;
      if (b[1] > 2) return 0xf3f1e8;
      return x > -24 && x < 12 && z < 1 ? 0xa3b6a2 : [0xe6e1d6, 0xd6d3c9, 0xe8e4da, 0xb5bcae][v % 4];
    }
    if (mat === 2) return 0xe9edf0;
    if (mat === 3) return b[4] > 1.3 ? 0xd4d9d3 : 0xf0dfbd;
    return 0xffffff;
  }
  if (mat === 2) return STEEL[v % STEEL.length];
  if (mat === 1) return theme === 'ship' ? [0xf0f1e8, 0xe6eee8, 0xd9e6df][v % 3] : [0xadc1c6, 0xbcc4bf, 0xa7aba7, 0xd2c7ac][v % 4];
  return 0xffffff;
}

export function lightLocation(world, theme) {
  const styles = {
    desert: [0xb8d4d7, 0xd6c3a0, 78, 230, 0xdbeef2, 0x887050, 1.7, 0xffedcc, 3, 1.15],
    dockyard: [0xb4d0dc, 0xb6c9cc, 90, 260, 0xddeaf4, 0x68787b, 1.65, 0xffedd6, 2.6, 1.08],
    office: [0x8398a2, 0x9ca9aa, 100, 260, 0xe7f0ed, 0xa4a494, 2.4, 0xfff4da, 1.4, 1.05],
    ship: [0x99bacb, 0xa3bdc7, 110, 310, 0xd4e7f0, 0x657e83, 1.8, 0xffe4c0, 2.7, 1.1],
  };
  const s = styles[theme === 'industrial' ? 'dockyard' : theme] || styles.desert;
  world.scene.background.set(s[0]); world.scene.fog = new THREE.Fog(s[1], s[2], s[3]);
  world.hemisphere.color.set(s[4]); world.hemisphere.groundColor.set(s[5]); world.hemisphere.intensity = s[6];
  world.sun.color.set(s[7]); world.sun.intensity = s[8]; world.renderer.toneMappingExposure = s[9];
  world.sun.position.set(-42, 65, 26);
}

class Dressing {
  constructor(group) {
    this.group = group; this.batches = new Map(); this.labels = [];
    this.materials = {
      paint: new THREE.MeshStandardMaterial({ roughness: .85 }),
      metal: new THREE.MeshStandardMaterial({ roughness: .55, metalness: .55 }),
      glass: new THREE.MeshStandardMaterial({ roughness: .26, metalness: .18 }),
      light: new THREE.MeshBasicMaterial(),
    };
    this.geometries = { box: new THREE.BoxGeometry(1, 1, 1), cylinder: new THREE.CylinderGeometry(.5, .5, 1, 10), sphere: new THREE.SphereGeometry(.5, 12, 8) };
    this.dummy = new THREE.Object3D(); this.instances = 0;
  }
  stamp(shape, mat, color, position, scale, rotation = [0, 0, 0]) {
    const key = `${shape}:${mat}`;
    if (!this.batches.has(key)) this.batches.set(key, { shape, mat, items: [] });
    const d = this.dummy; d.position.set(...position); d.scale.set(...scale); d.rotation.set(...rotation); d.updateMatrix();
    this.batches.get(key).items.push([d.matrix.clone(), color]); this.instances++;
  }
  box(color, p, size, mat = 'paint', r) { this.stamp('box', mat, color, p, size, r); }
  cylinder(color, p, size, mat = 'metal', r) { this.stamp('cylinder', mat, color, p, size, r); }
  beam(a, b, width, color, mat = 'metal') {
    const p = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.sub(p);
    const d = this.dummy; d.position.copy(p).addScaledVector(delta, .5); d.scale.set(width, delta.length(), width);
    d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); d.updateMatrix();
    const key = `box:${mat}`;
    if (!this.batches.has(key)) this.batches.set(key, { shape: 'box', mat, items: [] });
    this.batches.get(key).items.push([d.matrix.clone(), color]); this.instances++;
  }
  label(title, subtitle, p, width, yaw = 0, color = '#17333e') { this.labels.push({ title, subtitle, p, width, yaw, color }); }
  finish() {
    const color = new THREE.Color();
    for (const batch of this.batches.values()) {
      const mesh = new THREE.InstancedMesh(this.geometries[batch.shape], this.materials[batch.mat], batch.items.length);
      batch.items.forEach(([matrix, tint], i) => { mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, color.set(tint)); });
      mesh.castShadow = batch.mat !== 'light'; mesh.receiveShadow = batch.mat !== 'light'; mesh.name = `Details: ${batch.shape}/${batch.mat}`;
      this.group.add(mesh);
    }
    if (this.labels.length) {
      const cols = 4, rows = Math.ceil(this.labels.length / cols), canvas = document.createElement('canvas');
      canvas.width = 2048; canvas.height = rows * 128;
      const g = canvas.getContext('2d'), points = [], uv = [], indices = [];
      this.labels.forEach((label, i) => {
        const x = i % cols * 512, y = Math.floor(i / cols) * 128;
        g.fillStyle = label.color; g.fillRect(x, y, 512, 128);
        g.strokeStyle = '#d9e0d6'; g.lineWidth = 3; g.strokeRect(x + 7, y + 7, 498, 114);
        g.textAlign = 'center'; g.fillStyle = '#f6f1df'; g.font = 'bold 46px sans-serif'; g.fillText(label.title, x + 256, y + 59, 478);
        g.font = '17px sans-serif'; g.fillText(label.subtitle || '', x + 256, y + 97, 475);
        const w = label.width / 2, h = label.width / 8, c = Math.cos(label.yaw), s = Math.sin(label.yaw), base = points.length / 3;
        for (const [dx, dy] of [[-w, -h], [w, -h], [w, h], [-w, h]]) points.push(label.p[0] + c * dx, label.p[1] + dy, label.p[2] - s * dx);
        const u0 = (x + 1) / canvas.width, u1 = (x + 511) / canvas.width, v0 = 1 - (y + 127) / canvas.height, v1 = 1 - (y + 1) / canvas.height;
        uv.push(u0, v0, u1, v0, u1, v1, u0, v1); indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(indices); geo.computeVertexNormals();
      this.group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })));
    }
    this.group.userData = { decorativeOnly: true, instances: this.instances, instanceBatches: this.batches.size, signs: this.labels.length };
  }
}

function water(group, size = 900) {
  const tex = texture((g, s) => {
    g.fillStyle = '#739aa5'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 120; i++) {
      g.strokeStyle = `rgba(213,235,227,${.05 + noise(i) * .18})`; g.lineWidth = 1;
      const x = noise(i + 1) * s, y = noise(i + 6) * s;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 12, y - 2, x + 24 + noise(i) * 30, y); g.stroke();
    }
  });
  tex.repeat.set(70, 70);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: 0x3f7383, map: tex, roughness: .32, metalness: .35 }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = -2.4; mesh.name = 'Sea'; group.add(mesh);
}

function containerDetails(d, map) {
  map.boxes.filter(b => b[6] === 2 && b[1] < .1).forEach((b, i) => {
    const [x0, , z0, x1, y1, z1] = b, x = (x0 + x1) / 2, z = (z0 + z1) / 2, w = x1 - x0, depth = z1 - z0;
    const trim = STEEL[b[7] % 6];
    for (const y of [.12, y1 - .1]) {
      d.box(trim, [x, y, z0 - .025], [w, .12, .06], 'metal'); d.box(trim, [x, y, z1 + .025], [w, .12, .06], 'metal');
    }
    for (const xx of [x0 + .06, x1 - .06]) for (const zz of [z0 - .025, z1 + .025]) d.box(0x7b8885, [xx, y1 / 2, zz], [.09, y1, .08], 'metal');
    for (const xx of [x - Math.min(w * .22, .7), x + Math.min(w * .22, .7)]) {
      d.box(0xd0cec0, [xx, y1 / 2, z1 + .07], [.055, y1 - .3, .055], 'metal');
      d.box(0xd0cec0, [xx + .09, 1.15, z1 + .1], [.22, .05, .06], 'metal');
    }
    if (w >= 3.5 && i % 2 === 0) d.label('MERIDIAN', `LOGISTICS  •  ${String(i + 401).padStart(6, '0')}`, [x, Math.min(y1 - .5, 1.8), z0 - .075], Math.min(w - .4, 3), Math.PI);
    if (depth > 5) d.label(`${String(i + 10).padStart(2, '0')}  /  45G1`, 'MAX GROSS 30 480 KG', [x1 + .07, 1.35, z], Math.min(depth - .5, 2.5), Math.PI / 2);
  });
}

function warehouseFaces(d, map) {
  for (const b of map.boxes.filter(b => b[6] === 1 && b[1] < .1 && b[4] > 5)) {
    const [x0, , z0, x1, y1, z1] = b, w = x1 - x0, depth = z1 - z0;
    if (w < 5 || depth < 2) continue;
    for (const z of [z0 - .03, z1 + .03]) {
      d.box(0x4a5a60, [(x0 + x1) / 2, y1 - .15, z], [w + .06, .18, .12], 'metal');
      for (let x = x0 + 2; x < x1 - 1; x += 4) {
        d.box(0x415665, [x, Math.min(y1 - 1.3, 4.9), z], [2.5, .95, .06], 'glass');
        d.box(0xa9b6b6, [x, Math.min(y1 - 1.3, 4.9), z + (z === z0 - .03 ? -.04 : .04)], [.06, .95, .04], 'metal');
      }
    }
    d.box(0x7b8788, [(x0 + x1) / 2, y1 + .25, (z0 + z1) / 2], [Math.min(w * .45, 6), .5, Math.min(depth * .5, 3)], 'metal');
  }
}

// Mount wayfinding on an actual solid face; no freestanding sign can imply an
// invisible wall or accidentally float in an open doorway after layout edits.
function mountedLabel(d, map, title, subtitle, target, width, color) {
  const candidates = [];
  for (const b of map.boxes.filter(b => b[6] === 1 && b[1] < .1)) {
    const height = width / 4, y = Math.min(target[1], b[4] - height / 2 - .15);
    if (y - height / 2 < .5) continue;
    const faces = [
      [b[0], b[3], b[2] - .07, Math.PI, false], [b[0], b[3], b[5] + .07, 0, false],
      [b[2], b[5], b[0] - .07, -Math.PI / 2, true], [b[2], b[5], b[3] + .07, Math.PI / 2, true],
    ];
    for (const [min, max, at, yaw, side] of faces) {
      if (max - min < width + .2) continue;
      const along = Math.max(min + width / 2 + .1, Math.min(max - width / 2 - .1, target[side ? 2 : 0]));
      const p = side ? [at, y, along] : [along, y, at];
      candidates.push({ p, yaw, distance: Math.hypot(p[0] - target[0], p[2] - target[2]) });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  if (candidates.length) { const f = candidates[0]; d.label(title, subtitle, f.p, width, f.yaw, color); }
}

function crane(d, x, z, yaw, color = 0xd2a459) {
  const convert = (a, y, b) => [x + Math.cos(yaw) * a + Math.sin(yaw) * b, y, z - Math.sin(yaw) * a + Math.cos(yaw) * b];
  const leg = [[-7, -5], [7, -5], [-7, 5], [7, 5]];
  for (const [a, b] of leg) {
    d.beam(convert(a, -1, b), convert(a * .65, 24, b * .65), .6, color);
    d.box(0x303e45, convert(a, .6, b), [2.5, 1.2, 2.2], 'metal');
  }
  d.beam(convert(-7, 13, -5), convert(7, 24, -5), .25, color); d.beam(convert(7, 13, 5), convert(-7, 24, 5), .25, color);
  for (const a of [-4.6, 4.6]) {
    d.beam(convert(a, 24, -16), convert(a, 24, 26), .6, color);
    d.beam(convert(a, 27, -16), convert(a, 27, 26), .35, color);
    for (let b = -16; b < 24; b += 4) d.beam(convert(a, 24, b), convert(a, 27, b + 4), .15, color);
  }
  for (let b = -16; b < 27; b += 6) d.beam(convert(-4.6, 24, b), convert(4.6, 24, b), .3, color);
  d.box(0x38515a, convert(0, 23, 8), [3.4, 2.1, 3], 'glass', [0, yaw, 0]);
  for (const a of [-2.2, 2.2]) d.beam(convert(a, 24, 10), convert(a, 8, 10), .04, 0x263d46);
  d.box(0xd6a740, convert(0, 8, 10), [6, .45, 2.4], 'metal', [0, yaw, 0]);
}

function buildDockyard(d, map) {
  water(d.group); containerDetails(d, map); warehouseFaces(d, map);
  d.box(0x6d7370, [0, -1.53, 0], [map.w * 2 + 1, 3, map.h * 2 + 1]);
  for (const x of [-map.w - .6, map.w + .6]) {
    d.box(0xc0bda8, [x, .04, 0], [.25, .09, map.h * 2]);
    for (let z = -map.h + 5; z < map.h; z += 10) {
      d.cylinder(0x32434a, [x, -.75, z], [.8, 1.6, .8]);
      d.box(0x34464b, [x, -.04, z], [1.2, .25, .5], 'metal');
    }
  }
  // The broad outer quays are walkable lanes; only paint is added on them.
  for (const x of [-map.w + 5, map.w - 5]) for (let z = -map.h + 7; z < map.h - 4; z += 8) d.box(0xd2bd73, [x, .026, z], [.16, .01, 3]);
  crane(d, -map.w - 15, -14, .2); crane(d, map.w + 19, -28, -.25, 0xa45639);
  for (let i = 0; i < 11; i++) {
    const x = -95 + i * 18, z = -map.h - 42 - noise(i) * 12;
    d.box([0x70858a, 0x839498, 0x687e84][i % 3], [x, 3 + noise(i) * 3, z], [14, 9 + noise(i) * 4, 12]);
    d.box(0x667c82, [x, 9 + noise(i) * 4, z], [15, .4, 13], 'metal');
  }
  mountedLabel(d, map, 'DOCKYARD', 'NORTH TERMINAL  /  AUTHORIZED CARGO', [0, 6.4, 40], 13);
  mountedLabel(d, map, 'A  /  EAST STORAGE', 'CONTAINER TERMINAL', [25, 4.2, -35], 8);
  mountedLabel(d, map, 'B  /  WEST STORAGE', 'PORT AUTHORITY', [-29, 4.2, -35], 8);
}

function buildShip(d, map) {
  water(d.group); containerDetails(d, map); warehouseFaces(d, map);
  const outline = new THREE.Shape();
  outline.moveTo(-map.w - 1, -map.h - 2); outline.lineTo(map.w + 1, -map.h - 2);
  outline.lineTo(map.w + 1, map.h - 2); outline.lineTo(map.w * .7, map.h + 9); outline.lineTo(0, map.h + 21);
  outline.lineTo(-map.w * .7, map.h + 9); outline.lineTo(-map.w - 1, map.h - 2); outline.closePath();
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 4.8, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0x283f49, roughness: .74 }));
  hull.rotation.x = Math.PI / 2; hull.position.y = -.035; hull.name = 'MV Meridian hull'; d.group.add(hull);
  for (const side of [-1, 1]) {
    const x = side * (map.w - .8);
    for (let z = -map.h + 2; z < map.h - 2; z += 4) d.box(0xd9dfd5, [x, 1.48, z], [.07, .36, .07], 'metal');
    for (const y of [1.35, 1.63]) d.box(0xd9dfd5, [x, y, 0], [.07, .06, map.h * 2 - 2], 'metal');
    for (let z = -map.h + 8; z < map.h - 5; z += 8) d.box(0xd2bf6f, [side * (map.w - 5), .026, z], [.15, .01, 3]);
    // Lifeboats hang outboard of the solid perimeter, never across a route.
    d.stamp('sphere', 'paint', 0xe17e42, [side * (map.w + 3), 2.6, -35], [4.6, 2.3, 10]);
    d.box(0xe3dfca, [side * (map.w + 3), 3.4, -35], [3.4, .5, 6]);
    for (const z of [-38, -32]) d.beam([side * (map.w + .3), 1.5, z], [side * (map.w + 4), 5.5, z], .2, 0xc4ccc7);
    d.label('MV MERIDIAN', 'NORTH SEA CARGO  /  IMO 9472046', [side * (map.w + 1.04), -1.15, -4], 20, side * Math.PI / 2);
  }
  // Bridge and antenna assembly sit above the impenetrable stern shield.
  d.box(0xe5e9df, [0, 10.6, -44], [30, 2.2, 7]);
  d.box(0x314f60, [0, 10.8, -40.43], [28, 1.15, .08], 'glass');
  for (let x = -13; x <= 13; x += 2.6) d.box(0xe6e8dc, [x, 10.8, -40.33], [.1, 1.2, .12], 'metal');
  d.box(0xe8e9df, [0, 11.85, -44], [32, .3, 8]);
  for (const x of [-8, 8]) {
    d.cylinder(0xc2c9bf, [x, 13.2, -45], [2.6, 2.8, 2.6]);
    d.cylinder(0x334851, [x, 14.7, -45], [2.7, .4, 2.7]);
  }
  d.beam([0, 11.9, -43], [0, 23, -43], .28, 0xd4d8ce);
  for (const y of [16, 19, 22]) d.box(0xd4d8ce, [0, y, -43], [y === 19 ? 8 : 5, .18, .18], 'metal');
  d.box(0x313c40, [0, 19.2, -43], [4.8, .25, .7], 'metal');
  d.label('MV MERIDIAN', 'BRIDGE  /  STERN ACCESS', [0, 5.3, -39.92], 15);
  d.label('FORECASTLE', 'A  ←  PORT     /     STARBOARD  →  B', [0, 5.6, 39.92], 15, Math.PI);
  for (const b of map.boxes.filter(b => b[6] === 1 && b[1] < .1 && b[4] > 8)) {
    if (b[2] < 0) continue;
    for (const x of [-7, 7]) {
      d.cylinder(0xdfe4d9, [x, b[4] + 1.5, 44], [2.5, 3, 2.5]);
      d.box(0x697c7c, [x, b[4] + 2.8, 44], [3.2, .4, 3.2]);
    }
  }
  // Small distant escort vessel reinforces the open-sea setting.
  d.box(0x536d78, [-125, -.3, -65], [11, 4, 43]); d.box(0xa6b8b9, [-125, 4, -72], [8, 5, 9]);
  d.beam([-125, 6, -72], [-125, 14, -72], .25, 0x657d83);
}

function floorPatch(d, x0, z0, x1, z1, tint, tile = false) {
  d.box(tint, [(x0 + x1) / 2, .009, (z0 + z1) / 2], [x1 - x0, .012, z1 - z0]);
  if (tile) for (let x = x0 + 2; x < x1; x += 2) d.box(0xadaea2, [x, .017, (z0 + z1) / 2], [.018, .006, z1 - z0]);
}

function buildOffice(d, map) {
  // Based on Kontor Norheim's IFC-derived ground-floor arrangement and finishes:
  // western Landskap Showroom, sage atrium, eastern offices/IKT and south Lager.
  d.box(0x526a5c, [0, -.4, 0], [map.w * 2 + 80, .6, map.h * 2 + 80]);
  floorPatch(d, -48, -50, 48, -34, 0x787e7a);
  floorPatch(d, -48, -32, -22, -4, 0x777c75);
  floorPatch(d, -20, -32, 10, -2, 0xc6c3b6, true);
  floorPatch(d, 14, -30, 48, -4, 0x7e827a);
  floorPatch(d, 2, 0, 48, 50, 0x969d9c);
  floorPatch(d, -48, 0, 0, 50, 0x6c7477);
  for (let z = 9; z < 43; z += 7) {
    d.box(0xd6d6c6, [-42, .025, z], [9, .01, .13]);
    d.box(0xd6d6c6, [-37.5, .025, z + 3.5], [.13, .01, 7]);
  }
  const walls = map.boxes.filter(b => b[6] === 1 && b[1] < .1);
  for (const b of walls) {
    const [x0, , z0, x1, y1, z1] = b, w = x1 - x0, depth = z1 - z0;
    if (z0 >= 0 || y1 < 3) continue;
    // Oak skirting and head rails follow real solid wall footprints.
    for (const y of [.09, Math.min(3.85, y1 - .1)]) {
      d.box(0xb59d75, [(x0 + x1) / 2, y, z0 - .025], [w, .12, .055]);
      d.box(0xb59d75, [(x0 + x1) / 2, y, z1 + .025], [w, .12, .055]);
      d.box(0xb59d75, [x0 - .025, y, (z0 + z1) / 2], [.055, .12, depth]);
      d.box(0xb59d75, [x1 + .025, y, (z0 + z1) / 2], [.055, .12, depth]);
    }
    // Opaque reflective/frosted inserts clearly retain their collision wall.
    if (w >= 6 && depth <= 2.1 && z0 < -3 && z0 > -49) for (let x = x0 + 1.5; x < x1 - 1; x += 3) for (const z of [z0 - .04, z1 + .04]) {
      d.box(0x788d8b, [x, 2.1, z], [2.5, 2.4, .04], 'glass');
      d.box(0xbfcac1, [x, 1.55, z + (z < z0 ? -.025 : .025)], [2.5, .85, .025], 'glass');
      for (const dx of [-1.26, 1.26]) d.box(0x485957, [x + dx, 2.1, z], [.055, 2.45, .08], 'metal');
      for (const y of [.88, 3.32]) d.box(0x485957, [x, y, z], [2.6, .055, .08], 'metal');
    }
  }
  map.boxes.filter(b => b[6] === 3 && b[1] < .1).forEach((b, i) => {
    const [x0, , z0, x1, y1, z1] = b, x = (x0 + x1) / 2, z = (z0 + z1) / 2, w = x1 - x0, depth = z1 - z0;
    if (z > 0) {
      d.box(0x685b46, [x, y1 + .03, z], [w + .02, .06, depth + .02]);
      for (const xx of [x0 + .15, x1 - .15]) d.box(0x585e58, [xx, y1 / 2, z1 + .03], [.12, y1, .08], 'metal');
      return;
    }
    if (y1 < 1.2) {
      // Every monitor sits entirely over an existing desk collision box.
      d.box(0xd8c5a1, [x, y1 + .035, z], [w + .03, .07, depth + .03]);
      for (let xx = x0 + .75; xx < x1 - .35; xx += 1.65) {
        d.box(0x26383a, [xx, y1 + .39, z], [.88, .5, .08], 'metal');
        d.box(0x738e8b, [xx, y1 + .39, z + .047], [.78, .4, .012], 'light');
        d.box(0x35545d, [xx - .16, y1 + .41, z + .057], [.3, .28, .01], 'light');
        d.box(0x3c4544, [xx, y1 + .13, z], [.06, .25, .08], 'metal');
        d.box(0x353f40, [xx, y1 + .09, Math.min(z1 - .2, z + .45)], [.7, .04, .22], 'metal');
        // Seat back is contained inside the desk footprint, keeping lanes clear.
        if (depth >= 1.8) d.box(0x53645e, [xx, .75, z0 + .18], [.55, .5, .14]);
      }
    } else {
      for (const yy of [.4, 1.0, 1.5]) {
        d.box(0xabb5ad, [x, yy, z1 + .025], [w - .1, .025, .05], 'metal');
        for (let xx = x0 + .5; xx < x1; xx += 1) d.box(0x526260, [xx, yy - .12, z1 + .06], [.22, .035, .05], 'metal');
      }
    }
  });
  // Planters are fitted to the low collision cover, including foliage above it.
  for (const b of map.boxes.filter(b => b[6] === 4 && b[1] < .1 && b[4] < 1.5)) {
    const x = (b[0] + b[3]) / 2, z = (b[2] + b[5]) / 2;
    d.box(0x4b5147, [x, b[4] + .025, z], [b[3] - b[0] - .12, .07, b[5] - b[2] - .12]);
    for (let i = 0; i < 5; i++) d.stamp('sphere', 'paint', [0x5b7654, 0x748761, 0x416746][i % 3], [x + (noise(i) - .5) * (b[3] - b[0]) * .65, b[4] + .25 + noise(i + 3) * .3, z + (noise(i + 6) - .5) * (b[5] - b[2]) * .65], [.65, .6, .65]);
  }
  // Luminous strips sit below the actual collision ceilings.
  for (const b of map.boxes.filter(b => b[1] > 3 && b[6] === 1)) {
    // The ground-floor partitions are 4.2m high. Complete the upper envelope
    // from that height to each real ceiling, without extending into a route.
    // In the atrium this becomes a glazed clerestory above the adjacent roofs.
    const top = b[1], bottom = 4.2;
    const edges = [
      { from: b[0], to: b[3], at: b[2] + .04, side: false },
      { from: b[0], to: b[3], at: b[5] - .04, side: false },
      { from: b[2], to: b[5], at: b[0] + .04, side: true },
      { from: b[2], to: b[5], at: b[3] - .04, side: true },
    ];
    for (const edge of edges) {
      const span = edge.to - edge.from, mid = (edge.from + edge.to) / 2;
      const panel = (along, y, width, height, depth, tint, mat = 'paint') =>
        d.box(tint, edge.side ? [edge.at, y, along] : [along, y, edge.at],
          edge.side ? [depth, height, width] : [width, height, depth], mat);
      const fasciaTop = Math.min(top, top > 8 ? 4.7 : top > 5 ? 5.25 : top);
      panel(mid, (bottom + fasciaTop) / 2, span, fasciaTop - bottom, .2, top > 8 ? 0xa3b6a2 : 0xd5d7ca);
      panel(mid, bottom + .055, span + .06, .11, .27, 0xb59d75);
      if (top > 5) {
        const glassBottom = fasciaTop + .08, glassTop = top - .12;
        const segments = Math.ceil(span / 3), width = span / segments;
        for (let i = 0; i < segments; i++) {
          const along = edge.from + (i + .5) * width;
          panel(along, (glassBottom + glassTop) / 2, width - .09, glassTop - glassBottom, .10,
            i % 3 === 0 ? 0x91a8a6 : 0xa7bbb5, 'glass');
          panel(edge.from + i * width, (fasciaTop + top) / 2, .09, top - fasciaTop, .23, 0x536a65, 'metal');
        }
        panel(edge.to, (fasciaTop + top) / 2, .09, top - fasciaTop, .23, 0x536a65, 'metal');
        for (const y of [fasciaTop + .04, top - .055]) panel(mid, y, span + .12, .11, .25, 0x536a65, 'metal');
        if (top > 8) panel(mid, 6.75, span, .08, .22, 0x647b74, 'metal');
      }
      panel(mid, top - .025, span + .16, .14, .3, 0xb7a17c);
    }
    for (let x = b[0] + 3; x < b[3] - 1; x += 7) for (let z = b[2] + 3; z < b[5] - 1; z += 7) {
      const y = b[1] - .10;
      d.box(0x606b66, [x, y + .035, z], [2.5, .09, .35], 'metal');
      d.box(0xf4f7df, [x, y - .017, z], [2.3, .025, .22], 'light');
    }
    if (b[1] < 5 && b[2] < 0) for (let x = b[0] + .4; x < b[3]; x += .8) d.box(0xac936c, [x, b[1] - .04, (b[2] + b[5]) / 2], [.12, .07, b[5] - b[2]]);
  }
  // High atrium pendant rings: visible from the foyer without obstructing play.
  for (const x of [-12, -1]) for (const z of [-24, -12]) {
    d.beam([x, 8.9, z], [x, 5.6, z], .035, 0x586561);
    d.cylinder(0xe3e7d4, [x, 5.55, z], [2.4, .13, 2.4], 'light');
    d.cylinder(0x74847b, [x, 5.64, z], [2.5, .08, 2.5], 'metal');
  }
  mountedLabel(d, map, 'NORHEIM', 'LANDSKAP  /  SHOWROOM  /  KONTOR', [-7, 3.1, -2.1], 10);
  mountedLabel(d, map, 'LANDSKAP SHOWROOM', 'A  /  VESTFLØY', [-35, 3.3, -2.1], 9);
  mountedLabel(d, map, 'NORDAVIND', 'MØTEROM  /  ØSTFLØY', [38, 3.3, -2.1], 7);
  mountedLabel(d, map, 'IKT', 'TEKNISK ROM', [20, 3.2, -2.1], 4);
  mountedLabel(d, map, 'LAGER', 'B  /  VAREMOTTAK', [25, 4.2, .1], 10);
  mountedLabel(d, map, 'SOLUTION ORIENTED', 'KONTOR NORHEIM', [-7, 3.2, -32.1], 9);
  mountedLabel(d, map, 'SØRAVIND', 'MØTEROM', [30, 3.1, -34.1], 6);
  for (let i = 0; i < 17; i++) {
    const x = (i % 2 ? -1 : 1) * (map.w + 10 + noise(i) * 12), z = -map.h + i * 6;
    d.cylinder(0x5b6050, [x, 2, z], [.5, 4, .5], 'paint');
    d.stamp('sphere', 'paint', [0x627b5d, 0x829170, 0x4d7058][i % 3], [x, 4.8, z], [4.5, 6, 4.5]);
  }
}

export function buildLocation(parent, map) {
  const group = new THREE.Group(); group.name = `${map.name || map.id} architectural details`; parent.add(group);
  const d = new Dressing(group);
  if (map.theme === 'office') buildOffice(d, map);
  else if (map.theme === 'ship') buildShip(d, map);
  else buildDockyard(d, map);
  d.finish(); return group;
}
