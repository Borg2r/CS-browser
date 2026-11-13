// Game client: networking, input, client-side prediction and the frame loop.
import { World } from './world.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { BotSettings } from './settings.js';

const $ = id => document.getElementById(id);
const canvas = $('view');
const world = new World(canvas);
const sfx = new Sfx();
const hud = new Hud(item => send({ t: 'buy', item }), () => {
  keys.clear(); mouseB = 0; if (joined) captureMouse();
});
const settings = new BotSettings(difficulty => send({ t: 'set_difficulty', difficulty }), () => {
  if (joined) captureMouse();
}, map => send({ t: 'set_map', map }));

const B = { FWD: 1, BACK: 2, LEFT: 4, RIGHT: 8, JUMP: 16, CROUCH: 32, WALK: 64, FIRE: 128, RELOAD: 256, USE: 512, FIRE2: 1024 };
const FREEZE_MASK = ~(B.FWD | B.BACK | B.LEFT | B.RIGHT | B.JUMP);
const INTERP = 0.1;
const round4 = v => Math.round(v * 1e4) / 1e4;

let ws, hello = null, weapons = [], myId = 0, joined = false;
let snaps = [], latest = null, me = null, roster = new Map();
let yaw = 0, pitch = 0, seq = 0, pending = [], pred = null, err = [0, 0, 0];
let wasAlive = false, resetView = false, timeOffset = -Infinity;
let punch = 0, punchYaw = 0, shotsC = 0, sinceShot = 9, eyeH = 1.62, stride = 0, lastSlot = 1, prevSlot = 1;
let recoilWeapon = -1;
const handShots = [0, 0], handSince = [9, 9];
let specIdx = 0, beepT = 0, chatOpen = false, sens = 1, fov = 74, aimBlend = 0;
const keys = new Set(); let mouseB = 0;

// ---- settings
try {
  $('name').value = localStorage.getItem('bp_name') || '';
  $('sens').value = localStorage.getItem('bp_sens') || 1;
  $('vol').value = localStorage.getItem('bp_vol') || 0.6;
} catch { /* storage unavailable */ }
const applySettings = () => {
  sens = +$('sens').value; sfx.volume = +$('vol').value;
  try { localStorage.setItem('bp_sens', sens); localStorage.setItem('bp_vol', sfx.volume); localStorage.setItem('bp_name', $('name').value); } catch { /* ignore */ }
};
$('sens').oninput = $('vol').oninput = $('name').onchange = applySettings; applySettings();

// ---- prediction module (same Rust movement code as the server)
let wasm = null, predictedMap = null;
let loadingError = '';
let serverReady = false;
function updateReady() {
  const ready = !!wasm && predictedMap === hello?.map.id && serverReady && !!settings.state && ws?.readyState === WebSocket.OPEN;
  for (const button of document.querySelectorAll('.teams button')) button.disabled = !ready;
  $('status').textContent = loadingError || (ready ? 'Connected — pick a side' : !wasm ? 'Loading game…' : 'Connecting to server…');
}
function selectPredictionMap() {
  if (!wasm || !hello || predictedMap === hello.map.id) return;
  if (wasm.select_map(hello.map.index) !== 1) throw new Error('Unknown prediction map');
  predictedMap = hello.map.id;
}
function installMap(message) {
  const changed = hello?.map.id !== message.map.id;
  hello = message; weapons = message.weapons;
  settings.setMaps(message.maps);
  if (changed) {
    keys.clear(); mouseB = 0; pending = []; snaps = []; latest = me = pred = null;
    wasAlive = false; resetView = true; timeOffset = -Infinity; err = [0, 0, 0];
    aimBlend = punch = punchYaw = shotsC = 0; recoilWeapon = -1;
    handShots.fill(0); handSince.fill(9);
    hud.toggleBuy(false); if (hud.wheelOpen) hud.closeWheel();
    world.buildMap(message.map); hud.init(message);
    $('killfeed').replaceChildren(); $('center').textContent = '';
    selectPredictionMap();
  }
  $('map-name').textContent = message.map.name;
  serverReady = true; updateReady();
}
async function loadPrediction() {
  try {
    const response = await fetch('predict.wasm');
    if (!response.ok) throw new Error(`Prediction download: HTTP ${response.status}`);
    wasm = (await WebAssembly.instantiate(await response.arrayBuffer())).instance.exports;
    if (typeof wasm.select_map !== 'function') throw new Error('Prediction module needs an update');
    selectPredictionMap();
  } catch (error) {
    loadingError = 'Could not load the game. Reload the page to try again.';
    wasm = null;
    console.error(error);
  }
  updateReady();
}
loadPrediction();

$('invite').onclick = async () => {
  const link = new URL('.', location.href).href;
  try {
    await navigator.clipboard.writeText(link);
    $('invite-status').textContent = 'Link copied — send it to your friends!';
  } catch {
    $('invite-link').value = link;
    $('invite-link').classList.remove('hidden');
    $('invite-link').focus();
    $('invite-link').select();
    $('invite-status').textContent = 'Copy this link and send it to your friends:';
  }
};
function simStep(st, buttons, y, dt, speed) {
  new Float32Array(wasm.memory.buffer, wasm.state_ptr(), 9).set(st);
  wasm.sim_step(buttons, y, dt, speed);
  st.set(new Float32Array(wasm.memory.buffer, wasm.state_ptr(), 9));
}

// ---- network
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = updateReady;
  ws.onclose = () => {
    serverReady = false;
    settings.disconnect();
    updateReady();
    joined = false; latest = me = pred = null; snaps = []; pending = []; hud.toggleBuy(false); hud.resetEffects(); $('menu').classList.remove('hidden'); $('hud').classList.add('hidden');
    if (!loadingError) $('status').textContent = 'Disconnected — reconnecting…';
    document.exitPointerLock?.();
    setTimeout(connect, 2000);
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    switch (m.t) {
      case 's': if (m.map === hello?.map.id) onSnap(m); break;
      case 'e': m.ev.forEach(onEvent); break;
      case 'r': roster = new Map(m.pl.map(p => [p.id, p])); break;
      case 'settings': settings.update(m); updateReady(); break;
      case 'settings_error': settings.error(m.m); break;
      case 'hello': installMap(m); break;
      case 'joined':
        myId = m.id; joined = true; snaps = []; pending = []; latest = me = pred = null; wasAlive = false; resetView = true;
        timeOffset = -Infinity;
        hud.resetEffects();
        aimBlend = 0;
        $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
        break;
      case 'full': $('status').textContent = 'Server is full'; break;
    }
  };
}
connect();

for (const b of document.querySelectorAll('.teams button')) {
  b.onclick = () => {
    sfx.unlock(); applySettings();
    if (!hello || !wasm) { $('status').textContent = 'Still loading…'; return; }
    send({ t: 'join', name: $('name').value.trim() || 'Player', team: +b.dataset.team, difficulty: settings.joinPreference, map: settings.joinMapPreference });
    captureMouse();
  };
}

function onSnap(m) {
  const now = performance.now() / 1000;
  timeOffset = Math.max(timeOffset - 0.0005, m.tm - now);
  m.players = new Map(m.pl.map(a => [a[0], { id: a[0], team: a[1], alive: !!a[2], x: a[3], y: a[4], z: a[5], yaw: a[6], pitch: a[7], hp: a[8], w: a[9], flags: a[10] }]));
  snaps.push(m); if (snaps.length > 40) snaps.shift();
  latest = m; me = m.me;
  if (!me || !wasm) return;
  if (recoilWeapon !== me.w) {
    recoilWeapon = me.w; shotsC = 0; sinceShot = 9;
    handShots.fill(0); handSince.fill(9);
  }
  const mp = m.players.get(myId), alive = !!mp?.alive;
  if (alive) {
    if (!pred || !wasAlive || resetView) {
      pred = Float32Array.from(me.st); pending = []; err = [0, 0, 0];
      yaw = mp.yaw; pitch = 0; resetView = false; punch = 0; punchYaw = 0; shotsC = 0; sinceShot = 9;
      handShots.fill(0); handSince.fill(9);
    } else {
      const before = [pred[0], pred[1], pred[2]];
      pred.set(me.st);
      pending = pending.filter(c => c.s > me.ack);
      for (const c of pending) simStep(pred, c.mb, c.y, c.d, c.sp);
      for (let i = 0; i < 3; i++) err[i] += before[i] - pred[i];
      if (Math.hypot(...err) > 3) err = [0, 0, 0];
    }
  }
  wasAlive = alive;
  if (me.sl !== prevSlot) { lastSlot = prevSlot; prevSlot = me.sl; }
}

const pname = id => roster.get(id)?.n || '?';
const pteam = id => ['', 'atk', 'def'][roster.get(id)?.tm || 0];
const safe = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function onEvent(ev) {
  switch (ev.t) {
    case 'shot': {
      const own = ev.id === myId, weapon = weapons[ev.w], cls = weapon.cls;
      const hand = ev.hand ?? 1;
      let from = [ev.o[0], ev.o[1] - 0.2, ev.o[2]];
      if (own && wasAlive) {
        const c = world.camera, f = [-Math.sin(yaw), -Math.cos(yaw)];
        const side = weapon.dual ? (hand === 0 ? -0.23 : 0.23) : 0.16 * (1 - aimBlend);
        from = [c.position.x + f[0] * 0.6 + Math.cos(yaw) * side, c.position.y - 0.14, c.position.z + f[1] * 0.6 - Math.sin(yaw) * side];
        world.kick(cls === 5 || cls === 2 ? 0.9 : 0.4, hand);
        if (weapon.dual) {
          handShots[hand]++; handSince[hand] = 0;
          shotsC = Math.max(...handShots);
        } else shotsC++;
        sinceShot = 0;
      }
      for (const h of ev.h) { world.tracer(from, h); world.puff(h, h[3] ? 0xb01818 : 0xd8c9a0, h[3] ? 0.09 : 0.06); }
      sfx.shot(cls, own ? null : ev.o);
      if (weapon.id === 'twin_lever') sfx.leverCycle(own ? null : ev.o);
      break;
    }
    case 'swing': sfx.swing(posOf(ev.id), ev.hit); if (ev.id === myId) world.kick(0.7); break;
    case 'reload': sfx.reload(posOf(ev.id)); break;
    case 'throw': sfx.swing(posOf(ev.id), false); break;
    case 'hurt': hud.hurt(ev.d); sfx.hurt(); break;
    case 'hit': hud.hit(ev.hs); sfx.hit(ev.hs); break;
    case 'pickup': sfx.ui(true); break;
    case 'flash': hud.flash(ev.a); sfx.ring(ev.a); break;
    case 'boom': world.explosion(ev.p, false); sfx.boom(ev.p, false); break;
    case 'bigboom': world.explosion(ev.p, true); sfx.boom(ev.p, true); break;
    case 'pop': world.puff(ev.p, 0xffffff, 0.8, 0.2); sfx.pop(ev.p); break;
    case 'smoke': sfx.hiss(ev.p); break;
    case 'kill':
      hud.feed(`${ev.k ? `<b class="${pteam(ev.k)}">${safe(pname(ev.k))}</b>` : ''}<span class="w">${safe(weapons[ev.w].name)}${ev.hs ? ' ✹' : ''}</span><b class="${pteam(ev.v)}">${safe(pname(ev.v))}</b>`);
      break;
    case 'planted': hud.center(`The charge has been planted at ${'AB'[ev.site]}`, 3.5); sfx.beep(null, true); break;
    case 'defused': hud.center('The charge has been defused', 3); break;
    case 'round': resetView = true; hud.toggleBuy(false); break;
    case 'go': hud.center('GO', 1); sfx.ui(true); break;
    case 'end': {
      const mine = roster.get(myId)?.tm;
      const side = ev.w === 1 ? 'Attackers' : 'Defenders';
      hud.center(ev.draw ? 'Match drawn' : ev.over ? `${side} win the match` : ev.half ? `${side} win the round — half-time, sides swap` : `${side} win the round`,
        ev.over ? 9 : 4.5, ['', 'atk', 'def'][ev.w]);
      sfx.jingle(ev.w === mine);
      break;
    }
    case 'chat': hud.chat(ev.n, ev.tm, ev.m); break;
  }
}
function posOf(id) {
  if (id === myId) return null;
  const p = latest?.players.get(id); return p ? [p.x, p.y + 1.2, p.z] : null;
}

// ---- input
const locked = () => document.pointerLockElement === canvas;
function captureMouse() {
  // After Esc, some browsers require a fresh click before locking again.
  try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* Click to play remains available. */ }
}
function openSettings() {
  if (!joined) return;
  keys.clear(); mouseB = 0;
  hud.toggleBuy(false);
  if (hud.wheelOpen) hud.closeWheel();
  chatOpen = false; $('chatbox').classList.add('hidden'); $('chatbox').blur();
  settings.show();
}
$('bot-settings-button').onclick = openSettings;
document.addEventListener('mousedown', e => {
  if (!joined) return;
  sfx.unlock();
  if (settings.open || hud.buyOpen || chatOpen || e.target.closest('#buy, #bot-settings-button')) return;
  if (!locked()) { if (!e.target.closest('#buy') && !chatOpen) captureMouse(); return; }
  if (e.button === 0) { mouseB |= B.FIRE; if (!wasAlive) specIdx++; }
  if (e.button === 2) mouseB |= B.FIRE2;
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) mouseB &= ~B.FIRE;
  if (e.button === 2) mouseB &= ~B.FIRE2;
});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { if (!locked()) { keys.clear(); mouseB = 0; } });
document.addEventListener('mousemove', e => {
  if (!locked() || settings.open || hud.buyOpen) return;
  const mx = Math.max(-400, Math.min(400, e.movementX)), my = Math.max(-400, Math.min(400, e.movementY));
  if (hud.wheelOpen) { hud.moveWheel(mx, my); return; }
  const k = 0.0022 * sens * (fov / 74);
  yaw -= mx * k; pitch = Math.max(-1.55, Math.min(1.55, pitch - my * k));
});
document.addEventListener('wheel', e => {
  if (!locked() || settings.open || hud.buyOpen || !me || !wasAlive) return;
  const own = hud.owned(me); let s = me.sl;
  for (let i = 0; i < 7; i++) { s = (s + (e.deltaY > 0 ? 1 : 6)) % 7; if (own[s]) break; }
  send({ t: 'sel', slot: s });
}, { passive: true });

function selectSlot(s) { if (me && hud.owned(me)[s]) send({ t: 'sel', slot: s }); }
document.addEventListener('keydown', e => {
  if (!joined) return;
  if (settings.open) {
    if (!e.repeat && (e.code === 'Escape' || e.code === 'F2')) { e.preventDefault(); settings.close(e.code !== 'Escape'); }
    return;
  }
  if (chatOpen) {
    if (e.code === 'Enter') { const v = $('chatbox').value.trim(); if (v) send({ t: 'chat', m: v }); }
    if (e.code === 'Enter' || e.code === 'Escape') { chatOpen = false; $('chatbox').value = ''; $('chatbox').classList.add('hidden'); $('chatbox').blur(); e.preventDefault(); }
    return;
  }
  if (hud.buyOpen) {
    if (e.repeat) return;
    const digit = /^(Digit|Numpad)(\d)$/.exec(e.code);
    if (digit) { e.preventDefault(); hud.buyKey(+digit[2]); sfx.ui(true); }
    else if (e.code === 'KeyB' || e.code === 'Escape') {
      e.preventDefault(); hud.toggleBuy(false); keys.clear(); mouseB = 0;
      if (e.code === 'KeyB') captureMouse();
    } else if (e.code === 'F2') { e.preventDefault(); openSettings(); }
    return;
  }
  if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || (e.ctrlKey && e.code !== 'KeyR')) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  switch (e.code) {
    case 'F2': e.preventDefault(); openSettings(); break;
    case 'KeyB':
      if (me?.cb) {
        keys.clear(); mouseB = 0; if (hud.wheelOpen) hud.closeWheel();
        hud.toggleBuy(true); hud.renderBuy(me, roster.get(myId)?.tm || 1, { buySeconds: latest?.buySeconds });
        document.exitPointerLock?.(); sfx.ui(true);
      } else sfx.ui(false);
      break;
    case 'Escape': hud.toggleBuy(false); break;
    case 'KeyQ': if (me && wasAlive && !hud.wheelOpen) hud.openWheel(me); break;
    case 'KeyG': send({ t: 'drop' }); break;
    case 'KeyT': case 'Enter': chatOpen = true; keys.clear(); $('chatbox').classList.remove('hidden'); $('chatbox').focus(); e.preventDefault(); break;
    case 'Digit1': selectSlot(0); break;
    case 'Digit2': selectSlot(1); break;
    case 'Digit3': selectSlot(2); break;
    case 'Digit4': if (me) { for (let i = 1; i <= 3; i++) { const s = 3 + ((me.sl - 3 + i) % 3 + 3) % 3; if (me.nd[s - 3] > 0) { selectSlot(s); break; } } } break;
    case 'Digit5': selectSlot(6); break;
  }
});
document.addEventListener('keyup', e => {
  keys.delete(e.code);
  if (e.code === 'KeyQ' && hud.wheelOpen) {
    const s = hud.closeWheel();
    if (s >= 0) selectSlot(s); else if (s === -2) selectSlot(lastSlot);
  }
});
window.addEventListener('blur', () => { keys.clear(); mouseB = 0; if (hud.wheelOpen) hud.closeWheel(); });

function buttons() {
  if (!locked() || settings.open || chatOpen || hud.buyOpen) return 0;
  const k = c => keys.has(c);
  let b = 0;
  if (k('KeyW') || k('ArrowUp')) b |= B.FWD;
  if (k('KeyS') || k('ArrowDown')) b |= B.BACK;
  if (k('KeyA') || k('ArrowLeft')) b |= B.LEFT;
  if (k('KeyD') || k('ArrowRight')) b |= B.RIGHT;
  if (k('Space')) b |= B.JUMP;
  if (k('KeyC') || k('ControlLeft')) b |= B.CROUCH;
  if (k('ShiftLeft') || k('ShiftRight')) b |= B.WALK;
  if (k('KeyR')) b |= B.RELOAD;
  if (k('KeyE')) b |= B.USE;
  if (!hud.wheelOpen) b |= mouseB;
  return b;
}

// ---- interpolation of remote players
function sample(rt) {
  let a = snaps[0], b = snaps[snaps.length - 1];
  for (let i = snaps.length - 1; i > 0; i--) if (snaps[i - 1].tm <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
  const k = b.tm > a.tm ? Math.max(0, Math.min(1, (rt - a.tm) / (b.tm - a.tm))) : 1;
  return id => {
    const q = b.players.get(id), p = a.players.get(id) || q;
    if (!q) return null;
    if (!p.alive || !q.alive || Math.hypot(q.x - p.x, q.z - p.z) > 4) return q;
    let dy = q.yaw - p.yaw; dy = ((dy + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return { ...q, x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k, yaw: p.yaw + dy * k, pitch: p.pitch + (q.pitch - p.pitch) * k };
  };
}

// ---- frame loop
let last = performance.now() / 1000;
function frame(tms) {
  requestAnimationFrame(frame);
  const now = tms / 1000;
  const dt = round4(Math.max(0.001, Math.min(0.2, now - last))); last = now;
  const cam = world.camera;

  if (!joined || !latest) {
    const a = now * 0.06;
    const radius = world.overviewRadius || 62, height = world.overviewHeight || 46;
    cam.position.set(Math.sin(a) * radius, height, Math.cos(a) * radius); cam.lookAt(0, 0, 0);
    if (latest && hello) drawRemote(now, dt, -1);
    aimBlend = 0;
    world.render(dt, { firstPerson: false, aim: 0 });
    return;
  }

  const rt = now + timeOffset - INTERP;
  const alive = wasAlive && !!pred && !!me;
  const w = me ? weapons[me.w] : null;
  let speed = 0;

  if (me && wasm) {
    const b = buttons(), y = round4(yaw), p = round4(pitch);
    const frozen = latest.ph === 0 || latest.ph === 3 || me.pl > 0 || me.df > 0;
    const mb = frozen ? b & FREEZE_MASK : b;
    const sp = w.speed * (me.sc && w.zoom ? 0.6 : 1);
    // Slow frames are split so movement speed never depends on frame rate.
    for (let left = dt; left > 1e-4; left -= 0.05) {
      const d = round4(Math.min(0.05, left));
      seq++;
      send({ t: 'in', map: hello.map.id, s: seq, b, y, p, d, it: +rt.toFixed(3) });
      if (alive) {
        simStep(pred, mb, y, d, sp);
        pending.push({ s: seq, mb, y, d, sp });
        if (pending.length > 150) pending.shift();
      }
    }
  }

  let specName = '';
  let hidden = -1;
  if (alive) {
    const k = Math.exp(-dt * 14); err = err.map(v => v * k);
    eyeH += ((pred[7] > 0.5 ? 1.05 : 1.62) - eyeH) * Math.min(1, dt * 14);
    speed = Math.hypot(pred[3], pred[5]);
    sinceShot += dt;
    if (w.dual) {
      for (let hand = 0; hand < 2; hand++) {
        handSince[hand] += dt;
        if (handSince[hand] > Math.max(w.interval * 1.7, 0.2)) handShots[hand] = Math.max(0, handShots[hand] - dt * 14);
      }
      shotsC = Math.max(...handShots);
    } else if (sinceShot > Math.max(w.interval * 1.7, 0.2)) shotsC = Math.max(0, shotsC - dt * 14);
    // Mirrors sim::weapons::recoil_offset so the view follows the spray pattern.
    const target = Math.min(shotsC, 9) * w.recoil;
    const side = shotsC > 4 ? w.recoil * 1.8 * Math.sin((shotsC - 4) * 0.5) * Math.min((shotsC - 4) / 4, 1) : 0;
    punch += (target - punch) * Math.min(1, dt * 25);
    punchYaw += (side - punchYaw) * Math.min(1, dt * 25);
    cam.position.set(pred[0] + err[0], pred[1] + err[1] + eyeH, pred[2] + err[2]);
    cam.rotation.set(pitch + punch, yaw + punchYaw, 0);
    if (pred[6] > 0.5 && speed > 3.4) { stride += speed * dt; if (stride > 2.3) { stride = 0; sfx.step(null, true); } }
    hidden = myId;
    world.setViewmodel(w);
  } else {
    // Spectate a living team-mate (click to cycle), or fall back to an overview.
    const mine = roster.get(myId)?.tm;
    let list = [...latest.players.values()].filter(p => p.alive && p.team === mine);
    if (!list.length) list = [...latest.players.values()].filter(p => p.alive);
    if (list.length) {
      const t = sample(rt)(list[specIdx % list.length].id);
      if (t) {
        cam.position.set(t.x, t.y + (t.flags & 1 ? 1.05 : 1.62), t.z); cam.rotation.set(t.pitch, t.yaw, 0);
        hidden = t.id; specName = `Spectating ${pname(t.id)} — click for next`;
        world.setViewmodel(weapons[t.w]);
      }
    } else { cam.position.set(0, (world.overviewHeight || 46) * 1.3, (world.overviewRadius || 62) * .65); cam.lookAt(0, 0, 0); }
  }

  const aiming = !!(alive && me.sc && w.ads && !w.dual && me.rl <= 0);
  aimBlend += ((aiming ? 1 : 0) - aimBlend) * Math.min(1, dt * 16);
  const scoped = aiming && w.zoom >= 4;
  const mag = 1 + (Math.max(1, w?.zoom || 1) - 1) * aimBlend;
  const wantFov = 2 * Math.atan(Math.tan(37 * Math.PI / 180) / mag) * 180 / Math.PI;
  if (Math.abs(wantFov - fov) > 0.05) { fov += (wantFov - fov) * Math.min(1, dt * 18); cam.fov = fov; cam.updateProjectionMatrix(); }

  sfx.listener = { x: cam.position.x, y: cam.position.y, z: cam.position.z, yaw: alive ? yaw : cam.rotation.y };
  drawRemote(now, dt, hidden);

  if (latest.bomb && latest.ph === 1) {
    beepT -= dt;
    if (beepT <= 0) { beepT = 0.12 + 0.9 * Math.max(0, latest.bomb[3]) / 45; sfx.beep(latest.bomb, latest.bomb[3] < 10); }
  }

  // HUD
  let hint = '', progress = null;
  if (alive) {
    const site = hello.map.sites.some(s => pred[0] >= s[0] && pred[0] <= s[2] && pred[2] >= s[1] && pred[2] <= s[3]);
    if (me.pl > 0) progress = [me.pl, 'PLANTING'];
    else if (me.df > 0) progress = [me.df, me.kit ? 'DEFUSING (KIT)' : 'DEFUSING'];
    else if (me.bm && site && latest.ph === 1 && !latest.bomb) hint = me.sl === 6 ? 'Hold FIRE to plant the charge' : 'Press 5 to equip the charge';
    else if (latest.bomb && roster.get(myId)?.tm === 2 && Math.hypot(latest.bomb[0] - pred[0], latest.bomb[2] - pred[2]) < 1.8) hint = 'Hold E to defuse';
    else if (latest.ph === 0) hint = me.cb ? 'Buy time — press B' : '';
    if (hud.buyOpen && !me.cb) hud.toggleBuy(false);
    hud.renderBuy(me, roster.get(myId)?.tm || 1, { buySeconds: latest.buySeconds });
  } else if (hud.buyOpen) { hud.toggleBuy(false); hud.renderBuy(me || { mo: 0 }, 1); }
  if (!alive && me && latest.ph !== 3) specName = specName || 'You will spawn next round';
  hud.update(dt, {
    me, snap: latest, alive, weapons, scoped, aiming, sniper: alive && w.cls === 5, hint, progress, spec: specName, locked: locked(),
    gap: 4 + speed * 1.1 + shotsC * 1.6 + (alive && pred[6] < 0.5 ? 8 : 0),
  });
  hud.scoreboard(keys.has('Tab') || latest.ph === 3, roster, latest, myId);
  hud.radar(latest, myId, roster.get(myId)?.tm, yaw, alive ? pred : null, latest.it);

  world.render(dt, { firstPerson: hidden >= 0, scoped, aim: aimBlend, speed: alive && pred[6] > 0.5 ? speed : 0,
    reload: alive && me.rl > 0, reloadFraction: alive && w.reload > 0 ? me.rl / w.reload : 0 });
}

function drawRemote(now, dt, hidden) {
  const get = sample(now + timeOffset - INTERP);
  for (const id of latest.players.keys()) {
    const s = get(id); if (!s) continue;
    if (world.setPlayer(id, s, weapons[s.w], dt, id === hidden) && id !== hidden) sfx.step([s.x, s.y, s.z], false);
  }
  world.sweepPlayers();
  world.setItems(latest.it, weapons); world.setNades(latest.nd, weapons);
  world.setSmokes(latest.sm); world.setBomb(latest.bomb, now);
}
requestAnimationFrame(frame);

// Debug handle for automated tests: open the page with ?debug.
if (location.search.includes('debug')) {
  window.__bp = { world, get pred() { return pred; }, get me() { return me; }, get latest() { return latest; },
    get view() { return { yaw, pitch }; }, set view(v) { yaw = v.yaw; pitch = v.pitch; }, get pending() { return pending.length; }, get err() { return err; },
    get weapons() { return weapons; }, get aim() { return aimBlend; }, get fov() { return fov; }, get settings() { return settings.state; }, get map() { return hello?.map; }, get predictedMap() { return predictedMap; } };
}
