// HTML heads-up display: vitals, radar, kill feed, buy menu, weapon wheel, scoreboard.
import { BuyMenu } from './buy.js';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TEAM = ['', 'atk', 'def'];
const SLOT_NAMES = ['PRIMARY', 'SIDEARM', 'KNIFE', 'FRAG', 'FLASH', 'SMOKE', 'CHARGE'];

export class Hud {
  constructor(onBuy, onBuyClosed) {
    this.onBuy = onBuy;
    this.buyMenu = new BuyMenu($('buy'), onBuy, onBuyClosed);
    this.centerT = 0; this.hitT = 0; this.dmg = 0; this.flashT = 0; this.flashDur = 1;
    this.wheelOpen = false; this.wheelVec = [0, 0]; this.wheelSel = -1;
    this.segs = SLOT_NAMES.map((n, i) => {
      const d = document.createElement('div'); d.className = 'seg';
      const a = i / 7 * Math.PI * 2;
      d.style.left = Math.sin(a) * 132 + 'px'; d.style.top = -Math.cos(a) * 132 + 'px';
      $('wheel').appendChild(d); return d;
    });
  }

  resetEffects() {
    this.centerT = this.hitT = this.dmg = this.flashT = 0; this.flashDur = 1;
    for (const id of ['hitmarker', 'damage', 'flash']) $(id).style.opacity = 0;
    for (const id of ['scope', 'optic-dot']) $(id).classList.add('hidden');
    $('center').replaceChildren(); $('killfeed').replaceChildren();
    this.buyMenu.pending = null; this.buyMenu.notice = ''; this.buyMenu.cache = '';
  }

  init(hello) {
    this.resetEffects();
    this.weapons = hello.weapons; this.map = hello.map; this.optics = hello.optics || [];
    this.buyMenu.init(hello.weapons, hello.optics);
    // Static radar background.
    const c = document.createElement('canvas'); c.width = 200; c.height = 186;
    const g = c.getContext('2d'), s = Math.min(192 / (hello.map.w * 2), 178 / (hello.map.h * 2));
    this.rs = s; this.rox = hello.map.w + (200 - hello.map.w * 2 * s) / (2 * s);
    this.roz = hello.map.h + (186 - hello.map.h * 2 * s) / (2 * s);
    g.fillStyle = '#67533c'; g.fillRect(0, 0, 200, 186);
    hello.map.sites.forEach((z, k) => {
      g.fillStyle = 'rgba(240,193,75,.22)'; g.fillRect((z[0] + this.rox) * s, (z[1] + this.roz) * s, (z[2] - z[0]) * s, (z[3] - z[1]) * s);
      g.fillStyle = 'rgba(240,193,75,.9)'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center';
      g.fillText('AB'[k], ((z[0] + z[2]) / 2 + this.rox) * s, ((z[1] + z[3]) / 2 + this.roz) * s + 6);
    });
    for (const b of hello.map.boxes) {
      if (!b[6] || b[1] >= 2) continue;
      g.fillStyle = ['', '#2c2723', '#a39170', '#8a7352', '#b3a487'][b[6]];
      g.fillRect((b[0] + this.rox) * s, (b[2] + this.roz) * s, (b[3] - b[0]) * s, (b[5] - b[2]) * s);
    }
    this.radarBg = c;
  }

  center(text, secs = 3, cls = '') {
    $('center').innerHTML = `<span class="${cls}">${esc(text)}</span>`; this.centerT = secs;
  }
  feed(html) {
    const d = document.createElement('div'); d.innerHTML = html; $('killfeed').prepend(d);
    setTimeout(() => d.remove(), 6000);
    while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
  }
  chat(name, team, msg) {
    const d = document.createElement('div');
    d.innerHTML = `<b class="${TEAM[team]}">${esc(name)}</b>: ${esc(msg)}`;
    $('chatlog').appendChild(d); setTimeout(() => d.remove(), 12000);
    while ($('chatlog').children.length > 6) $('chatlog').firstChild.remove();
  }
  hit(hs) { this.hitT = 0.25; $('hitmarker').className = hs ? 'hs' : ''; }
  hurt(d) { this.dmg = Math.min(1, this.dmg + 0.3 + d / 60); }
  flash(dur) { this.flashT = Math.max(this.flashT, dur); this.flashDur = Math.max(1, this.flashT); }

  // ---- buy menu
  get buyOpen() { return this.buyMenu.open; }
  get buyCat() { return this.buyMenu.category; }
  buyItems(cat, team) { return this.buyMenu.items(cat, team); }
  renderBuy(me, team, context) { this.buyMenu.render(me, team, context); }
  toggleBuy(open) { this.buyMenu.toggle(open); }
  buyKey(n) { return this.buyMenu.key(n); }

  // ---- weapon wheel
  owned(me) { return [me.pr >= 0, me.se >= 0, true, me.nd[0] > 0, me.nd[1] > 0, me.nd[2] > 0, me.bm]; }
  openWheel(me) {
    this.wheelOpen = true; this.wheelVec = [0, 0]; this.wheelSel = -1; this.wheelMoved = false;
    const own = this.owned(me);
    const names = [me.pr >= 0 ? this.weapons[me.pr].name : '—', me.se >= 0 ? this.weapons[me.se].name : '—', 'Combat Knife',
      `Frag ×${me.nd[0]}`, `Flashbang ×${me.nd[1]}`, `Smoke ×${me.nd[2]}`, me.bm ? 'Demolition Charge' : '—'];
    this.segs.forEach((d, i) => {
      d.innerHTML = `<b>${SLOT_NAMES[i]}</b>${esc(names[i])}`;
      d.className = 'seg' + (own[i] ? ' own' : '') + (me.sl === i ? ' cur' : '');
    });
    this.wheelOwn = own;
    $('wheel').classList.remove('hidden'); $('wheelDot').style.transform = '';
  }
  moveWheel(dx, dy) {
    const v = this.wheelVec; v[0] += dx; v[1] += dy;
    const len = Math.hypot(v[0], v[1]);
    if (len > 110) { v[0] *= 110 / len; v[1] *= 110 / len; }
    if (len > 12) this.wheelMoved = true;
    $('wheelDot').style.transform = `translate(${v[0]}px,${v[1]}px)`;
    let sel = -1;
    if (len > 28) {
      const a = (Math.atan2(v[0], -v[1]) + Math.PI * 2) % (Math.PI * 2);
      sel = Math.round(a / (Math.PI * 2) * 7) % 7;
      if (!this.wheelOwn[sel]) sel = -1;
    }
    if (sel !== this.wheelSel) {
      if (this.wheelSel >= 0) this.segs[this.wheelSel].classList.remove('sel');
      if (sel >= 0) this.segs[sel].classList.add('sel');
      this.wheelSel = sel;
    }
  }
  /** Returns the chosen slot, -1 for nothing, or -2 for a quick tap (swap to last weapon). */
  closeWheel() {
    this.wheelOpen = false; $('wheel').classList.add('hidden');
    return this.wheelSel >= 0 ? this.wheelSel : this.wheelMoved ? -1 : -2;
  }

  scoreboard(show, roster, snap, myId) {
    const el = $('scoreboard'); el.classList.toggle('hidden', !show);
    if (!show) return;
    let h = '';
    for (const t of [1, 2]) {
      const rows = [...roster.values()].filter(p => p.tm === t).sort((a, b) => b.k - a.k);
      h += `<h3 class="${TEAM[t]}"><span>${t === 1 ? 'ATTACKERS' : 'DEFENDERS'}</span><span>${snap.sc[t - 1]}</span></h3><table><tr><th></th><th>Kills</th><th>Deaths</th><th>Money</th></tr>`;
      for (const p of rows) {
        const alive = snap.players.get(p.id)?.alive;
        h += `<tr class="${alive ? '' : 'dead'} ${p.id === myId ? 'me' : ''}"><td>${esc(p.n)}</td><td>${p.k}</td><td>${p.d}</td><td>${p.tm === roster.get(myId)?.tm ? '$' + p.mo : ''}</td></tr>`;
      }
      h += '</table>';
    }
    el.innerHTML = h;
  }

  radar(snap, myId, myTeam, yaw, pos, items) {
    const g = $('radar').getContext('2d'), s = this.rs;
    g.drawImage(this.radarBg, 0, 0);
    const X = x => (x + this.rox) * s, Z = z => (z + this.roz) * s;
    const bombItem = items.find(i => this.weapons[i[1]].cls === 10);
    if (bombItem && myTeam === 1) { g.fillStyle = '#f0c14b'; g.fillRect(X(bombItem[2]) - 3, Z(bombItem[4]) - 3, 6, 6); }
    if (snap.bomb && (snap.tm * 3 | 0) % 2 === 0) { g.fillStyle = '#ff3b2e'; g.fillRect(X(snap.bomb[0]) - 4, Z(snap.bomb[2]) - 4, 8, 8); }
    for (const p of snap.players.values()) {
      if (!p.alive || p.team !== myTeam || p.id === myId) continue;
      g.fillStyle = p.flags & 2 ? '#f0c14b' : myTeam === 1 ? '#f0a04b' : '#5db4ff';
      g.beginPath(); g.arc(X(p.x), Z(p.z), 3.2, 0, 7); g.fill();
    }
    if (pos) {
      g.save(); g.translate(X(pos[0]), Z(pos[2])); g.rotate(-yaw);
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -7); g.lineTo(4.5, 5); g.lineTo(-4.5, 5); g.fill(); g.restore();
    }
  }

  update(dt, s) {
    // s: {me, snap, alive, weapons, gap, scoped, sniper, hint, progress, spec, locked}
    const { me, snap } = s;
    this.centerT -= dt; if (this.centerT <= 0) $('center').innerHTML = '';
    this.hitT = Math.max(0, this.hitT - dt); $('hitmarker').style.opacity = this.hitT * 4;
    this.dmg = Math.max(0, this.dmg - dt * 1.4); $('damage').style.opacity = this.dmg;
    this.flashT = Math.max(0, this.flashT - dt); $('flash').style.opacity = Math.min(1, this.flashT / Math.min(1.2, this.flashDur) );
    $('scoreA').textContent = snap.sc[0]; $('scoreD').textContent = snap.sc[1];
    const t = snap.bomb ? snap.bomb[3] : snap.pt;
    $('timer').textContent = snap.bomb && snap.ph === 1 ? '◉ CHARGE' : `${t / 60 | 0}:${String(t % 60 | 0).padStart(2, '0')}`;
    $('timer').classList.toggle('bomb', !!snap.bomb);
    let a = 0, d = 0; for (const p of snap.players.values()) if (p.alive) p.team === 1 ? a++ : d++;
    $('alive').textContent = `${a} alive · round ${snap.rd} · ${d} alive`;
    const show = s.alive;
    for (const id of ['vitals', 'ammo', 'money']) $(id).style.visibility = show ? 'visible' : 'hidden';
    $('crosshair').style.display = show && !s.aiming && !s.sniper ? '' : 'none';
    $('crosshair').style.setProperty('--gap', s.gap.toFixed(1) + 'px');
    $('scope').classList.toggle('hidden', !s.scoped);
    $('scope').dataset.kind = s.viewWeapon?.optic === 2 ? 'acog' : 'precision';
    $('scope-zoom').textContent = `${s.viewWeapon?.zoom || 1}× · ${s.viewWeapon?.optic === 2 ? 'ACOG' : 'PRECISION OPTIC'}`;
    $('optic-dot').classList.toggle('hidden', !s.opticDot);
    $('spec').classList.toggle('hidden', show || !s.spec); $('spec').textContent = s.spec || '';
    $('hint').textContent = s.hint || '';
    $('progress').classList.toggle('hidden', !s.progress);
    if (s.progress) { $('progressBar').style.width = s.progress[0] * 100 + '%'; $('progressLabel').textContent = s.progress[1]; }
    $('lock').classList.toggle('hidden', s.locked || this.buyOpen || s.menuOpen);
    if (!me) return;
    $('hp').textContent = me.hp; $('hp').classList.toggle('low', me.hp <= 25);
    $('armor').textContent = me.ar; $('armorLabel').textContent = me.he ? 'ARMOR+H' : 'ARMOR';
    $('money').textContent = '$' + me.mo;
    const w = s.weapons[me.w];
    const gun = w.mag > 0;
    $('ammo').classList.toggle('dual', !!w.dual);
    $('clip').textContent = w.dual ? `${me.amL ?? 0} | ${me.amR ?? 0}` : gun ? me.am : w.slot >= 3 && w.slot <= 5 ? me.nd[w.slot - 3] : '';
    $('reserve').textContent = gun ? '/ ' + me.rs : '';
    $('wname').textContent = w.name + (me.rl > 0 ? ' — reloading' : '');
    const optic = this.optics?.find(o => o.index === me.optic);
    const aimLabel = optic ? `${optic.name.toUpperCase()} ${optic.zoom}× · HOLD RMB` : w.zoom >= 4 ? `${w.zoom}× SCOPE · HOLD RMB` : 'HOLD RMB TO AIM';
    $('weapon-mode').textContent = w.dual ? 'LMB: LEFT  ·  RMB: RIGHT' : w.ads ? aimLabel : w.cls === 0 ? 'LMB: SLASH  ·  RMB: STAB' : '';
    $('carry').textContent = [me.bm ? 'CHARGE [5]' : '', me.kit ? 'DEFUSE KIT' : '',
      me.nd[0] ? 'FRAG' : '', me.nd[1] ? `FLASH×${me.nd[1]}` : '', me.nd[2] ? 'SMOKE' : ''].filter(Boolean).join(' · ');
  }
}
