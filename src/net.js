// Client networking: thin wrapper over the room relay, plus the snapshot codec
// and the RemoteInput adapter the host feeds into Match for a remote player.

export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.code = null;
    this.handlers = {}; // t → fn(msg)
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this.ws = new WebSocket(`${proto}://${location.host}`);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        this.handlers[m.t]?.(m);
      };
      this.ws.onclose = () => this.handlers.close?.({});
    });
  }

  on(t, fn) { this.handlers[t] = fn; }
  close() { this.ws?.close(); }
  send(obj) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  create(name, team) { this.send({ t: 'create', name, team }); }
  join(code, name) { this.send({ t: 'join', code, name }); }
  pickTeam(idx) { this.send({ t: 'team', idx }); }
  sendInput(d) { this.send({ t: 'input', d }); }
  cast(d) { this.send({ t: 'cast', d }); }
  to(id, d) { this.send({ t: 'to', id, d }); }
}

// host-side stand-in for a remote player's keyboard
export class RemoteInput {
  constructor() {
    this.axis = { x: 0, z: 0 };
    this.sprint = false;
    this.queue = [];
    this.charging = null;
  }
  moveDir() { return this.axis; }
  sprinting() { return this.sprint; }
  chargePower() { return 0; }
  apply(d) {
    if (d.a) this.axis = d.a;
    this.sprint = !!d.s;
    if (d.e?.length) this.queue.push(...d.e);
  }
  takeEvents() { const q = this.queue; this.queue = []; return q; }
}

// --- snapshot codec (host → viewers) ---------------------------------------

const r2 = (v) => Math.round(v * 100) / 100;

// one-shot anim bits (1..64 rising-edge triggered on viewers, 128 is a held state)
export function rigFx(rig) {
  return (rig.bicycleT > 0 ? 1 : 0) | (rig.slideT > 0 ? 2 : 0)
    | (rig.flickT > 0 ? 4 : 0) | (rig.finesseT > 0 ? 8 : 0)
    | (rig.throwT > 0 ? 16 : 0) | (rig.kickT > 0 ? 32 : 0)
    | (rig.chipT > 0 ? 64 : 0) | (rig.holdBall ? 128 : 0);
}

export function encodeSnapshot(match) {
  const players = [];
  for (const team of [match.teamA, match.teamB]) {
    for (const p of team.players) {
      players.push([
        r2(p.pos.x), r2(p.pos.z),
        r2(p.rig.group.rotation.y),
        r2(Math.hypot(p.vel.x, p.vel.z)),
        rigFx(p.rig),
      ]);
    }
  }
  const b = match.ball;
  // controlled map: seatKey → global player index (A players first, then B)
  const aCount = match.teamA.players.length;
  const ct = {};
  for (const [key, p] of Object.entries(match.seats)) {
    ct[key] = p.team.key === 'B' ? aCount + p.idx : p.idx;
  }
  return {
    k: 'snap',
    p: players,
    b: [r2(b.pos.x), r2(b.pos.y), r2(b.pos.z)],
    sc: [match.scoreA, match.scoreB],
    ck: match.clockText(),
    ct,
  };
}
