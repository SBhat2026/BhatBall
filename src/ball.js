import * as THREE from 'three';
import { FIELD, BALL } from './config.js';
import { buildBallMesh } from './balls.js';

const _a = new THREE.Vector3();
const _axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Ball {
  constructor(scene, styleId) {
    this.mesh = buildBallMesh(styleId);
    scene.add(this.mesh);

    this.pos = new THREE.Vector3(0, BALL.r, 0);
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3(); // rad/s
    this.lastTouch = null;           // player
    this.intendedReceiver = null;    // player a pass is aimed at
    this.heldBy = null;              // GK holding
    this.owner = null;               // player dribbling — ball sticks to their feet
    this.isShot = false;             // shots can't be trapped, only blocked/saved
  }

  reset(x = 0, z = 0) {
    this.pos.set(x, BALL.r, z);
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.intendedReceiver = null;
    this.heldBy = null;
    this.owner = null;
    this.isShot = false;
  }

  kick(player, vel, spin, isShot = false) {
    this.vel.copy(vel);
    if (spin) this.spin.copy(spin); else this.spin.set(0, 0, 0);
    this.lastTouch = player;
    this.intendedReceiver = null;
    this.heldBy = null;
    this.owner = null;
    this.isShot = isShot;
    if (player) player.kickCd = 0.35;
  }

  speed() { return this.vel.length(); }

  step(dt) {
    if (this.heldBy) {
      const p = this.heldBy;
      this.pos.set(
        p.pos.x + p.heading.x * 0.5,
        0.9,
        p.pos.z + p.heading.z * 0.5,
      );
      this.vel.set(0, 0, 0);
      this._sync(dt);
      return;
    }
    if (this.owner) {
      this._follow(dt);
      this._sync(dt);
      return;
    }

    const N = 2, h = dt / N;
    for (let i = 0; i < N; i++) this._substep(h);
    this._sync(dt);
  }

  // dribble: ball trails just ahead of the owner's feet. Sprinting knocks it
  // genuinely further ahead with looser control — faster, but the gap is a
  // window defenders can attack (match.js reads ball-to-carrier distance).
  _follow(dt) {
    const p = this.owner;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const heavy = !!p.sprinting;
    const lead = Math.min(heavy ? 1.6 : 1.3, (0.45 + sp * 0.09) * (heavy ? 1.4 : 1));
    const tx = p.pos.x + p.heading.x * lead;
    const tz = p.pos.z + p.heading.z * lead;
    const k = 1 - Math.exp(-(heavy ? 6.5 : 10) * dt);
    const nx = this.pos.x + (tx - this.pos.x) * k;
    const nz = this.pos.z + (tz - this.pos.z) * k;
    this.vel.set((nx - this.pos.x) / dt, 0, (nz - this.pos.z) / dt);
    this.pos.x = nx;
    this.pos.z = nz;
    this.pos.y += (BALL.r - this.pos.y) * Math.min(1, 8 * dt);
    this.spin.set(0, 0, 0);
  }

  _substep(h) {
    const v = this.vel;
    v.y -= BALL.g * h;

    const s = v.length();
    if (s > 0.01) {
      // quadratic air drag
      v.multiplyScalar(Math.max(0, 1 - BALL.drag * s * h));
      // Magnus lift: a = k (spin x v)
      _a.crossVectors(this.spin, v).multiplyScalar(BALL.magnus);
      v.addScaledVector(_a, h);
      // spin bleeds off in flight, so curl straightens late
      if (this.pos.y > BALL.r * 1.5) this.spin.multiplyScalar(Math.max(0, 1 - 0.25 * h));
    }

    this.pos.addScaledVector(v, h);

    // ground contact
    if (this.pos.y < BALL.r) {
      this.pos.y = BALL.r;
      if (v.y < -1.5) {
        v.y *= -BALL.restitution;
        // spin-ground interaction: topspin skids on, backspin bites
        const hv = Math.hypot(v.x, v.z);
        if (hv > 0.5) {
          const top = (this.spin.x * v.z - this.spin.z * v.x) / hv;
          const grip = 0.85 + Math.max(-0.3, Math.min(0.12, top * 0.02));
          v.x *= grip; v.z *= grip;
        } else { v.x *= 0.85; v.z *= 0.85; }
        this.spin.multiplyScalar(0.7);
      } else {
        v.y = 0;
        const hs = Math.hypot(v.x, v.z);
        if (hs > 0.01) {
          const ns = Math.max(0, hs - BALL.rollFriction * h);
          v.x *= ns / hs; v.z *= ns / hs;
        } else { v.x = 0; v.z = 0; }
        this.spin.multiplyScalar(Math.max(0, 1 - 1.6 * h));
      }
    }

    this._goalFrame();
    this._net(h);
  }

  // posts + crossbar collisions (both goals)
  _goalFrame() {
    const { halfL, goalHalf, goalHeight, postR } = FIELD;
    const R = BALL.r + postR;
    for (const sx of [-1, 1]) {
      const gx = sx * halfL;
      // posts: vertical cylinders
      if (this.pos.y < goalHeight + 0.15) {
        for (const sz of [-1, 1]) {
          const pz = sz * goalHalf;
          const dx = this.pos.x - gx, dz = this.pos.z - pz;
          const d = Math.hypot(dx, dz);
          if (d < R && d > 1e-4) {
            const nx = dx / d, nz = dz / d;
            this.pos.x = gx + nx * R; this.pos.z = pz + nz * R;
            const dot = this.vel.x * nx + this.vel.z * nz;
            if (dot < 0) {
              this.vel.x -= 1.7 * dot * nx;
              this.vel.z -= 1.7 * dot * nz;
              this.frameHit = true; // booth: "off the post!"
            }
          }
        }
      }
      // crossbar: horizontal cylinder along z
      if (Math.abs(this.pos.z) < goalHalf + 0.2) {
        const dx = this.pos.x - gx, dy = this.pos.y - goalHeight;
        const d = Math.hypot(dx, dy);
        if (d < R && d > 1e-4) {
          const nx = dx / d, ny = dy / d;
          this.pos.x = gx + nx * R; this.pos.y = goalHeight + ny * R;
          const dot = this.vel.x * nx + this.vel.y * ny;
          if (dot < 0) {
            this.vel.x -= 1.7 * dot * nx;
            this.vel.y -= 1.7 * dot * ny;
            this.frameHit = true; // booth: "off the bar!"
          }
        }
      }
    }
  }

  // soft net: heavily damp the ball once it's inside a goal mouth
  _net(h) {
    const { halfL, goalHalf, goalHeight } = FIELD;
    const ax = Math.abs(this.pos.x);
    if (ax > halfL + 0.1 && Math.abs(this.pos.z) < goalHalf + 0.6 && this.pos.y < goalHeight + 0.4) {
      this.vel.multiplyScalar(Math.max(0, 1 - 7 * h));
      const lim = halfL + 1.7;
      if (ax > lim) {
        this.pos.x = Math.sign(this.pos.x) * lim;
        this.vel.x *= -0.2;
      }
    }
  }

  _sync(dt) {
    this.mesh.position.copy(this.pos);
    // visual roll
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.05) {
      _axis.set(this.vel.z, 0, -this.vel.x).normalize();
      this.mesh.rotateOnWorldAxis(_axis, (hs * dt) / BALL.r);
    }
  }
}
export { UP };
