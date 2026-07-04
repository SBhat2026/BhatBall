// Replica renderer for LAN joiners/spectators: rigs + ball driven by host snapshots.
import * as THREE from 'three';
import { BALL } from './config.js';
import { SKIN_TONES } from './teams.js';
import { buildRig, animateRig } from './rig.js';
import { buildLineup } from './tactics.js';

export class NetView {
  constructor(scene, teamADef, teamBDef, mode, myKey) {
    this.scene = scene;
    this.myKey = myKey ?? null; // seat key ('H' or String(clientId)); null = spectator
    this.players = [];
    this.defs = { A: teamADef, B: teamBDef };

    const sizeKey = mode ?? '11';
    for (const def of [teamADef, teamBDef]) {
      const lineup = buildLineup(def, sizeKey);
      lineup.slots.forEach((slot, i) => {
        const isGK = slot.role === 'GK';
        const skin = SKIN_TONES[(Math.random() * SKIN_TONES.length) | 0];
        const entry = def.xi?.[slot.xi] ?? [i + 1, `${def.code} ${i + 1}`];
        const rig = buildRig(def, skin, isGK, { number: entry[0], captain: i === 6 });
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

    this.ballMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(BALL.r, 1),
      new THREE.MeshStandardMaterial({ color: '#f7f5f0', roughness: 0.85, metalness: 0, flatShading: true }),
    );
    this.ballMesh.castShadow = true;
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
    for (let i = 0; i < s.p.length && i < this.players.length; i++) {
      const [x, z, ry, spd, fx] = s.p[i];
      const p = this.players[i];
      p.tgt.set(x, 0, z);
      p.rotY = ry;
      p.speed = spd;
      // trigger one-shot animations on rising edge
      if ((fx & 1) && !(p.fx & 1)) p.rig.bicycleT = 1.05;
      if ((fx & 2) && !(p.fx & 2)) p.rig.slideT = 0.55;
      if ((fx & 4) && !(p.fx & 4)) p.rig.flickT = 0.4;
      if ((fx & 8) && !(p.fx & 8)) p.rig.finesseT = 0.55;
      p.fx = fx;
    }
    this.ballTgt.set(s.b[0], s.b[1], s.b[2]);
  }

  update(dt) {
    const k = 1 - Math.exp(-14 * dt);
    for (const p of this.players) {
      p.cur.lerp(p.tgt, k);
      p.rig.group.position.x = p.cur.x;
      p.rig.group.position.z = p.cur.z;
      p.rig.group.rotation.y = p.rotY;
      animateRig(p.rig, p.speed, dt);
    }
    this.ballCur.lerp(this.ballTgt, 1 - Math.exp(-18 * dt));
    this.ballMesh.position.copy(this.ballCur);

    const me = this.myIdx() >= 0 ? this.players[this.myIdx()] : null;
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
