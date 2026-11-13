// Fully synthesised sound effects (WebAudio) - no audio assets.
export class Sfx {
  constructor() { this.ctx = null; this.volume = 0.6; this.listener = { x: 0, y: 0, z: 0, yaw: 0 }; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, len);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // Returns an output node positioned in the stereo field, or null if inaudible.
  out(pos, gain = 1, range = 90) {
    if (!this.ctx) return null;
    this.master.gain.value = this.volume;
    let g = gain, pan = 0;
    if (pos) {
      const dx = pos[0] - this.listener.x, dz = pos[2] - this.listener.z;
      const d = Math.hypot(dx, dz, pos[1] - this.listener.y);
      if (d > range) return null;
      g *= Math.pow(1 - d / range, 2);
      const yaw = this.listener.yaw;
      const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      pan = d > 0.5 ? Math.max(-0.9, Math.min(0.9, right / d)) : 0;
    }
    const gn = this.ctx.createGain(); gn.gain.value = g;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = pan;
      gn.connect(p); p.connect(this.master);
    } else gn.connect(this.master);
    return gn;
  }

  burst(dst, { dur = 0.2, freq = 1200, q = 0.7, type = 'lowpass', vol = 1, sweep = 0 }) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(dst);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  tone(dst, { freq = 440, to = 0, dur = 0.1, vol = 0.5, type = 'sine', delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dst); o.start(t); o.stop(t + dur + 0.02);
  }

  shot(cls, pos) {
    const o = this.out(pos, pos ? 1 : 0.8, 120); if (!o) return;
    const p = {
      1: [0.16, 2600, 0.9, 150, 0.10], 2: [0.34, 1300, 1.2, 90, 0.22], 3: [0.13, 3000, 0.8, 170, 0.08],
      4: [0.22, 2000, 1.0, 110, 0.14], 5: [0.5, 1500, 1.3, 70, 0.3], 6: [0.22, 1700, 1.0, 100, 0.15],
    }[cls] || [0.2, 2000, 1, 120, 0.1];
    this.burst(o, { dur: p[0], freq: p[1], vol: p[2], sweep: 300 });
    this.tone(o, { freq: p[3], to: 40, dur: p[4], vol: p[2] * 0.9, type: 'triangle' });
  }
  leverCycle(pos) {
    const o = this.out(pos, 0.24, 24); if (!o) return;
    this.tone(o, { freq: 1250, to: 500, dur: 0.045, vol: 0.35, type: 'square', delay: 0.16 });
    this.tone(o, { freq: 850, to: 350, dur: 0.035, vol: 0.4, type: 'square', delay: 0.68 });
  }
  swing(pos, hit) {
    const o = this.out(pos, 0.5, 25); if (!o) return;
    this.burst(o, { dur: 0.12, freq: 900, type: 'bandpass', q: 2, vol: 0.6, sweep: 2500 });
    if (hit) this.burst(o, { dur: 0.1, freq: 500, vol: 0.9 });
  }
  reload(pos) {
    const o = this.out(pos, 0.5, 20); if (!o) return;
    this.tone(o, { freq: 1500, dur: 0.03, vol: 0.4, type: 'square' });
    this.tone(o, { freq: 900, dur: 0.04, vol: 0.4, type: 'square', delay: 0.35 });
  }
  step(pos, own) {
    const o = this.out(own ? null : pos, own ? 0.12 : 0.5, 26); if (!o) return;
    this.burst(o, { dur: 0.07, freq: 380 + Math.random() * 160, vol: 0.9 });
  }
  boom(pos, big) {
    const o = this.out(pos, big ? 2.2 : 1.5, big ? 400 : 140); if (!o) return;
    this.burst(o, { dur: big ? 2.2 : 0.9, freq: 900, vol: 1.5, sweep: 60 });
    this.tone(o, { freq: 90, to: 28, dur: big ? 1.6 : 0.6, vol: 1.4, type: 'triangle' });
  }
  pop(pos) {
    const o = this.out(pos, 1.2, 100); if (!o) return;
    this.burst(o, { dur: 0.25, freq: 5000, type: 'highpass', vol: 1 });
  }
  ring(amount) {
    const o = this.out(null, Math.min(0.5, amount * 0.15)); if (!o) return;
    this.tone(o, { freq: 3900, dur: Math.max(0.5, amount), vol: 0.5 });
  }
  hiss(pos) {
    const o = this.out(pos, 0.7, 60); if (!o) return;
    this.burst(o, { dur: 1.6, freq: 4500, type: 'bandpass', q: 0.6, vol: 0.5 });
  }
  beep(pos, high) {
    const o = this.out(pos, 0.9, 70); if (!o) return;
    this.tone(o, { freq: high ? 2600 : 1900, dur: 0.07, vol: 0.5, type: 'square' });
  }
  hit(hs) {
    const o = this.out(null, 0.35); if (!o) return;
    this.tone(o, { freq: hs ? 1700 : 1100, dur: 0.06, vol: 0.6, type: 'triangle' });
  }
  hurt() {
    const o = this.out(null, 0.5); if (!o) return;
    this.burst(o, { dur: 0.14, freq: 600, vol: 0.9 });
  }
  ui(ok = true) {
    const o = this.out(null, 0.25); if (!o) return;
    this.tone(o, { freq: ok ? 880 : 220, dur: 0.05, vol: 0.5, type: 'square' });
  }
  jingle(win) {
    const o = this.out(null, 0.35); if (!o) return;
    const notes = win ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((f, i) => this.tone(o, { freq: f, dur: 0.22, vol: 0.5, type: 'triangle', delay: i * 0.14 }));
  }
}
