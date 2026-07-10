import * as THREE from 'three';
import { FIELD, BALL, PLAYER, DIFFICULTY, MATE_DIFF, clamp, damp, rand } from './config.js';
import { playerLook } from './teams.js';
import { buildLineup, ROLE_ATT } from './tactics.js';
import { buildRig, animateRig } from './rig.js';
import { Ball } from './ball.js';
import { gkUpdate } from './ai.js';
import { updateBrains, decideOnBall } from './brain.js';
import { Scout } from './scout.js';
import { starOf, starMul } from './stars.js';

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
    this.halves = opts.halves ?? 2; // 1 = straight through, no half-time
    this.goldenGoal = !!opts.goldenGoal;
    this.golden = false;
    this.sizeKey = opts.sizeKey ?? '11';

    this.ball = new Ball(scene, opts.ballStyle);
    const kits = opts.kits ?? { a: opts.teamADef, b: opts.teamBDef };
    this.teamA = this._makeTeam(opts.teamADef, 1, MATE_DIFF, 'A', kits.a);
    this.teamB = this._makeTeam(opts.teamBDef, -1, DIFFICULTY[opts.diffKey], 'B', kits.b);

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
    this._aerialCd = 0;
    this.transTeam = null;
    this.transT = 99;
    this._zoneT = 0;
    this._moodT = 4;

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

  _makeTeam(def, dir, diff, key, kit) {
    const lineup = buildLineup(def, this.sizeKey);
    const team = {
      def, dir, diff, key, kit: kit ?? def, players: [],
      style: lineup.style, baseStyle: { ...lineup.style }, kickerIdx: lineup.kicker,
      mood: 0, moodRegime: 'level', buildupT: 0,
      intent: 'balance', assignT: 0,
      adapt: { shiftZ: 0, closeDown: 0, lineDrop: 0, wideDeep: 0, tackleBoost: 0 },
      policyNet: null,
    };
    team.aggro = diff.tackleAggro * (0.7 + 0.6 * lineup.style.aggression);
    lineup.slots.forEach((slot, i) => {
      const isGK = slot.role === 'GK';
      const entry = def.xi?.[slot.xi] ?? [i + 1, `${def.code} ${i + 1}`];
      const look = playerLook(entry[1]);
      const rig = buildRig(kit ?? def, look.skin, isGK, { number: entry[0], captain: i === 6, name: entry[1], hairColor: look.hair });
      this.scene.add(rig.group);
      team.players.push({
        team, idx: i, role: slot.role, isGK, isHuman: false, seatKey: null,
        num: entry[0], name: entry[1],
        star: isGK ? null : starOf(entry[1]), clutchK: 1,
        base: { x: slot.x, z: slot.z },
        rig,
        pos: rig.group.position,
        vel: new THREE.Vector3(),
        heading: new THREE.Vector3(dir, 0, 0),
        target: new THREE.Vector3(),
        urgency: 0.75, act: 'anchor', markT: null, oneTwoT: 0,
        aiT: 0, kickCd: 0, touchCd: 0, ownerT: 0,
        tackleT: 0, stunT: 0, holdT: 0,
        sta: 1, staLock: false, wallHoldT: 0, inWall: false,
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
        p.sta = 1; p.staLock = false; p.wallHoldT = 0; p.inWall = false;
        p.rig.bicycleT = 0; p.rig.slideT = 0; p.rig.flickT = 0; p.rig.finesseT = 0;
        p.rig.kickT = 0; p.rig.chipT = 0; p.rig.throwT = 0; p.rig.diveT = 0; p.rig.headT = 0; p.rig.holdBall = false;
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
    this.hooks.evt?.('kickoff', { first: this.elapsed === 0 && this.scoreA + this.scoreB === 0 });
  }

  kickBall(p, vx, vy, vz, spin, isDribble = false, isShot = false) {
    _v.set(vx, vy, vz);
    this.ball.kick(p, _v, spin, isShot);
    if (isDribble) p.kickCd = 0;
    p.touchCd = isDribble ? 0.16 : 0.1;
    const sp = Math.hypot(vx, vy, vz);
    if (isShot && this.hooks.evt) {
      // commentary tap: distance/angle/blockers feed the xG read
      const goalX = p.team.dir * FIELD.halfL;
      const dGoal = Math.hypot(goalX - p.pos.x, p.pos.z);
      let blockers = 0;
      for (const o of this.opponentsOf(p.team)) {
        if (o.isGK) continue;
        const along = (o.pos.x - p.pos.x) * p.team.dir;
        if (along > 0.5 && along < dGoal && Math.abs(o.pos.z - p.pos.z * (1 - along / dGoal)) < 1.6) blockers++;
      }
      this.hooks.evt('shot', { p, dist: dGoal, z: p.pos.z, blockers });
    }
    // strike animation — lofted balls scoop, everything else swings through,
    // unless a specialty move (bicycle/finesse/sombrero) already owns the body
    if (!isDribble && p.rig && p.rig.bicycleT <= 0 && p.rig.finesseT <= 0
        && p.rig.flickT <= 0 && p.rig.throwT <= 0 && p.rig.headT <= 0) {
      if (!isShot && vy > Math.hypot(vx, vz) * 0.32) p.rig.chipT = 0.4;
      else p.rig.kickT = 0.32;
    }
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
    if (kind === 'throwin') z = Math.sign(z) * (halfW - 0.2);
    this.ball.reset(x, z);
    this.state = 'SETPIECE';

    // taker: nearest human seat on this team, else closest outfielder (GK for goal kicks)
    let taker = null;
    if (kind === 'goalkick') taker = team.players[0];
    else if (kind === 'corner') {
      // corners are taken by one of the team's three strikers (front line), picked
      // at random — if that striker happens to be the user's player, they take it.
      const fwds = team.players
        .filter((p) => !p.isGK)
        .sort((a, b) => (ROLE_ATT[b.role] ?? 0) - (ROLE_ATT[a.role] ?? 0))
        .slice(0, 3);
      taker = fwds[Math.floor(Math.random() * fwds.length)] ?? team.players[team.players.length - 1];
    } else {
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
    // penalties + corners are whistle-gated: a longer setup, then the ref blows
    // a second whistle and only from that moment can ANYONE (AI or human) kick
    const readyT = kind === 'penalty' ? 2.6 : kind === 'corner' ? 2.2 : 1.4;
    this.setPiece = {
      kind, team, taker, t: 0, ready: false, readyT,
      whistled: kind !== 'penalty' && kind !== 'corner',
      aiDelay: rand(0.4, 1.0), // AI composes itself after the whistle, no snap kicks
    };

    // setup targets
    const def = this.otherTeam(team);
    const goalX = team.dir * halfL; // goal being attacked
    if (kind === 'throwin') {
      taker.target.set(x, 0, z); // stands on the line, ball overhead
      taker.heading.set(0, 0, -Math.sign(z) || 1);
    } else {
      const behind = kind === 'penalty' ? 2.2 : 1.1;
      _v.set(Math.sign(-goalX + x) || -team.dir, 0, 0); // step back from goal direction
      taker.target.set(x + _v.x * behind, 0, z + (kind === 'corner' ? -Math.sign(z) * 1.2 : 0));
      taker.heading.set(team.dir, 0, 0);
    }
    taker.pos.copy(taker.target); // taker jogs over off-camera — snap to spot
    taker.vel.set(0, 0, 0);

    const inRange = Math.abs(goalX - x) < 32 * K;
    const dFK = Math.hypot(goalX - x, z);
    // closer free kicks earn a bigger wall
    const maxWall = this.sizeKey === '11' ? (dFK < 22 * K ? 4 : 3) : 2;
    let wallCount = 0;
    for (const t2 of [this.teamA, this.teamB]) {
      for (const p of t2.players) {
        p.inWall = false;
        p.wallHoldT = 0;
        if (p === taker) continue;
        if (p.isGK) { p.target.set(-p.team.dir * (halfL - 1.3), 0, 0); continue; }
        if (kind === 'penalty') {
          // everyone waits on the edge of the box
          p.target.set(goalX - team.dir * (FIELD.boxL + 2 + rand(0, 4)), 0, rand(-FIELD.boxHalfW * 0.8, FIELD.boxHalfW * 0.8));
        } else if (kind === 'corner' || (kind === 'freekick' && inRange)) {
          if (p.team === team && ROLE_ATT[p.role] > 0.3) {
            p.target.set(goalX - team.dir * rand(4, 11) * K, 0, rand(-8, 8) * K); // crash the box
          } else if (p.team === def && kind === 'freekick' && ROLE_ATT[p.role] < 0.75 && wallCount < maxWall) {
            // defensive wall, 9.15m along the ball→goal line — hardwired: these
            // players are flagged and hold the line through the strike
            wallCount++;
            p.inWall = true;
            const dx = goalX - x, dz = -z;
            const dl = Math.hypot(dx, dz) || 1;
            const wd = Math.min(9.15, dl * 0.5);
            p.target.set(x + (dx / dl) * wd, 0, z + (dz / dl) * wd + (wallCount - (maxWall + 1) / 2) * 0.85);
          } else if (p.team === def) {
            p.target.set(goalX - team.dir * rand(3, 10) * K, 0, rand(-10, 10) * K); // mark up
          } else {
            p.target.set(p.base.x * team.dir + 10 * team.dir * K, 0, p.base.z);
          }
        } else if (kind === 'throwin') {
          const d = distXZ(p.pos, this.ball.pos);
          if (p.team === team && !p.isGK && d < 22 * K) {
            // two-ish teammates come short to offer an option
            const infield = -Math.sign(z);
            p.target.set(
              x + rand(-7, 7) * K + (p.pos.x - x) * 0.3, 0,
              z + infield * rand(4, 10) * K,
            );
          } else if (p.team === def && !p.isGK && d < 18 * K) {
            // defenders shade toward the throw
            p.target.set(p.pos.x * 0.5 + x * 0.5, 0, p.pos.z * 0.6 + z * 0.4 - Math.sign(z) * 2);
          } else {
            p.target.set(p.team.dir * p.base.x + x * 0.35, 0, p.base.z * 0.85 + z * 0.15);
          }
        } else {
          // goal kick / deep free kick: spread back out
          p.target.set(p.team.dir * p.base.x + this.ball.pos.x * 0.2, 0, p.base.z);
        }
        p.target.x = clamp(p.target.x, -halfL + 1, halfL - 1);
        p.target.z = clamp(p.target.z, -halfW + 1, halfW - 1);
      }
    }

    const label = { corner: 'CORNER', goalkick: 'GOAL KICK', freekick: 'FREE KICK', penalty: 'PENALTY!', throwin: 'THROW-IN' }[kind];
    this.hooks.banner(label, kind === 'penalty' ? 2000 : 1100);
    this.hooks.sfx?.('whistle', 1);
    this.hooks.evt?.('setpiece', { kind, team, att: inRange });
  }

  _setPieceUpdate(dt, inputs, events) {
    const sp = this.setPiece;
    sp.t += dt;
    sp.ready = sp.t > sp.readyT;
    if (sp.ready && !sp.whistled) {
      sp.whistled = true; // the "go" whistle — kicks are legal from here
      this.hooks.sfx?.('whistle', 1);
    }

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
    // throw-in: taker stands on the line, ball held two-handed overhead
    if (sp.kind === 'throwin') {
      const t = sp.taker;
      t.heading.set(0, 0, -Math.sign(t.pos.z) || 1);
      t.rig.group.rotation.y = Math.atan2(t.heading.x, t.heading.z);
      t.rig.holdBall = true;
      this.ball.pos.set(t.pos.x + t.heading.x * 0.12, 1.82, t.pos.z + t.heading.z * 0.12);
      this.ball.vel.set(0, 0, 0);
    }
    this.ball.mesh.position.copy(this.ball.pos);

    if (!sp.ready) return;

    const seatKey = this._seatKeyOf(sp.taker);
    if (seatKey && sp.t < 9) {
      const evts = events[seatKey] ?? [];
      const input = inputs[seatKey] ?? IDLE_INPUT;
      if (sp.kind === 'throwin') {
        for (const e of evts) {
          if (e.type === 'pass') this._takeThrow(sp, input, false, e.aim);
          else if (e.type === 'through' || e.type === 'shoot' || e.type === 'chip') this._takeThrow(sp, input, true, e.aim);
        }
        return;
      }
      // face the play
      sp.taker.heading.set(sp.team.dir, 0, 0);
      for (const e of evts) {
        if (e.type === 'pass' || e.type === 'through') this._takePass(sp, input, e);
        else if (e.type === 'chip') this._takeCross(sp, e.aim);
        else if (e.type === 'shoot' || e.type === 'finesse') this._takeShot(sp, input, e.power ?? 0.6, e.type === 'finesse', e.aim);
      }
    } else if (!seatKey && sp.t >= sp.readyT + sp.aiDelay) {
      this._aiTake(sp);
    } else if (seatKey && sp.t >= 9) {
      this._aiTake(sp); // human dawdled — AI takes it for them
    }
  }

  // two-handed throw from the line: short to feet, or a long hurl down the wing
  _takeThrow(sp, input, long = false, aim = null) {
    const h = sp.taker;
    const mate = this._passTargetFor(h, input ?? IDLE_INPUT, 3, long ? 30 : 16, long, aim);
    const infield = -Math.sign(h.pos.z) || 1;
    let tx, tz;
    if (mate) {
      tx = mate.pos.x + mate.vel.x * 0.3;
      tz = mate.pos.z + mate.vel.z * 0.3;
    } else {
      tx = h.pos.x + h.team.dir * 6;
      tz = h.pos.z + infield * 8;
    }
    const d = Math.hypot(tx - h.pos.x, tz - h.pos.z);
    const T = clamp(d / 13, 0.45, 1.15);
    const vx = (tx - h.pos.x) / T, vz = (tz - h.pos.z) / T;
    const vy = (BALL.g * T) / 2 - 1.65 / T; // released ~1.8m up, arrives at the grass
    h.rig.holdBall = false;
    h.rig.throwT = 0.45;
    this.ball.pos.set(h.pos.x + h.heading.x * 0.2, 1.82, h.pos.z + h.heading.z * 0.2);
    this.ball.kick(h, _v.set(vx, vy, vz), null);
    h.touchCd = 0.15;
    if (mate) this.ball.intendedReceiver = mate;
    this.hooks.sfx?.('touch', 0.7);
    this._resumeFromSetPiece(sp);
  }

  _resumeFromSetPiece(sp) {
    // the wall jumps on the strike and holds its line briefly — no instant scatter
    if (sp.kind === 'freekick') {
      for (const p of this.otherTeam(sp.team).players) {
        if (!p.inWall) continue;
        if (!p.isHuman) p.wallHoldT = 0.5; // never freeze a human's controls
        p.rig.headT = 0.42; // leap animation doubles as the wall jump
        p.inWall = false;
      }
    }
    this.setPiece = null;
    this.state = 'PLAY';
    this.lock = { team: sp.team, t: 0.7 };
  }

  _takePass(sp, input, e) {
    const h = sp.taker;
    const mate = this._passTargetFor(h, input ?? IDLE_INPUT, 4, 40, e.type === 'through', e.aim);
    if (!mate) return;
    const d = distXZ(mate.pos, h.pos);
    const spd = clamp(7 + d * 0.9, 9, 24);
    const ang = Math.atan2(mate.pos.z - h.pos.z, mate.pos.x - h.pos.x);
    this.kickBall(h, Math.cos(ang) * spd, 0, Math.sin(ang) * spd, null);
    this.ball.intendedReceiver = mate;
    this._resumeFromSetPiece(sp);
  }

  _takeCross(sp, aim = null) {
    const h = sp.taker;
    const K = FIELD.halfL / 52.5;
    const goalX = sp.team.dir * FIELD.halfL;
    // human takers can float the delivery onto the cursor; AI swings into the danger zone
    const tx = aim ? clamp(aim.x, goalX - sp.team.dir * 16 * K, goalX) : goalX - sp.team.dir * rand(6, 10.5) * K;
    const tz = aim ? clamp(aim.z, -FIELD.boxHalfW, FIELD.boxHalfW) : rand(-6, 6) * K;
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

  _takeShot(sp, input, power, finesse, aim = null) {
    const h = sp.taker;
    const goalX = sp.team.dir * FIELD.halfL;
    const dGoal = Math.hypot(goalX - h.pos.x, h.pos.z);
    const K = FIELD.halfL / 52.5;
    if (sp.kind === 'penalty') {
      const zCap = FIELD.goalHalf - 0.55;
      const aimZ = this._aimZAtGoal(h, aim, zCap)
        ?? clamp((input ?? IDLE_INPUT).moveDir().z * (zCap * 0.94), -zCap, zCap);
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
      const aimZ = this._aimZAtGoal(h, aim, FIELD.goalHalf - 0.55) ?? -side * FIELD.goalHalf * 0.66;
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
    if (sp.kind === 'throwin') return this._takeThrow(sp, null, Math.random() < 0.3);
    if (sp.kind === 'penalty') return this._takeShot(sp, null, 0.6, false);
    if (sp.kind === 'corner') return this._takeCross(sp);
    if (sp.kind === 'freekick') {
      // direct hit only when close, central, AND the wall doesn't seal the line;
      // otherwise work the ball — cross into the box or play it short
      let sealed = 0;
      const gx = goalX - x, gz = -z;
      const gl = Math.hypot(gx, gz) || 1;
      for (const o of this.otherTeam(sp.team).players) {
        const ox = o.pos.x - x, oz = o.pos.z - z;
        const along = (ox * gx + oz * gz) / gl;
        if (along < 1 || along > gl) continue;
        if (Math.abs(ox * gz - oz * gx) / gl < 1.1) sealed++;
      }
      const shootable = dGoal < 24 * K && Math.abs(z) < 13 * K && sealed < 2;
      if (shootable && Math.random() < 0.45) return this._takeShot(sp, null, 0.55, true);
      if (dGoal < 30 * K) return this._takeCross(sp);
      return this._takePass(sp, null, { type: 'pass' });
    }
    if (sp.kind === 'goalkick') {
      if (Math.random() < 0.75) return this._takePass(sp, null, { type: 'pass' });
      // the long option is still a PASS: hit the most advanced open teammate
      let best = null, bs = -1e9;
      for (const m of sp.team.players) {
        if (m === sp.taker || m.isGK) continue;
        let open = 1e9;
        for (const o of this.otherTeam(sp.team).players) open = Math.min(open, distXZ(o.pos, m.pos));
        const s = m.pos.x * sp.team.dir + Math.min(open, 8) * 1.2;
        if (s > bs) { bs = s; best = m; }
      }
      const tx = best ? best.pos.x : sp.team.dir * 10;
      const tz = best ? best.pos.z : rand(-10, 10);
      const T = clamp(Math.hypot(tx - x, tz - z) / 17, 0.8, 1.7);
      this.kickBall(sp.taker, (tx - x) / T, (BALL.g * T) / 2, (tz - z) / T, null);
      if (best) this.ball.intendedReceiver = best;
      return this._resumeFromSetPiece(sp);
    }
    this._takeCross(sp);
  }

  // aim: optional {x,z} world point (mouse) — beats move-key direction when present
  _passTargetFor(h, input, minD, maxD, preferForward = false, aim = null) {
    let aimX, aimZ;
    if (aim) {
      aimX = aim.x - h.pos.x; aimZ = aim.z - h.pos.z;
      const l = Math.hypot(aimX, aimZ) || 1;
      aimX /= l; aimZ /= l;
    } else {
      const m = input.moveDir();
      aimX = (m.x || m.z) ? m.x : h.heading.x;
      aimZ = (m.x || m.z) ? m.z : h.heading.z;
    }
    let best = null, bestScore = -1e9;
    for (const mate of h.team.players) {
      if (mate === h || mate.isGK) continue;
      const dx = mate.pos.x - h.pos.x, dz = mate.pos.z - h.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < minD || d > maxD) continue;
      const align = (dx * aimX + dz * aimZ) / d;
      const progress = dx * h.team.dir;
      let score = align * 8 - d * 0.12 + (preferForward ? progress * 0.4 : progress * 0.1);
      if (aim) score -= Math.hypot(mate.pos.x - aim.x, mate.pos.z - aim.z) * 0.3;
      if (score > bestScore) { bestScore = score; best = mate; }
    }
    return best;
  }

  // where the aim ray from p crosses the goal line, clamped inside the mouth
  _aimZAtGoal(p, aim, zCap) {
    if (!aim) return null;
    const goalX = p.team.dir * FIELD.halfL;
    const dx = aim.x - p.pos.x;
    if (dx * p.team.dir < 0.5) return clamp(aim.z, -zCap, zCap); // aiming sideways: use raw z
    const t = (goalX - p.pos.x) / dx;
    return clamp(p.pos.z + (aim.z - p.pos.z) * t, -zCap, zCap);
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
        } else if (this.state === 'PLAY' && !p.rig.holdBall && p.rig.diveT <= 0) {
          // standing players track the ball with their body
          const ty = Math.atan2(this.ball.pos.x - p.pos.x, this.ball.pos.z - p.pos.z);
          let d = ty - p.rig.group.rotation.y;
          d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          p.rig.group.rotation.y += d * Math.min(1, 3.5 * dt);
        }
      }
    }
  }

  _play(dt, inputs, events) {
    this.elapsed += dt;
    if (this.elapsed >= this.halfLen * 2) {
      if (this.goldenGoal && this.scoreA === this.scoreB) {
        if (!this.golden) {
          this.golden = true;
          this.hooks.banner('GOLDEN GOAL', 2400);
          this.hooks.sfx?.('whistle', 1);
          this.hooks.evt?.('golden', {});
        }
      } else {
        this.state = 'FULL';
        this.hooks.sfx?.('whistle', 3);
        this.hooks.evt?.('full', {});
        this.hooks.onFullTime();
        return;
      }
    } else if (this.halves === 2 && this.half === 1 && this.elapsed >= this.halfLen) {
      this.state = 'HALF';
      this.stateT = 3;
      this.secondHalfKicker = this.firstHalfKicker === this.teamA ? this.teamB : this.teamA;
      this.hooks.banner('HALF-TIME', 2600);
      this.hooks.sfx?.('whistle', 2);
      this.hooks.evt?.('half', {});
      return;
    }
    // woodwork tap for the booth (flag set by the ball's goal-frame collision)
    if (this.ball.frameHit) {
      this.ball.frameHit = false;
      if (this.ball.isShot) this.hooks.evt?.('woodwork', { p: this.ball.lastTouch });
    }
    if (this.lock.t > 0) this.lock.t -= dt;
    this.transT += dt;

    // scoreline mood: losing sides chase, leading sides shut up shop
    this._moodT -= dt;
    if (this._moodT <= 0) {
      this._moodT = 3;
      this._updateMood(this.teamA);
      this._updateMood(this.teamB);
    }

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
    this._aerials(dt);
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
        if (distXZ(p.pos, this.ball.pos) < 1.25 && this.ball.pos.y < 0.9 && p.kickCd <= 0) {
          _v.copy(p.lungeDir).multiplyScalar(7).add(_v2.set(rand(-2, 2), 0, rand(-2, 2)));
          _v.y = rand(0.5, 2);
          this.ball.kick(p, _v, null);
          p.kickCd = 0.5;
          p.tackleT = 0;
        } else if (owner && owner.team !== p.team && distXZ(p.pos, owner.pos) < 0.8
                   && distXZ(p.pos, this.ball.pos) > 1.0 && !this._foulThisFrame) {
          // …contact with the man, no ball. Front/side challenges aimed at the
          // ball are shoulder-to-shoulder — play on. A foul is a lunge through
          // the carrier's back, or a wild hack nowhere near the ball.
          const behind = p.lungeDir.dot(owner.heading) > 0.35
            && (owner.pos.x - p.pos.x) * owner.heading.x + (owner.pos.z - p.pos.z) * owner.heading.z > 0;
          const wild = distXZ(p.pos, this.ball.pos) > 1.7;
          if (behind || (wild && Math.random() < 0.35)) {
            this._foulThisFrame = true;
            p.tackleT = 0;
            p.stunT = 1.0;
            this._callFoul(p, owner);
            return;
          }
        }
        if (p.tackleT <= 0 && p.kickCd <= 0) p.stunT = 0.6;
      } else if (p.wallHoldT > 0) {
        // free-kick wall: hold the line through the strike instead of scattering
        p.wallHoldT -= dt;
        p.vel.multiplyScalar(Math.max(0, 1 - 8 * dt));
      } else if (p.isHuman) {
        const input = this._inputFor(p) ?? IDLE_INPUT;
        const m = input.moveDir();
        const ST = PLAYER.stamina;
        if (p.staLock && p.sta >= ST.relock) p.staLock = false;
        const sprinting = input.sprinting() && (m.x || m.z) && !p.staLock && p.sta > 0;
        p.sta = clamp(p.sta + (ST.regen - (sprinting ? ST.burn : 0)) * dt, 0, 1);
        if (sprinting && p.sta <= 0) p.staLock = true;
        const sp = sprinting ? PLAYER.sprint : PLAYER.speed;
        _v.set(m.x * sp, 0, m.z * sp);
        p.vel.lerp(_v, damp(9, dt));
      } else {
        _v.set(p.target.x - p.pos.x, 0, p.target.z - p.pos.z);
        const d = _v.length();
        // AI legs: full-urgency chases burst above jog pace while their (slower
        // draining) tank lasts — but the burst tops out under a fresh human sprint
        const ST = PLAYER.stamina;
        if (p.staLock && p.sta >= ST.relock) p.staLock = false;
        // the carrier never bursts — you can't sprint at top pace with the ball
        const burst = !p.isGK && p !== owner && p.urgency >= 0.85 && d > 2.5 && !p.staLock && p.sta > 0;
        p.sta = clamp(p.sta + (ST.regen - (burst ? ST.aiBurn : 0)) * dt, 0, 1);
        if (burst && p.sta <= 0) p.staLock = true;
        const top = (burst ? ST.aiBurst : PLAYER.speed) * starMul(p, 'pace');
        // star pace never outruns a fresh human sprint (9.3)
        const max = (p.isGK ? 5.2 : Math.min(top * p.team.diff.speed, 9.2)) * p.urgency;
        const want = Math.min(max, d * 3);
        if (d > 0.05) _v.multiplyScalar(want / d); else _v.set(0, 0, 0);
        // anti-clump: ease away from teammates on the same grass
        // (full-urgency chasers and the carrier are exempt — they must converge)
        if (!p.isGK && p.urgency < 1 && owner !== p) {
          let sx = 0, sz = 0;
          for (const q of p.team.players) {
            if (q === p || q.isGK) continue;
            const dx = p.pos.x - q.pos.x, dz = p.pos.z - q.pos.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < 9 && d2 > 1e-4) {
              const dd = Math.sqrt(d2);
              const f = (3 - dd) / 3;
              sx += (dx / dd) * f;
              sz += (dz / dd) * f;
            }
          }
          _v.x += sx * 2.6;
          _v.z += sz * 2.6;
        }
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
    this.hooks.evt?.('foul', { fouler, victim });
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
        const heavy = Math.max(0, spd - 7) * 0.045 + (press < 2.2 ? 0.16 : 0)
          - (best.isHuman ? 0.06 : 0) - (starMul(best, 'dribble') - 1) * 0.45;
        if (spd > 7 && Math.random() < heavy) {
          _v.copy(ball.vel).multiplyScalar(0.22);
          _v.x += rand(-2.5, 2.5); _v.z += rand(-2.5, 2.5); _v.y = rand(0.2, 1);
          ball.kick(best, _v, null);
          best.kickCd = 0.35;
        } else {
          const passed = ball.intendedReceiver === best && ball.lastTouch?.team === best.team;
          ball.owner = owner = best;
          owner.ownerT = 0;
          owner._dribNoted = false;
          ball.lastTouch = best;
          ball.intendedReceiver = null;
          ball.isShot = false;
          this.hooks.evt?.('own', { p: best, passed });
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
        const shield = owner.isHuman ? 0.75 : 1 / starMul(owner, 'dribble');
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
          const mate = this._passTargetFor(h, input, 4, 34, false, e.aim);
          if (!mate) break;
          const d = distXZ(mate.pos, h.pos);
          const sp = clamp(7 + d * 0.9, 9, 24);
          const t = d / sp;
          const tx = mate.pos.x + mate.vel.x * t * 0.8;
          const tz = mate.pos.z + mate.vel.z * t * 0.8;
          const ang = Math.atan2(tz - h.pos.z, tx - h.pos.x);
          this.kickBall(h, Math.cos(ang) * sp, 0, Math.sin(ang) * sp, null);
          ball.intendedReceiver = mate;
          h.team.buildupT = 2.2; // teammates surge after the release
          scout?.note('pass');
          break;
        }

        case 'through': {
          if (dBall > PLAYER.kickRange || ball.pos.y > 1.5 || h.kickCd > 0) break;
          const mate = this._passTargetFor(h, input, 6, 45, true, e.aim);
          if (!mate) break;
          const lead = (e.loft ? 7 : 5) + (e.loft ? 9 : 7) * e.power;
          const tx = mate.pos.x + h.team.dir * lead + mate.vel.x * 0.4;
          const tz = mate.pos.z * 0.96 + mate.vel.z * 0.4;
          const d = Math.hypot(tx - h.pos.x, tz - h.pos.z);
          if (e.loft) {
            // over the top: floated ball with backspin that sits down for the runner
            const T = clamp(d / 16, 0.55, 1.3);
            const vx = (tx - h.pos.x) / T, vz = (tz - h.pos.z) / T;
            this.kickBall(h, vx, (BALL.g * T) / 2, vz, latSpin(vx, vz, -5));
          } else {
            const sp = clamp(9 + d * 0.85 + 5 * e.power, 12, 26);
            const ang = Math.atan2(tz - h.pos.z, tx - h.pos.x);
            const vx = Math.cos(ang) * sp, vz = Math.sin(ang) * sp;
            this.kickBall(h, vx, 0, vz, latSpin(vx, vz, 4));
          }
          ball.intendedReceiver = mate;
          h.team.buildupT = 2.2; // teammates surge after the release
          scout?.note('through');
          break;
        }

        case 'chip': {
          if (dBall > PLAYER.kickRange || ball.pos.y > 1.5 || h.kickCd > 0) break;
          const pw = e.power ?? 0.5; // held L = longer, flatter lob
          const mate = this._passTargetFor(h, input, 8, 16 + 30 * pw, true, e.aim);
          let tx, tz;
          if (mate) { tx = mate.pos.x + mate.vel.x * 0.6; tz = mate.pos.z + mate.vel.z * 0.6; }
          else if (e.aim) { tx = e.aim.x; tz = e.aim.z; }
          else { tx = goalX - h.team.dir * 8; tz = rand(-5, 5); }
          const d = Math.hypot(tx - h.pos.x, tz - h.pos.z);
          const T = clamp(d / (12 + 7 * pw), 0.6, 1.55);
          const vx = (tx - h.pos.x) / T, vz = (tz - h.pos.z) / T;
          this.kickBall(h, vx, (BALL.g * T) / 2, vz, latSpin(vx, vz, -5.5));
          if (mate) ball.intendedReceiver = mate;
          h.team.buildupT = 2.2;
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
          const zCap = FIELD.goalHalf - 0.55;
          const aimZ = this._aimZAtGoal(h, e.aim, zCap);
          if (ball.pos.y > 0.75 && ball.pos.y < 2.3) {
            this._shot(h, 18 + 10 * p, 0.05, 0.09, aimZ);
          } else if (ball.pos.y <= 0.75 && dBall <= PLAYER.kickRange) {
            const sp = 15 + 15 * p;
            const lift = sp * (0.05 + 0.11 * p);
            this._shot(h, sp, lift / sp, 0.02 + 0.06 * p, aimZ ?? input.moveDir().z * 3.0);
          } else break;
          scout?.note('shot');
          if (dG > FIELD.halfL * 0.42) scout?.note('longShot');
          break;
        }

        case 'finesse': {
          if (h.kickCd > 0 || dBall > PLAYER.kickRange || ball.pos.y > 0.9) break;
          const side = Math.sign(h.pos.z || 1);
          const aimZ = this._aimZAtGoal(h, e.aim, FIELD.goalHalf - 0.55) ?? -side * FIELD.goalHalf * 0.7;
          const spin = new THREE.Vector3(0, 5 * side * h.team.dir, 0);
          this._shot(h, 18.5 + 4 * e.power, 0.11, 0.015, aimZ, spin);
          h.rig.finesseT = 0.55;
          scout?.note('shot');
          if (Math.hypot(goalX - h.pos.x, h.pos.z) > FIELD.halfL * 0.42) scout?.note('longShot');
          break;
        }

        case 'head': {
          // only reachable on an airborne ball — never steps on ground control/passing
          if (h.kickCd > 0 || ball.pos.y < 0.9 || ball.pos.y > 2.9 || dBall > 2.2) break;
          const onGoal = this._header(h, e.aim, 'auto');
          if (onGoal) scout?.note('shot');
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

  // Jump and head an airborne ball. mode: 'goal' (nod on target) · 'clear' (hoof
  // it high and away) · 'flick' (redirect onward) · 'auto' (pick from position).
  // Returns true if the header was a goal attempt. Shared by the human key and AI.
  _header(p, aim = null, mode = 'auto') {
    const dir = p.team.dir;
    const goalX = dir * FIELD.halfL;
    const dGoal = Math.hypot(goalX - p.pos.x, p.pos.z);
    const inAttBox = (goalX - p.pos.x) * dir < FIELD.boxL + 6 && Math.abs(p.pos.z) < FIELD.boxHalfW;
    const inOwnThird = p.pos.x * dir < -FIELD.halfL * 0.4;

    if (mode === 'auto') {
      if (inAttBox && dGoal < FIELD.boxL + 8) mode = 'goal';
      else if (inOwnThird) mode = 'clear';
      else mode = 'flick';
    }

    let tx, tz, vy, spd, onGoal = false;
    if (mode === 'goal') {
      onGoal = true;
      const zCap = FIELD.goalHalf - 0.5;
      tz = this._aimZAtGoal(p, aim, zCap) ?? -Math.sign(p.pos.z || 1) * zCap * rand(0.35, 0.85);
      tx = goalX;
      spd = (12 + rand(0, 3)) * starMul(p, 'aerial');
      vy = -2.2;                 // powered downward — a header you bury
    } else if (mode === 'clear') {
      const d = _v.set(dir, 0, rand(-0.7, 0.7)).normalize();
      tx = p.pos.x + d.x * 30; tz = p.pos.z + d.z * 30;
      spd = 15 + rand(0, 4);
      vy = 5.5;                  // high and away from danger
    } else {                     // flick / knock-down
      if (aim) { tx = aim.x; tz = aim.z; }
      else { tx = p.pos.x + dir * 12; tz = p.pos.z + rand(-4, 4); }
      spd = 11;
      vy = 2.0;
    }
    const dx = tx - p.pos.x, dz = tz - p.pos.z;
    const dl = Math.hypot(dx, dz) || 1;
    p.rig.headT = 0.42;
    this.kickBall(p, (dx / dl) * spd, vy, (dz / dl) * spd, null, false, onGoal);
    p.kickCd = 0.5;
    p.touchCd = 0.2;
    return onGoal;
  }

  // AI heading: when a genuinely aerial ball (above ground-control height) is in
  // reach, let a nearby player nod it — attackers attack it in the box, defenders
  // clear, everyone contests a challenged ball. Ground play is untouched: this
  // only ever fires on balls too high to trap at the feet.
  _aerials(dt) {
    if (this._aerialCd > 0) { this._aerialCd -= dt; return; }
    const ball = this.ball;
    if (ball.owner || ball.heldBy) return;
    if (ball.pos.y < 1.0 || ball.pos.y > 2.7) return;
    if (ball.speed() > 20) return; // rockets are for the keeper / deflections

    let best = null, bestD = 1e9;
    for (const team of [this.teamA, this.teamB]) {
      for (const p of team.players) {
        if (p.isGK || p.isHuman || p.kickCd > 0 || p.stunT > 0 || p.tackleT > 0) continue;
        const d = distXZ(p.pos, ball.pos);
        if (d < 1.7 * starMul(p, 'aerial') && d < bestD) { best = p; bestD = d; }
      }
    }
    if (!best) return;

    const dir = best.team.dir;
    const goalX = dir * FIELD.halfL;
    const inAttBox = (goalX - best.pos.x) * dir < FIELD.boxL + 6 && Math.abs(best.pos.z) < FIELD.boxHalfW;
    const inOwnThird = best.pos.x * dir < -FIELD.halfL * 0.4;
    let press = 1e9;
    for (const o of this.opponentsOf(best.team)) press = Math.min(press, distXZ(o.pos, ball.pos));
    const contested = press < 2.6;

    // only head when it's the better option — an uncontested midfield ball is
    // left to drop and be controlled at feet (regular play stays intact)
    let go, mode, mate = null;
    if (inAttBox) { go = true; mode = 'goal'; }
    else if (inOwnThird && (contested || ball.vel.x * -dir > 1)) { go = true; mode = 'clear'; }
    else if (contested) { go = Math.random() < 0.7; mode = 'flick'; }
    else return;

    if (mode === 'flick') {
      // knock it on toward the most advanced teammate in range
      let fb = -1e9;
      for (const m of best.team.players) {
        if (m === best || m.isGK) continue;
        if (distXZ(m.pos, best.pos) > 30) continue;
        const prog = (m.pos.x - best.pos.x) * dir;
        if (prog > fb) { fb = prog; mate = m; }
      }
    }
    const onGoal = this._header(best, mate ? { x: mate.pos.x, z: mate.pos.z } : null, mode);
    if (mate && !onGoal) ball.intendedReceiver = mate;
    this._aerialCd = 0.4;
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
        if (ball.isShot && Math.abs(ball.pos.z) < goalHalf + 2.4 && ball.pos.y < goalHeight + 1.6) {
          this.hooks.evt?.('nearMiss', { p: ball.lastTouch, dz: Math.abs(ball.pos.z) - goalHalf });
        }
        if (ball.lastTouch && ball.lastTouch.team === attTeam) {
          this.enterSetPiece('goalkick', defTeam, sideSign * (halfL - FIELD.sixL), zSign * goalHalf * 2);
        } else {
          this.enterSetPiece('corner', attTeam, sideSign * (halfL - 0.4), zSign * (halfW - 0.4));
        }
      }
      return;
    }

    if (Math.abs(ball.pos.z) > halfW + 0.4 && this.state === 'PLAY') {
      const zSign = Math.sign(ball.pos.z);
      const toTeam = ball.lastTouch ? this.otherTeam(ball.lastTouch.team) : this.teamA;
      ball.owner = null;
      this.enterSetPiece('throwin', toTeam,
        clamp(ball.pos.x, -halfL + 1.5, halfL - 1.5), zSign * (halfW - 0.2));
    }
  }

  setFirstKicker(team) { this.firstHalfKicker = team; }

  // Blend each side's live style between its base DNA and a chasing/protecting
  // posture driven by the scoreline and how little time is left.
  _updateMood(team) {
    const myScore = team === this.teamA ? this.scoreA : this.scoreB;
    const oppScore = team === this.teamA ? this.scoreB : this.scoreA;
    const d = myScore - oppScore;
    const frac = clamp(this.elapsed / (this.halfLen * 2), 0, 1);
    let mood = 0; // +1 all-out attack … -1 park the bus
    if (d < 0) mood = Math.min(2, -d) * 0.5 * (0.35 + 0.65 * frac);
    else if (d > 0 && frac > 0.45) mood = -Math.min(2, d) * 0.4 * ((frac - 0.45) / 0.55);
    team.mood = mood;
    // clutch stars swell when the side trails or the match enters its last quarter
    const bigMoment = d < 0 || frac > 0.75;
    for (const p of team.players) if (p.star?.clutch) p.clutchK = bigMoment ? 1.6 : 1;
    const b = team.baseStyle, s = team.style;
    s.line = clamp(b.line + 0.22 * mood, 0.05, 0.95);
    s.press = clamp(b.press + 0.18 * mood, 0.05, 0.95);
    s.risk = clamp(b.risk + 0.3 * mood, 0.05, 0.95);
    s.directness = clamp(b.directness + 0.18 * Math.abs(mood), 0.05, 0.95);
    s.counter = clamp(b.counter + 0.25 * Math.max(0, -mood), 0.05, 0.95);
    s.aggression = clamp(b.aggression + 0.2 * Math.max(0, mood), 0.05, 0.95);
    team.aggro = team.diff.tackleAggro * (0.7 + 0.6 * s.aggression);
    const regime = mood > 0.3 ? 'chasing' : mood < -0.2 ? 'protecting' : 'level';
    if (regime !== team.moodRegime) {
      team.moodRegime = regime;
      if (regime === 'chasing') this.hooks.coach?.(`${team.def.code}: chasing the game — higher line, more risks`);
      else if (regime === 'protecting') this.hooks.coach?.(`${team.def.code}: protecting the lead — sitting deep, hitting on the break`);
      else this.hooks.coach?.(`${team.def.code}: back to the game plan`);
    }
  }

  clockText() {
    const total = this.halfLen * 2;
    const mins = Math.floor((this.elapsed / total) * 90);
    if (this.golden) return `${mins}'  ·  golden goal`;
    if (this.halves === 1) return `${Math.min(90, mins)}'`;
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
