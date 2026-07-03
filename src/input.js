const MOVE = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1],  ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0],  ArrowRight: [1, 0],
};
const HANDLED = new Set([
  ...Object.keys(MOVE), 'Space', 'KeyJ', 'KeyK', 'KeyL', 'KeyI', 'KeyQ', 'KeyE',
  'KeyC', 'KeyH', 'KeyP', 'KeyM', 'Tab', 'Escape', 'ShiftLeft', 'ShiftRight',
]);

export class Input {
  constructor() {
    this.down = new Set();
    this.events = [];
    this.charging = null; // { type: 'shoot'|'finesse', t0 }
    addEventListener('keydown', (e) => {
      if (HANDLED.has(e.code)) e.preventDefault();
      if (e.repeat || this.down.has(e.code)) return;
      this.down.add(e.code);
      this._press(e.code);
    });
    addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this._release(e.code);
    });
    addEventListener('blur', () => { this.down.clear(); this.charging = null; });
  }

  _press(c) {
    if (c === 'Space') this.charging = { type: 'shoot', t0: performance.now() };
    else if (c === 'KeyI') this.charging = { type: 'finesse', t0: performance.now() };
    else if (c === 'KeyJ') this.charging = { type: 'pass', t0: performance.now() };
    else if (c === 'KeyL') this.events.push({ type: 'chip' });
    else if (c === 'KeyQ') this.events.push({ type: 'sombrero' });
    else if (c === 'KeyE') this.events.push({ type: 'bicycle' });
    else if (c === 'KeyK') this.events.push({ type: 'tackle' });
    else if (c === 'KeyC') this.events.push({ type: 'camera' });
    else if (c === 'KeyH') this.events.push({ type: 'help' });
    else if (c === 'KeyP' || c === 'Escape') this.events.push({ type: 'pause' });
    else if (c === 'KeyM') this.events.push({ type: 'mute' });
    else if (c === 'Tab') this.events.push({ type: 'tab' });
  }

  _release(c) {
    if (c === 'Space' && this.charging?.type === 'shoot')
      this.events.push({ type: 'shoot', power: this.chargePower() });
    else if (c === 'KeyI' && this.charging?.type === 'finesse')
      this.events.push({ type: 'finesse', power: Math.min(0.7, this.chargePower()) });
    else if (c === 'KeyJ' && this.charging?.type === 'pass') {
      const held = (performance.now() - this.charging.t0) / 1000;
      if (held < 0.32) this.events.push({ type: 'pass' });
      else this.events.push({ type: 'through', power: Math.min(1, (held - 0.32) / 0.9) });
    } else return;
    this.charging = null;
  }

  chargePower() {
    if (!this.charging) return 0;
    return Math.min(1, (performance.now() - this.charging.t0) / 900);
  }

  moveDir() {
    let x = 0, z = 0;
    for (const c of this.down) { const m = MOVE[c]; if (m) { x += m[0]; z += m[1]; } }
    const len = Math.hypot(x, z);
    return len > 0 ? { x: x / len, z: z / len } : { x: 0, z: 0 };
  }

  sprinting() { return this.down.has('ShiftLeft') || this.down.has('ShiftRight'); }

  takeEvents() { const e = this.events; this.events = []; return e; }
}
