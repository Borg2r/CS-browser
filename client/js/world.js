// Rendering: map geometry, player models, first-person weapon and effects.
import * as THREE from '../vendor/three.module.min.js';
import { gunModel, handModel, weaponInfo } from './models.js';
import { playerModel } from './characters.js';
import { buildDesert } from './desert.js';
import { locationTexture, locationTint, lightLocation, buildLocation } from './locations.js';

const TIMBER_COLS = [0xb39770, 0x89775b, 0xb09b78, 0xb8a580, 0x9a8061, 0xc2a77b];

function canvasTex(size, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function speckle(g, s, n, lo, hi, a = 0.25) {
  for (let i = 0; i < n; i++) {
    const v = lo + Math.random() * (hi - lo) | 0;
    g.fillStyle = `rgba(${v},${v},${v},${a})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
const TEX = {
  ground: () => canvasTex(512, (g, s) => {
    g.fillStyle = '#c9b88c'; g.fillRect(0, 0, s, s);
    for (let row = 0; row < 8; row++) for (let col = -1; col < 8; col++) {
      const x = col * 80 + (row % 2) * 40, y = row * 64;
      g.fillStyle = ['#cbbd98', '#d5c7a2', '#c1b28e', '#c9bb97'][(row * 13 + col + 16) % 4];
      g.fillRect(x + 1, y + 1, 78, 62);
      g.strokeStyle = 'rgba(102,88,63,.16)'; g.strokeRect(x + 1, y + 1, 78, 62);
    }
    speckle(g, s, 9000, 140, 225, .15);
    for (let i = 0; i < 16; i++) {
      const x = (i * 97) % s, y = (i * 173) % s;
      const dust = g.createRadialGradient(x, y, 3, x, y, 110); dust.addColorStop(0, 'rgba(222,199,149,.5)'); dust.addColorStop(1, 'rgba(222,199,149,0)');
      g.fillStyle = dust; g.fillRect(x - 110, y - 110, 220, 220);
    }
  }),
  wall: () => canvasTex(512, (g, s) => {
    g.fillStyle = '#d1c4ab'; g.fillRect(0, 0, s, s); speckle(g, s, 16000, 130, 235, .13);
    for (let i = 0; i < 30; i++) {
      const x = (i * 113) % s, y = (i * 67) % s;
      g.fillStyle = 'rgba(129,105,74,.13)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 9, y - 3); g.lineTo(x + 19, y + 12); g.lineTo(x + 6, y + 14); g.fill();
    }
    for (let row = 0; row < 2; row++) for (let col = -1; col < 7; col++) {
      g.fillStyle = ['#9e927b', '#afa18a', '#a69a81'][(row + col + 9) % 3];
      g.fillRect(col * 90 + row * 45 + 2, s - 74 + row * 37, 87, 34);
    }
    const stain = g.createLinearGradient(0, s - 110, 0, s); stain.addColorStop(0, 'rgba(88,69,44,0)'); stain.addColorStop(1, 'rgba(88,69,44,.15)'); g.fillStyle = stain; g.fillRect(0, s - 110, s, 110);
  }),
  container: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#b6a37d'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 32) {
      g.fillStyle = 'rgba(48,33,22,.45)'; g.fillRect(x, 0, 3, s);
      for (let i = 0; i < 8; i++) { g.strokeStyle = `rgba(59,37,22,${.025 + i * .008})`; g.beginPath(); g.moveTo(x + 4 + i * 3, 0); g.bezierCurveTo(x + i * 3 - 6, 100, x + i * 3 + 10, 180, x + i * 3 + 5, s); g.stroke(); }
    }
    for (const y of [34, 204]) { g.fillStyle = '#44463e'; g.fillRect(0, y, s, 13); for (let x = 12; x < s; x += 32) { g.fillStyle = '#9b9782'; g.beginPath(); g.arc(x, y + 6, 3, 0, Math.PI * 2); g.fill(); } }
    speckle(g, s, 1500, 70, 180, .18);
  }),
  crate: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#a58c5f'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 42) { g.fillStyle = 'rgba(49,34,16,.35)'; g.fillRect(0, y, s, 3); }
    speckle(g, s, 3500, 60, 180, .17);
    g.strokeStyle = '#6c593e'; g.lineWidth = 14; g.strokeRect(8, 8, s - 16, s - 16);
    g.beginPath(); g.moveTo(14, 14); g.lineTo(s - 14, s - 14); g.stroke();
    g.fillStyle = '#d3cba9'; g.fillRect(115, 40, 98, 58); g.fillStyle = '#5e573e'; g.font = 'bold 18px monospace'; g.fillText('SIROCCO', 120, 64); g.font = '12px monospace'; g.fillText('CARGO 047', 123, 84);
    for (const x of [9, s - 9]) for (const y of [9, s - 9]) { g.fillStyle = '#33362d'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  }),
  barrier: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#c7bda5'; g.fillRect(0, 0, s, s); speckle(g, s, 5000, 110, 220, .23);
    g.strokeStyle = 'rgba(91,76,55,.3)'; g.lineWidth = 2;
    for (let row = 0; row < 4; row++) for (let col = -1; col < 4; col++) g.strokeRect(col * 80 + row % 2 * 40, row * 64, 80, 64);
  }),
};

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}

// Only map-owned objects reach this helper. Player and weapon meshes deliberately
// share immutable GPU assets, so removing those entities must not dispose them.
function disposeMapGroup(group) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  group.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      materials.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    }
    // InstancedMesh owns an additional instance-matrix GPU buffer.
    if (o.isInstancedMesh) o.dispose();
  });
  textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose());
  geometries.forEach(g => g.dispose()); group.clear();
}

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xb8d4d7);
    this.scene.fog = new THREE.Fog(0xd6c3a0, 78, 230);
    this.camera = new THREE.PerspectiveCamera(74, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.hemisphere = new THREE.HemisphereLight(0xdbeef2, 0x887050, 1.7);
    this.scene.add(this.hemisphere);
    const sun = new THREE.DirectionalLight(0xffedcc, 3.0);
    this.sun = sun;
    sun.position.set(-42, 65, 26); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 220 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    this.scene.add(sun);

    // First-person weapon is drawn in its own pass so it never clips into walls.
    this.vmScene = new THREE.Scene();
    this.vmScene.add(new THREE.HemisphereLight(0xf2f7ff, 0x6c6049, 2.2));
    const vmKey = new THREE.DirectionalLight(0xffefd0, 3.4); vmKey.position.set(-2, 3, 2); this.vmScene.add(vmKey);
    const vmRim = new THREE.DirectionalLight(0xc3e4f0, 1.6); vmRim.position.set(3, 1, -2); this.vmScene.add(vmRim);
    this.vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.vm = new THREE.Group(); this.vmScene.add(this.vm);
    this.vmCls = -1; this.vmWeapon = null; this.vmKick = 0; this.vmSwitch = 0; this.vmBob = 0; this.vmAim = 0;
    this.vmHands = [new THREE.Group(), new THREE.Group()];
    this.vm.add(...this.vmHands);
    this.handKick = [0, 0]; this.flashTimers = [0, 0]; this.handCycleAge = [Infinity, Infinity];
    this.vmReload = 0; this.vmTime = 0;
    this.muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ map: canvasTex(64, (g, s) => {
        const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        r.addColorStop(0, '#fff'); r.addColorStop(0.3, '#ffd76a'); r.addColorStop(1, 'rgba(255,120,0,0)');
        g.fillStyle = r; g.fillRect(0, 0, s, s);
      }, false), transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
    this.muzzle.visible = false;
    this.muzzles = [this.muzzle.clone(), this.muzzle];
    this.muzzles.forEach((flash, hand) => { flash.name = `muzzle-${hand}`; this.vmHands[hand].add(flash); });

    this.players = new Map();
    this.items = new Map();
    this.nades = new Map();
    this.fx = [];
    this.smokes = [];
    this.smokeTex = canvasTex(64, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(225,228,230,1)'); r.addColorStop(0.6, 'rgba(205,208,212,.85)'); r.addColorStop(1, 'rgba(200,200,200,0)');
      g.fillStyle = r; g.fillRect(0, 0, s, s);
    }, false);
    this.bomb = new THREE.Group();
    this.bomb.add(box(0.36, 0.14, 0.24, 0x4a3d2a, 0, 0.07, 0));
    this.bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    this.bombLight.position.set(0.1, 0.16, 0); this.bomb.add(this.bombLight);
    this.bomb.visible = false; this.scene.add(this.bomb);
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.7 });
    window.addEventListener('resize', () => this.resize()); this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.vmCamera.aspect = w / h;
    this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
  }

  buildMap(map) {
    this.clearMap();
    const theme = map.theme || 'desert';
    this.map = map;
    this.mapGroup = new THREE.Group(); this.mapGroup.name = `Map: ${map.name || map.id || 'Sirocco'}`;
    this.scene.add(this.mapGroup);
    lightLocation(this, theme);
    // Frame and light the whole playable town as its footprint changes.
    this.overviewRadius = Math.max(map.w, map.h) * 1.35;
    this.overviewHeight = Math.max(map.w, map.h) * 1.05;
    const shadowExtent = Math.max(map.w, map.h) * 1.35 + 8;
    Object.assign(this.sun.shadow.camera, {
      left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
    const mats = ['ground', 'wall', 'container', 'crate', 'barrier'];
    const tile = [5, 5, 3.4, 1.5, 2];
    const buf = mats.map(() => ({ p: [], n: [], u: [], c: [], i: [] }));
    const col = new THREE.Color();
    for (const b of map.boxes) {
      const [x0, y0, z0, x1, y1, z1, mat, v] = b, o = buf[mat], t = tile[mat];
      col.set(mat === 2 ? TIMBER_COLS[v % 6] : 0xffffff);
      if (mat === 1) col.set([0xf0d9b0, 0xe7c99b, 0xd4b98b, 0xf2e2c4, 0xe5ceaa, 0xd5c3a0][v % 6]);
      if (theme !== 'desert') col.set(locationTint(theme, mat, v, b));
      const face = (vs, n, uv) => {
        const base = o.p.length / 3;
        vs.forEach((p, k) => { o.p.push(...p); o.n.push(...n); o.u.push(uv[k][0] / t, uv[k][1] / t); o.c.push(col.r, col.g, col.b); });
        o.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]]);
      if (mat === 0) continue;
      if (y0 > 2.5) face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
      const side = (a, b2, n) => face([[a[0], y0, a[1]], [b2[0], y0, b2[1]], [b2[0], y1, b2[1]], [a[0], y1, a[1]]], n,
        [[a[0] + a[1], y0], [b2[0] + b2[1], y0], [b2[0] + b2[1], y1], [a[0] + a[1], y1]]);
      side([x0, z1], [x1, z1], [0, 0, 1]); side([x1, z0], [x0, z0], [0, 0, -1]);
      side([x1, z1], [x1, z0], [1, 0, 0]); side([x0, z0], [x0, z1], [-1, 0, 0]);
    }
    buf.forEach((o, k) => {
      if (!o.p.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(o.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(o.c, 3));
      g.setIndex(o.i);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: theme === 'desert' ? TEX[mats[k]]() : locationTexture(theme, mats[k]), vertexColors: true, roughness: k === 2 && theme !== 'desert' ? .6 : .95, metalness: k === 2 && theme !== 'desert' ? .2 : 0, side: THREE.DoubleSide }));
      m.receiveShadow = true; m.castShadow = k !== 0;
      this.mapGroup.add(m);
    });
    map.sites.forEach((s, k) => {
      const w = s[2] - s[0], d = s[3] - s[1];
      const tex = canvasTex(256, (g, sz) => {
        g.strokeStyle = 'rgba(240,193,75,.9)'; g.lineWidth = 8; g.setLineDash([26, 14]); g.strokeRect(6, 6, sz - 12, sz - 12);
        g.fillStyle = 'rgba(240,193,75,.75)'; g.font = 'bold 120px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('AB'[k], sz / 2, sz / 2 + 6);
      }, false);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.rotation.x = -Math.PI / 2; m.position.set((s[0] + s[2]) / 2, 0.02, (s[1] + s[3]) / 2);
      this.mapGroup.add(m);
    });
    if (theme === 'desert') buildDesert(this.mapGroup, map);
    else buildLocation(this.mapGroup, map);
  }

  clearMap() {
    if (this.mapGroup) {
      this.scene.remove(this.mapGroup); disposeMapGroup(this.mapGroup); this.mapGroup = null;
    }
    for (const model of this.players.values()) this.scene.remove(model.root);
    this.players.clear();
    for (const store of [this.items, this.nades]) {
      for (const model of store.values()) this.scene.remove(model);
      store.clear();
    }
    this.setSmokes([]);
    for (const f of this.fx) {
      this.scene.remove(f.o);
      if (f.dispose) { f.o.geometry.dispose(); if (f.o.material !== this.tracerMat) f.o.material.dispose(); }
    }
    this.fx.length = 0; this.bomb.visible = false;
    this.handKick.fill(0); this.flashTimers.fill(0); this.handCycleAge.fill(Infinity); this.vmKick = this.vmAim = 0;
    this.muzzles.forEach(m => { m.visible = false; });
    // Render lists otherwise retain removed map objects until the next frame.
    this.renderer.renderLists.dispose();
  }

  // ---- other players
  setPlayer(id, s, weapon, dt, hidden) {
    const w = weaponInfo(weapon);
    let m = this.players.get(id);
    if (!m || m.team !== s.team) {
      if (m) this.scene.remove(m.root);
      m = playerModel(s.team); m.team = s.team; this.players.set(id, m); this.scene.add(m.root);
    }
    m.seen = true;
    m.root.visible = !hidden;
    if (!s.alive) {
      m.deadT = Math.min(1, m.deadT + dt * 4);
      m.body.rotation.x = -m.deadT * Math.PI / 2; m.body.position.y = m.deadT * 0.15;
      return 0;
    }
    m.deadT = 0; m.body.rotation.x = 0; m.body.position.y = 0;
    const speed = m.last ? Math.hypot(s.x - m.last[0], s.z - m.last[1]) / Math.max(dt, 0.001) : 0;
    m.last = [s.x, s.z];
    m.root.position.set(s.x, s.y, s.z);
    m.root.rotation.y = s.yaw;
    const crouch = s.flags & 1;
    m.torso.position.y = crouch ? 0.5 : 0.85;
    m.legL.position.y = m.legR.position.y = crouch ? 0.5 : 0.85;
    m.legL.scale.y = m.legR.scale.y = crouch ? 0.6 : 1;
    const prev = m.phase;
    m.phase += Math.min(speed, 7) * dt * 1.7;
    const sw = Math.sin(m.phase) * Math.min(1, speed / 3) * 0.7;
    m.legL.rotation.x = sw; m.legR.rotation.x = -sw;
    m.arms.rotation.x = s.pitch * 0.9;
    m.torso.rotation.z = Math.sin(m.phase) * Math.min(speed, 6) * .003;
    if (m.kneeL) m.kneeL.rotation.x = Math.max(0, -sw) * .45;
    if (m.kneeR) m.kneeR.rotation.x = Math.max(0, sw) * .45;
    m.pack.visible = !!(s.flags & 2);
    if (m.weapon !== w.id) {
      m.weapon = w.id; m.gunSlot.clear(); m.gunSlot.add(gunModel(w));
      if (m.gunSlotL) { m.gunSlotL.clear(); if (w.dual) m.gunSlotL.add(gunModel(w)); }
      if (m.leftArm) m.leftArm.visible = !w.dual;
      if (m.leftArmDual) m.leftArmDual.visible = !!w.dual;
    }
    // Report a footstep when the stride crosses a half cycle at running speed.
    return speed > 3.4 && Math.floor(prev / Math.PI) !== Math.floor(m.phase / Math.PI) ? 1 : 0;
  }
  sweepPlayers() {
    for (const [id, m] of this.players) {
      if (!m.seen) { this.scene.remove(m.root); this.players.delete(id); }
      m.seen = false;
    }
  }

  syncSimple(store, list, make) {
    const seen = new Set();
    for (const e of list) {
      seen.add(e[0]);
      let m = store.get(e[0]);
      if (!m) { m = make(e); store.set(e[0], m); this.scene.add(m); m.position.set(e[2], e[3], e[4]); }
      m.userData.target = [e[2], e[3], e[4]];
    }
    for (const [id, m] of store) if (!seen.has(id)) { this.scene.remove(m); store.delete(id); }
  }
  setItems(list, weapons) {
    this.syncSimple(this.items, list, e => {
      const weapon = weapons[e[1]], h = new THREE.Group();
      for (let side = 0; side < (weapon.dual ? 2 : 1); side++) {
        const gun = gunModel(weapon); gun.rotation.z = Math.PI / 2; gun.scale.setScalar(1.3);
        if (weapon.dual) { gun.position.x = side ? .16 : -.16; gun.rotation.y = side ? -.08 : .08; }
        // Keep the entire model above the floor, including the large lever loop.
        gun.updateMatrixWorld(true);
        gun.position.y = .035 - new THREE.Box3().setFromObject(gun).min.y;
        h.add(gun);
      }
      return h;
    });
  }
  setNades(list, weapons) {
    this.syncSimple(this.nades, list, e => gunModel(weapons[e[1]]));
  }
  setSmokes(list) {
    while (this.smokes.length > list.length) {
      const smoke = this.smokes.pop(); this.scene.remove(smoke);
      smoke.children.forEach(sprite => sprite.material.dispose());
    }
    list.forEach((s, k) => {
      let g = this.smokes[k];
      if (!g) {
        g = new THREE.Group();
        for (let i = 0; i < 22; i++) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, opacity: 0.95 }));
          const a = Math.random() * 6.283, r = Math.random() * 2.4, y = 0.4 + Math.random() * 2.6;
          sp.position.set(Math.cos(a) * r, y, Math.sin(a) * r); sp.scale.setScalar(3.4 + Math.random() * 1.8);
          g.add(sp);
        }
        this.smokes[k] = g; this.scene.add(g);
      }
      g.position.set(s[0], s[1], s[2]);
      const fade = Math.min(1, s[3] / 2.5, (16.2 - s[3]) / 1.2);
      g.children.forEach(sp => { sp.material.opacity = 0.95 * Math.max(0, fade); });
    });
  }
  setBomb(b, time) {
    this.bomb.visible = !!b;
    if (b) { this.bomb.position.set(b[0], b[1], b[2]); this.bombLight.visible = (time * 4 | 0) % 2 === 0; }
  }

  // ---- effects
  tracer(from, to) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
    const l = new THREE.Line(g, this.tracerMat);
    this.scene.add(l); this.fx.push({ o: l, t: 0.06, dispose: true });
  }
  puff(p, color, size = 0.12, life = 0.25) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 6), new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.set(p[0], p[1], p[2]); this.scene.add(m);
    this.fx.push({ o: m, t: life, life, grow: 3, dispose: true });
  }
  explosion(p, big) {
    const size = big ? 6 : 1.6;
    this.puff(p, 0xffc45a, size, big ? 1.4 : 0.5); this.puff(p, 0xff7a2a, size * 0.6, big ? 1.0 : 0.35);
    const l = new THREE.PointLight(0xffa040, big ? 900 : 200, big ? 120 : 40);
    l.position.set(p[0], p[1] + 1, p[2]); this.scene.add(l); this.fx.push({ o: l, t: 0.25 });
  }

  setViewmodel(weapon) {
    const w = weaponInfo(weapon);
    if (w.id === this.vmWeapon?.id) return;
    this.vmWeapon = w; this.vmCls = w.cls; this.vmSwitch = 1; this.vmAim = 0;
    this.handKick.fill(0); this.flashTimers.fill(0); this.handCycleAge.fill(Infinity);
    this.vmHands.forEach((hand, side) => {
      hand.clear(); hand.visible = side === 1 || !!w.dual;
      const gun = gunModel(w); gun.name = 'weapon';
      hand.add(gun, handModel(side));
      if (side === 1 && !w.dual && w.cls >= 2 && w.cls <= 6) {
        const support = handModel(0, true); support.position.set(-.025, .035, -.26); hand.add(support);
      }
      const muzzle = this.muzzles[side]; muzzle.position.set(...gun.userData.muzzle); muzzle.visible = false; hand.add(muzzle);
      hand.userData.sightY = gun.userData.sightY;
      hand.userData.dualHip = gun.userData.dualHip;
    });
  }
  kick(amount, hand = 1) {
    const side = this.vmWeapon?.dual ? (hand === 0 ? 0 : 1) : 1;
    this.handKick[side] = Math.min(1.1, this.handKick[side] + amount);
    this.flashTimers[side] = .055; this.handCycleAge[side] = 0;
    this.vmKick = Math.min(1, this.vmKick + amount * .5);
  }

  render(dt, view) {
    // view: {speed, reload, scoped, firstPerson}
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.t -= dt;
      if (f.grow) { f.o.scale.multiplyScalar(1 + f.grow * dt); f.o.material.opacity = Math.max(0, f.t / f.life); }
      if (f.t <= 0) {
        this.scene.remove(f.o);
        if (f.dispose) { f.o.geometry.dispose(); if (f.o.material !== this.tracerMat) f.o.material.dispose(); }
        this.fx.splice(i, 1);
      }
    }
    for (const store of [this.items, this.nades]) for (const m of store.values()) {
      const t = m.userData.target; m.position.lerp(new THREE.Vector3(t[0], t[1], t[2]), Math.min(1, dt * 25));
      if (store === this.nades) m.rotation.x += dt * 9;
    }
    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.vmTime += dt;
    this.vmSwitch = Math.max(0, this.vmSwitch - dt * 4);
    this.vmKick = Math.max(0, this.vmKick - dt * 7);
    const dual = !!this.vmWeapon?.dual;
    const targetAim = dual || view.scoped || view.reload ? 0 : Math.max(0, Math.min(1, view.aim || 0));
    this.vmAim += (targetAim - this.vmAim) * Math.min(1, dt * 16);
    this.vmReload += ((view.reload ? 1 : 0) - this.vmReload) * Math.min(1, dt * 10);
    this.vmBob += dt * (view.speed || 0) * 1.6;
    this.vm.position.set(0, 0, 0); this.vm.rotation.set(0, 0, 0);
    for (let side = 0; side < 2; side++) {
      this.handKick[side] = Math.max(0, this.handKick[side] - dt * 7);
      this.flashTimers[side] = Math.max(0, this.flashTimers[side] - dt);
      const hand = this.vmHands[side], sign = side ? 1 : -1;
      const kick = this.handKick[side], aim = this.vmAim;
      const bob = Math.min(1, (view.speed || 0) / 6) * (1 - aim * .94);
      const lower = Math.max(this.vmSwitch, this.vmReload * .65);
      const reloadWave = this.vmReload * Math.sin(this.vmTime * 5 + side * .8);
      const hip = hand.userData.dualHip || [.23, -.15, -.45];
      const hipX = dual ? sign * hip[0] : .20;
      const hipY = dual ? hip[1] : -.14;
      const sightY = hand.userData.sightY || .12;
      hand.position.set(
        hipX * (1 - aim) + Math.cos(this.vmBob) * .006 * bob,
        THREE.MathUtils.lerp(hipY, -sightY, aim) - lower * .19 + Math.abs(Math.sin(this.vmBob)) * .008 * bob,
        THREE.MathUtils.lerp(dual ? hip[2] : -.43, -.26, aim) + kick * .055 + lower * .08);
      hand.rotation.set(kick * .13 - lower * .48, (dual ? sign * -.035 : .025) * (1 - aim), sign * (lower * .32 + reloadWave * .06));
      const gun = hand.getObjectByName('weapon');
      const slide = gun?.getObjectByName('slide');
      if (slide) slide.position.z = kick * .045;
      this.handCycleAge[side] += dt;
      const lever = gun?.getObjectByName('lever');
      if (lever) {
        const duration = Math.max(.4, this.vmWeapon.interval * .9);
        const phase = Math.max(0, Math.min(1, (this.handCycleAge[side] - .07) / duration));
        const cycle = Math.sin(phase * Math.PI);
        lever.rotation.x = cycle * 1.05 + this.vmReload * .24;
        const bolt = gun.getObjectByName('bolt');
        if (bolt) bolt.position.z = cycle * .057 + this.vmReload * .018;
        // Each wrist follows its own lever stroke, independently of the other gun.
        hand.rotation.x -= cycle * .065;
        hand.rotation.z += sign * cycle * .12;
      }
      const magazine = gun?.getObjectByName('magazine');
      if (magazine) magazine.position.y = -this.vmReload * (.07 + Math.max(0, reloadWave) * .08);
      const flash = this.muzzles[side];
      flash.visible = this.flashTimers[side] > 0 && this.vmCls >= 1 && this.vmCls <= 6;
      flash.rotation.z = Math.random() * Math.PI;
      flash.scale.setScalar(this.vmCls === 2 ? 1 : dual || this.vmCls === 1 ? .65 : 1);
    }
    if (view.firstPerson && !view.scoped) {
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
    this.frameStats = { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles };
  }
}
