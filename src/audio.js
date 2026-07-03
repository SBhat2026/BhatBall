// Procedural stadium audio — no asset files. Crowd bed, kick thumps, whistles, goal roar.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.crowdGain = null;
    this._lastTouch = 0;
  }

  // must be called from a user gesture
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this._startCrowd();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  _noiseBuffer(seconds = 2) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // pink-ish: integrate white noise slightly
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.15;
      d[i] = last;
    }
    return buf;
  }

  _startCrowd() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(4);
    src.loop = true;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.5;

    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.05;

    // slow murmur wobble
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain).connect(this.crowdGain.gain);

    src.connect(bp).connect(this.crowdGain).connect(this.master);
    src.start();
    lfo.start();

    // occasional random swells so the crowd feels alive
    const swellLoop = () => {
      if (!this.ctx) return;
      setTimeout(() => { this.swell(0.03 + Math.random() * 0.03, 1.5); swellLoop(); }, 6000 + Math.random() * 14000);
    };
    swellLoop();
  }

  // crowd rises: amount 0..0.3, seconds to decay back
  swell(amount = 0.1, decay = 2.5) {
    if (!this.crowdGain) return;
    const t = this.ctx.currentTime;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.05 + amount, t, 0.12);
    g.setTargetAtTime(0.05, t + 0.4, decay);
  }

  roar() {
    if (!this.ctx) return;
    this.swell(0.28, 3.2);
    // bright layer on top of the bed
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(3);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    src.connect(bp).connect(g).connect(this.master);
    src.start();
    src.stop(t + 3.1);
  }

  // ball contact: power 0..1
  kick(power = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // thump body
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120 + power * 60, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.09);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.12 + power * 0.25, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(og).connect(this.master);
    osc.start(t); osc.stop(t + 0.12);
    // leather snap
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.1);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + power * 2400;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.1 + power * 0.2, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(lp).connect(ng).connect(this.master);
    src.start(t); src.stop(t + 0.08);
  }

  // soft dribble touch, throttled
  touch() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this._lastTouch < 0.22) return;
    this._lastTouch = now;
    this.kick(0.08);
  }

  whistle(blasts = 1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < blasts; i++) {
      const t = t0 + i * 0.42;
      const dur = blasts === 3 && i === 2 ? 0.7 : 0.28; // long final blast at full-time
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 2350;
      const trem = this.ctx.createOscillator();
      trem.frequency.value = 38; // pea rattle
      const tg = this.ctx.createGain();
      tg.gain.value = 0.35;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.055, t + 0.02);
      g.gain.setValueAtTime(0.055, t + dur - 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      trem.connect(tg).connect(g.gain);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
      trem.start(t); trem.stop(t + dur + 0.02);
    }
  }

  switchBlip() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.07);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.12);
  }

  // routed from match hooks
  event(name, arg) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'kick': this.kick(arg ?? 0.5); if ((arg ?? 0) > 0.75) this.swell(0.08, 1.5); break;
      case 'touch': this.touch(); break;
      case 'whistle': this.whistle(arg ?? 1); break;
      case 'switch': this.switchBlip(); break;
    }
  }
}
