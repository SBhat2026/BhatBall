// Replica renderer for LAN joiners/spectators: rigs + ball driven by host snapshots.
import * as THREE from 'three';
import { BALL } from './config.js';
import { SKIN_TONES } from './teams.js';
import { buildRig, animateRig } from './rig.js';

export class NetView {
  constructor(scene, teamADef, teamBDef, mySide) {
    this.scene = scene;
    this.mySide = mySide; // 'A' | 'B' | null (spectator)
    this.players = [];
    this.defs = { A: teamADef, B: teamBDef };

    for (const [def, count] of [[teamADef, 11], [teamBDef, 11]]) {
      for (let i = 0; i < count; i++) {
        const isGK = i === 0;
        const skin = SKIN_TONES[(Math.random() * SKIN_TONES.length) | 0];
        const entry = def.xi?.[i] ?? [i + 1, `${def.code} ${i + 1}`];
        const rig = buildRig(def, skin, isGK, { number: entry[0], captain: i === 6 });
        this.scene.add(rig.group);
        this.players.push({
          rig,
          name: entry[1],
          cur: new THREE.Vector3(), tgt: new THREE.Vector3(),
          rotY: 0, speed: 0, fx: 0,
        });
      }
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

    if (this.snap) {
      const myIdx = this.mySide === 'A' ? this.snap.ctA : this.mySide === 'B' ? 11 + this.snap.ctB : -1;
      const me = myIdx >= 0 ? this.players[myIdx] : null;
      this.marker.visible = !!me;
      if (me) {
        this.marker.position.set(me.cur.x, 0.06, me.cur.z);
        this.playerProxy.pos.copy(me.cur);
      }
    }
  }

  // minimal minimap data provider matching drawMinimap's expectations
  minimapData() {
    return {
      a: this.players.slice(0, 11).map((p) => p.cur),
      b: this.players.slice(11).map((p) => p.cur),
      ball: this.ballCur,
    };
  }
}
