// Static server + LAN room relay for Pastel Pitch.
// The HOST BROWSER is authoritative for gameplay; this server only serves files
// and relays lobby/roster/input/state messages between host and joiners.
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3080;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// --- room relay ---------------------------------------------------------------

const wss = new WebSocketServer({ server });
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const makeCode = () => Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function castRoster(r) {
  const roster = [...r.names.entries()].map(([id, name]) => ({ id, name, team: r.teams.get(id) ?? null }));
  const msg = { t: 'roster', roster };
  send(r.host, msg);
  for (const c of r.clients.values()) send(c, msg);
}

wss.on('connection', (ws) => {
  ws._room = null;
  ws._id = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const room = rooms.get(ws._room);

    switch (m.t) {
      case 'create': {
        let code;
        do { code = makeCode(); } while (rooms.has(code));
        rooms.set(code, {
          code, host: ws, clients: new Map(), nextId: 1,
          names: new Map([[0, (m.name || 'HOST').slice(0, 14)]]),
          teams: new Map([[0, m.team ?? null]]),
        });
        ws._room = code;
        ws._id = 0;
        send(ws, { t: 'created', code });
        castRoster(rooms.get(code));
        break;
      }
      case 'join': {
        const r = rooms.get((m.code || '').toUpperCase().trim());
        if (!r) return send(ws, { t: 'err', msg: 'Room not found' });
        if (r.clients.size >= 15) return send(ws, { t: 'err', msg: 'Room full' });
        const id = r.nextId++;
        r.clients.set(id, ws);
        r.names.set(id, (m.name || `P${id}`).slice(0, 14));
        r.teams.set(id, null);
        ws._room = r.code;
        ws._id = id;
        send(ws, { t: 'joined', code: r.code, id });
        send(r.host, { t: 'join', id }); // let the host catch up a late joiner
        castRoster(r);
        break;
      }
      case 'team':
        if (room) { room.teams.set(ws._id, m.idx); castRoster(room); }
        break;
      case 'input': // joiner → host
        if (room && room.host !== ws) send(room.host, { t: 'input', from: ws._id, d: m.d });
        break;
      case 'avatar': // joiner → host: custom face image
        if (room && room.host !== ws) send(room.host, { t: 'avatar', from: ws._id, d: m.d });
        break;
      case 'customteam': // joiner → host: custom XI def
        if (room && room.host !== ws) send(room.host, { t: 'customteam', from: ws._id, def: m.def });
        break;
      case 'cast': { // host → everyone else
        if (!room || room.host !== ws) break;
        const s = JSON.stringify({ t: 'cast', d: m.d });
        for (const c of room.clients.values()) if (c.readyState === 1) c.send(s);
        break;
      }
      case 'to': // host → one joiner
        if (room && room.host === ws) send(room.clients.get(m.id), { t: 'cast', d: m.d });
        break;
    }
  });

  ws.on('close', () => {
    const r = rooms.get(ws._room);
    if (!r) return;
    if (r.host === ws) {
      for (const c of r.clients.values()) send(c, { t: 'cast', d: { k: 'hostleft' } });
      rooms.delete(r.code);
    } else {
      r.clients.delete(ws._id);
      r.names.delete(ws._id);
      r.teams.delete(ws._id);
      send(r.host, { t: 'left', id: ws._id });
      castRoster(r);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ⚽ Pastel Pitch`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`  LAN:     http://${i.address}:${PORT}  ← share this with joiners`);
    }
  }
  console.log('');
});
