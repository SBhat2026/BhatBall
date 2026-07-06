// Goalkeeper brain + spatial helpers shared with brain.js.
// (Outfield decision-making lives in brain.js — utility-based.)
import * as THREE from 'three';
import { FIELD, clamp, rand } from './config.js';

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
    if (ballInBox && (loose || (towardGoal && dBall < FIELD.boxL * 0.8))) {
      interceptPoint(ball, gk, 5.8, gk.target);
      const rushLim = FIELD.boxL - 1.5;
      gk.target.x = clamp(gk.target.x, Math.min(goalX, goalX + team.dir * rushLim), Math.max(goalX, goalX + team.dir * rushLim));
      gk.urgency = 1;
    } else {
      gk.target.set(homeX, 0, tz);
      gk.urgency = 0.9;
    }
  }

  // save attempt (free balls only — a dribbler must be dispossessed, not smothered)
  const reach = 1.1 + (towardGoal ? 0.7 : 0);
  if (!ball.owner && dBall < reach && ball.pos.y < 2.3 && gk.kickCd <= 0) {
    const sp = ball.speed();
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
    if (Math.random() > pSave) {
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
