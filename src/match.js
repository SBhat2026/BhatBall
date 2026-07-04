import * as THREE from 'three';
import { FIELD, BALL, PLAYER, DIFFICULTY, MATE_DIFF, clamp, damp, rand } from './config.js';
import { SKIN_TONES } from './teams.js';
import { buildLineup, ROLE_ATT } from './tactics.js';
import { buildRig, animateRig } from './rig.js';
import { Ball } from './ball.js';
import { gkUpdate } from './ai.js';
import { updateBrains, decideOnBall } from './brain.js';
import { Scout } from './scout.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

const IDLE_INPUT = { moveDir: () => ({ x: 0, z: 0 }), sprinting: () => false, charging: null, chargePower: () => 0 };

function distXZ(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

// spin about the lateral axis: positive = topspin (runs on landing), negative = backspin (sits down)
function latSpin(vx, vz, amt) {
  const len = Math.hypot(vx, vz);
  if (len < 0.01) return null;
  return new THREE.Vector3((vz / len) * amt, 0, (-vx / len) * amt);
}

export class Match {
  // opts: { teamADef, teamBDef, diffKey, lengthMin, goldenGoal, sizeKey,
  //         seats: [{key, side, idx?}], controlled (legacy {A,B}), hooks }
  constructor(scene, opts) {
    this.scene = scene;
    this.opts = opts;
    this.hooks = opts.hooks;
    this.lengthMin = opts.lengthMin;
    this.halfLen = (opts.lengthMin * 60) / 2;
    this.goldenGoal = !!opts.goldenGoal;
    this.golden = false;
    this.sizeKey = opts.sizeKey ?? '11';

    this.ball = new Ball(scene);
    this.teamA = this._makeTeam(opts.teamADef, 1, MATE_DIFF, 'A');
    this.teamB = this._makeTeam(opts.teamBDef, -1, DIFFICULTY[opts.diffKey], 'B');

    // seats: human-controlled players. 'H' = the host keyboard.
    this.seats = {};      // key → player
    this.seatSide = {};   // key → 'A' | 'B'
    let seatCfg = opts.seats;
    if (!seatCfg) {
      const ctl = opts.controlled ?? { A: this.teamA.kickerIdx, B: null };
      seatCfg = [];
      if (ctl.A != null) seatCfg.push({ key: 'H', side: 'A', idx: ctl.A });
      if (ctl.B != null) seatCfg.push({ key: 'B', side: 'B', idx: ctl.B });
    }
    for (const s of seatCfg) this._setHuman(s.key, s.side, s.idx ?? this.team(s.side).kickerIdx);

    // scouting: any side with humans gets studied by the opposing AI
    this.scouts = [];
    const coach = (msg) => this.hooks.coach?.(msg);
    if (Object.values(this.seatSide).includes('A')) this.scouts.push(new Scout(this.teamA, this.teamB, coach));
    if (Object.values(this.seatSide).includes('B')) this.scouts.push(new Scout(this.teamB, this.teamA, coach));

    this.scoreA = 0;
    this.scoreB = 0;
    this.half = 1;
    this.elapsed = 0;
    this.state = 'KICKOFF';
    this.stateT = 1.2;
    this.controller = null;
    this.controllerTeam = null;
    this.owner = null;
    this.lock = { team: null, t: 0 };
    this.setPiece = null;
    this.pendingStrike = null;
    this.transTeam = null;
    this.transT = 99;
    this._zoneT = 0;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.78, 28),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    this.marker = ring;
    scene.add(ring);

    this._layout(this.teamA);
    this.ball.reset(0, 0);
  }

  _makeTeam(def, dir, diff, key) {
    const lineup = buildLineup(def, this.sizeKey);
    const team = {
      def, dir, diff, key, players: [],
      style: lineup.style, kickerIdx: lineup.kicker,
      adapt: { shiftZ: 0, closeDown: 0, lineDrop: 0, wideDeep: 0, tackleBoost: 0 },
      policyNet: null,
    };
    team.aggro = diff.tackleAggro * (0.7 + 0.6 * lineup.style.aggression);
    lineup.slots.forEach((slot, i) => {
      const isGK = slot.role === 'GK';
      const skin = SKIN_TONES[(Math.random() * SKIN_TONES.length) | 0];
      const entry = def.xi?.[slot.xi] ?? [i + 1, `${def.code} ${i + 1}`];
      const rig = buildRig(def, skin, isGK, { number: entry[0], captain: i === 6 });
      this.scene.add(rig.group);
      team.players.push({
        team, idx: i, role: slot.role, isGK, isHuman: false, seatKey: null,
        num: entry[0], name: entry[1],
        base: { x: slot.x, z: slot.z },
        rig,
        pos: rig.group.position,
        vel: new THREE.Vector3(),
        heading: new THREE.Vector3(dir, 0, 0),
        target: new THREE.Vector3(),
        urgency: 0.75, act: 'anchor', markT: null,
        aiT: 0, kickCd: 0, touchCd: 0, ownerT: 0,
        tackleT: 0, stunT: 0, holdT: 0,
        lungeDir: new THREE.Vector3(),
      });
    });
    return team;
  }

  team(key) { return key === 'A' ? this.teamA : this.teamB; }
  opponentsOf(team) { return (team === this.teamA ? this.teamB : this.teamA).players; }
  otherTeam(team) { return team === this.teamA ? this.teamB : this.teamA; }
  // compat convenience: first human on a side / single-player hero
  humanOnSide(side) {
    for (const [k, p] of Object.entries(this.seats)) if (this.seatSide[k] === side) return p;
    return null;
  }
  get human() { return this.seats.H ?? null; }
  get humans() { return { A: this.humanOnSide('A'), B: this.humanOnSide('B') }; }

  _setHuman(key, side, idx) {
    const team = this.team(side);
    const p = team.players[idx];
    if (!p || p.isGK) return false;
    // street: one player per person, no doubling up
    for (const [k, q] of Object.entries(this.seats)) {
      if (k !== key && q === p) return false;
    }
    const prev = this.seats[key];
    if (prev) { prev.isHuman = false; prev.seatKey = null; }
    p.isHuman = true;
    p.seatKey = key;
    this.seats[key] = p;
    this.seatSide[key] = side;
    return true;
  }

  // Tab-menu switching (11v11 only — street locks you to your player)
  switchControlled(key, idx) {
    if (this.sizeKey !== '11') return false;
    const side = this.seatSide[key] ?? (key === 'H' ? 'A' : null);
    if (!side) return false;
    const ok = this._setHuman(key, side, idx);
    if (ok) this.hooks.sfx?.('switch');
    return ok;
  }

  _seatKeyOf(p) { return p.seatKey; }
  _scoutFor(team) { return this.scouts.find((s) => s.subject === team) ?? null; }

  // --- kickoff / restarts -------------------------------------------------

  _layout(kickingTeam) {
    for (const team of [this.teamA, this.teamB]) {
      for (const p of team.players) {
        let x = team.dir * p.base.x;
        let z = p.base.z;
        if (team === kickingTeam && p.idx === team.kickerIdx) { x = -team.dir * 1.2; z = 0; }
        p.pos.set(x, 0, z);
        p.vel.set(0, 0, 0);
        p.heading.set(team.dir, 0, 0);
        p.target.set(x, 0, z);
        p.aiT = 0; p.kickCd = 0; p.touchCd = 0;
        p.tackleT = 0; p.stunT = 0; p.holdT = 0;
        p.rig.bicycleT = 0; p.rig.slideT = 0; p.rig.flickT = 0; p.rig.finesseT = 0;
        p.rig.group.rotation.set(0, Math.atan2(team.dir, 0), 0);
      }
    }
    this.ball.reset(0, 0);
    this.lock = { team: kickingTeam, t: 1.5 };
  }

  kickoff(kickingTeam) {
    this._layout(kickingTeam);
    this.state = 'KICKOFF';
    this.stateT = 1.2;
    this.setPiece = null;
    this.pendingStrike = null;
    this.hooks.sfx?.('whistle', 1);
  }

  kickBall(p, vx, vy, vz, spin, isDribble = false, isShot = false) {
    _v.set(vx, vy, vz);
    this.ball.kick(p, _v, spin, isShot);
    if (isDribble) p.kickCd = 0;
    p.touchCd = isDribble ? 0.16 : 0.1;
    const sp = Math.hypot(vx, vy, vz);
    this.hooks.sfx?.(isDribble ? 'touch' : 'kick', Math.min(1, sp / 26));
  }

  tackle(p) {
    if (p.tackleT > 0 || p.stunT > 0 || p.kickCd > 0.3) return;
    _v.set(this.ball.pos.x - p.pos.x, 0, this.ball.pos.z - p.pos.z);
    if (_v.lengthSq() < 0.01) _v.copy(p.heading);
    p.lungeDir.copy(_v.normalize());
    p.tackleT = 0.5;
    p.rig.slideT = 0.55;
  }

  // --- set pieces -----------------------------------------------------------

  enterSetPiece(kind, team, x, z) {
    const { halfL, halfW } = FIELD;
    const K = halfL / 52.5;
    x = clamp(x, -halfL + 0.2, halfL - 0.2);
    z = clamp(z, -halfW + 0.2, halfW - 0.2);
    if (kind === 'penalty') { x = team.dir * (halfL - FIELD.penSpot); z = 0; }
    this.ball.reset(x, z);
    this.state = 'SETPIECE';

    // taker: nearest human seat on this team, else closest outfielder (GK for goal kicks)
    let taker = null;
    if (kind === 'goalkick') taker = team.players[0];
    else {
      let bd = 1e9;
      for (const [k, p] of Object.entries(this.seats)) {
        if (this.seatSide[k] !== team.key) continue;
        const d = distXZ(p.pos, this.ball.pos);
        if (d < bd) { bd = d; taker = p; }
      }
      if (!taker) {
        bd = 1e9;
        for (const p of team.players) {
          if (p.isGK) continue;
          const d = distXZ(p.pos, this.ball.pos);
          if (d < bd) { bd = d; taker = p; }
        }
      }
    }
    this.setPiece = { kind, team, taker, t: 0, ready: false };

    // setup targets
    const def = this.otherTeam(team);
    const goalX = team.dir * halfL; // goal being attacked
    const behind = kind === 'penalty' ? 2.2 : 1.1;
    _v.set(Math.sign(-goalX + x) || -team.dir, 0, 0); // step back from goal direction
    taker.target.set(x + _v.x * behind, 0, z + (kind === 'corner' ? -Math.sign(z) * 1.2 : 0));
    taker.pos.copy(taker.target); // taker jogs over off-camera — snap to spot
    taker.vel.set(0, 0, 0);
    taker.heading.set(team.dir, 0, 0);

    const inRange = Math.abs(goalX - x) < 32 * K;
    const maxWall = this.sizeKey === '11' ? 3 : 2;
    let wallCount = 0;
    for (const t2 of [this.teamA, this.teamB]) {
      for (const p of t2.players) {
        if (p === taker) continue;
        if (p.isGK) { p.target.set(-p.team.dir * (halfL - 1.3), 0, 0); continue; }
        if (kind === 'penalty') {
          // everyone waits on the edge of the box
          p.target.set(goalX - team.dir * (FIELD.boxL + 2 + rand(0, 4)), 0, rand(-FIELD.boxHalfW * 0.8, FIELD.boxHalfW * 0.8));
        } else if (kind === 'corner' || (kind === 'freekick' && inRange)) {
          if (p.team === team && ROLE_ATT[p.role] > 0.3) {
            p.target.set(goalX - team.dir * rand(4, 11) * K, 0, rand(-8, 8) * K); // crash the box
          } else if (p.team === def && kind === 'freekick' && ROLE_ATT[p.role] < 0.75 && wallCount < maxWall) {
            // defensive wall, 9.15m along the ball→goal line
            wallCount++;
            const dx = goalX - x, dz = -z;
            const dl = Math.hypot(dx, dz) || 1;
            const wd = Math.min(9.15, dl * 0.5);
            p.target.set(x + (dx / dl) * wd, 0, z + (dz / dl) * wd + (wallCount - (maxWall + 1) / 2) * 0.85);
          } else if (p.team === def) {
            p.target.set(goalX - team.dir * rand(3, 10) * K, 0, rand(-10, 10) * K); // mark up
          } else {
            p.target.set(p.base.x * team.dir + 10 * team.dir * K, 0, p.base.z);
          }
        } else {
          // goal kick / deep free kick: spread back out
          p.target.set(p.team.dir * p.base.x + this.ball.pos.x * 0.2, 0, p.base.z);
        }
        p.target.x = clamp(p.target.x, -halfL + 1, halfL - 1);
        p.target.z = clamp(p.target.z, -halfW + 1, halfW - 1);
      }
    }

    const label = { corner: 'CORNER', goalkick: 'GOAL KICK', freekick: 'FREE KICK', penalty: 'PENALTY!' }[kind];
    this.hooks.banner(label, kind === 'penalty' ? 2000 : 1100);
    this.hooks.sfx?.('whistle', 1);
  }

  _setPieceUpdate(dt, inputs, events) {
    const sp = this.setPiece;
    sp.t += dt;
    sp.ready = sp.t > 1.4;

    // walk everyone to their spots
    for (const team of [this.teamA, this.teamB]) {
      for (const p of team.players) {
        _v.set(p.target.x - p.pos.x, 0, p.target.z - p.pos.z);
        const d = _v.length();
        if (d > 0.1) {
          _v.multiplyScalar(Math.min(6, d * 3) / d);
          p.vel.lerp(_v, damp(7, dt));
        } else p.vel.multiplyScalar(Math.max(0, 1 - 8 * dt));
        p.pos.x += p.vel.x * dt;
        p.pos.z += p.vel.z * dt;
        if (p.vel.lengthSq() > 0.36) p.heading.copy(p.vel).normalize();
      }
    }
    this.ball.mesh.position.copy(this.ball.pos);

    if (!sp.ready) return;

    const seatKey = this._seatKeyOf(sp.taker);
    if (seatKey && sp.t < 9) {
      // face the play
      sp.taker.heading.set(sp.team.dir, 0, 0);
      const evts = events[seatKey] ?? [];
      const input = inputs[seatKey] ?? IDLE_INPUT;
      for (const e of evts) {
        if (e.type === 'pass' || e.type === 'through') this._takePass(sp, input, e);
        else if (e.type === 'chip') this._takeCross(sp);
        else if (e.type === 'shoot' || e.type === 'finesse') this._takeShot(sp, input, e.power ?? 0.6, e.type === 'finesse');
      }
    } else if (!seatKey || sp.t >= 9) {
      this._aiTake(sp);
    }
  }

  _resumeFromSetPiece(sp) {
    this.setPiece = null;
    this.state = 'PLAY';
    this.lock = { team: sp.team, t: 0.7 };
  }

  _takePass(sp, input, e) {
    const h = sp.taker;
    const mate = this._passTargetFor(h, input ?? IDLE_INPUT, 4, 40, e.type === 'through');
    if (!mate) return;
    const d = distXZ(mate.pos, h.pos);
    const spd = clamp(7 + d * 0.9, 9, 24);
    const ang = Math.atan2(mate.pos.z - h.pos.z, mate.pos.x - h.pos.x);
    this.kickBall(h, Math.cos(ang) * spd, 0, Math.sin(ang) * spd, null);
    this.ball.intendedReceiver = mate;
    this._resumeFromSetPiece(sp);
  }

  _takeCross(sp) {
    const h = sp.taker;
    const K = FIELD.halfL / 52.5;
    const goalX = sp.team.dir * FIELD.halfL;
    const tx = goalX - sp.team.dir * rand(6, 10.5) * K;
    const tz = rand(-6, 6) * K;
    const d = Math.hypot(tx - h.pos.x, tz - h.pos.z);
    const T = clamp(d / 15, 0.7, 1.6);
    const vx = (tx - h.pos.x) / T, vz = (tz - h.pos.z) / T;
    this.kickBall(h, vx, (BALL.g * T) / 2, vz, latSpin(vx, vz, -5.5));
    // aim for the best-placed attacker in the box
    let best = null, bd = 1e9;
    for (const p of sp.team.players) {
      if (p === h || p.isGK) continue;
      const dd = Math.hypot(p.pos.x - tx, p.pos.z - tz);
      if (dd < bd) { bd = dd; best = p; }
    }
    this.ball.intendedReceiver = best;
    this._resumeFromSetPiece(sp);
  }

  _takeShot(sp, input, power, finesse) {
    const h = sp.taker;
    const goalX = sp.team.dir * FIELD.halfL;
    const dGoal = Math.hypot(goalX - h.pos.x, h.pos.z);
    const K = FIELD.halfL / 52.5;
    if (sp.kind === 'penalty') {
      const zCap = FIELD.goalHalf - 0.55;
      const aimZ = clamp((input ?? IDLE_INPUT).moveDir().z * (zCap * 0.94), -zCap, zCap);
      const spd = 19 + 5 * power;
      const err = power > 0.85 ? rand(-0.08, 0.08) : rand(-0.02, 0.02);
      const ang = Math.atan2(aimZ - h.pos.z, goalX - h.pos.x) + err;
      // keeper picks a side — guess wrong and he's rooted
      const gk = this.otherTeam(sp.team).players[0];
      if (Math.random() < 0.5) gk.kickCd = 0.7;
      this.kickBall(h, Math.cos(ang) * spd, spd * (0.04 + power * 0.07), Math.sin(ang) * spd, null, false, true);
    } else {
      if (dGoal > 34 * K) return; // too far — pass or cross instead
      const side = Math.sign(h.pos.z || 1);
      const spin = new THREE.Vector3(0, (finesse ? 6 : 3.5) * side * sp.team.dir, 0);
      const spd = finesse ? 19.5 : 17 + 8 * power;
      const aimZ = -side * FIELD.goalHalf * 0.66;
      const ang = Math.atan2(aimZ - h.pos.z, goalX - h.pos.x) + rand(-0.03, 0.03);
      // enough lift to clear the wall
      this.kickBall(h, Math.cos(ang) * spd, spd * 0.15, Math.sin(ang) * spd, spin, false, true);
    }
    this._resumeFromSetPiece(sp);
  }

  _aiTake(sp) {
    const K = FIELD.halfL / 52.5;
    const goalX = sp.team.dir * FIELD.halfL;
    const x = this.ball.pos.x, z = this.ball.pos.z;
    const dGoal = Math.hypot(goalX - x, z);
    if (sp.kind === 'penalty') this._takeShot(sp, null, 0.6, false);
    else if (sp.kind === 'corner') this._takeCross(sp);
    else if (sp.kind === 'freekick' && dGoal < 27 * K && Math.abs(z) < 16 * K) this._takeShot(sp, null, 0.55, true);
    else if (sp.kind === 'goalkick' && Math.random() < 0.45) this._takePass(sp, null, { type: 'pass' });
    else if (sp.kind === 'goalkick') {
      const dir = _v.set(sp.team.dir, 0, rand(-0.5, 0.5)).normalize();
      this.kickBall(sp.taker, dir.x * 25, 10, dir.z * 25, null);
      this._resumeFromSetPiece(sp);
    } else this._takeCross(sp);
  }

  _passTargetFor(h, input, minD, maxD, preferForward = false) {
    const m = input.moveDir();
    const aimX = (m.x || m.z) ? m.x : h.heading.x;
    const aimZ = (m.x || m.z) ? m.z : h.heading.z;
    let best = null, bestScore = -1e9;
    for (const mate of h.team.players) {
      if (mate === h || mate.isGK) continue;
      const dx = mate.pos.x - h.pos.x, dz = mate.pos.z - h.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < minD || d > maxD) continue;
      const align = (dx * aimX + dz * aimZ) / d;
      const progress = dx * h.team.dir;
      let score = align * 8 - d * 0.12 + (preferForward ? progress * 0.4 : progress * 0.1);
      if (score > bestScore) { bestScore = score; best = mate; }
    }
    return best;
  }

  // --- main update --------------------------------------------------------

  update(dt, inputsIn, eventsIn) {
    // accept the legacy single-player signature or per-seat maps
    const inputs = inputsIn?.moveDir ? { H: inputsIn } : (inputsIn ?? {});
    const events = Array.isArray(eventsIn) ? { H: eventsIn } : (eventsIn ?? {});

    switch (this.state) {
      case 'KICKOFF':
        this.stateT -= dt;
        if (this.stateT <= 0) this.state = 'PLAY';
        break;
      case 'PLAY':
        this._play(dt, inputs, events);
        break;
      case 'SETPIECE':
        this.elapsed += dt * 0.35; // clock creeps during dead balls
        this._setPieceUpdate(dt, inputs, events);
        break;
      case 'GOAL':
        this.stateT -= dt;
        this.ball.step(dt);
        if (this.stateT <= 0) {
          if (this.golden) {
            this.state = 'FULL';
            this.hooks.sfx?.('whistle', 3);
            this.hooks.onFullTime();
          } else this.kickoff(this.concededTeam);
        }
        break;
      case 'HALF':
        this.stateT -= dt;
        if (this.stateT <= 0) {
          this.half = 2;
          this.teamA.dir *= -1;
          this.teamB.dir *= -1;
          this.kickoff(this.secondHalfKicker);
          this.hooks.banner('SECOND HALF', 1400);
        }
        break;
      case 'FULL':
        break;
    }

    const focus = this.seats.H ?? null;
    if (focus) this.marker.position.set(focus.pos.x, 0.06, focus.pos.z);
    this.marker.visible = !!focus;

    for (const team of [this.teamA, this.teamB]) {
      for (const p of team.players) {
        const sp = Math.hypot(p.vel.x, p.vel.z);
        animateRig(p.rig, this.state === 'PLAY' || this.state === 'SETPIECE' ? sp : 0, dt);
        if (sp > 0.6 || p.tackleT > 0) {
          const h = p.tackleT > 0 ? p.lungeDir : p.heading;
          p.rig.group.rotation.y = Math.atan2(h.x, h.z);
        }
      }
    }
  }

  _play(dt, inputs, events) {
    this.elapsed += dt;
    if (this.half === 1 && this.elapsed >= this.halfLen) {
      this.state = 'HALF';
      this.stateT = 3;
      this.secondHalfKicker = this.firstHalfKicker === this.teamA ? this.teamB : this.teamA;
      this.hooks.banner('HALF-TIME', 2600);
      this.hooks.sfx?.('whistle', 2);
      return;
    }
    if (this.half === 2 && this.elapsed >= this.halfLen * 2) {
      if (this.goldenGoal && this.scoreA === this.scoreB) {
        if (!this.golden) {
          this.golden = true;
          this.hooks.banner('GOLDEN GOAL', 2400);
          this.hooks.sfx?.('whistle', 1);
        }
      } else {
        this.state = 'FULL';
        this.hooks.sfx?.('whistle', 3);
        this.hooks.onFullTime();
        return;
      }
    }
    if (this.lock.t > 0) this.lock.t -= dt;
    this.transT += dt;

    // scouting: sample attack channels + roll the adjustment clock
    this._zoneT -= dt;
    for (const sc of this.scouts) {
      if (this._zoneT <= 0 && this.controllerTeam === sc.subject
          && this.ball.pos.x * sc.subject.dir > FIELD.halfL * 0.35) {
        sc.sampleZ(this.ball.pos.z);
      }
      sc.update(dt, this);
    }
    if (this._zoneT <= 0) this._zoneT = 0.5;

    // delayed bicycle strike
    if (this.pendingStrike) {
      this.pendingStrike.t -= dt;
      if (this.pendingStrike.t <= 0) {
        const p = this.pendingStrike.p;
        this.pendingStrike = null;
        const b = this.ball;
        if (distXZ(p.pos, b.pos) < 2.6 && b.pos.y > 0.4 && b.pos.y < 2.7) {
          const goalX = p.team.dir * FIELD.halfL;
          const tz = (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.72) * FIELD.goalHalf;
          const ang = Math.atan2(tz - p.pos.z, goalX - p.pos.x) + rand(-0.09, 0.09);
          this.kickBall(p, Math.cos(ang) * 23, 2.0, Math.sin(ang) * 23, null, false, true);
          this.hooks.onBicycle?.(p);
        }
      }
    }

    for (const team of [this.teamA, this.teamB]) {
      for (const p of team.players) {
        if (p.kickCd > 0) p.kickCd -= dt;
        if (p.touchCd > 0) p.touchCd -= dt;
      }
    }

    updateBrains(this, dt);
    gkUpdate(this, this.teamA.players[0], dt);
    gkUpdate(this, this.teamB.players[0], dt);
    this._move(dt, inputs);
    this._control(dt, inputs, events);
    this._deflections();
    this.ball.step(dt);
    this._rules();
  }

  _inputFor(p) { return p.seatKey ? this._inputs[p.seatKey] : null; }

  _move(dt, inputs) {
    this._inputs = inputs;
    this._foulThisFrame = false;
    const all = [...this.teamA.players, ...this.teamB.players];
    const owner = this.ball.owner;

    for (const p of all) {
      if (p.stunT > 0) {
        p.stunT -= dt;
        p.vel.multiplyScalar(Math.max(0, 1 - 6 * dt));
      } else if (p.tackleT > 0) {
        p.tackleT -= dt;
        p.vel.copy(p.lungeDir).multiplyScalar(10.5);
        // win the ball…
        if (distXZ(p.pos, this.ball.pos) < 1.05 && this.ball.pos.y < 0.9 && p.kickCd <= 0) {
          _v.copy(p.lungeDir).multiplyScalar(7).add(_v2.set(rand(-2, 2), 0, rand(-2, 2)));
          _v.y = rand(0.5, 2);
          this.ball.kick(p, _v, null);
          p.kickCd = 0.5;
          p.tackleT = 0;
        } else if (owner && owner.team !== p.team && distXZ(p.pos, owner.pos) < 0.8
                   && distXZ(p.pos, this.ball.pos) > 1.0 && Math.random() < 0.5 && !this._foulThisFrame) {
          // …or take the man: foul
          this._foulThisFrame = true;
          p.tackleT = 0;
          p.stunT = 1.0;
          this._callFoul(p, owner);
          return;
        }
        if (p.tackleT <= 0 && p.kickCd <= 0) p.stunT = 0.6;
      } else if (p.isHuman) {
        const input = this._inputFor(p) ?? IDLE_INPUT;
        const m = input.moveDir();
        const sp = input.sprinting() ? PLAYER.sprint : PLAYER.speed;
        _v.set(m.x * sp, 0, m.z * sp);
        p.vel.lerp(_v, damp(9, dt));
      } else {
        _v.set(p.target.x - p.pos.x, 0, p.target.z - p.pos.z);
        const d = _v.length();
        const max = (p.isGK ? 5.2 : PLAYER.speed * p.team.diff.speed) * p.urgency;
        const want = Math.min(max, d * 3);
        if (d > 0.05) _v.multiplyScalar(want / d); else _v.set(0, 0, 0);
        p.vel.lerp(_v, damp(7, dt));
      }

      p.pos.x = clamp(p.pos.x + p.vel.x * dt, -FIELD.halfL - 2, FIELD.halfL + 2);
      p.pos.z = clamp(p.pos.z + p.vel.z * dt, -FIELD.halfW - 2, FIELD.halfW + 2);
      if (p.vel.lengthSq() > 0.36) p.heading.copy(p.vel).normalize();
    }

    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.49 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (0.7 - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      }
    }
  }

  _callFoul(fouler, victim) {
    this.hooks.banner('FOUL', 1100);
    this.hooks.sfx?.('whistle', 1);
    const defGoalX = -fouler.team.dir * FIELD.halfL; // fouler's own goal
    const inBox = Math.abs(victim.pos.x - defGoalX) < FIELD.boxL && Math.abs(victim.pos.z) < FIELD.boxHalfW;
    this.ball.owner = null;
    if (inBox) this.enterSetPiece('penalty', victim.team, 0, 0);
    else this.enterSetPiece('freekick', victim.team, victim.pos.x, victim.pos.z);
  }

  _control(dt, inputs, events) {
    const ball = this.ball;

    if (ball.heldBy) {
      ball.owner = null;
      this.owner = null;
      this.controller = null;
      this.controllerTeam = ball.heldBy.team;
      this._humansAct(inputs, events);
      return;
    }

    let owner = ball.owner;
    if (owner && (owner.stunT > 0 || owner.tackleT > 0)) { ball.owner = owner = null; }

    if (!owner) {
      let best = null, bestD = 1e9;
      for (const team of [this.teamA, this.teamB]) {
        if (this.lock.t > 0 && team !== this.lock.team) continue;
        for (const p of team.players) {
          if (p.kickCd > 0 || p.stunT > 0 || p.isGK) continue;
          if (ball.speed() >= 14 && ball.intendedReceiver !== p && (ball.isShot || ball.speed() >= 22)) continue;
          const d = distXZ(p.pos, ball.pos);
          let reach = PLAYER.controlRange + (p.tackleT > 0 ? 0.5 : 0);
          if (ball.speed() > 7 && ball.intendedReceiver !== p) reach *= 0.62;
          if (d < reach && ball.pos.y < 0.9 && d < bestD) { best = p; bestD = d; }
        }
      }
      if (best) {
        const spd = ball.speed();
        let press = 1e9;
        for (const o of this.opponentsOf(best.team)) {
          const d = distXZ(o.pos, best.pos);
          if (d < press) press = d;
        }
        const heavy = Math.max(0, spd - 7) * 0.045 + (press < 2.2 ? 0.16 : 0) - (best.isHuman ? 0.06 : 0);
        if (spd > 7 && Math.random() < heavy) {
          _v.copy(ball.vel).multiplyScalar(0.22);
          _v.x += rand(-2.5, 2.5); _v.z += rand(-2.5, 2.5); _v.y = rand(0.2, 1);
          ball.kick(best, _v, null);
          best.kickCd = 0.35;
        } else {
          ball.owner = owner = best;
          owner.ownerT = 0;
          owner._dribNoted = false;
          ball.lastTouch = best;
          ball.intendedReceiver = null;
          ball.isShot = false;
          // transition tracking
          if (this.transTeam !== best.team) { this.transTeam = best.team; this.transT = 0; }
        }
      }
    }

    if (owner) {
      owner.ownerT += dt;
      // scout: long human carries read as a dribbling habit
      if (owner.isHuman && owner.ownerT > 1.2 && !owner._dribNoted) {
        owner._dribNoted = true;
        this._scoutFor(owner.team)?.note('dribble');
      }
    }
    this.owner = owner;
    this.controller = owner;
    this.controllerTeam = owner ? owner.team : null;

    if (owner) {
      for (const o of this.opponentsOf(owner.team)) {
        if (o.stunT > 0 || o.tackleT > 0 || o.kickCd > 0) continue;
        if (distXZ(o.pos, owner.pos) > 1.15) continue;
        const boost = 1 + (o.team.adapt?.tackleBoost ?? 0) * 0.5;
        const aggro = o.isHuman ? 0.9 : o.team.aggro * boost;
        const shield = owner.isHuman ? 0.75 : 1;
        if (Math.random() < aggro * 0.55 * shield * dt) {
          owner.stunT = 0.3;
          if (Math.random() < 0.45) {
            ball.owner = o;
            o.ownerT = 0;
            ball.lastTouch = o;
            if (this.transTeam !== o.team) { this.transTeam = o.team; this.transT = 0; }
          } else {
            _v.set(o.pos.x - owner.pos.x, 0, o.pos.z - owner.pos.z).normalize().multiplyScalar(rand(3.5, 6));
            _v.y = rand(0.3, 1.2);
            ball.kick(o, _v, null);
            o.kickCd = 0.25;
          }
          break;
        }
      }
    }

    this._humansAct(inputs, events);

    const cur = this.ball.owner;
    if (cur && !cur.isHuman && !cur.isGK && cur.ownerT > 0.35 && cur.touchCd <= 0) {
      decideOnBall(this, cur);
      cur.touchCd = 0.3;
    }
  }

  _humansAct(inputs, events) {
    for (const [key, p] of Object.entries(this.seats)) {
      this._humanActions(p, inputs[key] ?? IDLE_INPUT, events[key] ?? []);
    }
  }

  _humanActions(h, input, events) {
    const ball = this.ball;
    const dBall = distXZ(h.pos, ball.pos);
    const goalX = h.team.dir * FIELD.halfL;
    const scout = this._scoutFor(h.team);

    for (const e of events) {
      switch (e.type) {
        case 'tackle':
          this.tackle(h);
          break;

        case 'pass': {
          if (dBall > PLAYER.kickRange || ball.pos.y > 1.5 || h.kickCd > 0) break;
          const mate = this._passTargetFor(h, input, 4, 34);
          if (!mate) break;
          const d = distXZ(mate.pos, h.pos);
          const sp = clamp(7 + d * 0.9, 9, 24);
          const t = d / sp;
          const tx = mate.pos.x + mate.vel.x * t * 0.8;
          const tz = mate.pos.z + mate.vel.z * t * 0.8;
          const ang = Math.atan2(tz - h.pos.z, tx - h.pos.x);
          this.kickBall(h, Math.cos(ang) * sp, 0, Math.sin(ang) * sp, null);
          ball.intendedReceiver = mate;
          scout?.note('pass');
          break;
        }

        case 'through': {
          if (dBall > PLAYER.kickRange || ball.pos.y > 1.5 || h.kickCd > 0) break;
          const mate = this._passTargetFor(h, input, 6, 45, true);
          if (!mate) break;
          const lead = 5 + 7 * e.power;
          const tx = mate.pos.x + h.team.dir * lead + mate.vel.x * 0.4;
          const tz = mate.pos.z * 0.96 + mate.vel.z * 0.4;
          const d = Math.hypot(tx - h.pos.x, tz - h.pos.z);
          const sp = clamp(9 + d * 0.85 + 5 * e.power, 12, 26);
          const ang = Math.atan2(tz - h.pos.z, tx - h.pos.x);
          const vx = Math.cos(ang) * sp, vz = Math.sin(ang) * sp;
          this.kickBall(h, vx, 0, vz, latSpin(vx, vz, 4));
          ball.intendedReceiver = mate;
          scout?.note('through');
          break;
        }

        case 'chip': {
          if (dBall > PLAYER.kickRange || ball.pos.y > 1.5 || h.kickCd > 0) break;
          const mate = this._passTargetFor(h, input, 10, 42, true);
          let tx, tz;
          if (mate) { tx = mate.pos.x + mate.vel.x * 0.6; tz = mate.pos.z + mate.vel.z * 0.6; }
          else { tx = goalX - h.team.dir * 8; tz = rand(-5, 5); }
          const d = Math.hypot(tx - h.pos.x, tz - h.pos.z);
          const T = clamp(d / 15, 0.6, 1.55);
          const vx = (tx - h.pos.x) / T, vz = (tz - h.pos.z) / T;
          this.kickBall(h, vx, (BALL.g * T) / 2, vz, latSpin(vx, vz, -5.5));
          if (mate) ball.intendedReceiver = mate;
          // wide chips into the box register as crosses
          if (Math.abs(h.pos.z) > FIELD.halfW * 0.45 && (goalX - h.pos.x) * h.team.dir < FIELD.halfL * 0.65) {
            scout?.note('cross');
          } else scout?.note('pass');
          break;
        }

        case 'shoot': {
          if (h.kickCd > 0 || dBall > 1.9) break;
          const p = e.power;
          const dG = Math.hypot(goalX - h.pos.x, h.pos.z);
          if (ball.pos.y > 0.75 && ball.pos.y < 2.3) {
            this._shot(h, 18 + 10 * p, 0.05, 0.09, null);
          } else if (ball.pos.y <= 0.75 && dBall <= PLAYER.kickRange) {
            const sp = 15 + 15 * p;
            const lift = sp * (0.05 + 0.11 * p);
            this._shot(h, sp, lift / sp, 0.02 + 0.06 * p, input.moveDir().z * 3.0);
          } else break;
          scout?.note('shot');
          if (dG > FIELD.halfL * 0.42) scout?.note('longShot');
          break;
        }

        case 'finesse': {
          if (h.kickCd > 0 || dBall > PLAYER.kickRange || ball.pos.y > 0.9) break;
          const side = Math.sign(h.pos.z || 1);
          const aimZ = -side * FIELD.goalHalf * 0.7;
          const spin = new THREE.Vector3(0, 5 * side * h.team.dir, 0);
          this._shot(h, 18.5 + 4 * e.power, 0.11, 0.015, aimZ, spin);
          h.rig.finesseT = 0.55;
          scout?.note('shot');
          if (Math.hypot(goalX - h.pos.x, h.pos.z) > FIELD.halfL * 0.42) scout?.note('longShot');
          break;
        }

        case 'sombrero': {
          if (dBall > 1.3 || ball.pos.y > 0.8 || h.kickCd > 0) break;
          this.kickBall(h,
            h.heading.x * 1.5 + h.vel.x * 0.5, 6.8,
            h.heading.z * 1.5 + h.vel.z * 0.5, null);
          h.rig.flickT = 0.4;
          break;
        }

        case 'bicycle': {
          if (dBall > 2.4 || ball.pos.y < 0.6 || ball.pos.y > 2.6 || h.kickCd > 0) break;
          h.rig.bicycleT = 1.05;
          h.kickCd = 1.2;
          this.pendingStrike = { p: h, t: 0.25 };
          break;
        }
      }
    }
  }

  _shot(p, speed, liftFrac, noise, aimZ, spin = null) {
    const goalX = p.team.dir * FIELD.halfL;
    const zCap = FIELD.goalHalf - 0.55;
    const tz = aimZ === null ? rand(-zCap * 0.5, zCap * 0.5) : clamp(aimZ, -zCap, zCap);
    let ang = Math.atan2(tz - p.pos.z, goalX - p.pos.x);
    ang += rand(-noise, noise) + Math.hypot(p.vel.x, p.vel.z) * 0.004 * rand(-1, 1);
    this.kickBall(p, Math.cos(ang) * speed, speed * liftFrac, Math.sin(ang) * speed, spin, false, true);
  }

  _deflections() {
    const ball = this.ball;
    if (ball.speed() < 13 || ball.heldBy || ball.owner) return;
    for (const team of [this.teamA, this.teamB]) {
      for (const p of team.players) {
        if (p.kickCd > 0 || p === ball.intendedReceiver) continue;
        if (ball.pos.y > 1.7) continue;
        if (distXZ(p.pos, ball.pos) < 0.42) {
          ball.vel.x *= -rand(0.15, 0.4);
          ball.vel.z = ball.vel.z * 0.3 + rand(-4, 4);
          ball.vel.y = Math.abs(ball.vel.y) * 0.4 + rand(0.5, 2);
          ball.lastTouch = p;
          ball.intendedReceiver = null;
          p.kickCd = 0.35;
          return;
        }
      }
    }
  }

  _rules() {
    const ball = this.ball;
    const { halfL, halfW, goalHalf, goalHeight } = FIELD;
    const ax = Math.abs(ball.pos.x);

    if (ax > halfL + BALL.r) {
      const sideSign = Math.sign(ball.pos.x);
      const inMouth = Math.abs(ball.pos.z) < goalHalf - 0.03 && ball.pos.y < goalHeight;

      if (inMouth) {
        const scorer = this.teamA.dir === sideSign ? this.teamA : this.teamB;
        if (scorer === this.teamA) this.scoreA++; else this.scoreB++;
        this.concededTeam = this.otherTeam(scorer);
        this.state = 'GOAL';
        this.stateT = 3;
        this.hooks.onGoal(scorer, ball.pos.x, ball.pos.z, ball.lastTouch);
        return;
      }

      if (ax > halfL + 0.6 && this.state === 'PLAY') {
        const defTeam = this.teamA.dir === -sideSign ? this.teamA : this.teamB;
        const attTeam = this.otherTeam(defTeam);
        const zSign = Math.sign(ball.pos.z || 1);
        if (ball.lastTouch && ball.lastTouch.team === attTeam) {
          this.enterSetPiece('goalkick', defTeam, sideSign * (halfL - FIELD.sixL), zSign * goalHalf * 2);
        } else {
          this.enterSetPiece('corner', attTeam, sideSign * (halfL - 0.4), zSign * (halfW - 0.4));
        }
      }
      return;
    }

    if (Math.abs(ball.pos.z) > halfW + 0.4) {
      const zSign = Math.sign(ball.pos.z);
      const toTeam = ball.lastTouch ? this.otherTeam(ball.lastTouch.team) : null;
      ball.reset(clamp(ball.pos.x, -halfL + 1, halfL - 1), zSign * (halfW - 0.4));
      if (toTeam) this.lock = { team: toTeam, t: 1.5 };
      this.hooks.banner('THROW-IN', 800);
    }
  }

  setFirstKicker(team) { this.firstHalfKicker = team; }

  clockText() {
    const total = this.halfLen * 2;
    const mins = Math.floor((this.elapsed / total) * 90);
    if (this.golden) return `${mins}'  ·  golden goal`;
    return `${Math.min(90, mins)}'  ·  ${this.half === 1 ? '1st' : '2nd'} half`;
  }

  // --- save / restore -------------------------------------------------------

  serialize() {
    return {
      a: this.teamA.def.code, b: this.teamB.def.code,
      diffKey: this.opts.diffKey, lengthMin: this.lengthMin,
      scoreA: this.scoreA, scoreB: this.scoreB,
      half: this.half, elapsed: this.elapsed,
      controlledA: this.seats.H ? this.seats.H.idx : null,
      savedAt: Date.now(),
    };
  }

  restoreState(save) {
    this.scoreA = save.scoreA;
    this.scoreB = save.scoreB;
    this.half = save.half;
    this.elapsed = save.elapsed;
    if (save.half === 2) { this.teamA.dir *= -1; this.teamB.dir *= -1; }
    if (save.controlledA != null) this._setHuman('H', 'A', save.controlledA);
    this.setFirstKicker(this.teamA);
    this.kickoff(Math.random() < 0.5 ? this.teamA : this.teamB);
  }
}
