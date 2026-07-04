import * as THREE from 'three';
import { FIELD, clamp, damp } from './config.js';

// broadcast framing scales with the pitch so street modes sit closer in
function frame() {
  const k = FIELD.halfW / 34; // 1.0 on the full pitch
  return { y: 17 * (0.55 + 0.45 * k), z: 33 * (0.55 + 0.45 * k), xCap: FIELD.halfL - 10.5 };
}

export class GameCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'broadcast'; // 'broadcast' | 'fp'
    this.pos = new THREE.Vector3(0, 21, 37);
    this.look = new THREE.Vector3(0, 1, 0);
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.punchT = 0;
    camera.position.copy(this.pos);
  }

  toggle() {
    this.mode = this.mode === 'broadcast' ? 'fp' : 'broadcast';
  }

  shake(amp = 0.45) { this.shakeT = 0.55; this.shakeAmp = amp; }

  punch() { this.punchT = 0.8; } // brief zoom-in for skill drama

  snap(ball) {
    const f = frame();
    this.pos.set(clamp(ball.pos.x * 0.85, -f.xCap, f.xCap), f.y, f.z);
    this.look.set(ball.pos.x * 0.9, 2.4, ball.pos.z * 0.5);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  update(dt, ball, player) {
    const tPos = new THREE.Vector3();
    const tLook = new THREE.Vector3();

    if (this.mode === 'broadcast') {
      const f = frame();
      tPos.set(clamp(ball.pos.x * 0.85, -f.xCap, f.xCap), f.y, f.z);
      tLook.set(ball.pos.x * 0.9, 2.4, ball.pos.z * 0.5);
      this.pos.lerp(tPos, damp(3.2, dt));
      this.look.lerp(tLook, damp(4.5, dt));
    } else {
      // first-person: eye at head, gaze blends heading with ball direction
      const h = player.heading;
      tPos.set(player.pos.x - h.x * 0.25, 1.62, player.pos.z - h.z * 0.25);
      const toBall = new THREE.Vector3(ball.pos.x - player.pos.x, 0, ball.pos.z - player.pos.z);
      const dist = toBall.length();
      const gaze = new THREE.Vector3(h.x, 0, h.z);
      if (dist > 0.5 && dist < 30) gaze.lerp(toBall.normalize(), 0.55).normalize();
      tLook.copy(tPos).addScaledVector(gaze, 12);
      tLook.y = 1.1;
      this.pos.lerp(tPos, damp(14, dt));
      this.look.lerp(tLook, damp(9, dt));
    }

    this.camera.position.copy(this.pos);

    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = Math.max(0, this.shakeT / 0.55) * this.shakeAmp;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
    }

    let fov = 45;
    if (this.punchT > 0) {
      this.punchT -= dt;
      fov = 45 - 8 * Math.sin(Math.min(1, (0.8 - this.punchT) / 0.8) * Math.PI);
    }
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.lookAt(this.look);
  }
}
