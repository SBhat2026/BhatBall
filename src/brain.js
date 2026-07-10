// Team-brain: once per decision tick each side builds role SLOTS (press /
// mark-runner-X / cut-lane-X / cover / support / run-behind / hold-width /
// overlap / recover / anchor), scores every player against every slot with
// the same football-utility formulas as ever, and solves the whole matrix
// with a tiny Hungarian assignment — so exactly one body takes each unique
// job and nobody double-claims. Gaussian noise lives in the matrix, so the
// side occasionally picks a near-best allocation and no two matches read
// the same. Hard rules (owner dribbles, receiver intercepts, nearest
// chases) still run per player and pre-empt assignment; the tiny policy
// net still nudges exactly where a player stands within their role.
// On-ball decisions (shoot / pass / through / cross / dribble / clear /
// hold) keep their softmax.
import * as THREE from 'three';
import { FIELD, PLAYER, clamp, rand } from './config.js';
import { ROLE_ATT } from './tactics.js';
import { interceptPoint, laneBlocked } from './ai.js';
import { runNet } from './policy.js';
import { starMul, starAdd } from './stars.js';

const _v = new THREE.Vector3();

function distXZ(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
const gauss = () => (Math.random() + Math.random() + Math.random()) * 2 / 3 - 1;

// role weight tables per candidate action
const W_PRESS = { CB: 0.5, FB: 0.8, WB: 0.85, DM: 1.05, CM: 1.0, WM: 0.95, AM: 0.9, W: 0.85, ST2: 0.9, ST: 0.85 };
const W_MARK = { CB: 1.25, FB: 1.0, WB: 0.9, DM: 0.8, CM: 0.4 };
const W_COVER = { CB: 1.0, DM: 1.1, FB: 0.6, WB: 0.6, CM: 0.5 };
const W_SUPPORT = { CM: 1.2, DM: 1.0, AM: 1.2, WM: 1.0, ST2: 1.1, FB: 0.5, WB: 0.6, W: 0.6, CB: 0.2, ST: 0.5 };
const W_RUN = { ST: 1.3, ST2: 1.2, W: 1.1, AM: 0.9, WM: 0.7, CM: 0.35 };
const W_RECOVER = { CB: 1.2, FB: 1.2, WB: 1.1, DM: 1.1, CM: 1.0, WM: 0.9, AM: 0.6, W: 0.5, ST2: 0.5, ST: 0.4 };
const W_LANE = { DM: 1.15, CM: 0.95, CB: 0.55, FB: 0.75, WB: 0.75, WM: 0.6, AM: 0.4 };

const URGENCY = {
  press: 1, chase: 1, intercept: 1, recover: 1,
  runBehind: 0.95, overlap: 0.9, mark: 0.85, lane: 0.88,
  support: 0.78, holdWidth: 0.78, cover: 0.85, anchor: 0.72, dribble: 0.95,
};
const SOFT = new Set(['anchor', 'support', 'holdWidth', 'cover']); // policy-net acts

const NO_ADAPT = { shiftZ: 0, closeDown: 0, lineDrop: 0, wideDeep: 0, tackleBoost: 0 };

const _in = new Float64Array(16);
const _out = new Float64Array(2);

// --- world snapshot -----------------------------------------------------------
// The reusable spatial facts every decision reads, computed once per tick
// instead of re-scanned inside nested candidate loops. `facts` covers every
// player (GKs included, matching the old per-site scans); per-team entries
// hold the defensive line, carrier pressure, and current assignment counts.
export function buildWorld(match) {
  const ball = match.ball;
  const all = [...match.teamA.players, ...match.teamB.players];
  const facts = new Map(); // player → { opp, oppD, mate, mateD }
  for (const p of all) facts.set(p, { opp: null, oppD: 1e9, mate: null, mateD: 1e9 });
  for (let i = 0; i < all.length; i++) {
    const a = all[i], fa = facts.get(a);
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j], fb = facts.get(b);
      const d = distXZ(a.pos, b.pos);
      if (a.team === b.team) {
        if (d < fa.mateD) { fa.mateD = d; fa.mate = b; }
        if (d < fb.mateD) { fb.mateD = d; fb.mate = a; }
      } else {
        if (d < fa.oppD) { fa.oppD = d; fa.opp = b; }
        if (d < fb.oppD) { fb.oppD = d; fb.opp = a; }
      }
    }
  }
  const K = FIELD.halfL / 52.5;
  const teams = new Map();
  for (const team of [match.teamA, match.teamB]) {
    const opp = match.otherTeam(team);
    let oppLine = -1e9; // opponents' last outfield defender, in our attacking coords
    for (const o of opp.players) if (!o.isGK) oppLine = Math.max(oppLine, o.pos.x * team.dir);
    let pressers = 0, runners = 0, nearBall = null, nearBallD = 1e9, ballCrowd = 0;
    for (const p of team.players) {
      if (p.act === 'press' || p.act === 'chase') pressers++;
      else if (p.act === 'runBehind') runners++;
      if (p.isGK) continue;
      if (distXZ(p.pos, ball.pos) < 6 * K) ballCrowd++;
      if (p.isHuman) continue;
      const d = distXZ(p.pos, ball.pos);
      if (d < nearBallD) { nearBallD = d; nearBall = p; }
    }
    const carrier = ball.owner;
    teams.set(team, {
      oppLine, pressers, runners, nearBall, nearBallD, ballCrowd,
      press: carrier && carrier.team === team ? facts.get(carrier).oppD : 1e9,
    });
  }
  return { facts, teams };
}

// --- Hungarian assignment (e-maxx potentials, minimization, n ≤ m) -------------
// Tiny matrices (≤10 players × ~25 slots) so the O(n·m²) cost is negligible.
function hungarian(cost, n, m) {
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1);
  const match_ = new Int32Array(m + 1), way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    match_[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(Infinity);
    const used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = match_[j0];
      let delta = Infinity, j1 = -1;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[match_[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (match_[j0] !== 0);
    do { const j1 = way[j0]; match_[j0] = match_[j1]; j0 = j1; } while (j0);
  }
  const res = new Int32Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (match_[j] > 0) res[match_[j] - 1] = j - 1;
  return res;
}

// --- team intent ---------------------------------------------------------------
// One shared posture per side, derived from mood + transition state, that
// biases the whole cost matrix so the unit shifts together.
const INTENT_BIAS = {
  counterpress: { press: 3, lane: 1.5, recover: 2 },
  commit: { runBehind: 2, support: 1.5, overlap: 1.5 },
  bunker: { mark: 1.5, cover: 2, runBehind: -2 },
  build: {}, shape: {}, balance: {},
};

function teamIntent(C) {
  if (C.transD && C.style.press > 0.55) return 'counterpress';
  if (C.attacking && (C.mood > 0.3 || (C.transA && C.style.counter > 0.6))) return 'commit';
  if (C.defending && C.mood < -0.2) return 'bunker';
  if (C.attacking) return 'build';
  if (C.defending) return 'shape';
  return 'balance';
}

// --- role slots ----------------------------------------------------------------
// Each slot: { act, score(p) → number|null (null = ineligible), target(p) →
// {tx,tz}, markT? }. Score formulas are the pre-existing utility scores —
// the assignment layer only chooses among already-sane candidates.
function buildSlots(match, team, world, C, players) {
  const ball = match.ball;
  const { style, adapt, dir, goalX, ownGoalX, ballLX, mood, K } = C;
  const tw = C.tw;
  const IB = INTENT_BIAS[C.intent];
  const slots = [];
  const owner = ball.owner;
  const looseBall = !owner && !ball.heldBy;

  // anchor: one per player so the assignment is always feasible — team shape,
  // phase-shifted, exactly the old anchor candidate
  const anchorTarget = (p) => {
    let bias, tz;
    const att = ROLE_ATT[p.role] ?? 0.5;
    // squeeze: when the ball lives in the far third the back line steps up
    // toward halfway to compress the pitch (the keeper sweeps behind it)
    const squeeze = att <= 0.45 && ballLX > FIELD.halfL * 0.3
      ? Math.min((ballLX - FIELD.halfL * 0.3) * 0.42, 13 * K) * (0.55 + style.line * 0.6)
      : 0;
    if (C.attacking) {
      bias = (11 + att * 9 + mood * 5) * K + squeeze;
      tz = p.base.z * (0.72 + style.width * 0.5) + ball.pos.z * 0.15;
    } else if (C.defending) {
      const lineK = clamp(style.line - adapt.lineDrop, 0.1, 1);
      bias = (-12 + (lineK - 0.5) * 16) * K + squeeze * 0.6;
      tz = p.base.z * 0.8 + ball.pos.z * 0.32;
      if (W_MARK[p.role]) tz += adapt.shiftZ;
    } else {
      bias = squeeze * 0.8;
      tz = p.base.z * 0.9 + ball.pos.z * 0.24;
    }
    let tx = dir * (p.base.x + bias) + ball.pos.x * 0.3;
    if (C.defending && (p.role === 'FB' || p.role === 'WB') && adapt.wideDeep > 0) {
      tx -= dir * 3.2 * adapt.wideDeep * K;
      tz *= 1 + 0.18 * adapt.wideDeep;
    }
    return { tx, tz };
  };
  for (let i = 0; i < players.length; i++) {
    slots.push({ act: 'anchor', score: () => 5, target: anchorTarget });
  }

  if (C.defending) {
    // press the carrier: up to maxPress bodies, extra pressers need a stronger case
    const gate = (9 + style.press * 13 + adapt.closeDown * 5) * K;
    for (let k = 0; k < C.maxPress; k++) {
      slots.push({
        act: 'press',
        score: (p) => {
          const dBall = distXZ(p.pos, ball.pos);
          if (dBall >= gate) return null;
          const pw = W_PRESS[p.role] ?? 0.7;
          let s = (13 - dBall * 0.5 / K) * pw + style.press * 4 + adapt.closeDown * 3 - k * 2.5;
          if (C.transD && style.press > 0.6) s += 4; // counter-press window
          return s + (IB.press ?? 0);
        },
        target: (p) => {
          // carrier held up close: jockey the goal-side gap instead of flying
          // past the ball — contain, and let the tackle reflex pick its moment
          if (owner && distXZ(p.pos, owner.pos) < 4.5) {
            const gx = ownGoalX - owner.pos.x, gz = -owner.pos.z;
            const gl = Math.hypot(gx, gz) || 1;
            return { tx: owner.pos.x + (gx / gl) * 1.3, tz: owner.pos.z + (gz / gl) * 1.3 };
          }
          interceptPoint(ball, p, PLAYER.speed * C.diff.speed, _v);
          return { tx: _v.x, tz: _v.z };
        },
      });
    }
    // dangerous runners, ranked once — mark slots for the top three,
    // lane-cut slots shadow the top two passing options
    const dangers = [];
    for (const o of C.opp.players) {
      if (o.isGK || o === owner) continue;
      const dOG = Math.hypot(o.pos.x - ownGoalX, o.pos.z);
      if (dOG > 44 * K) continue;
      dangers.push({ o, dOG, danger: (44 * K - dOG) * 0.35 + (ROLE_ATT[o.role] ?? 0.5) * 6 });
    }
    dangers.sort((a, b) => b.danger - a.danger);
    for (const dg of dangers.slice(0, 3)) {
      slots.push({
        act: 'mark', markT: dg.o,
        score: (p) => {
          const mw = W_MARK[p.role];
          if (!mw) return null;
          return 4.5 + dg.danger * mw - distXZ(p.pos, dg.o.pos) * 0.35 + (IB.mark ?? 0);
        },
        // tighter: sit closer to the runner's goal-side shoulder, track their z
        target: () => ({
          tx: dg.o.pos.x + (ownGoalX - dg.o.pos.x) * 0.08 + dg.o.vel.x * 0.25,
          tz: dg.o.pos.z + (0 - dg.o.pos.z) * 0.05 + dg.o.vel.z * 0.25 + adapt.shiftZ * 0.3,
        }),
      });
    }
    if (owner) {
      for (const dg of dangers.slice(0, 2)) {
        if (distXZ(dg.o.pos, ball.pos) > 30 * K) continue;
        const mid = { x: (ball.pos.x + dg.o.pos.x) / 2, z: (ball.pos.z + dg.o.pos.z) / 2 };
        slots.push({
          act: 'lane',
          score: (p) => {
            const lw = W_LANE[p.role];
            if (!lw) return null;
            return (8.2 + style.press * 3) * lw
              - Math.hypot(p.pos.x - mid.x, p.pos.z - mid.z) * 0.12 + (IB.lane ?? 0);
          },
          target: () => ({ tx: mid.x, tz: mid.z }),
        });
      }
    }
    // cover the central lane goal-side of the ball (two depths: screen + sweeper)
    if (ballLX < 6 * K) {
      const dx = ball.pos.x - ownGoalX, dz = ball.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      for (const depthK of [0.4, 0.62]) {
        const depth = clamp(dl * depthK, 7 * K, 18 * K);
        slots.push({
          act: 'cover',
          score: (p) => {
            const cw = W_COVER[p.role];
            if (!cw) return null;
            return (9 + (Math.abs(ball.pos.z) < FIELD.halfW * 0.35 ? 2 : 0)) * cw
              - distXZ(p.pos, ball.pos) * 0.08 + (IB.cover ?? 0);
          },
          target: () => ({ tx: ownGoalX + (dx / dl) * depth, tz: (dz / dl) * depth * 0.8 }),
        });
      }
    }
    // recover: caught upfield in transition
    if (C.transD) {
      for (let k = 0; k < 2; k++) {
        slots.push({
          act: 'recover',
          score: (p) => {
            if (p.pos.x * dir <= ballLX - 2 * K) return null;
            return (10 + style.counter * 2) * (W_RECOVER[p.role] ?? 0.8) + (IB.recover ?? 0);
          },
          target: (p) => ({ tx: ball.pos.x - dir * 6 * K, tz: p.base.z * 0.6 + ball.pos.z * 0.3 }),
        });
      }
    }
  } else if (C.attacking && owner) {
    const buildup = team.buildupT > 0;
    // give-and-go: whoever just released a pass bursts for the return
    slots.push({
      act: 'runBehind',
      score: (p) => (p.oneTwoT > 0 && p !== owner && distXZ(p.pos, owner.pos) < 26 * K
        ? 10.5 + style.chemistry * 3 : null),
      target: (p) => ({
        tx: clamp(owner.pos.x + dir * 11 * K, -FIELD.halfL + 3, FIELD.halfL - 3),
        tz: clamp((p.pos.z + owner.pos.z) * 0.5, -FIELD.halfW + 3, FIELD.halfW - 3),
      }),
    });
    // support: each player's best open spot at passing distance, found once
    const spots = new Map();
    for (const p of players) {
      if (p === owner || (W_SUPPORT[p.role] ?? 0.5) <= 0.3) continue;
      const baseAng = Math.atan2(-owner.pos.z * 0.25, dir);
      let bestSpot = null, bestS = -1e9;
      for (const da of [-1.05, -0.45, 0, 0.45, 1.05]) {
        const a = baseAng + da;
        const sx = owner.pos.x + Math.cos(a) * 10 * K;
        const sz = owner.pos.z + Math.sin(a) * 10 * K;
        if (Math.abs(sx) > FIELD.halfL - 2 || Math.abs(sz) > FIELD.halfW - 2) continue;
        let open = 1e9;
        for (const o of C.opp.players) open = Math.min(open, Math.hypot(o.pos.x - sx, o.pos.z - sz));
        let s = Math.min(open, 8) * 0.7 + (sx - owner.pos.x) * dir * 0.15
          - Math.hypot(p.pos.x - sx, p.pos.z - sz) * 0.22
          + (laneBlocked(match, owner, sx, sz) ? -3 : 3);
        let mateNear = 1e9; // don't offer where a teammate already stands
        for (const m2 of team.players) {
          if (m2 === p || m2 === owner || m2.isGK) continue;
          mateNear = Math.min(mateNear, Math.hypot(m2.pos.x - sx, m2.pos.z - sz));
        }
        if (mateNear < 5) s -= (5 - mateNear) * 0.9;
        if (s > bestS) { bestS = s; bestSpot = { tx: sx, tz: sz }; }
      }
      if (bestSpot) spots.set(p, { spot: bestSpot, s: bestS });
    }
    for (let k = 0; k < 3; k++) {
      slots.push({
        act: 'support',
        score: (p) => {
          const e = spots.get(p);
          if (!e) return null;
          return (6 + e.s) * (W_SUPPORT[p.role] ?? 0.5) + (buildup ? 1.5 : 0) + (IB.support ?? 0);
        },
        target: (p) => spots.get(p)?.spot ?? anchorTarget(p),
      });
    }
    // runs in behind the last defender
    for (let k = 0; k < C.maxRun; k++) {
      slots.push({
        act: 'runBehind',
        score: (p) => {
          const rw = W_RUN[p.role];
          if (!rw || p === owner || ballLX <= -10 * K || distXZ(p.pos, owner.pos) >= 38 * K) return null;
          return (7 + style.counter * 3 + style.chemistry * 2 + (C.transA ? 3 : 0)) * rw
            + (buildup ? 2.5 : 0) + (IB.runBehind ?? 0) + starAdd(p, 'runner');
        },
        target: (p) => ({
          tx: dir * Math.min(tw.oppLine + 3 * K, FIELD.halfL - 3),
          tz: (p.role === 'ST' || p.role === 'ST2')
            ? clamp(p.pos.z * 0.4, -6 * K, 6 * K)
            : Math.sign(p.base.z || 1) * FIELD.halfW * 0.32,
        }),
      });
    }
    // hold width — one slot per flank so the wings never stack
    for (const side of [-1, 1]) {
      slots.push({
        act: 'holdWidth',
        score: (p) => {
          if (p.role !== 'W' && p.role !== 'WM' && p.role !== 'WB') return null;
          if (Math.sign(p.base.z || 1) !== side) return null;
          return 6 + style.width * 3
            - (Math.sign(ball.pos.z) === side && Math.abs(ball.pos.z) > FIELD.halfW * 0.4 ? 2 : 0);
        },
        target: () => ({
          tx: clamp(ball.pos.x * 0.6 + dir * 8 * K, -FIELD.halfL + 3, FIELD.halfL - 3),
          tz: side * FIELD.halfW * (0.5 + style.width * 0.35),
        }),
      });
    }
    // overlap down the ball-side flank
    if (Math.abs(ball.pos.z) > FIELD.halfW * 0.25 && ballLX > -8 * K) {
      slots.push({
        act: 'overlap',
        score: (p) => {
          if (p.role !== 'FB' && p.role !== 'WB') return null;
          if (Math.sign(ball.pos.z) !== Math.sign(p.base.z || 1)) return null;
          return 5.5 + style.width * 5 + (C.transA ? style.counter * 2 : 0)
            - distXZ(p.pos, ball.pos) * 0.15 + (p.role === 'WB' ? 1.5 : 0) + (IB.overlap ?? 0);
        },
        target: (p) => ({
          tx: clamp(ball.pos.x + dir * 11 * K, -FIELD.halfL + 3, FIELD.halfL - 3),
          tz: Math.sign(p.base.z) * (FIELD.halfW - 4 * K),
        }),
      });
    }
  } else if (looseBall) {
    // one extra body toward a loose ball (the nearest is already hard-ruled)
    slots.push({
      act: 'chase2',
      score: (p) => {
        const dBall = distXZ(p.pos, ball.pos);
        return dBall < 20 * K ? 8 - dBall * 0.3 : null;
      },
      target: () => ({ tx: ball.pos.x, tz: ball.pos.z }),
    });
  }

  return slots;
}

function assignRoles(match, team, world, players, C) {
  const slots = buildSlots(match, team, world, C, players);
  const n = players.length, m = slots.length;
  const BIG = 1e6;
  const cost = [];
  for (const p of players) {
    const row = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      const s = slots[j].score(p);
      // noise + stickiness live in the matrix: the team occasionally commits
      // to a near-best allocation instead of the mathematically top one
      row[j] = s == null ? BIG : -(s + gauss() * 0.7 + (p.act === slots[j].act ? 0.9 : 0));
    }
    cost.push(row);
  }
  const asg = hungarian(cost, n, m);

  const attacking = C.attacking, defending = C.defending;
  for (let i = 0; i < n; i++) {
    const p = players[i];
    let s = asg[i] >= 0 && cost[i][asg[i]] < BIG / 2 ? slots[asg[i]] : null;
    if (!s) s = slots[i]; // player's own anchor slot — always feasible
    p.act = s.act;
    p.markT = s.markT ?? null;
    p.urgency = URGENCY[s.act] ?? 0.75;
    const t = s.target(p);
    let tx = t.tx, tz = t.tz;
    // learned micro-positioning: tiny clamped offset on soft assignments
    if (team.policyNet && SOFT.has(s.act)) {
      policyInputs(match, team, p, attacking, defending, tx, tz, world.facts.get(p));
      runNet(team.policyNet, _in, _out);
      tx += _out[0] * C.dir;
      tz += _out[1];
    }
    p.target.set(
      clamp(tx, -FIELD.halfL + 1.5, FIELD.halfL - 1.5), 0,
      clamp(tz, -FIELD.halfW + 1.5, FIELD.halfW - 1.5),
    );
  }
}

// --- per-tick driver ------------------------------------------------------------

export function updateBrains(match, dt) {
  const ball = match.ball;
  const K = FIELD.halfL / 52.5;
  const world = buildWorld(match);
  match._world = world; // decideOnBall (called from the control step) reads it too

  for (const team of [match.teamA, match.teamB]) {
    if (team.buildupT > 0) team.buildupT -= dt; // post-pass surge window (human release)
    const style = team.style, adapt = team.adapt ?? NO_ADAPT, diff = team.diff;
    const tw = world.teams.get(team);
    const attacking = match.controllerTeam === team;
    const defending = !!match.controllerTeam && !attacking;
    const trans = match.transT < 2.5;
    const dir = team.dir;
    const mood = team.mood ?? 0;
    const C = {
      style, adapt, diff, tw, attacking, defending, mood, dir, K,
      transA: attacking && trans, transD: defending && trans,
      goalX: dir * FIELD.halfL, ownGoalX: -dir * FIELD.halfL,
      ballLX: ball.pos.x * dir,
      opp: match.otherTeam(team),
      maxPress: 1 + Math.round(style.press * 2 + adapt.closeDown),
      maxRun: (style.chemistry > 0.8 ? 3 : 2) + (mood > 0.5 ? 1 : 0),
    };
    C.intent = teamIntent(C);
    if (C.intent !== team.intent) {
      team.intent = C.intent;
      match.hooks?.coach?.(`${team.def.code}: intent → ${C.intent}`);
    }

    const looseBall = !ball.owner && !ball.heldBy;
    const assignable = [];
    for (const p of team.players) {
      if (p.isGK || p.isHuman) continue;
      p.aiT -= dt;
      if (p.oneTwoT > 0) p.oneTwoT -= dt; // give-and-go window after playing a pass

      // tackle reflex runs every frame, thoughts are throttled — pick moments:
      // pounce on a heavy touch or from a goal-side angle; rarely dive in from
      // behind (those are the tackles the new foul rules punish)
      if (defending && !p.tackleT && !p.stunT) {
        const d = distXZ(p.pos, ball.pos);
        if (d < 1.9) {
          const own = ball.owner;
          const heavy = own && distXZ(own.pos, ball.pos) > 0.75;
          const goalSide = own && (p.pos.x - own.pos.x) * dir < 0;
          const odds = heavy ? 0.36 : goalSide ? 0.22 : 0.07;
          if (Math.random() < team.aggro * odds * (1 + adapt.tackleBoost)) match.tackle(p);
        }
      }

      // hard rules refresh on the personal clock and pre-empt assignment
      if (p.aiT <= 0) {
        p.aiT = diff.react + Math.random() * 0.08;
        if (ball.owner === p) {
          dribbleMove(match, p, dir, K, style, world.facts.get(p));
          p.act = 'dribble';
          p.urgency = URGENCY.dribble;
          p.hard = true;
        } else if (ball.intendedReceiver === p) {
          interceptPoint(ball, p, PLAYER.speed * diff.speed, p.target);
          p.act = 'intercept'; p.urgency = 1;
          p.hard = true;
        } else if (p === tw.nearBall && (looseBall || defending)) {
          // chasing a held ball at close range: jockey goal-side of the carrier
          // rather than running straight through them
          if (defending && ball.owner && distXZ(p.pos, ball.owner.pos) < 4.5) {
            const o2 = ball.owner;
            const gx = -dir * FIELD.halfL - o2.pos.x, gz = -o2.pos.z;
            const gl = Math.hypot(gx, gz) || 1;
            p.target.set(o2.pos.x + (gx / gl) * 1.3, 0, o2.pos.z + (gz / gl) * 1.3);
          } else interceptPoint(ball, p, PLAYER.speed * diff.speed, p.target);
          p.act = 'chase'; p.urgency = 1;
          p.hard = true;
        } else p.hard = false;
      }
      if (!p.hard) assignable.push(p);
    }

    // team decision tick: allocate roles across the whole unit at once
    team.assignT = (team.assignT ?? 0) - dt;
    if (team.assignT <= 0 && assignable.length) {
      team.assignT = diff.react * 1.35 + Math.random() * 0.08;
      assignRoles(match, team, world, assignable, C);
    }
  }
}

function dribbleMove(match, p, dir, K, style, f) {
  const nearestO = f?.opp ?? null;
  const nd = f?.oppD ?? 1e9;
  let veer = 0;
  if (nearestO && nd < 6) {
    veer = (Math.sign(p.pos.z - nearestO.pos.z) || (Math.random() < 0.5 ? 1 : -1))
      * (6 - nd) * (1.2 + style.flair * 0.6);
  }
  // wingers stay wide while carrying; central players attack the box
  const zPull = (p.role === 'W' || p.role === 'WM') ? 0.98 : 0.9;
  p.target.set(
    clamp(p.pos.x + dir * 12 * K, -FIELD.halfL + 2, FIELD.halfL - 2), 0,
    clamp(p.pos.z * zPull + veer, -FIELD.halfW + 2, FIELD.halfW - 2),
  );
}

function policyInputs(match, team, p, attacking, defending, tx, tz, f) {
  const ball = match.ball, dir = team.dir;
  let ox = 0, oz = 0, mx = 0, mz = 0;
  if (f?.opp) { ox = f.opp.pos.x - p.pos.x; oz = f.opp.pos.z - p.pos.z; }
  if (f?.mate) { mx = f.mate.pos.x - p.pos.x; mz = f.mate.pos.z - p.pos.z; }
  _in[0] = p.pos.x * dir / FIELD.halfL;
  _in[1] = p.pos.z / FIELD.halfW;
  _in[2] = (ball.pos.x - p.pos.x) * dir / 20;
  _in[3] = (ball.pos.z - p.pos.z) / 20;
  _in[4] = ball.vel.x * dir / 20;
  _in[5] = ball.vel.z / 20;
  _in[6] = attacking ? 1 : defending ? -1 : 0;
  _in[7] = ox * dir / 10; _in[8] = oz / 10;
  _in[9] = mx * dir / 10; _in[10] = mz / 10;
  _in[11] = (tx - p.pos.x) * dir / 10;
  _in[12] = (tz - p.pos.z) / 10;
  _in[13] = ROLE_ATT[p.role] ?? 0.5;
  _in[14] = attacking ? 1 : defending ? -1 : 0;
  _in[15] = clamp(match.elapsed / (match.halfLen * 2), 0, 1);
}

// --- on-ball decision --------------------------------------------------------

export function decideOnBall(match, p) {
  const team = p.team, style = team.style, diff = team.diff, ball = match.ball;
  const K = FIELD.halfL / 52.5;
  const dir = team.dir;
  const goalX = dir * FIELD.halfL;
  const dGoal = Math.hypot(goalX - p.pos.x, p.pos.z);
  const ballLX = p.pos.x * dir;
  const facts = match._world?.facts;

  const press = facts?.get(p)?.oppD ?? 1e9;

  const acts = [];

  // shoot
  if (dGoal < 30 * K && Math.abs(p.pos.z) < FIELD.halfW * 0.65) {
    let blockers = 0;
    for (const o of match.opponentsOf(team)) {
      if (o.isGK) continue;
      const along = (o.pos.x - p.pos.x) * dir;
      if (along > 0.5 && along < dGoal && Math.abs(o.pos.z - p.pos.z * (1 - along / dGoal)) < 1.6) blockers++;
    }
    let s = (30 * K - dGoal) * (0.55 / K) + style.risk * 3 - blockers * 3 - Math.abs(p.pos.z) * 0.12 / K
      + (starMul(p, 'finish') - 1) * 12;
    if (dGoal < 11 * K) s += 6;
    acts.push({ n: 'shoot', s, run: () => execShoot(match, p, dGoal, goalX, K) });
  }

  // passes (incl. through balls)
  let bestMate = null, bestPass = -1e9, bestThrough = null, bestThroughS = -1e9;
  for (const mate of team.players) {
    if (mate === p || mate.isGK) continue;
    const d = distXZ(mate.pos, p.pos);
    if (d < 4 * K || d > 34) continue;
    const progress = (mate.pos.x - p.pos.x) * dir;
    const open = facts?.get(mate)?.oppD ?? 1e9;
    const blocked = d < 15 && laneBlocked(match, p, mate.pos.x, mate.pos.z);
    let s = progress * (1.0 + style.directness * 1.2) / K + Math.min(open, 8) * 1.3 - d * 0.2 - (blocked ? 12 : 0)
      + style.chemistry * 2 + (mate.isHuman ? 4 : 0);
    if (progress < -5 * K) s -= 2 + 8 * style.directness;
    if (s > bestPass) { bestPass = s; bestMate = mate; }
    // through: feed a runner into space
    const running = mate.act === 'runBehind' || mate.vel.x * dir > 2.5;
    if (running && progress > 4 * K && !blocked) {
      const ts = 6 + style.directness * 4 + style.counter * 2 + Math.min(open, 8) * 0.8 + style.chemistry * 1.5
        + (match.transTeam === team && match.transT < 2.5 ? 2 : 0); // spring the counter
      if (ts > bestThroughS) { bestThroughS = ts; bestThrough = mate; }
    }
  }
  if (bestMate) {
    const gate = press < 2.2 ? 4 : 0; // pressured: passing gets urgent
    acts.push({ n: 'pass', s: bestPass * 0.55 + gate, run: () => execPass(match, p, bestMate, K) });
  }
  if (bestThrough) {
    acts.push({
      n: 'through', s: bestThroughS + (starMul(p, 'vision') - 1) * 15,
      run: () => execThrough(match, p, bestThrough, dir, K),
    });
  }

  // switch play: lofted diagonal to a free man on the far flank
  {
    let swMate = null, swS = -1e9;
    for (const mate of team.players) {
      if (mate === p || mate.isGK) continue;
      if (Math.abs(mate.pos.z - p.pos.z) < FIELD.halfW * 0.75) continue;
      const progress = (mate.pos.x - p.pos.x) * dir;
      if (progress < -8 * K) continue;
      const open = facts?.get(mate)?.oppD ?? 1e9;
      const s = Math.min(open, 10) * 0.9 + progress * 0.15 + style.width * 2;
      if (s > swS) { swS = s; swMate = mate; }
    }
    if (swMate && swS > 4) {
      acts.push({
        n: 'switch',
        s: 2 + style.width * 3 + (press < 2.5 ? 3 : 0) + swS * 0.35,
        run: () => execSwitch(match, p, swMate),
      });
    }
  }

  // cross from a wide channel
  if (Math.abs(p.pos.z) > FIELD.halfW * 0.5 && ballLX > FIELD.halfL * 0.4) {
    let boxMates = 0;
    for (const m of team.players) {
      if (m === p || m.isGK) continue;
      if ((goalX - m.pos.x) * dir < FIELD.boxL + 4 && Math.abs(m.pos.z) < FIELD.boxHalfW) boxMates++;
    }
    if (boxMates > 0) acts.push({ n: 'cross', s: 4 + boxMates * 2.5 + style.width * 2, run: () => execCross(match, p, goalX, dir, K) });
  }

  // dribble on (no kick — the carry movement handles it)
  {
    let ahead = 1e9;
    for (const o of match.opponentsOf(team)) {
      const along = (o.pos.x - p.pos.x) * dir;
      if (along > 0 && along < 7 && Math.abs(o.pos.z - p.pos.z) < 4) ahead = Math.min(ahead, along);
    }
    const space = ahead > 5;
    let s = 5 + style.flair * 3 + (space ? 4 : -2) - (press < 1.5 ? 3 : 0)
      + (starMul(p, 'dribble') - 1) * 8;
    if (match.transTeam === team && match.transT < 2.5) s += style.counter * 2;
    acts.push({ n: 'dribble', s, run: () => execFlair(match, p, style, press) });
  }

  // clear from danger
  if (ballLX < -FIELD.halfL * 0.55 && press < 3.5) {
    acts.push({
      n: 'clear', s: 8 + (press < 1.5 ? 6 : 0) + (1 - style.risk) * 3,
      run: () => {
        const d = _v.set(dir, 0, rand(-0.7, 0.7)).normalize();
        match.kickBall(p, d.x * 24, 8, d.z * 24, null);
      },
    });
  }

  // hold / shield
  acts.push({ n: 'hold', s: 1.5 + (1 - style.directness) * 2 - (press < 2 ? 2 : 0), run: () => {} });

  // softmax pick among the credible options
  let top = -1e9;
  for (const a of acts) top = Math.max(top, a.s);
  const pool = acts.filter((a) => a.s > top - 5);
  let sum = 0;
  for (const a of pool) { a.w = Math.exp((a.s - top) / 2.2); sum += a.w; }
  let r = Math.random() * sum;
  for (const a of pool) {
    r -= a.w;
    if (r <= 0) { a.run(); return; }
  }
  pool[pool.length - 1].run();
}

function execShoot(match, p, dGoal, goalX, K) {
  const diff = p.team.diff, style = p.team.style;
  const finesse = (style.flair > 0.55 || p.star?.finesse) && dGoal > 12 * K && dGoal < 24 * K
    && Math.random() < (p.star?.finesse ? 0.65 : 0.45);
  const err = (diff.shootErr * (1.05 - style.chemistry * 0.3) + dGoal * 0.003)
    * rand(-1, 1) / starMul(p, 'finish');
  const aimZ = (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.8) * FIELD.goalHalf;
  const ang = Math.atan2(aimZ - p.pos.z, goalX - p.pos.x) + err;
  if (finesse) {
    const side = Math.sign(p.pos.z || 1);
    const spd = 18.5 + rand(0, 3);
    match.kickBall(p, Math.cos(ang) * spd, spd * 0.11, Math.sin(ang) * spd,
      new THREE.Vector3(0, 5 * side * p.team.dir, 0), false, true);
    p.rig.finesseT = 0.55;
  } else {
    const spd = clamp(16 + (28 * K - dGoal) * 0.5 + rand(0, 4), 15, 27) + starAdd(p, 'power');
    match.kickBall(p, Math.cos(ang) * spd, spd * rand(0.07, 0.15), Math.sin(ang) * spd,
      new THREE.Vector3(0, rand(-3, 3), 0), false, true);
  }
}

function execPass(match, p, mate, K) {
  const diff = p.team.diff, style = p.team.style;
  const d = distXZ(mate.pos, p.pos);
  const spd = clamp(7 + d * 0.85, 9, 23);
  const t = d / spd;
  const err = diff.passErr * (1.1 - style.chemistry * 0.5) * rand(-1, 1) / starMul(p, 'vision');
  const tx = mate.pos.x + mate.vel.x * t * 0.8;
  const tz = mate.pos.z + mate.vel.z * t * 0.8;
  if (d > 14 && laneBlocked(match, p, tx, tz)) {
    // chip it over, backspin so it sits down
    const T = clamp(d / 15, 0.6, 1.5);
    const vx = (tx - p.pos.x) / T, vz = (tz - p.pos.z) / T;
    const l = Math.hypot(vx, vz) || 1;
    match.kickBall(p, vx, 9.81 * T / 2, vz, new THREE.Vector3((vz / l) * -5.5, 0, (-vx / l) * -5.5));
  } else {
    const ang = Math.atan2(tz - p.pos.z, tx - p.pos.x) + err;
    match.kickBall(p, Math.cos(ang) * spd, 0, Math.sin(ang) * spd, null);
  }
  match.ball.intendedReceiver = mate;
  p.oneTwoT = 2.2; // look for the return ball
  match.noteAI?.(p.team, 'pass');
}

// lofted cross-field diagonal, backspin so it sits down for the receiver
function execSwitch(match, p, mate) {
  const tx = mate.pos.x + mate.vel.x * 0.5;
  const tz = mate.pos.z + mate.vel.z * 0.5;
  const d = Math.hypot(tx - p.pos.x, tz - p.pos.z);
  const T = clamp(d / 16, 0.7, 1.6);
  const vx = (tx - p.pos.x) / T, vz = (tz - p.pos.z) / T;
  const l = Math.hypot(vx, vz) || 1;
  match.kickBall(p, vx, 9.81 * T / 2, vz, new THREE.Vector3((vz / l) * -5.5, 0, (-vx / l) * -5.5));
  match.ball.intendedReceiver = mate;
}

function execThrough(match, p, mate, dir, K) {
  const lead = (4 + 5 * p.team.style.directness) * K;
  const tx = mate.pos.x + dir * lead + mate.vel.x * 0.4;
  const tz = mate.pos.z * 0.96 + mate.vel.z * 0.4;
  const d = Math.hypot(tx - p.pos.x, tz - p.pos.z);
  const spd = clamp(9 + d * 0.85, 11, 25);
  const ang = Math.atan2(tz - p.pos.z, tx - p.pos.x)
    + p.team.diff.passErr * rand(-0.8, 0.8) / starMul(p, 'vision');
  const vx = Math.cos(ang) * spd, vz = Math.sin(ang) * spd;
  const l = Math.hypot(vx, vz) || 1;
  match.kickBall(p, vx, 0, vz, new THREE.Vector3((vz / l) * 4, 0, (-vx / l) * 4));
  match.ball.intendedReceiver = mate;
  p.oneTwoT = 2.2;
}

function execCross(match, p, goalX, dir, K) {
  const tx = goalX - dir * rand(5, 9) * K;
  const tz = rand(-6, 6) * K;
  const d = Math.hypot(tx - p.pos.x, tz - p.pos.z);
  const T = clamp(d / 15, 0.6, 1.5);
  const vx = (tx - p.pos.x) / T, vz = (tz - p.pos.z) / T;
  const l = Math.hypot(vx, vz) || 1;
  match.kickBall(p, vx, 9.81 * T / 2, vz, new THREE.Vector3((vz / l) * -5.5, 0, (-vx / l) * -5.5));
  let best = null, bd = 1e9;
  for (const m of p.team.players) {
    if (m === p || m.isGK) continue;
    const dd = Math.hypot(m.pos.x - tx, m.pos.z - tz);
    if (dd < bd) { bd = dd; best = m; }
  }
  match.ball.intendedReceiver = best;
}

function execFlair(match, p, style, press) {
  // tightly marked + flair: pop a sombrero over the marker
  if (press < 1.8 && Math.random() < style.flair * 0.12 * starMul(p, 'flair')) {
    match.kickBall(p,
      p.heading.x * 1.5 + p.vel.x * 0.5, 6.8,
      p.heading.z * 1.5 + p.vel.z * 0.5, null);
    p.rig.flickT = 0.4;
  }
  // otherwise: keep carrying — dribbleMove steers
}
