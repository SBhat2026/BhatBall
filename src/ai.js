// Goalkeeper brain + spatial helpers shared with brain.js.
// (Outfield decision-making lives in brain.js — utility-based.)
import * as THREE from 'three';
import { FIELD, clamp, rand } from './config.js';
import { starMul } from './stars.js';

const _v = new THREE.Vector3();

function distXZ(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

// where a chaser should run to meet the ball
export function interceptPoint(ball, p, speed, out) {
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

export function laneBlocked(match, p, tx, tz) {
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

// distribution: a keeper with the ball picks a real pass instead of a blind
// boot — short into an open deep outlet when the press allows, lofted long to
// the most advanced open teammate when it doesn't (or the long ball is on).
function gkDistribute(match, gk) {
  const ball = match.ball;
  const team = gk.team;
  const K = FIELD.halfL / 52.5;
  let short = null, shortS = -1e9, long = null, longS = -1e9, pressure = 0;
  for (const o of match.opponentsOf(team)) if (distXZ(o.pos, gk.pos) < 22 * K) pressure++;
  for (const m of team.players) {
    if (m === gk) continue;
    let open = 1e9;
    for (const o of match.opponentsOf(team)) open = Math.min(open, distXZ(o.pos, m.pos));
    const d = distXZ(m.pos, gk.pos);
    if (d > 6 * K && d < 26 * K) {
      const s = Math.min(open, 10) * 1.4 - d * 0.12
        - (laneBlocked(match, gk, m.pos.x, m.pos.z) ? 9 : 0);
      if (s > shortS) { shortS = s; short = m; }
    }
    if (d >= 18 * K) {
      const s = (m.pos.x * team.dir) * 0.5 / K + Math.min(open, 8) * 1.1;
      if (s > longS) { longS = s; long = m; }
    }
  }
  // pressed with no safe outlet → go over the press; otherwise mostly build
  // short (keepers with good feet stay composed under a heavier press)
  const pressGate = gk.star?.dribble ? 3 : 2;
  const goLong = long && (pressure >= pressGate ? shortS < 8 : Math.random() < 0.25);
  const mate = goLong ? long : (short ?? long);
  ball.heldBy = null;
  gk.kickCd = 0.4;
  // release window: opponents can't smother the distribution at point-blank
  match.lock = { team, t: 0.6, gk: true };
  if (!mate) {
    const dir = _v.set(team.dir, 0, rand(-0.5, 0.5)).normalize();
    match.kickBall(gk, dir.x * 25, 10, dir.z * 25, null);
    return;
  }
  const d = distXZ(mate.pos, gk.pos);
  if (!goLong && mate === short && d < 20 * K) {
    // firm ground pass into feet
    const sp = clamp(8 + d * 0.8, 9, 20);
    const ang = Math.atan2(mate.pos.z - gk.pos.z, mate.pos.x - gk.pos.x);
    match.kickBall(gk, Math.cos(ang) * sp, 0, Math.sin(ang) * sp, null);
  } else {
    // lofted ball dropped just in front of the runner
    const tx = mate.pos.x + mate.vel.x * 0.6 + team.dir * 2;
    const tz = mate.pos.z + mate.vel.z * 0.6;
    const T = clamp(Math.hypot(tx - gk.pos.x, tz - gk.pos.z) / 17, 0.8, 1.7);
    match.kickBall(gk, (tx - gk.pos.x) / T, 9.81 * T / 2, (tz - gk.pos.z) / T, null);
  }
  ball.intendedReceiver = mate;
}

// goalkeeper brain
export function gkUpdate(match, gk, dt) {
  const ball = match.ball;
  const team = gk.team;
  const goalX = -team.dir * FIELD.halfL; // own goal
  const homeX = goalX + team.dir * 1.3;
  const zCap = FIELD.goalHalf - 0.55;

  if (gk.holdT > 0) {
    gk.holdT -= dt;
    gk.target.set(homeX + team.dir * 4, 0, 0);
    if (gk.holdT <= 0 && ball.heldBy === gk) gkDistribute(match, gk);
    return;
  }

  const towardGoal = ball.vel.x * -team.dir > 2; // ball moving at our goal
  const dBall = distXZ(gk.pos, ball.pos);
  const ballInBox = Math.abs(ball.pos.x - goalX) < FIELD.boxL && Math.abs(ball.pos.z) < FIELD.boxHalfW;

  // reaction lag: re-read the shot line only every ~0.22s
  gk.aiT -= dt;
  if (gk.aiT <= 0) {
    gk.aiT = 0.22;
    let tz = ball.pos.z * 0.35;
    if (towardGoal && Math.abs(ball.vel.x) > 0.5) {
      const t = (goalX - ball.pos.x) / ball.vel.x;
      if (t > 0 && t < 3) tz = ball.pos.z + ball.vel.z * t + rand(-0.6, 0.6); // imperfect read
    }
    tz = clamp(tz, -zCap, zCap);

    const loose = !match.controllerTeam && ball.speed() < 9;
    const freeBall = !ball.owner && !ball.heldBy;
    // sweep: a ball played in behind that the keeper clearly reaches first is
    // his — come off the line (even outside the box) and kill it
    let sweeping = false;
    if (freeBall && !ballInBox && ball.vel.x * -team.dir > 1 && ball.pos.y < 1.6) {
      interceptPoint(ball, gk, 5.2, _v);
      if (Math.abs(_v.x - goalX) < FIELD.boxL * 1.7) {
        const tGK = Math.hypot(_v.x - gk.pos.x, _v.z - gk.pos.z) / 5.2;
        let tOpp = 1e9;
        for (const o of match.opponentsOf(team)) {
          if (o.isGK) continue;
          tOpp = Math.min(tOpp, Math.hypot(_v.x - o.pos.x, _v.z - o.pos.z) / 8.6);
        }
        sweeping = tGK < tOpp * 0.85;
        if (sweeping) { gk.target.copy(_v); gk.urgency = 1; }
      }
    }
    // breakaway: a carrier through with nobody covering the goal line — come
    // out and sit on the ball→goal line to smother the angle
    const own = ball.owner;
    let challenging = false;
    if (!sweeping && own && own.team !== team
        && Math.abs(own.pos.x - goalX) < FIELD.boxL * 1.35 && Math.abs(own.pos.z) < FIELD.boxHalfW * 1.1) {
      const gx = goalX - own.pos.x, gz = -own.pos.z;
      const gl = Math.hypot(gx, gz) || 1;
      let cover = 0;
      for (const q of team.players) {
        if (q === gk) continue;
        const qx = q.pos.x - own.pos.x, qz = q.pos.z - own.pos.z;
        const along = (qx * gx + qz * gz) / gl;
        if (along > 0.5 && along < gl && Math.abs(qx * gz - qz * gx) / gl < 2.2) cover++;
      }
      challenging = cover === 0;
      if (challenging) {
        const rushLim = FIELD.boxL - 1.0;
        gk.target.set(
          clamp(own.pos.x + (gx / gl) * 2.2, Math.min(goalX, goalX + team.dir * rushLim), Math.max(goalX, goalX + team.dir * rushLim)),
          0, clamp(own.pos.z + (gz / gl) * 2.2, -FIELD.boxHalfW, FIELD.boxHalfW),
        );
        gk.urgency = 1;
      }
    }
    if (ballInBox && (loose || (towardGoal && dBall < FIELD.boxL * 0.8))) {
      interceptPoint(ball, gk, 5.8, gk.target);
      const rushLim = FIELD.boxL - 1.5;
      gk.target.x = clamp(gk.target.x, Math.min(goalX, goalX + team.dir * rushLim), Math.max(goalX, goalX + team.dir * rushLim));
      gk.urgency = 1;
    } else if (!sweeping && !challenging) {
      // Angle play: track the ball's z more tightly and step off the line for
      // CENTRAL threats (narrows the shooting angle), while staying near the
      // near post for wide ones — and never so far out that a chip beats us.
      const dxGoal = Math.abs(ball.pos.x - goalX);
      const central = 1 - Math.min(1, Math.abs(ball.pos.z) / (FIELD.goalHalf * 2.2));
      const danger = clamp(1 - dxGoal / (FIELD.boxL * 2.4), 0, 1); // 1 near box … 0 far
      const zTrack = clamp(ball.pos.z * (0.35 + 0.12 * danger), -zCap, zCap);
      // sweeper line: with play upfield, start from higher ground so balls in
      // behind the (squeezed-up) defence are the keeper's first — retreating
      // as play comes back so a chip never finds an empty net
      const sweepLine = clamp((dxGoal - FIELD.halfL * 0.8) * 0.22, 0, FIELD.boxL * 0.55);
      const stepOff = team.dir * Math.max(2.4 * danger * central, sweepLine);
      gk.target.set(homeX + stepOff, 0, zTrack);
      gk.urgency = 0.9;
    }
  }

  // save attempt (free balls only — a dribbler must be dispossessed, not smothered)
  const spNow = ball.speed();
  // a slow rolling ball is claimed with hands, not toes — a touch more reach
  // (keepers with good feet claim wider still)
  const reach = 1.1 + (towardGoal ? 0.7 : 0) + (spNow < 6 ? 0.45 : 0)
    + (starMul(gk, 'dribble') - 1) * 1.5;
  if (!ball.owner && dBall < reach && ball.pos.y < 2.3 && gk.kickCd <= 0) {
    const sp = spNow;
    // quick balls at full stretch get a proper dive (lateral side via heading × toBall)
    if (gk.rig && (sp > 9 || dBall > 0.9)) {
      gk.rig.diveT = 0.62;
      gk.rig.diveDir = Math.sign(
        gk.heading.x * (ball.pos.z - gk.pos.z) - gk.heading.z * (ball.pos.x - gk.pos.x),
      ) || 1;
    }
    // pace and a full stretch make saves miss-able
    const stretch = dBall > 1.1 ? 0.3 : 0;
    const pSave = clamp(0.95 - Math.max(0, sp - 12) * 0.032 - stretch, 0.2, 0.95);
    // legendary keepers shrink the MISS chance — the roll stays probabilistic
    // and the base pSave formula above is untouched
    const pEff = 1 - (1 - pSave) / starMul(gk, 'saves');
    if (Math.random() > pEff) {
      gk.kickCd = 0.55; // beaten — no second grab at the same ball
    } else if (sp < 16.5) {
      ball.heldBy = gk;
      ball.lastTouch = gk;
      ball.intendedReceiver = null;
      gk.holdT = 1.1;
      gk.kickCd = 0.5;
      if (sp > 8) match.hooks?.evt?.('save', { gk, held: true });
    } else {
      match.hooks?.evt?.('save', { gk, held: false });
      const wide = Math.sign(ball.pos.z || rand(-1, 1));
      // a fierce shot at full stretch gets tipped behind — over the byline, wide
      // of the post — which is a corner under the regular rule (keeper last touch)
      if (sp > 13 && (stretch > 0 || Math.random() < 0.45)) {
        ball.vel.x = -team.dir * (8 + rand(0, 3)); // carry it past the byline
        ball.vel.z = wide * (5 + rand(0, 3));      // and wide of the frame
        ball.vel.y = 2.2 + rand(0, 1.5);
      } else {
        // otherwise punch it clear, back into play toward the nearer touchline
        const out = sp * 0.32;
        ball.vel.x = team.dir * out * rand(0.5, 0.9); // away from goal
        ball.vel.z = wide * out * rand(0.7, 1.2);
        ball.vel.y = out * rand(0.3, 0.6) + 1.5;
      }
      ball.lastTouch = gk;
      ball.intendedReceiver = null;
      gk.kickCd = 0.6;
    }
  }
}
