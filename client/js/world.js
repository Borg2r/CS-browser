// Rendering: map geometry, player models, first-person weapon and effects.
import * as THREE from '../vendor/three.module.min.js';

const ATK_COL = 0xc9772e, DEF_COL = 0x2f6fb5;
const CONTAINER_COLS = [0xb5482e, 0x2f6fa8, 0x3e8a57, 0xd0a030, 0xc76a2a, 0x2e8f96];

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
  ground: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#6d6f6c'; g.fillRect(0, 0, s, s); speckle(g, s, 5000, 60, 150);
    g.strokeStyle = 'rgba(40,40,40,.5)'; g.lineWidth = 2; g.strokeRect(0, 0, s, s);
  }),
  wall: () => canvasTex(256, (g, s) => {
    g.fillStyle = '#9a9588'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 32) { g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(x, 0, 3, s); g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x + 3, 0, 3, s); }
    speckle(g, s, 3000, 80, 190, 0.18);
    g.fillStyle = 'rgba(60,45,30,.25)'; g.fillRect(0, s - 26, s, 26);
  }),
  container: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      const gr = g.createLinearGradient(x, 0, x + 16, 0);
      gr.addColorStop(0, 'rgba(0,0,0,.28)'); gr.addColorStop(0.5, 'rgba(255,255,255,.12)'); gr.addColorStop(1, 'rgba(0,0,0,.28)');
      g.fillStyle = gr; g.fillRect(x, 0, 16, s);
    }
    speckle(g, s, 500, 60, 120, 0.2);
  }),
  crate: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#a57c48'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 21) { g.fillStyle = 'rgba(50,30,10,.35)'; g.fillRect(0, y, s, 2); }
    speckle(g, s, 900, 60, 140, 0.2);
    g.strokeStyle = '#6e4d26'; g.lineWidth = 12; g.strokeRect(6, 6, s - 12, s - 12);
    g.beginPath(); g.moveTo(8, 8); g.lineTo(s - 8, s - 8); g.stroke();
  }),
  barrier: () => canvasTex(128, (g, s) => {
    g.fillStyle = '#b9b6ad'; g.fillRect(0, 0, s, s); speckle(g, s, 1500, 90, 200, 0.2);
    for (let x = -s; x < s; x += 32) { g.fillStyle = '#d9a514'; g.beginPath(); g.moveTo(x, 20); g.lineTo(x + 16, 20); g.lineTo(x + 36, 0); g.lineTo(x + 20, 0); g.fill(); }
  }),
};

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}

// Simple block-built guns, pointing down -Z.
function gunModel(cls) {
  const g = new THREE.Group(), metal = 0x23262b, dark = 0x15171a, wood = 0x6b4a2a;
  const add = (...a) => g.add(box(...a));
  switch (cls) {
    case 0: add(0.02, 0.05, 0.26, 0xcfd6dd, 0, 0.02, -0.2); add(0.035, 0.06, 0.12, dark, 0, 0, 0); break;
    case 1: add(0.045, 0.06, 0.24, metal, 0, 0.03, -0.1); add(0.04, 0.13, 0.06, dark, 0, -0.05, 0); break;
    case 2: add(0.06, 0.07, 0.75, metal, 0, 0.02, -0.3); add(0.065, 0.06, 0.25, wood, 0, -0.03, -0.38); add(0.055, 0.1, 0.25, wood, 0, -0.01, 0.15); break;
    case 3: add(0.06, 0.09, 0.4, metal, 0, 0.02, -0.15); add(0.04, 0.2, 0.05, dark, 0, -0.1, -0.12); add(0.04, 0.11, 0.05, dark, 0, -0.06, 0.03); add(0.03, 0.03, 0.14, dark, 0, 0.03, -0.42); break;
    case 5: add(0.06, 0.08, 0.7, 0x2f3b2c, 0, 0.02, -0.25); add(0.03, 0.03, 0.45, dark, 0, 0.03, -0.8); add(0.05, 0.05, 0.3, dark, 0, 0.1, -0.2); add(0.055, 0.11, 0.3, 0x2f3b2c, 0, -0.01, 0.2); break;
    case 6: add(0.08, 0.11, 0.6, metal, 0, 0.02, -0.2); add(0.03, 0.03, 0.4, dark, 0, 0.03, -0.7); add(0.12, 0.13, 0.14, 0x39402f, 0, -0.1, -0.2); add(0.055, 0.1, 0.25, dark, 0, 0, 0.2); break;
    case 7: case 8: case 9: {
      const col = cls === 7 ? 0x3d5a34 : cls === 8 ? 0xd8dde2 : 0x6c7780;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 10), new THREE.MeshLambertMaterial({ color: col }));
      s.position.set(0, 0.02, -0.12); g.add(s); add(0.03, 0.03, 0.03, dark, 0, 0.09, -0.12); break;
    }
    case 10: add(0.24, 0.1, 0.16, 0x4a3d2a, 0, 0, -0.15); add(0.1, 0.02, 0.07, 0x122b16, 0.04, 0.06, -0.15); add(0.02, 0.025, 0.02, 0xff2a1a, -0.08, 0.06, -0.15); break;
    default: add(0.055, 0.08, 0.55, metal, 0, 0.02, -0.2); add(0.03, 0.03, 0.3, dark, 0, 0.03, -0.6); add(0.04, 0.2, 0.07, dark, 0, -0.1, -0.18); add(0.05, 0.1, 0.25, wood, 0, 0, 0.18); add(0.04, 0.11, 0.05, dark, 0, -0.07, 0.02);
  }
  return g;
}

function playerModel(team) {
  const col = team === 1 ? ATK_COL : DEF_COL, dark = team === 1 ? 0x4a3524 : 0x1c2c40;
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.add(box(0.2, 0.85, 0.22, dark, 0, -0.42, 0)); legR.add(box(0.2, 0.85, 0.22, dark, 0, -0.42, 0));
  legL.position.set(-0.13, 0.85, 0); legR.position.set(0.13, 0.85, 0);
  const torso = new THREE.Group(); torso.position.y = 0.85;
  torso.add(box(0.52, 0.6, 0.28, col, 0, 0.3, 0));
  torso.add(box(0.44, 0.34, 0.32, dark, 0, 0.36, 0));
  const head = box(0.26, 0.27, 0.26, 0xd9a47a, 0, 0.76, 0);
  torso.add(head); torso.add(box(0.29, 0.13, 0.29, col, 0, 0.87, 0));
  const arms = new THREE.Group(); arms.position.set(0, 0.5, 0);
  arms.add(box(0.13, 0.13, 0.5, col, 0.27, 0, -0.22)); arms.add(box(0.13, 0.13, 0.5, col, -0.2, 0, -0.26));
  const gunSlot = new THREE.Group(); gunSlot.position.set(0.14, 0, -0.5); arms.add(gunSlot);
  torso.add(arms);
  const pack = box(0.3, 0.3, 0.14, 0x4a3d2a, 0, 0.32, 0.2); pack.visible = false; torso.add(pack);
  body.add(legL, legR, torso);
  return { root, body, legL, legR, torso, arms, gunSlot, pack, phase: 0, weapon: -1, deadT: 0, last: null };
}

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc3e0);
    this.scene.fog = new THREE.Fog(0xb7cfe0, 60, 190);
    this.camera = new THREE.PerspectiveCamera(74, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6b6558, 1.5));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(-45, 80, 35); sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 220 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    this.scene.add(sun);

    // First-person weapon is drawn in its own pass so it never clips into walls.
    this.vmScene = new THREE.Scene();
    this.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.2));
    this.vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.vm = new THREE.Group(); this.vmScene.add(this.vm);
    this.vmCls = -1; this.vmKick = 0; this.vmSwitch = 0; this.vmBob = 0;
    this.muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ map: canvasTex(64, (g, s) => {
        const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        r.addColorStop(0, '#fff'); r.addColorStop(0.3, '#ffd76a'); r.addColorStop(1, 'rgba(255,120,0,0)');
        g.fillStyle = r; g.fillRect(0, 0, s, s);
      }, false), transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
    this.muzzle.visible = false; this.vmScene.add(this.muzzle);

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
    const mats = ['ground', 'wall', 'container', 'crate', 'barrier'];
    const tile = [4, 4, 2.6, 1, 2];
    const buf = mats.map(() => ({ p: [], n: [], u: [], c: [], i: [] }));
    const col = new THREE.Color();
    for (const b of map.boxes) {
      const [x0, y0, z0, x1, y1, z1, mat, v] = b, o = buf[mat], t = tile[mat];
      col.set(mat === 2 ? CONTAINER_COLS[v % 6] : 0xffffff);
      if (mat === 1) col.setScalar(0.9 + (v % 3) * 0.05);
      const face = (vs, n, uv) => {
        const base = o.p.length / 3;
        vs.forEach((p, k) => { o.p.push(...p); o.n.push(...n); o.u.push(uv[k][0] / t, uv[k][1] / t); o.c.push(col.r, col.g, col.b); });
        o.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]]);
      if (mat === 0) continue;
      const side = (a, b2, n) => face([[a[0], y0, a[1]], [b2[0], y0, b2[1]], [b2[0], y1, b2[1]], [a[0], y1, a[1]]], n,
        [[a[0] + a[1], y0], [b2[0] + b2[1], y0], [b2[0] + b2[1], y1], [a[0] + a[1], y1]]);
      side([x0, z1], [x1, z1], [0, 0, 1]); side([x1, z0], [x0, z0], [0, 0, -1]);
      side([x1, z1], [x1, z0], [1, 0, 0]); side([x0, z0], [x0, z1], [-1, 0, 0]);
    }
    buf.forEach((o, k) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(o.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(o.c, 3));
      g.setIndex(o.i);
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: TEX[mats[k]](), vertexColors: true, side: THREE.DoubleSide }));
      m.receiveShadow = true; m.castShadow = k !== 0;
      this.scene.add(m);
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
      this.scene.add(m);
    });
  }

  // ---- other players
  setPlayer(id, s, weaponCls, dt, hidden) {
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
    m.pack.visible = !!(s.flags & 2);
    if (m.weapon !== weaponCls) {
      m.weapon = weaponCls; m.gunSlot.clear(); m.gunSlot.add(gunModel(weaponCls));
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
      const g = gunModel(weapons[e[1]].cls); g.rotation.z = Math.PI / 2; g.scale.setScalar(1.3);
      const h = new THREE.Group(); g.position.y = 0.06; h.add(g); return h;
    });
  }
  setNades(list, weapons) {
    this.syncSimple(this.nades, list, e => gunModel(weapons[e[1]].cls));
  }
  setSmokes(list) {
    while (this.smokes.length > list.length) this.scene.remove(this.smokes.pop());
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

  setViewmodel(cls) {
    if (cls === this.vmCls) return;
    this.vmCls = cls; this.vm.clear(); this.vmSwitch = 1;
    const g = gunModel(cls); this.vm.add(g);
    const arm = box(0.09, 0.09, 0.4, 0x3a3f46, 0.02, -0.07, 0.22); arm.castShadow = false; this.vm.add(arm);
  }
  kick(amount) { this.vmKick = Math.min(1, this.vmKick + amount); this.muzzleT = 0.045; }

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
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (view.firstPerson && !view.scoped) {
      this.vmKick = Math.max(0, this.vmKick - dt * 7);
      this.vmSwitch = Math.max(0, this.vmSwitch - dt * 4);
      this.vmBob += dt * view.speed * 1.6;
      const bob = Math.min(1, view.speed / 6);
      const lower = Math.max(this.vmSwitch, view.reload ? 0.8 : 0);
      this.vm.position.set(0.17 + Math.cos(this.vmBob) * 0.008 * bob, -0.17 - lower * 0.25 + Math.abs(Math.sin(this.vmBob)) * 0.01 * bob, -0.42 + this.vmKick * 0.07);
      this.vm.rotation.set(this.vmKick * 0.18 - lower * 0.9, 0.04, 0);
      this.muzzleT = (this.muzzleT || 0) - dt;
      this.muzzle.visible = this.muzzleT > 0 && this.vmCls >= 1 && this.vmCls <= 6;
      if (this.muzzle.visible) {
        const len = [0, 0.26, 0.7, 0.5, 0.78, 1.05, 0.92][this.vmCls];
        this.muzzle.position.set(0.17, -0.13, -0.42 - len); this.muzzle.rotation.z = Math.random() * 6;
      }
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
  }
}
