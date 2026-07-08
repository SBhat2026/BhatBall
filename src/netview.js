// Replica renderer for LAN joiners/spectators: rigs + ball driven by host snapshots.
import * as THREE from 'three';
import { BALL, FIELD, PLAYER, damp } from './config.js';
import { playerLook, resolveKits } from './teams.js';
import { buildRig, animateRig } from './rig.js';
import { buildLineup } from './tactics.js';
import { buildBallMesh } from './balls.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// shortest-arc angle interpolation so rotations don't spin the long way around
const angLerp = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const _vt = new THREE.Vector3(); // scratch: predicted target velocity
// Render this far behind the newest snapshot. With ~20Hz snapshots (50ms apart)
// a ~110ms buffer keeps two real snapshots on hand to interpolate between, so
// one lost/late packet doesn't stall — motion stays smooth at constant latency
// instead of the rubber-band you get from chasing only the latest target.
const RENDER_DELAY = 0.11;

export class NetView {
  constructor(scene, teamADef, teamBDef, mode, myKey, ballStyle) {
    this.scene = scene;
    this.myKey = myKey ?? null; // seat key ('H' or String(clientId)); null = spectator
    this.players = [];
    this.defs = { A: teamADef, B: teamBDef };

    const sizeKey = mode ?? '11';
    const kits = resolveKits(teamADef, teamBDef);
    this.kits = kits;
    for (const def of [teamADef, teamBDef]) {
      const lineup = buildLineup(def, sizeKey);
      const kit = def === teamADef ? kits.a : kits.b;
      lineup.slots.forEach((slot, i) => {
        const isGK = slot.role === 'GK';
        const entry = def.xi?.[slot.xi] ?? [i + 1, `${def.code} ${i + 1}`];
        const look = playerLook(entry[1]);
        const rig = buildRig(kit, look.skin, isGK, { number: entry[0], captain: i === 6, name: entry[1], hairColor: look.hair });
        this.scene.add(rig.group);
        this.players.push({
          rig,
          name: entry[1],
          cur: new THREE.Vector3(slot.x, 0, slot.z), tgt: new THREE.Vector3(slot.x, 0, slot.z),
          rotY: 0, speed: 0, fx: 0,
        });
      });
      if (def === teamADef) this.aCount = lineup.slots.length;
    }

    this.ballMesh = buildBallMesh(ballStyle);
    scene.add(this.ballMesh);
    this.ballCur = new THREE.Vector3(0, BALL.r, 0);
    this.ballTgt = new THREE.Vector3(0, BALL.r, 0);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.78, 28),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.marker = ring;
    scene.add(ring);

    this.snap = null;
    this.buf = []; // interpolation buffer: [{ t, p, b }] timestamped on arrival
    // Client-side prediction of the LOCAL player (mirrors the host's human
    // movement model) so your own avatar responds instantly instead of lagging
    // a full round-trip; reconciled toward the newest authoritative snapshot.
    this.pred = null;          // { pos, vel, heading }
    this.predictEnabled = true;
    // ball proxy so GameCamera can follow it
    this.ballProxy = { pos: this.ballCur };
    this.playerProxy = { pos: new THREE.Vector3(), heading: new THREE.Vector3(1, 0, 0) };
  }

  myIdx() {
    const ct = this.snap?.ct;
    if (!ct || this.myKey == null || !(this.myKey in ct)) return -1;
    return ct[this.myKey];
  }

  myName() {
    const i = this.myIdx();
    return i >= 0 ? this.players[i]?.name ?? null : null;
  }

  applySnapshot(s) {
    this.snap = s;
    // Fire one-shot animations off the freshest data (a few ms of timing offset
    // on a flick/dive is imperceptible; positions are what get interpolated).
    for (let i = 0; i < s.p.length && i < this.players.length; i++) {
      const fx = s.p[i][4];
      const p = this.players[i];
      if ((fx & 1) && !(p.fx & 1)) p.rig.bicycleT = 1.05;
      if ((fx & 2) && !(p.fx & 2)) p.rig.slideT = 0.55;
      if ((fx & 4) && !(p.fx & 4)) p.rig.flickT = 0.4;
      if ((fx & 8) && !(p.fx & 8)) p.rig.finesseT = 0.55;
      if ((fx & 16) && !(p.fx & 16)) p.rig.throwT = 0.45;
      if ((fx & 32) && !(p.fx & 32)) p.rig.kickT = 0.32;
      if ((fx & 64) && !(p.fx & 64)) p.rig.chipT = 0.4;
      if ((fx & 256) && !(p.fx & 256)) { p.rig.diveT = 0.62; p.rig.diveDir = (fx & 512) ? 1 : -1; }
      if ((fx & 1024) && !(p.fx & 1024)) p.rig.headT = 0.42;
      p.rig.holdBall = !!(fx & 128);
      p.fx = fx;
    }
    // Timestamp on arrival and push into the interpolation buffer; trim history.
    const now = performance.now() / 1000;
    this.buf.push({ t: now, p: s.p, b: s.b });
    while (this.buf.length > 2 && this.buf[1].t < now - 1) this.buf.shift();
  }

  // intent: { dir:{x,z}, sprint } for the locally-controlled player, or null
  // (spectator / not playing) to interpolate every avatar straight.
  update(dt, intent = null) {
    const mi = this.myIdx();
    const doPredict = this.predictEnabled && intent && mi >= 0;

    // Render at (now - RENDER_DELAY), interpolating between the two snapshots
    // that straddle that render time. If we've starved (no fresh snapshot), the
    // pair collapses to the newest and we hold rather than drift/extrapolate.
    const buf = this.buf;
    if (buf.length) {
      const rt = performance.now() / 1000 - RENDER_DELAY;
      let i = buf.length - 1;
      while (i > 0 && buf[i].t > rt) i--;
      const A = buf[i];
      const B = buf[Math.min(i + 1, buf.length - 1)];
      const alpha = B.t > A.t ? clamp((rt - A.t) / (B.t - A.t), 0, 1) : 0;
      for (let k = 0; k < this.players.length; k++) {
        const pa = A.p[k]; const pb = B.p[k];
        if (!pa) continue;
        const p = this.players[k];
        const x = pa[0] + (pb[0] - pa[0]) * alpha;
        const z = pa[1] + (pb[1] - pa[1]) * alpha;
        p.cur.set(x, 0, z); // authoritative (interpolated) position
        // The predicted local player is placed + animated below; skip it here so
        // animateRig isn't advanced twice in one frame.
        if (k === mi && doPredict) continue;
        p.rig.group.position.x = x;
        p.rig.group.position.z = z;
        p.rig.group.rotation.y = angLerp(pa[2], pb[2], alpha);
        animateRig(p.rig, pa[3] + (pb[3] - pa[3]) * alpha, dt);
      }
      this.ballCur.set(
        A.b[0] + (B.b[0] - A.b[0]) * alpha,
        A.b[1] + (B.b[1] - A.b[1]) * alpha,
        A.b[2] + (B.b[2] - A.b[2]) * alpha,
      );
      this.ballMesh.position.copy(this.ballCur);
    }

    const me = mi >= 0 ? this.players[mi] : null;

    if (doPredict && me) {
      const authRotY = me.rig.group.rotation.y; // last interpolated facing (idle)
      if (!this.pred) this.pred = { pos: me.cur.clone(), vel: new THREE.Vector3(), heading: authRotY };
      const pr = this.pred;
      // Same model the host runs for a human seat: ease velocity toward dir*speed.
      const sp = intent.sprint ? PLAYER.sprint : PLAYER.speed;
      _vt.set(intent.dir.x * sp, 0, intent.dir.z * sp);
      pr.vel.lerp(_vt, damp(9, dt));
      pr.pos.x = clamp(pr.pos.x + pr.vel.x * dt, -FIELD.halfL - 2, FIELD.halfL + 2);
      pr.pos.z = clamp(pr.pos.z + pr.vel.z * dt, -FIELD.halfW - 2, FIELD.halfW + 2);
      // Reconcile toward the NEWEST snapshot (only network-RTT stale, not the
      // full render delay). Soft normally; hard when far off — a tackle, stun,
      // possession grab or set piece the client can't predict teleports us back.
      const snapMe = this.snap?.p?.[mi];
      const ax = snapMe ? snapMe[0] : me.cur.x;
      const az = snapMe ? snapMe[1] : me.cur.z;
      const err = Math.hypot(ax - pr.pos.x, az - pr.pos.z);
      const corr = err > 2.5 ? damp(16, dt) : damp(2.6, dt);
      pr.pos.x += (ax - pr.pos.x) * corr;
      pr.pos.z += (az - pr.pos.z) * corr;
      // Face movement while running (host convention), else hold last facing.
      if (pr.vel.lengthSq() > 0.36) pr.heading = Math.atan2(pr.vel.x, pr.vel.z);
      me.cur.copy(pr.pos);
      me.rig.group.position.x = pr.pos.x;
      me.rig.group.position.z = pr.pos.z;
      me.rig.group.rotation.y = pr.heading;
      animateRig(me.rig, Math.hypot(pr.vel.x, pr.vel.z), dt);
    } else if (this.pred) {
      this.pred = null; // stopped controlling — drop stale prediction state
    }

    this.marker.visible = !!me;
    if (me) {
      this.marker.position.set(me.cur.x, 0.06, me.cur.z);
      this.playerProxy.pos.copy(me.cur);
    }
  }

  // minimal minimap data provider matching drawMinimap's expectations
  minimapData() {
    return {
      a: this.players.slice(0, this.aCount).map((p) => p.cur),
      b: this.players.slice(this.aCount).map((p) => p.cur),
      ball: this.ballCur,
    };
  }
}
