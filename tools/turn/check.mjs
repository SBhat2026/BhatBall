#!/usr/bin/env node
// Health check for the BhatBall TURN relay (tools/turn/fly, coturn on Fly.io).
//
// Run this FIRST when Online Rooms "worked yesterday" and now hang: a stopped
// relay is invisible from the game — joins on strict networks just time out
// with no error. Probes STUN binding + TURN allocate over every transport the
// game's window.BHATBALL_ICE actually uses.
//
//   node tools/turn/check.mjs [host]
//
// Exit code 0 = every transport answered, 1 = something is down.
// If it fails:  fly status -a bhatball-turn   (start it if stopped, then allow
// ~30s before TCP/443 answers — coturn's aux listener comes up last).
import dgram from 'dgram';
import net from 'net';
import crypto from 'crypto';

const HOST = process.argv[2] || '77.83.142.36';
const TIMEOUT = 6000;

const stunHeader = (type, body = Buffer.alloc(0)) => {
  const h = Buffer.alloc(20);
  h.writeUInt16BE(type, 0);
  h.writeUInt16BE(body.length, 2);
  h.writeUInt32BE(0x2112a442, 4);
  crypto.randomBytes(12).copy(h, 8);
  return Buffer.concat([h, body]);
};
const binding = () => stunHeader(0x0001);
const allocate = () => {
  const a = Buffer.alloc(8);
  a.writeUInt16BE(0x0019, 0); // REQUESTED-TRANSPORT
  a.writeUInt16BE(4, 2);
  a.writeUInt32BE(0x11000000, 4); // UDP
  return stunHeader(0x0003, a); // unauthenticated → a live server answers 401
};

const udp = (port, msg) => new Promise((res) => {
  const s = dgram.createSocket('udp4');
  const t = setTimeout(() => { s.close(); res(null); }, TIMEOUT);
  s.on('message', (m) => { clearTimeout(t); s.close(); res(m); });
  s.on('error', () => { clearTimeout(t); res(null); });
  s.send(msg, port, HOST);
});

const tcp = (port, msg) => new Promise((res) => {
  const s = net.connect(port, HOST);
  const t = setTimeout(() => { s.destroy(); res(null); }, TIMEOUT);
  s.on('connect', () => s.write(msg));
  s.on('data', (d) => { clearTimeout(t); s.destroy(); res(d); });
  s.on('error', () => { clearTimeout(t); res(null); });
});

const checks = [
  ['STUN  udp/3478', () => udp(3478, binding())],
  ['TURN  udp/3478', () => udp(3478, allocate())],
  ['STUN  udp/443 ', () => udp(443, binding())],
  ['STUN  tcp/3478', () => tcp(3478, binding())],
  ['STUN  tcp/443 ', () => tcp(443, binding())],
];

console.log(`\n  TURN relay ${HOST}\n`);
let bad = 0;
for (const [label, run] of checks) {
  const reply = await run();
  if (reply) console.log(`  ✅ ${label}  reply 0x${reply.readUInt16BE(0).toString(16)}`);
  else { bad++; console.log(`  ❌ ${label}  no response`); }
}
console.log(bad
  ? `\n  ${bad} transport(s) down — check: fly status -a bhatball-turn\n`
  : '\n  Relay healthy — rooms will connect on strict networks.\n');
process.exit(bad ? 1 : 0);
