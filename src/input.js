const MOVE = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1],  ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0],  ArrowRight: [1, 0],
};
const HANDLED = new Set([
  ...Object.keys(MOVE), 'Space', 'KeyJ', 'KeyK', 'KeyL', 'KeyI', 'KeyQ', 'KeyE',
  'KeyC', 'KeyH', 'KeyP', 'KeyM', 'Tab', 'Escape', 'ShiftLeft', 'ShiftRight', 'Enter',
]);

export class Input {
  constructor() {
    this.down = new Set();
    this.events = [];
    this.charging = null; // { type: 'shoot'|'finesse'|'pass', t0, mouse? }
    // mouse aiming: NDC tracked here, world point (this.aim) filled by main.js raycast
    this.mouse = { x: 0, y: 0, active: false, lastMove: 0 };
    this.aim = null; // { x, z } on the pitch plane
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

    addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / innerHeight) * 2 + 1;
      this.mouse.active = true;
      this.mouse.lastMove = performance.now();
    });
    // LMB = shoot (hold for power), RMB = pass (hold for through ball) — both aim at the cursor
    addEventListener('mousedown', (e) => {
      if (e.target.id !== 'game') return; // ignore clicks on menus/HUD
      if (e.button === 0) this.charging = { type: 'shoot', t0: performance.now(), mouse: true };
      else if (e.button === 2) this.charging = { type: 'pass', t0: performance.now(), mouse: true };
    });
    addEventListener('mouseup', (e) => {
      if (!this.charging?.mouse) return;
      if (e.button === 0 && this.charging.type === 'shoot') {
        this.events.push({ type: 'shoot', power: this.chargePower(), aim: this.aim });
      } else if (e.button === 2 && this.charging.type === 'pass') {
        const held = (performance.now() - this.charging.t0) / 1000;
        if (held < 0.32) this.events.push({ type: 'pass', aim: this.aim });
        else this.events.push({ type: 'through', power: Math.min(1, (held - 0.32) / 0.9), loft: held > 1.05, aim: this.aim });
      } else return;
      this.charging = null;
    });
    addEventListener('contextmenu', (e) => {
      if (e.target.id === 'game') e.preventDefault();
    });
  }

  // aim only counts for keyboard actions if the mouse moved recently (actively aiming)
  _aimNow() {
    return this.mouse.active && performance.now() - this.mouse.lastMove < 2500 ? this.aim : null;
  }

  aimPoint() { return this._aimNow(); }

  _press(c) {
    if (c === 'Space') this.charging = { type: 'shoot', t0: performance.now() };
    else if (c === 'KeyI') this.charging = { type: 'finesse', t0: performance.now() };
    else if (c === 'KeyJ') this.charging = { type: 'pass', t0: performance.now() };
    else if (c === 'KeyL') this.charging = { type: 'chip', t0: performance.now() };
    else if (c === 'KeyQ') this.events.push({ type: 'sombrero' });
    else if (c === 'KeyE') this.events.push({ type: 'bicycle' });
    else if (c === 'KeyK') this.events.push({ type: 'tackle' });
    else if (c === 'KeyC') this.events.push({ type: 'camera' });
    else if (c === 'KeyH') this.events.push({ type: 'help' });
    else if (c === 'KeyP' || c === 'Escape') this.events.push({ type: 'pause' });
    else if (c === 'KeyM') this.events.push({ type: 'mute' });
    else if (c === 'Tab') this.events.push({ type: 'tab' });
    else if (c === 'Enter') this.events.push({ type: 'skip' });
  }

  _release(c) {
    if (this.charging?.mouse) return; // mouse owns the charge
    if (c === 'Space' && this.charging?.type === 'shoot')
      this.events.push({ type: 'shoot', power: this.chargePower(), aim: this._aimNow() });
    else if (c === 'KeyI' && this.charging?.type === 'finesse')
      this.events.push({ type: 'finesse', power: Math.min(0.7, this.chargePower()), aim: this._aimNow() });
    else if (c === 'KeyJ' && this.charging?.type === 'pass') {
      const held = (performance.now() - this.charging.t0) / 1000;
      if (held < 0.32) this.events.push({ type: 'pass', aim: this._aimNow() });
      else this.events.push({ type: 'through', power: Math.min(1, (held - 0.32) / 0.9), loft: held > 1.05, aim: this._aimNow() });
    } else if (c === 'KeyL' && this.charging?.type === 'chip') {
      this.events.push({ type: 'chip', power: this.chargePower(), aim: this._aimNow() });
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
