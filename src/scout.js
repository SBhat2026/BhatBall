// Opposition scouting: tracks the human-controlled side's tendencies during a
// match and periodically retunes the opposing AI's defensive knobs. Invisible
// in normal play; dev mode surfaces the adjustments as coach toasts.
import { clamp } from './config.js';

const PERIOD = 12; // seconds between adjustment passes

export class Scout {
  // watches team `subject` (human side), adapts team `counter` (their opponents)
  constructor(subject, counter, onCoach) {
    this.subject = subject;
    this.counter = counter;
    this.onCoach = onCoach ?? (() => {});
    this.t = 0;
    this.n = { pass: 0, through: 0, cross: 0, shot: 0, longShot: 0, dribble: 0 };
    this.zSum = 0; this.zN = 0; // where their final-third entries happen
    this.prev = { shiftZ: 0, closeDown: 0, lineDrop: 0, wideDeep: 0, tackleBoost: 0 };
  }

  note(kind) { if (kind in this.n) this.n[kind]++; }

  // match.js calls sampleZ() when the subject works the final third
  update(dt, match) {
    this.t += dt;
    if (this.t < PERIOD) return;
    this.t = 0;

    const n = this.n;
    const adapt = this.counter.adapt;
    const passes = Math.max(4, n.pass + n.through);

    const next = {
      shiftZ: this.zN >= 4 ? clamp((this.zSum / this.zN) * 0.55, -6, 6) : this.prev.shiftZ * 0.6,
      wideDeep: clamp((n.cross / passes - 0.1) * 5, 0, 1),
      closeDown: n.shot >= 2 ? clamp((n.longShot / Math.max(2, n.shot) - 0.3) * 2.2, 0, 1) : this.prev.closeDown * 0.7,
      lineDrop: clamp((n.through / passes - 0.12) * 1.4, 0, 0.8) * 0.5,
      tackleBoost: clamp((n.dribble / passes - 0.35) * 1.5, 0, 0.8),
    };

    // coach lines when a counter-move actually kicks in
    const say = (msg) => this.onCoach(`${this.counter.def.code}: ${msg}`);
    if (Math.abs(next.shiftZ - this.prev.shiftZ) > 2.2 && Math.abs(next.shiftZ) > 2.2) {
      say(`defence shading ${next.shiftZ < 0 ? 'LEFT' : 'RIGHT'} — your channel bias is clocked`);
    }
    if (next.wideDeep > 0.45 && this.prev.wideDeep <= 0.45) say('fullbacks dropping deeper to cut out your crosses');
    if (next.closeDown > 0.4 && this.prev.closeDown <= 0.4) say('closing you down earlier — they\'ve seen the long shots');
    if (next.lineDrop > 0.2 && this.prev.lineDrop <= 0.2) say('back line dropping off to kill your through balls');
    if (next.tackleBoost > 0.35 && this.prev.tackleBoost <= 0.35) say('doubling up when you dribble');

    Object.assign(adapt, next);
    this.prev = next;

    // decay counters so the read stays rolling, not cumulative
    for (const k of Object.keys(n)) n[k] *= 0.5;
    this.zSum *= 0.5; this.zN *= 0.5;
  }

  sampleZ(z) { this.zSum += z; this.zN++; }
}
