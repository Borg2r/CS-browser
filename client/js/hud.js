// HTML heads-up display: vitals, radar, kill feed, buy menu, weapon wheel, scoreboard.
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TEAM = ['', 'atk', 'def'];
const SLOT_NAMES = ['PRIMARY', 'SIDEARM', 'KNIFE', 'FRAG', 'FLASH', 'SMOKE', 'CHARGE'];
const GEAR = [
  { id: 'vest', name: 'Kevlar Vest', price: 650 },
  { id: 'vesthelm', name: 'Vest + Helmet', price: 1000 },
  { id: 'kit', name: 'Defuse Kit', price: 200, team: 2 },
];
const CATS = [['Pistols', [1]], ['Shotguns', [2]], ['SMGs', [3]], ['Rifles', [4]], ['Snipers & MG', [5, 6]], ['Grenades & Gear', [7, 8, 9]]];

export class Hud {
  constructor(onBuy) {
    this.onBuy = onBuy;
    this.centerT = 0; this.hitT = 0; this.dmg = 0; this.flashT = 0; this.flashDur = 1;
    this.buyOpen = false; this.buyCat = -1; this.wheelOpen = false; this.wheelVec = [0, 0]; this.wheelSel = -1;
    this.segs = SLOT_NAMES.map((n, i) => {
      const d = document.createElement('div'); d.className = 'seg';
      const a = i / 7 * Math.PI * 2;
      d.style.left = Math.sin(a) * 132 + 'px'; d.style.top = -Math.cos(a) * 132 + 'px';
      $('wheel').appendChild(d); return d;
    });
    $('buy').addEventListener('click', e => {
      const row = e.target.closest('.row'); if (row) this.buyKey(+row.dataset.k);
    });
  }

  init(hello) {
    this.weapons = hello.weapons; this.map = hello.map;
    // Static radar background.
    const c = document.createElement('canvas'); c.width = 200; c.height = 186;
    const g = c.getContext('2d'), s = 200 / (hello.map.w * 2);
    this.rs = s; this.rox = hello.map.w; this.roz = hello.map.h;
    g.fillStyle = '#3b424a'; g.fillRect(0, 0, 200, 186);
    hello.map.sites.forEach((z, k) => {
      g.fillStyle = 'rgba(240,193,75,.22)'; g.fillRect((z[0] + this.rox) * s, (z[1] + this.roz) * s, (z[2] - z[0]) * s, (z[3] - z[1]) * s);
      g.fillStyle = 'rgba(240,193,75,.9)'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center';
      g.fillText('AB'[k], ((z[0] + z[2]) / 2 + this.rox) * s, ((z[1] + z[3]) / 2 + this.roz) * s + 6);
    });
    for (const b of hello.map.boxes) {
      if (!b[6]) continue;
      g.fillStyle = ['', '#12161b', '#77808a', '#8a7352', '#9a9a94'][b[6]];
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
  buyItems(cat, team) {
    const list = this.weapons.filter(w => CATS[cat][1].includes(w.cls) && (!w.team || w.team === team));
    return cat === 5 ? list.concat(GEAR.filter(g => !g.team || g.team === team)) : list;
  }
  renderBuy(me, team) {
    const el = $('buy'); el.classList.toggle('hidden', !this.buyOpen);
    if (!this.buyOpen) return;
    const key = `${this.buyCat}|${me.mo}|${team}`;
    if (key === this.buyKeyCache) return;
    this.buyKeyCache = key; this.buyTeam = team;
    let h = `<h2><span>${this.buyCat < 0 ? 'BUY MENU' : esc(CATS[this.buyCat][0]).toUpperCase()}</span><span class="p" style="color:#8fe08a">$${me.mo}</span></h2>`;
    if (this.buyCat < 0) {
      CATS.forEach((c, i) => { h += `<div class="row" data-k="${i + 1}"><span class="k">${i + 1}</span>${esc(c[0])}</div>`; });
    } else {
      this.buyItems(this.buyCat, team).forEach((w, i) => {
        const stat = w.mag ? `${w.dmg} dmg · ${w.mag} rds` : '';
        h += `<div class="row ${w.price > me.mo ? 'no' : ''}" data-k="${i + 1}"><span class="k">${i + 1}</span>${esc(w.name)}<span class="s">${stat}</span><span class="p">$${w.price}</span></div>`;
      });
    }
    h += `<div class="row" data-k="0"><span class="k">0</span>${this.buyCat < 0 ? 'Close' : 'Back'}</div><div class="foot">Number keys or click · B closes</div>`;
    el.innerHTML = h;
  }
  toggleBuy(open) { this.buyOpen = open; this.buyCat = -1; this.buyKeyCache = ''; }
  buyKey(n) {
    if (!this.buyOpen) return false;
    if (n === 0) { if (this.buyCat < 0) this.toggleBuy(false); else { this.buyCat = -1; } this.buyKeyCache = ''; return true; }
    if (this.buyCat < 0) { if (n <= CATS.length) { this.buyCat = n - 1; this.buyKeyCache = ''; } return true; }
    const item = this.buyItems(this.buyCat, this.buyTeam)[n - 1];
    if (item) { this.onBuy(item.id); this.toggleBuy(false); }
    return true;
  }

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
    $('crosshair').style.display = show && !s.scoped && !s.sniper ? '' : 'none';
    $('crosshair').style.setProperty('--gap', s.gap.toFixed(1) + 'px');
    $('scope').classList.toggle('hidden', !(show && s.scoped));
    $('spec').classList.toggle('hidden', show || !s.spec); $('spec').textContent = s.spec || '';
    $('hint').textContent = s.hint || '';
    $('progress').classList.toggle('hidden', !s.progress);
    if (s.progress) { $('progressBar').style.width = s.progress[0] * 100 + '%'; $('progressLabel').textContent = s.progress[1]; }
    $('lock').classList.toggle('hidden', s.locked || this.buyOpen);
    if (!me) return;
    $('hp').textContent = me.hp; $('hp').classList.toggle('low', me.hp <= 25);
    $('armor').textContent = me.ar; $('armorLabel').textContent = me.he ? 'ARMOR+H' : 'ARMOR';
    $('money').textContent = '$' + me.mo;
    const w = s.weapons[me.w];
    const gun = w.mag > 0;
    $('clip').textContent = gun ? me.am : w.slot >= 3 && w.slot <= 5 ? me.nd[w.slot - 3] : '';
    $('reserve').textContent = gun ? '/ ' + me.rs : '';
    $('wname').textContent = w.name + (me.rl > 0 ? ' — reloading' : '');
    $('carry').textContent = [me.bm ? 'CHARGE [5]' : '', me.kit ? 'DEFUSE KIT' : '',
      me.nd[0] ? 'FRAG' : '', me.nd[1] ? `FLASH×${me.nd[1]}` : '', me.nd[2] ? 'SMOKE' : ''].filter(Boolean).join(' · ');
  }
}
