// Utility-based player brains. Every AI outfielder scores candidate actions
// (press / mark / cover / support / run-behind / overlap / hold-width / recover
// / anchor) weighted by role, team style DNA, match phase, and the scout's
// counter-adjustments — plus a little noise so no two matches read the same.
// On-ball decisions (shoot / pass / through / cross / dribble / clear / hold)
// go through a softmax so choices stay football-logical but not robotic.
import * as THREE from 'three';
import { FIELD, PLAYER, clamp, rand } from './config.js';
import { ROLE_ATT } from './tactics.js';
import { interceptPoint, laneBlocked } from './ai.js';
import { runNet } from './policy.js';

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

const URGENCY = {
  press: 1, chase: 1, intercept: 1, recover: 1,
  runBehind: 0.95, overlap: 0.9, mark: 0.85,
  support: 0.78, holdWidth: 0.78, cover: 0.85, anchor: 0.72, dribble: 0.95,
};

const NO_ADAPT = { shiftZ: 0, closeDown: 0, lineDrop: 0, wideDeep: 0, tackleBoost: 0 };

const _in = new Float64Array(16);
const _out = new Float64Array(2);

export function updateBrains(match, dt) {
  const ball = match.ball;
  const K = FIELD.halfL / 52.5;

  // per-team nearest outfield AI to the ball (the guaranteed hunter)
  const nearest = new Map();
  for (const team of [match.teamA, match.teamB]) {
    let best = null, bestD = 1e9;
    for (const p of team.players) {
      if (p.isGK || p.isHuman) continue;
      const d = distXZ(p.pos, ball.pos);
      if (d < bestD) { best = p; bestD = d; }
    }
    nearest.set(team, { best, bestD });
  }

  for (const team of [match.teamA, match.teamB]) {
    const style = team.style, adapt = team.adapt ?? NO_ADAPT, diff = team.diff;
    const opp = match.otherTeam(team);
    const attacking = match.controllerTeam === team;
    const defending = !!match.controllerTeam && !attacking;
    const trans = match.transT < 2.5;
    const transA = attacking && trans;
    const transD = defending && trans;
    const dir = team.dir;
    const goalX = dir * FIELD.halfL;      // goal we attack
    const ownGoalX = -goalX;
    const ballLX = ball.pos.x * dir;      // ball x in attacking coords

    // opponents' last outfield defender (for runs in behind)
    let oppLine = -1e9;
    for (const o of opp.players) if (!o.isGK) oppLine = Math.max(oppLine, o.pos.x * dir);

    // current assignment counts (for caps)
    let pressers = 0, runners = 0;
    for (const p of team.players) {
      if (p.act === 'press' || p.act === 'chase') pressers++;
      else if (p.act === 'runBehind') runners++;
    }
    const maxPress = 1 + Math.round(style.press * 2 + adapt.closeDown);
    const maxRun = style.chemistry > 0.8 ? 3 : 2;

    for (const p of team.players) {
      if (p.isGK || p.isHuman) continue;
      p.aiT -= dt;

      // tackle reflex runs every frame, thoughts are throttled
      if (defending && !p.tackleT && !p.stunT) {
        const d = distXZ(p.pos, ball.pos);
        if (d < 1.9 && Math.random() < team.aggro * 0.22 * (1 + adapt.tackleBoost)) match.tackle(p);
      }
      if (p.aiT > 0) continue;
      p.aiT = diff.react + Math.random() * 0.08;

      // --- hard rules ------------------------------------------------------
      if (ball.owner === p) { // carry: drive at goal, veer off the nearest defender
        dribbleMove(match, p, dir, K, style);
        p.act = 'dribble';
        p.urgency = URGENCY.dribble;
        continue;
      }
      if (ball.intendedReceiver === p) {
        interceptPoint(ball, p, PLAYER.speed * diff.speed, p.target);
        p.act = 'intercept'; p.urgency = 1;
        continue;
      }
      const near = nearest.get(team);
      const looseBall = !ball.owner && !ball.heldBy;
      if (p === near.best && (looseBall || defending)) {
        interceptPoint(ball, p, PLAYER.speed * diff.speed, p.target);
        p.act = 'chase'; p.urgency = 1;
        continue;
      }

      // --- utility candidates ----------------------------------------------
      const cands = [];
      const att = ROLE_ATT[p.role] ?? 0.5;
      const dBall = distXZ(p.pos, ball.pos);

      // anchor: team shape, phase-shifted
      {
        let bias, tz;
        if (attacking) {
          bias = (11 + att * 9) * K;
          tz = p.base.z * (0.72 + style.width * 0.5) + ball.pos.z * 0.15;
        } else if (defending) {
          const lineK = clamp(style.line - adapt.lineDrop, 0.1, 1);
          bias = (-12 + (lineK - 0.5) * 16) * K;
          tz = p.base.z * 0.8 + ball.pos.z * 0.32;
          if (W_MARK[p.role]) tz += adapt.shiftZ;
        } else {
          bias = 0;
          tz = p.base.z * 0.9 + ball.pos.z * 0.24;
        }
        let tx = dir * (p.base.x + bias) + ball.pos.x * 0.3;
        if (defending && (p.role === 'FB' || p.role === 'WB') && adapt.wideDeep > 0) {
          tx -= dir * 3.2 * adapt.wideDeep * K;
          tz *= 1 + 0.18 * adapt.wideDeep;
        }
        cands.push({ act: 'anchor', tx, tz, s: 5 });
      }

      if (defending) {
        // press the carrier
        const pw = W_PRESS[p.role] ?? 0.7;
        const gate = (9 + style.press * 13 + adapt.closeDown * 5) * K;
        if (dBall < gate && pressers < maxPress) {
          interceptPoint(ball, p, PLAYER.speed * diff.speed, _v);
          let s = (13 - dBall * 0.5 / K) * pw + style.press * 4 + adapt.closeDown * 3;
          if (transD && style.press > 0.6) s += 4; // counter-press window
          cands.push({ act: 'press', tx: _v.x, tz: _v.z, s });
        }
        // mark a dangerous runner
        const mw = W_MARK[p.role];
        if (mw) {
          let bestO = null, bestS = -1e9;
          for (const o of opp.players) {
            if (o.isGK || o === ball.owner) continue;
            const dOG = Math.hypot(o.pos.x - ownGoalX, o.pos.z);
            if (dOG > 44 * K) continue;
            let claimed = false;
            for (const p2 of team.players) if (p2 !== p && p2.markT === o) { claimed = true; break; }
            if (claimed) continue;
            const danger = (44 * K - dOG) * 0.35 + (ROLE_ATT[o.role] ?? 0.5) * 6;
            const s = 3.5 + danger * mw - distXZ(p.pos, o.pos) * 0.35;
            if (s > bestS) { bestS = s; bestO = o; }
          }
          if (bestO) {
            const tx = bestO.pos.x + (ownGoalX - bestO.pos.x) * 0.14;
            const tz = bestO.pos.z + (0 - bestO.pos.z) * 0.08 + adapt.shiftZ * 0.3;
            cands.push({ act: 'mark', tx, tz, s: bestS, markT: bestO });
          }
        }
        // cover the central lane goal-side of the ball
        const cw = W_COVER[p.role];
        if (cw && ballLX < 6 * K) {
          const dx = ball.pos.x - ownGoalX, dz = ball.pos.z;
          const dl = Math.hypot(dx, dz) || 1;
          const depth = clamp(dl * 0.4, 7 * K, 15 * K);
          cands.push({
            act: 'cover',
            tx: ownGoalX + (dx / dl) * depth, tz: (dz / dl) * depth * 0.8,
            s: (9 + (Math.abs(ball.pos.z) < FIELD.halfW * 0.35 ? 2 : 0)) * cw - dBall * 0.08,
          });
        }
        // recover: caught upfield in transition
        if (transD && p.pos.x * dir > ballLX - 2 * K) {
          cands.push({
            act: 'recover',
            tx: ball.pos.x - dir * 6 * K, tz: p.base.z * 0.6 + ball.pos.z * 0.3,
            s: (10 + style.counter * 2) * (W_RECOVER[p.role] ?? 0.8),
          });
        }
      } else if (attacking && ball.owner && ball.owner !== p) {
        const owner = ball.owner;
        // support: find an open spot at passing distance
        const sw = W_SUPPORT[p.role] ?? 0.5;
        if (sw > 0.3) {
          const baseAng = Math.atan2(-owner.pos.z * 0.25, dir);
          let bestSpot = null, bestS = -1e9;
          for (const da of [-1.05, -0.45, 0, 0.45, 1.05]) {
            const a = baseAng + da;
            const sx = owner.pos.x + Math.cos(a) * 10 * K;
            const sz = owner.pos.z + Math.sin(a) * 10 * K;
            if (Math.abs(sx) > FIELD.halfL - 2 || Math.abs(sz) > FIELD.halfW - 2) continue;
            let open = 1e9;
            for (const o of opp.players) open = Math.min(open, Math.hypot(o.pos.x - sx, o.pos.z - sz));
            let s = Math.min(open, 8) * 0.7 + (sx - owner.pos.x) * dir * 0.15
              - Math.hypot(p.pos.x - sx, p.pos.z - sz) * 0.22
              + (laneBlocked(match, owner, sx, sz) ? -3 : 3);
            if (s > bestS) { bestS = s; bestSpot = { sx, sz }; }
          }
          if (bestSpot) cands.push({ act: 'support', tx: bestSpot.sx, tz: bestSpot.sz, s: (6 + bestS) * sw });
        }
        // run in behind the last defender
        const rw = W_RUN[p.role];
        if (rw && ballLX > -10 * K && runners < maxRun && distXZ(p.pos, owner.pos) < 38 * K) {
          const txl = Math.min(oppLine + 3 * K, FIELD.halfL - 3);
          const tz = (p.role === 'ST' || p.role === 'ST2')
            ? clamp(p.pos.z * 0.4, -6 * K, 6 * K)
            : Math.sign(p.base.z || 1) * FIELD.halfW * 0.32;
          cands.push({
            act: 'runBehind', tx: dir * txl, tz,
            s: (7 + style.counter * 3 + style.chemistry * 2 + (transA ? 3 : 0)) * rw,
          });
        }
        // hold width
        if (p.role === 'W' || p.role === 'WM' || p.role === 'WB') {
          const sgn = Math.sign(p.base.z || 1);
          cands.push({
            act: 'holdWidth',
            tx: clamp(ball.pos.x * 0.6 + dir * 8 * K, -FIELD.halfL + 3, FIELD.halfL - 3),
            tz: sgn * FIELD.halfW * (0.5 + style.width * 0.35),
            s: 6 + style.width * 3 - (Math.sign(ball.pos.z) === sgn && Math.abs(ball.pos.z) > FIELD.halfW * 0.4 ? 2 : 0),
          });
        }
        // overlap down the flank
        if ((p.role === 'FB' || p.role === 'WB')
            && Math.sign(ball.pos.z) === Math.sign(p.base.z || 1)
            && Math.abs(ball.pos.z) > FIELD.halfW * 0.25 && ballLX > -8 * K) {
          cands.push({
            act: 'overlap',
            tx: clamp(ball.pos.x + dir * 11 * K, -FIELD.halfL + 3, FIELD.halfL - 3),
            tz: Math.sign(p.base.z) * (FIELD.halfW - 4 * K),
            s: 4 + style.width * 5 + (transA ? style.counter * 2 : 0) - dBall * 0.15
              + (p.role === 'WB' ? 1.5 : 0),
          });
        }
      } else if (looseBall) {
        // second body toward a loose ball
        if (dBall < 20 * K) cands.push({ act: 'chase2', tx: ball.pos.x, tz: ball.pos.z, s: 8 - dBall * 0.3 });
      }

      // pick: noise + stickiness
      let best = null, bestS = -1e9;
      for (const c of cands) {
        let s = c.s + gauss() * 0.7;
        if (c.act === p.act) s += 0.9;
        if (s > bestS) { bestS = s; best = c; }
      }
      p.act = best.act;
      p.markT = best.markT ?? null;
      p.urgency = URGENCY[best.act] ?? 0.75;
      let tx = best.tx, tz = best.tz;

      // learned micro-positioning: tiny clamped offset on soft assignments
      if (team.policyNet && (best.act === 'anchor' || best.act === 'support'
          || best.act === 'holdWidth' || best.act === 'cover')) {
        policyInputs(match, team, p, attacking, defending, tx, tz);
        runNet(team.policyNet, _in, _out);
        tx += _out[0] * dir;
        tz += _out[1];
      }
      p.target.set(
        clamp(tx, -FIELD.halfL + 1.5, FIELD.halfL - 1.5), 0,
        clamp(tz, -FIELD.halfW + 1.5, FIELD.halfW - 1.5),
      );
    }
  }
}

function dribbleMove(match, p, dir, K, style) {
  let nd = 1e9, nearestO = null;
  for (const o of match.opponentsOf(p.team)) {
    const d = distXZ(o.pos, p.pos);
    if (d < nd) { nd = d; nearestO = o; }
  }
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

function policyInputs(match, team, p, attacking, defending, tx, tz) {
  const ball = match.ball, dir = team.dir;
  let od = 1e9, ox = 0, oz = 0, md = 1e9, mx = 0, mz = 0;
  for (const o of match.opponentsOf(team)) {
    const d = distXZ(o.pos, p.pos);
    if (d < od) { od = d; ox = o.pos.x - p.pos.x; oz = o.pos.z - p.pos.z; }
  }
  for (const m of team.players) {
    if (m === p) continue;
    const d = distXZ(m.pos, p.pos);
    if (d < md) { md = d; mx = m.pos.x - p.pos.x; mz = m.pos.z - p.pos.z; }
  }
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

  let press = 1e9;
  for (const o of match.opponentsOf(team)) press = Math.min(press, distXZ(o.pos, p.pos));

  const acts = [];

  // shoot
  if (dGoal < 30 * K && Math.abs(p.pos.z) < FIELD.halfW * 0.65) {
    let blockers = 0;
    for (const o of match.opponentsOf(team)) {
      if (o.isGK) continue;
      const along = (o.pos.x - p.pos.x) * dir;
      if (along > 0.5 && along < dGoal && Math.abs(o.pos.z - p.pos.z * (1 - along / dGoal)) < 1.6) blockers++;
    }
    let s = (30 * K - dGoal) * (0.55 / K) + style.risk * 3 - blockers * 3 - Math.abs(p.pos.z) * 0.12 / K;
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
    let open = 1e9;
    for (const o of match.opponentsOf(team)) open = Math.min(open, distXZ(o.pos, mate.pos));
    const blocked = d < 15 && laneBlocked(match, p, mate.pos.x, mate.pos.z);
    let s = progress * (1.0 + style.directness * 1.2) / K + Math.min(open, 8) * 1.3 - d * 0.2 - (blocked ? 12 : 0)
      + style.chemistry * 2 + (mate.isHuman ? 4 : 0);
    if (progress < -5 * K) s -= 2 + 8 * style.directness;
    if (s > bestPass) { bestPass = s; bestMate = mate; }
    // through: feed a runner into space
    const running = mate.act === 'runBehind' || mate.vel.x * dir > 2.5;
    if (running && progress > 4 * K && !blocked) {
      const ts = 6 + style.directness * 4 + style.counter * 2 + Math.min(open, 8) * 0.8 + style.chemistry * 1.5;
      if (ts > bestThroughS) { bestThroughS = ts; bestThrough = mate; }
    }
  }
  if (bestMate) {
    const gate = press < 2.2 ? 4 : 0; // pressured: passing gets urgent
    acts.push({ n: 'pass', s: bestPass * 0.55 + gate, run: () => execPass(match, p, bestMate, K) });
  }
  if (bestThrough) acts.push({ n: 'through', s: bestThroughS, run: () => execThrough(match, p, bestThrough, dir, K) });

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
    let s = 5 + style.flair * 3 + (space ? 4 : -2) - (press < 1.5 ? 3 : 0);
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
  const finesse = style.flair > 0.55 && dGoal > 12 * K && dGoal < 24 * K && Math.random() < 0.45;
  const err = (diff.shootErr * (1.05 - style.chemistry * 0.3) + dGoal * 0.003) * rand(-1, 1);
  const aimZ = (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.8) * FIELD.goalHalf;
  const ang = Math.atan2(aimZ - p.pos.z, goalX - p.pos.x) + err;
  if (finesse) {
    const side = Math.sign(p.pos.z || 1);
    const spd = 18.5 + rand(0, 3);
    match.kickBall(p, Math.cos(ang) * spd, spd * 0.11, Math.sin(ang) * spd,
      new THREE.Vector3(0, 5 * side * p.team.dir, 0), false, true);
    p.rig.finesseT = 0.55;
  } else {
    const spd = clamp(16 + (28 * K - dGoal) * 0.5 + rand(0, 4), 15, 27);
    match.kickBall(p, Math.cos(ang) * spd, spd * rand(0.07, 0.15), Math.sin(ang) * spd,
      new THREE.Vector3(0, rand(-3, 3), 0), false, true);
  }
}

function execPass(match, p, mate, K) {
  const diff = p.team.diff, style = p.team.style;
  const d = distXZ(mate.pos, p.pos);
  const spd = clamp(7 + d * 0.85, 9, 23);
  const t = d / spd;
  const err = diff.passErr * (1.1 - style.chemistry * 0.5) * rand(-1, 1);
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
  match.noteAI?.(p.team, 'pass');
}

function execThrough(match, p, mate, dir, K) {
  const lead = (4 + 5 * p.team.style.directness) * K;
  const tx = mate.pos.x + dir * lead + mate.vel.x * 0.4;
  const tz = mate.pos.z * 0.96 + mate.vel.z * 0.4;
  const d = Math.hypot(tx - p.pos.x, tz - p.pos.z);
  const spd = clamp(9 + d * 0.85, 11, 25);
  const ang = Math.atan2(tz - p.pos.z, tx - p.pos.x) + p.team.diff.passErr * rand(-0.8, 0.8);
  const vx = Math.cos(ang) * spd, vz = Math.sin(ang) * spd;
  const l = Math.hypot(vx, vz) || 1;
  match.kickBall(p, vx, 0, vz, new THREE.Vector3((vz / l) * 4, 0, (-vx / l) * 4));
  match.ball.intendedReceiver = mate;
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
  if (press < 1.8 && Math.random() < style.flair * 0.12) {
    match.kickBall(p,
      p.heading.x * 1.5 + p.vel.x * 0.5, 6.8,
      p.heading.z * 1.5 + p.vel.z * 0.5, null);
    p.rig.flickT = 0.4;
  }
  // otherwise: keep carrying — dribbleMove steers
}
