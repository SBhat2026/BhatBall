import * as THREE from 'three';
import { FIELD, PLAYER, clamp, rand } from './config.js';

const _v = new THREE.Vector3();

function distXZ(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

// where a chaser should run to meet the ball
function interceptPoint(ball, p, speed, out) {
  let t = distXZ(p.pos, ball.pos) / speed;
  for (let i = 0; i < 3; i++) {
    const decay = Math.max(0.3, 1 - 0.35 * t); // rough drag/friction falloff
    out.set(
      ball.pos.x + ball.vel.x * t * decay,
      0,
      ball.pos.z + ball.vel.z * t * decay,
    );
    t = distXZ(p.pos, out) / speed;
  }
  out.x = clamp(out.x, -FIELD.halfL + 0.5, FIELD.halfL - 0.5);
  out.z = clamp(out.z, -FIELD.halfW + 0.5, FIELD.halfW - 0.5);
  return out;
}

function formationTarget(match, p, out) {
  const team = p.team;
  const ball = match.ball;
  const attacking = match.controllerTeam === team;
  const bias = attacking ? 15 : match.controllerTeam ? -10 : 0;
  let tx = team.dir * (p.base.x + bias) + ball.pos.x * 0.3;
  let tz = p.base.z + ball.pos.z * 0.24;
  if (attacking && p.role === 'FW') {
    // forwards run beyond the ball as outlets
    tx = team.dir > 0 ? Math.max(tx, ball.pos.x + 9) : Math.min(tx, ball.pos.x - 9);
    tz = p.base.z * 0.85 + ball.pos.z * 0.2;
  }
  tx = clamp(tx, -FIELD.halfL + 3, FIELD.halfL - 3);
  tz = clamp(tz, -FIELD.halfW + 2, FIELD.halfW - 2);
  return out.set(tx, 0, tz);
}

export function updateAI(match, dt) {
  const ball = match.ball;

  // per-team nearest outfielder to ball
  const chasers = new Map();
  for (const team of [match.teamA, match.teamB]) {
    let best = null, bestD = 1e9, second = null, secondD = 1e9;
    for (const p of team.players) {
      if (p.isGK || p.isHuman) continue;
      const d = distXZ(p.pos, ball.pos);
      if (d < bestD) { second = best; secondD = bestD; best = p; bestD = d; }
      else if (d < secondD) { second = p; secondD = d; }
    }
    chasers.set(team, { best, second });
  }

  for (const team of [match.teamA, match.teamB]) {
    const diff = team.diff;
    const { best, second } = chasers.get(team);
    const oppControls = match.controllerTeam && match.controllerTeam !== team;

    for (const p of team.players) {
      if (p.isGK || p.isHuman) continue;
      p.aiT -= dt;
      if (p.aiT > 0) continue;
      p.aiT = diff.react + Math.random() * 0.08;

      p.urgency = 0.75;
      if (ball.owner === p) {
        // attack run with the ball: drive at goal, veer off the nearest defender
        const goalX = team.dir * FIELD.halfL;
        let veer = 0;
        let nd = 1e9, nearest = null;
        for (const o of match.opponentsOf(team)) {
          const d = distXZ(o.pos, p.pos);
          if (d < nd) { nd = d; nearest = o; }
        }
        if (nearest && nd < 6) {
          veer = (Math.sign(p.pos.z - nearest.pos.z) || (Math.random() < 0.5 ? 1 : -1)) * (6 - nd) * 1.4;
        }
        p.target.set(
          clamp(p.pos.x + team.dir * 12, -FIELD.halfL + 2, FIELD.halfL - 2),
          0,
          clamp(p.pos.z * 0.92 + veer, -FIELD.halfW + 2, FIELD.halfW - 2),
        );
        p.urgency = 0.95;
      } else if (ball.intendedReceiver === p) {
        interceptPoint(ball, p, PLAYER.speed * diff.speed, p.target);
        p.urgency = 1;
      } else if (p === best && (!match.controllerTeam || oppControls)) {
        interceptPoint(ball, p, PLAYER.speed * diff.speed, p.target);
        p.urgency = 1;
      } else if (p === second && oppControls && distXZ(p.pos, ball.pos) < 22) {
        interceptPoint(ball, p, PLAYER.speed * diff.speed, p.target);
        p.urgency = 0.9;
      } else {
        formationTarget(match, p, p.target);
      }

      // defenders near an opponent dribbler try a tackle (sparingly)
      if (oppControls && !p.tackleT && !p.stunT) {
        const d = distXZ(p.pos, ball.pos);
        if (d < 1.9 && Math.random() < diff.tackleAggro * 0.22) match.tackle(p);
      }
    }
  }
}

// on-ball decision for an AI player (called when they can touch the ball)
export function aiTouch(match, p) {
  const ball = match.ball;
  const team = p.team;
  const diff = team.diff;
  const goalX = team.dir * FIELD.halfL;
  const dGoal = Math.hypot(goalX - p.pos.x, p.pos.z);

  // nearest opponent = pressure
  let press = 1e9;
  for (const o of match.opponentsOf(team)) {
    const d = distXZ(o.pos, p.pos);
    if (d < press) press = d;
  }

  // 1. shoot when in range — pick a corner, with difficulty-scaled error
  if (dGoal < 26 && Math.abs(p.pos.z) < 21 && Math.random() < 0.85) {
    const err = (diff.shootErr + dGoal * 0.003) * rand(-1, 1);
    const aimZ = (Math.random() < 0.5 ? -1 : 1) * rand(1.6, 3.0);
    const dir = _v.set(goalX - p.pos.x, 0, aimZ - p.pos.z).normalize();
    const ang = Math.atan2(dir.z, dir.x) + err;
    const speed = clamp(16 + (25 - dGoal) * 0.5 + rand(0, 4), 16, 27);
    match.kickBall(p, Math.cos(ang) * speed, speed * rand(0.07, 0.15), Math.sin(ang) * speed,
      new THREE.Vector3(0, rand(-3, 3), 0), false, true);
    return;
  }

  // 2. clear from own third under pressure
  if ((goalX > 0 ? p.pos.x < -30 : p.pos.x > 30) && press < 3) {
    const dir = _v.set(team.dir, 0, rand(-0.7, 0.7)).normalize();
    match.kickBall(p, dir.x * 24, 8, dir.z * 24, null);
    return;
  }

  // 3. pass when pressured, or hit a good forward outlet
  const passOption = pickPass(match, p);
  const forwardOutlet = passOption && (passOption.pos.x - p.pos.x) * team.dir > 8;
  if (passOption && (press < 1.7 || (forwardOutlet && Math.random() < 0.35) || Math.random() < 0.06)) {
    const mate = passOption;
    {
      const d = distXZ(mate.pos, p.pos);
      const passSpeed = clamp(7 + d * 0.85, 9, 23);
      const t = d / passSpeed;
      const err = diff.passErr * rand(-1, 1);
      // through-ball lead: play it into space ahead of a forward-moving mate
      const lead = forwardOutlet ? 3.5 : 0;
      const tx = mate.pos.x + mate.vel.x * t * 0.8 + team.dir * lead;
      const tz = mate.pos.z + mate.vel.z * t * 0.8;
      const ang = Math.atan2(tz - p.pos.z, tx - p.pos.x) + err;
      if (laneBlocked(match, p, tx, tz) && d > 14) {
        // chip it over, backspin so it sits down for the runner
        const T = clamp(d / 15, 0.6, 1.5);
        const cvx = (tx - p.pos.x) / T, cvz = (tz - p.pos.z) / T;
        const cl = Math.hypot(cvx, cvz) || 1;
        match.kickBall(p, cvx, 9.81 * T / 2, cvz,
          new THREE.Vector3((cvz / cl) * -5.5, 0, (-cvx / cl) * -5.5));
      } else {
        match.kickBall(p, Math.cos(ang) * passSpeed, 0, Math.sin(ang) * passSpeed, null);
      }
      ball.intendedReceiver = mate;
      return;
    }
  }

  // 4. legend flair: rare sombrero when tightly marked
  if (press < 1.8 && diff.tackleAggro > 0.8 && Math.random() < 0.05) {
    match.kickBall(p, p.heading.x * 2.5 + p.vel.x * 0.5, 6.8, p.heading.z * 2.5 + p.vel.z * 0.5, null);
    return;
  }

  // 5. otherwise keep carrying it — the attack run in updateAI does the dribbling
}

function pickPass(match, p) {
  const team = p.team;
  let best = null, bestScore = -1e9;
  for (const mate of team.players) {
    if (mate === p || mate.isGK) continue;
    const d = distXZ(mate.pos, p.pos);
    if (d < 4 || d > 34) continue;
    const progress = (mate.pos.x - p.pos.x) * team.dir;
    let open = 1e9;
    for (const o of match.opponentsOf(team)) {
      const od = distXZ(o.pos, mate.pos);
      if (od < open) open = od;
    }
    let score = progress * 1.9 + Math.min(open, 8) * 1.4 - d * 0.25;
    if (progress < -5) score -= 6; // don't recycle backwards unless it's all there is
    if (mate.isHuman) score += 4;  // feed the user's striker
    if (d < 15 && laneBlocked(match, p, mate.pos.x, mate.pos.z)) score -= 14; // short passes need a lane
    if (score > bestScore) { bestScore = score; best = mate; }
  }
  return best;
}

function laneBlocked(match, p, tx, tz) {
  const dx = tx - p.pos.x, dz = tz - p.pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1) return false;
  const nx = dx / len, nz = dz / len;
  for (const o of match.opponentsOf(p.team)) {
    const ox = o.pos.x - p.pos.x, oz = o.pos.z - p.pos.z;
    const along = ox * nx + oz * nz;
    if (along < 1 || along > len) continue;
    const perp = Math.abs(ox * nz - oz * nx);
    if (perp < 1.6) return true;
  }
  return false;
}

// goalkeeper brain
export function gkUpdate(match, gk, dt) {
  const ball = match.ball;
  const team = gk.team;
  const goalX = -team.dir * FIELD.halfL; // own goal
  const homeX = goalX + team.dir * 1.3;

  if (gk.holdT > 0) {
    gk.holdT -= dt;
    gk.target.set(homeX + team.dir * 4, 0, 0);
    if (gk.holdT <= 0 && ball.heldBy === gk) {
      // boot it upfield
      const dir = _v.set(team.dir, 0, rand(-0.5, 0.5)).normalize();
      ball.heldBy = null;
      match.kickBall(gk, dir.x * 25, 10, dir.z * 25, null);
    }
    return;
  }

  const towardGoal = ball.vel.x * -team.dir > 2; // ball moving at our goal
  const dBall = distXZ(gk.pos, ball.pos);
  const ballInBox = Math.abs(ball.pos.x - goalX) < 16.5 && Math.abs(ball.pos.z) < 20;

  // reaction lag: re-read the shot line only every ~0.22s
  gk.aiT -= dt;
  if (gk.aiT <= 0) {
    gk.aiT = 0.22;
    let tz = ball.pos.z * 0.35;
    if (towardGoal && Math.abs(ball.vel.x) > 0.5) {
      const t = (goalX - ball.pos.x) / ball.vel.x;
      if (t > 0 && t < 3) tz = ball.pos.z + ball.vel.z * t + rand(-0.6, 0.6); // imperfect read
    }
    tz = clamp(tz, -3.1, 3.1);

    const loose = !match.controllerTeam && ball.speed() < 9;
    if (ballInBox && (loose || (towardGoal && dBall < 13))) {
      interceptPoint(ball, gk, 5.8, gk.target);
      gk.target.x = clamp(gk.target.x, Math.min(goalX, goalX + team.dir * 15), Math.max(goalX, goalX + team.dir * 15));
      gk.urgency = 1;
    } else {
      gk.target.set(homeX, 0, tz);
      gk.urgency = 0.9;
    }
  }

  // save attempt (free balls only — a dribbler must be dispossessed, not.smothered)
  const reach = 1.1 + (towardGoal ? 0.7 : 0);
  if (!ball.owner && dBall < reach && ball.pos.y < 2.3 && gk.kickCd <= 0) {
    const sp = ball.speed();
    // pace and a full stretch make saves miss-able
    const stretch = dBall > 1.1 ? 0.3 : 0;
    const pSave = clamp(0.95 - Math.max(0, sp - 12) * 0.032 - stretch, 0.2, 0.95);
    if (Math.random() > pSave) {
      gk.kickCd = 0.55; // beaten — no second grab at the same ball
    } else if (sp < 16.5) {
      ball.heldBy = gk;
      ball.lastTouch = gk;
      ball.intendedReceiver = null;
      gk.holdT = 1.1;
      gk.kickCd = 0.5;
    } else {
      // parry wide of the frame, palms angled toward the nearer touchline
      const out = sp * 0.32;
      const wide = Math.sign(ball.pos.z || rand(-1, 1));
      ball.vel.x = team.dir * out * rand(0.5, 0.9); // away from goal
      ball.vel.z = wide * out * rand(0.7, 1.2);
      ball.vel.y = out * rand(0.3, 0.6) + 1.5;
      ball.lastTouch = gk;
      ball.intendedReceiver = null;
      gk.kickCd = 0.6;
    }
  }
}
