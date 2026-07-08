// Serverless rooms over WebRTC (PeerJS + its free public signaling cloud).
// Drop-in replacement for the ws Net: same handler names and message shapes.
// The HOST BROWSER plays the role server.js used to play — it owns the roster,
// assigns ids, and relays casts — so the static site needs no server at all.
// window.Peer comes from vendor/peerjs.min.js (classic script in index.html).
//
// TWO DATA CHANNELS PER JOINER (this is the latency fix):
//   • 'evt'  — reliable + ordered. Carries the control plane: joined/roster/
//              team picks, fixture/start, goals, banners, brackets, end. These
//              MUST arrive and MUST arrive in order (a dropped 'start' = a
//              client stuck in the lobby), so retransmit + ordering are correct.
//   • 'rt'   — UNRELIABLE + unordered. Carries the high-frequency, self-
//              superseding traffic: host→client state snapshots (15–20Hz) and
//              client→host inputs (30Hz). Each snapshot fully replaces the last,
//              so retransmitting a lost one only delays the newer one behind it.
//              On a reliable channel a single late packet head-of-line-blocks
//              the whole stream → the rubber-banding you feel over TURN/cellular.
//              Unreliable delivery drops the stale packet and keeps moving.
// If the 'rt' channel never opens (rare NAT edge), snapshots/inputs fall back
// to the reliable 'evt' channel, so worst case is exactly the old behaviour.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const makeCode = () => Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
const peerId = (code) => `bhatball-room-${code}`;

// --- ICE (STUN + TURN) --------------------------------------------------------
// The PeerJS cloud only does *signalling* (code lookup). The actual data channel
// is a direct browser↔browser WebRTC connection, and that needs ICE servers to
// cross NATs. Without this, joiners on a different network find the room but the
// connection never reaches 'open' — they type the code and just hang.
//   • STUN lets peers on ordinary home routers discover their public address.
//   • TURN relays media for the hard cases (symmetric NAT, school/corporate
//     Wi-Fi, cellular) where a direct path is impossible. STUN alone will NOT
//     fix those — TURN is what makes remote joining actually reliable.
// The default below is STUN-only. STUN reliably fixes the common case (two
// ordinary home networks), which is the biggest win over having no ICE at all.
// There is deliberately NO TURN in the default: every "free public" TURN relay
// (OpenRelay, freeturn, etc.) is unauthenticated, rate-limited, and routinely
// dead — shipping one gives a false sense of reliability. For the hard cases
// (symmetric NAT, school/corporate Wi-Fi, cellular) you MUST supply your own
// TURN credentials. Do it without touching this file by defining, before the
// app's module scripts load in index.html:
//
//   window.BHATBALL_ICE = [
//     { urls: 'stun:stun.l.google.com:19302' },
//     { urls: 'turn:YOUR_HOST:3478', username: 'USER', credential: 'PASS' },
//   ];
//
// Get credentials free from Metered (metered.ca — 50GB/mo, real API-key creds),
// Twilio's NTS, or self-host coturn. Metered/Twilio also offer short-lived
// per-session credentials if you want to fetch them at runtime.
const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];
// Optionally fetch fresh, multi-region TURN credentials at runtime. Point
// window.BHATBALL_ICE_URL at an endpoint that returns either an ICE-server array
// or { iceServers: [...] } — e.g. Metered's free tier:
//   https://<subdomain>.metered.live/api/v1/turn/credentials?apiKey=<KEY>
// Metered's relays are geo-distributed, so a distant player connects through a
// nearby POP instead of hairpinning through one fixed box. Fetched servers are
// MERGED with any static window.BHATBALL_ICE (keep your own coturn as a floor).
let _fetchedIce = null;
async function fetchIce() {
  if (_fetchedIce) return _fetchedIce;
  const url = typeof window !== 'undefined' && window.BHATBALL_ICE_URL;
  if (!url) return null;
  try {
    const j = await (await fetch(url)).json();
    const list = Array.isArray(j) ? j : j?.iceServers;
    if (Array.isArray(list) && list.length) { _fetchedIce = list; return list; }
  } catch { /* fall back to static/default below */ }
  return null;
}
const iceServers = () => {
  const staticIce = (typeof window !== 'undefined' && Array.isArray(window.BHATBALL_ICE) && window.BHATBALL_ICE.length)
    ? window.BHATBALL_ICE : DEFAULT_ICE;
  return _fetchedIce ? [...staticIce, ..._fetchedIce] : staticIce;
};
const peerOpts = () => ({ config: { iceServers: iceServers() } });

// How long a joiner waits for the data channel to open before giving up.
const JOIN_TIMEOUT_MS = 20000;

export class RtcNet {
  constructor() {
    this.peer = null;
    this.conn = null;      // joiner → host, reliable control channel ('evt')
    this.connRt = null;    // joiner → host, unreliable realtime channel ('rt')
    this.id = null;
    this.code = null;
    this.handlers = {};    // t → fn(msg)
    // host room state (mirrors server.js)
    this.clients = new Map(); // id → record { id, evt, rt, name, team }
    this.peers = new Map();   // remote peerId → record (pairs the two channels)
    this._pendingRt = new Map(); // remote peerId → rt conn that opened before evt
    this.names = new Map();   // host self (id 0) only
    this.teams = new Map();
    this.nextId = 1;
    this._dead = false;
    this._joinTimer = null;
  }

  async connect() {
    if (typeof window === 'undefined' || !window.Peer) {
      throw new Error('PeerJS not loaded');
    }
    await fetchIce(); // best-effort: pull multi-region TURN creds if configured
  }

  on(t, fn) { this.handlers[t] = fn; }
  _emit(t, m) { this.handlers[t]?.(m); }

  close() {
    this._dead = true;
    clearTimeout(this._joinTimer);
    try { this.peer?.destroy(); } catch { /* already gone */ }
    this.peer = null;
  }

  // --- host ------------------------------------------------------------------

  create(name, team, _attempt = 0) {
    this._dead = false;
    const code = makeCode();
    const peer = this.peer = new window.Peer(peerId(code), peerOpts());

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
      // The 'rt' (unreliable realtime) channel just pairs onto an existing
      // client record — it never allocates an id or counts toward the room cap.
      if (conn.label === 'rt') {
        const rec = this.peers.get(conn.peer);
        if (rec) rec.rt = conn;
        else this._pendingRt.set(conn.peer, conn); // evt hasn't opened yet
        return;
      }
      // 'evt' (or a legacy single) channel = the client's control connection.
      if (this.clients.size >= 15) {
        conn.send({ t: 'err', msg: 'Room full' });
        setTimeout(() => conn.close(), 200);
        return;
      }
      const id = this.nextId++;
      const rec = {
        id, evt: conn,
        rt: this._pendingRt.get(conn.peer) || null,
        name: (conn.metadata?.name || `P${id}`).slice(0, 14),
        team: null,
      };
      this._pendingRt.delete(conn.peer);
      this.clients.set(id, rec);
      this.peers.set(conn.peer, rec);
      conn.send({ t: 'joined', code: this.code, id });
      this._castRoster();
      this._emit('join', { t: 'join', id }); // lets the host resend a live fixture
    });
    conn.on('data', (m) => this._hostData(conn, m));
    const drop = () => this._hostDrop(conn);
    conn.on('close', drop);
    conn.on('error', drop);
  }

  _hostData(conn, m) {
    if (!m) return;
    const rec = this.peers.get(conn.peer);
    if (!rec) return; // rt packet arrived before the client's evt handshake
    if (m.t === 'team') { rec.team = m.idx; this._castRoster(); }
    else if (m.t === 'input') this._emit('input', { t: 'input', from: rec.id, d: m.d });
  }

  _hostDrop(conn) {
    // Losing only the 'rt' channel is survivable: snapshots fall back to 'evt'.
    const pend = this._pendingRt.get(conn.peer);
    if (pend === conn) { this._pendingRt.delete(conn.peer); return; }
    const rec = this.peers.get(conn.peer);
    if (!rec) return;
    if (rec.rt === conn && rec.evt !== conn) { rec.rt = null; return; }
    // The control channel dropped → the client is gone.
    this.clients.delete(rec.id);
    this.peers.delete(conn.peer);
    try { rec.rt?.close(); } catch { /* already gone */ }
    this._emit('left', { t: 'left', id: rec.id });
    this._castRoster();
  }

  _castRoster() {
    const roster = [{ id: 0, name: this.names.get(0), team: this.teams.get(0) ?? null }];
    for (const rec of this.clients.values()) roster.push({ id: rec.id, name: rec.name, team: rec.team ?? null });
    roster.sort((a, b) => a.id - b.id);
    const msg = { t: 'roster', roster };
    this._emit('roster', msg);
    for (const rec of this.clients.values()) this._sendEvt(rec, msg);
  }

  _sendEvt(rec, msg) { if (rec.evt?.open) rec.evt.send(msg); }

  // Snapshots (k:'snap') go over the unreliable 'rt' channel when it's up;
  // everything else — and the fallback — uses the reliable 'evt' channel.
  cast(d) {
    const realtime = d && d.k === 'snap';
    for (const rec of this.clients.values()) {
      if (realtime && rec.rt?.open) rec.rt.send({ t: 'cast', d });
      else if (rec.evt?.open) rec.evt.send({ t: 'cast', d });
    }
  }

  to(id, d) { const rec = this.clients.get(id); if (rec?.evt?.open) rec.evt.send({ t: 'cast', d }); }

  // --- joiner ------------------------------------------------------------------

  join(code, name) {
    this._dead = false;
    const clean = (code || '').toUpperCase().trim();
    const nm = (name || 'Player').slice(0, 14);
    const peer = this.peer = new window.Peer(undefined, peerOpts());

    // If the data channel never opens (blocked by NAT/firewall with no TURN
    // path), don't hang forever — surface a real error the joiner can act on.
    let opened = false;
    this._joinTimer = setTimeout(() => {
      if (opened || this._dead) return;
      this._emit('err', {
        t: 'err',
        msg: 'Could not connect to the host — your network may be blocking it. Try again, or have everyone join from the same Wi-Fi.',
      });
      this.close();
    }, JOIN_TIMEOUT_MS);

    peer.on('open', () => {
      // Reliable control channel — the handshake + all lobby/scoring events.
      const conn = this.conn = peer.connect(peerId(clean), {
        reliable: true, label: 'evt', metadata: { name: nm },
      });
      conn.on('open', () => { opened = true; clearTimeout(this._joinTimer); });
      conn.on('data', (m) => { if (m?.t) this._emit(m.t, m); });
      conn.on('close', () => { if (!this._dead) this._emit('close', {}); });
      conn.on('error', () => { if (!this._dead && !opened) this._emit('err', { t: 'err', msg: 'Connection to the host failed. Please try again.' }); });

      // Unreliable realtime channel — snapshots down, inputs up. Best-effort:
      // if it fails we simply keep using the reliable channel for these.
      const rt = this.connRt = peer.connect(peerId(clean), {
        reliable: false, label: 'rt', metadata: { name: nm },
      });
      rt.on('data', (m) => { if (m?.t) this._emit(m.t, m); });
      rt.on('error', () => { /* fall back to reliable conn */ });
    });

    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') { clearTimeout(this._joinTimer); this._emit('err', { t: 'err', msg: 'Room not found' }); }
      else if (!this.conn?.open) this._emit('err', { t: 'err', msg: 'Could not reach the room network — check your connection.' });
    });
    peer.on('disconnected', () => { if (!this._dead) peer.reconnect(); });
  }

  pickTeam(idx) {
    if (this.id === 0) { this.teams.set(0, idx); this._castRoster(); }
    else if (this.conn?.open) this.conn.send({ t: 'team', idx });
  }

  sendInput(d) {
    if (this.connRt?.open) this.connRt.send({ t: 'input', d });
    else if (this.conn?.open) this.conn.send({ t: 'input', d });
  }
}
