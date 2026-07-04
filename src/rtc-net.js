// Serverless rooms over WebRTC (PeerJS + its free public signaling cloud).
// Drop-in replacement for the ws Net: same handler names and message shapes.
// The HOST BROWSER plays the role server.js used to play — it owns the roster,
// assigns ids, and relays casts — so the static site needs no server at all.
// window.Peer comes from vendor/peerjs.min.js (classic script in index.html).

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const makeCode = () => Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
const peerId = (code) => `bhatball-room-${code}`;

export class RtcNet {
  constructor() {
    this.peer = null;
    this.conn = null;      // joiner → host connection
    this.id = null;
    this.code = null;
    this.handlers = {};    // t → fn(msg)
    // host room state (mirrors server.js)
    this.clients = new Map(); // id → conn
    this.names = new Map();
    this.teams = new Map();
    this.nextId = 1;
    this._dead = false;
  }

  connect() {
    if (typeof window === 'undefined' || !window.Peer) {
      return Promise.reject(new Error('PeerJS not loaded'));
    }
    return Promise.resolve();
  }

  on(t, fn) { this.handlers[t] = fn; }
  _emit(t, m) { this.handlers[t]?.(m); }

  close() {
    this._dead = true;
    try { this.peer?.destroy(); } catch { /* already gone */ }
    this.peer = null;
  }

  // --- host ------------------------------------------------------------------

  create(name, team, _attempt = 0) {
    const code = makeCode();
    const peer = this.peer = new window.Peer(peerId(code));

    peer.on('open', () => {
      this.code = code;
      this.id = 0;
      this.names.set(0, (name || 'HOST').slice(0, 14));
      this.teams.set(0, team ?? null);
      this._emit('created', { t: 'created', code });
      this._castRoster();
    });

    peer.on('connection', (conn) => this._accept(conn));

    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && _attempt < 4) {
        peer.destroy();
        this.create(name, team, _attempt + 1); // code collision — roll again
      } else if (!this.code) {
        this._emit('err', { t: 'err', msg: 'Could not reach the room network — check your connection.' });
      }
    });
    peer.on('disconnected', () => { if (!this._dead) peer.reconnect(); });
    peer.on('close', () => { if (!this._dead) this._emit('close', {}); });
  }

  _accept(conn) {
    conn.on('open', () => {
      if (this.clients.size >= 15) {
        conn.send({ t: 'err', msg: 'Room full' });
        setTimeout(() => conn.close(), 200);
        return;
      }
      const id = this.nextId++;
      conn._id = id;
      this.clients.set(id, conn);
      this.names.set(id, (conn.metadata?.name || `P${id}`).slice(0, 14));
      this.teams.set(id, null);
      conn.send({ t: 'joined', code: this.code, id });
      this._castRoster();
    });
    conn.on('data', (m) => {
      if (!m || conn._id == null) return;
      if (m.t === 'team') { this.teams.set(conn._id, m.idx); this._castRoster(); }
      else if (m.t === 'input') this._emit('input', { t: 'input', from: conn._id, d: m.d });
    });
    const drop = () => {
      if (conn._id == null || !this.clients.has(conn._id)) return;
      this.clients.delete(conn._id);
      this.names.delete(conn._id);
      this.teams.delete(conn._id);
      this._emit('left', { t: 'left', id: conn._id });
      this._castRoster();
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  _castRoster() {
    const roster = [...this.names.entries()].map(([id, name]) => ({ id, name, team: this.teams.get(id) ?? null }));
    const msg = { t: 'roster', roster };
    this._emit('roster', msg);
    for (const c of this.clients.values()) if (c.open) c.send(msg);
  }

  cast(d) { for (const c of this.clients.values()) if (c.open) c.send({ t: 'cast', d }); }
  to(id, d) { const c = this.clients.get(id); if (c?.open) c.send({ t: 'cast', d }); }

  // --- joiner ------------------------------------------------------------------

  join(code, name) {
    const clean = (code || '').toUpperCase().trim();
    const peer = this.peer = new window.Peer();

    peer.on('open', () => {
      const conn = this.conn = peer.connect(peerId(clean), {
        reliable: true, metadata: { name: (name || 'Player').slice(0, 14) },
      });
      conn.on('data', (m) => { if (m?.t) this._emit(m.t, m); });
      conn.on('close', () => { if (!this._dead) this._emit('close', {}); });
    });

    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') this._emit('err', { t: 'err', msg: 'Room not found' });
      else if (!this.conn?.open) this._emit('err', { t: 'err', msg: 'Could not reach the room network — check your connection.' });
    });
    peer.on('disconnected', () => { if (!this._dead) peer.reconnect(); });
  }

  pickTeam(idx) {
    if (this.id === 0) { this.teams.set(0, idx); this._castRoster(); }
    else if (this.conn?.open) this.conn.send({ t: 'team', idx });
  }

  sendInput(d) { if (this.conn?.open) this.conn.send({ t: 'input', d }); }
}
