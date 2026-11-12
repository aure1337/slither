'use strict';

/* ============ Звук (WebAudio, без файлов) ============ */

const Sfx = {
  ctx: null,
  muted: false,

  init() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  tone(freq, dur, type, vol, when, slide) {
    if (this.muted || !this.ctx) return;
    try {
      const t0 = this.ctx.currentTime + (when || 0);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      g.gain.setValueAtTime(vol || 0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    } catch (e) { /* ignore */ }
  },

  click()  { this.tone(640, 0.05, 'square', 0.045); },
  eat(n)   { this.tone(480 + Math.min(n || 1, 14) * 42, 0.06, 'triangle', 0.07); },
  die()    { this.tone(280, 0.5, 'sawtooth', 0.11, 0, -200); this.tone(140, 0.6, 'square', 0.07, 0.06, -90); },
  kill()   { this.tone(880, 0.09, 'square', 0.09); this.tone(1320, 0.12, 'square', 0.09, 0.09); },
  cash()   { [880, 1108, 1318, 1760].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.11, i * 0.08)); },
  bonus()  { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'square', 0.08, i * 0.09)); },
  join()   { this.tone(520, 0.1, 'triangle', 0.08); this.tone(780, 0.12, 'triangle', 0.08, 0.1); },
};
