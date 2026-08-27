/**
 * Procedural sound. No files: everything is synthesised with WebAudio so the
 * game stays a few hundred kilobytes and works offline.
 */

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.noiseBuffer = null;
    this.unlocked = false;
  }

  /** Must be called from a user gesture (iOS requirement). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch { return; }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    // A touch of glue so blasts don't clip on phone speakers.
    if (this.ctx.createDynamicsCompressor) {
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 8;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
    } else {
      this.master.connect(this.ctx.destination);
    }

    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    this.unlocked = true;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.55 : 0;
  }

  get ok() { return this.enabled && this.ctx && this.ctx.state === 'running'; }
  get now() { return this.ctx.currentTime; }

  _env(node, t0, attack, decay, peak) {
    const g = node.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  _tone({ freq = 440, to = null, type = 'sine', dur = 0.2, gain = 0.3, delay = 0, detune = 0 }) {
    if (!this.ok) return;
    const t0 = this.now + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
    this._env(g, t0, Math.min(0.012, dur * 0.2), dur, gain);
    osc.connect(g); g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.06);
  }

  _noise({ dur = 0.3, gain = 0.4, delay = 0, from = 3200, to = 120, q = 1.2, type = 'lowpass' }) {
    if (!this.ok) return;
    const t0 = this.now + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(to, 30), t0 + dur);
    const g = this.ctx.createGain();
    this._env(g, t0, 0.006, dur, gain);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /* ── Game events ───────────────────────────────────────────────────── */

  throwBomb(wave = 1) {
    this._tone({ freq: 200 + wave * 14, to: 520 + wave * 20, type: 'square', dur: 0.075, gain: 0.075 });
  }

  catch(streak = 0) {
    const step = Math.min(streak, 24);
    const freq = 520 * Math.pow(2, step / 24);
    this._tone({ freq, to: freq * 1.6, type: 'triangle', dur: 0.1, gain: 0.24 });
    this._tone({ freq: freq * 2, type: 'sine', dur: 0.055, gain: 0.1, delay: 0.012 });
  }

  explode(power = 1, delay = 0) {
    this._noise({ dur: 0.5 * power, gain: 0.5, delay, from: 2600, to: 60 });
    this._tone({ freq: 150, to: 32, type: 'sine', dur: 0.42 * power, gain: 0.5, delay });
    this._tone({ freq: 88, to: 24, type: 'square', dur: 0.3 * power, gain: 0.16, delay: delay + 0.02 });
  }

  loseBucket() {
    this._noise({ dur: 0.35, gain: 0.35, from: 1800, to: 200, type: 'bandpass', q: 2.2 });
    this._tone({ freq: 420, to: 70, type: 'sawtooth', dur: 0.55, gain: 0.28 });
  }

  waveClear() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.22, gain: 0.22, delay: i * 0.085 }));
    this._tone({ freq: 1567.98, type: 'sine', dur: 0.5, gain: 0.14, delay: 0.36 });
  }

  extraBucket() {
    [784, 988, 1319].forEach((f, i) =>
      this._tone({ freq: f, type: 'square', dur: 0.14, gain: 0.14, delay: i * 0.07 }));
  }

  streakOn() {
    [660, 880, 1320].forEach((f, i) =>
      this._tone({ freq: f, type: 'triangle', dur: 0.18, gain: 0.13, delay: i * 0.05 }));
  }

  gameOver() {
    const notes = [392, 329.63, 261.63, 196];
    notes.forEach((f, i) => this._tone({ freq: f, type: 'sawtooth', dur: 0.45, gain: 0.2, delay: i * 0.17 }));
    this._noise({ dur: 1.4, gain: 0.18, delay: 0.6, from: 900, to: 40 });
  }

  ui() {
    this._tone({ freq: 880, to: 1320, type: 'square', dur: 0.05, gain: 0.07 });
  }
}
