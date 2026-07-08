import * as THREE from 'three';
import { PLAYER } from './config.js';

// Low-poly player: hex-cylinder torso, icosphere head, jointed box limbs
// (hip/knee, shoulder/elbow). Matte pastel materials.
// Kits can carry a torso pattern (Argentina stripes, Croatia checkers).
// The whole rig renders at PLAYER.vis scale — proportions untouched.

const HAIR_COLORS = ['#2e2a28', '#4a3826', '#7a5a38', '#c9b18a', '#5a5f6b'];
const numberTexCache = new Map();
const kitTexCache = new Map();
const nameTexCache = new Map();

function nameTexture(name) {
  if (nameTexCache.has(name)) return nameTexCache.get(name);
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = '700 30px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#3a3f4ccc';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.strokeText(name, 128, 34);
  ctx.fillStyle = '#f6f7fa';
  ctx.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  nameTexCache.set(name, tex);
  return tex;
}

const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

function numberTexture(n, ink) {
  const key = `${n}|${ink}`;
  if (numberTexCache.has(key)) return numberTexCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = ink;
  ctx.font = '900 92px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  numberTexCache.set(key, tex);
  return tex;
}

// torso pattern painted onto a small wrapped canvas (headless-safe: falls back to plain)
function kitTexture(base, pat, pat2) {
  const key = `${base}|${pat}|${pat2}`;
  if (kitTexCache.has(key)) return kitTexCache.get(key);
  const S = 192;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = pat2;
  if (pat === 'stripes') {
    for (let x = 0; x < S; x += S / 4) ctx.fillRect(x, 0, S / 8, S);
  } else if (pat === 'hoops') {
    for (let y = 0; y < S; y += S / 4) ctx.fillRect(0, y, S, S / 8);
  } else if (pat === 'checkers') {
    const s = S / 6;
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
      if ((x + y) % 2 === 0) ctx.fillRect(x * s, y * s, s, s);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  kitTexCache.set(key, tex);
  return tex;
}

export function buildRig(kit, skinTone, isGK, opts = {}) {
  const shirt = isGK ? kit.gk : kit.shirt;
  const sleeve = isGK ? kit.gk : kit.sleeve;
  const shorts = isGK ? '#5c6478' : kit.shorts;
  const socks = isGK ? '#5c6478' : (kit.socks ?? kit.shorts);
  const canPaint = typeof document !== 'undefined';

  const mat = (c) => new THREE.MeshStandardMaterial({
    color: c, roughness: 0.95, metalness: 0, flatShading: true,
  });
  const g = new THREE.Group();
  const add = (geo, m, x, y, z, parent = g) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const torsoMat = (!isGK && kit.pat && canPaint)
    ? new THREE.MeshStandardMaterial({
        map: kitTexture(kit.shirt, kit.pat, kit.pat2), roughness: 0.95, metalness: 0, flatShading: true,
      })
    : mat(shirt);
  const torso = add(new THREE.CylinderGeometry(0.26, 0.32, 0.68, 6), torsoMat, 0, 1.12, 0);
  add(new THREE.CylinderGeometry(0.3, 0.3, 0.24, 6), mat(shorts), 0, 0.72, 0);
  add(new THREE.IcosahedronGeometry(0.22, 1), mat(skinTone), 0, 1.66, 0);

  // small chest crest, trim-colored so the kit reads less flat
  if (!isGK) {
    const trim = kit.sleeve !== kit.shirt ? kit.sleeve : (kit.socks ?? kit.shorts);
    add(new THREE.BoxGeometry(0.075, 0.085, 0.02), mat(trim), 0.12, 1.3, 0.245);
  }

  // shirt number on the back (rig faces +z, so back is -z); ink flips on dark shirts
  if (opts.number != null && canPaint) {
    const ink = luminance(shirt) > 0.55 ? '#4a4f5c' : '#f2f3f5';
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.34),
      new THREE.MeshBasicMaterial({ map: numberTexture(opts.number, ink), transparent: true }),
    );
    plate.position.set(0, 1.2, -0.31);
    plate.rotation.y = Math.PI;
    g.add(plate);
  }

  // hair: polygon caps in a few styles
  const style = opts.hairStyle ?? Math.floor(Math.random() * 5);
  const hairC = mat(opts.hairColor ?? HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)]);
  if (style === 1) add(new THREE.IcosahedronGeometry(0.2, 0), hairC, 0, 1.78, -0.03).scale.set(1.1, 0.55, 1.05); // crop
  else if (style === 2) add(new THREE.IcosahedronGeometry(0.24, 0), hairC, 0, 1.8, -0.02); // afro
  else if (style === 3) { // bun
    add(new THREE.IcosahedronGeometry(0.19, 0), hairC, 0, 1.79, -0.03).scale.set(1.05, 0.5, 1);
    add(new THREE.IcosahedronGeometry(0.09, 0), hairC, 0, 1.87, -0.16);
  } else if (style === 4) add(new THREE.BoxGeometry(0.3, 0.12, 0.3), hairC, 0, 1.85, 0); // flat top
  // style 0: bald

  // two-segment limb: hip/shoulder pivot + knee/elbow pivot
  const mkLimb = (x, y, w, upLen, loLen, upColor, loColor, footColor) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    g.add(pivot);
    add(new THREE.BoxGeometry(w, upLen, w), mat(upColor), 0, -upLen / 2, 0, pivot);
    const joint = new THREE.Group();
    joint.position.set(0, -upLen, 0);
    pivot.add(joint);
    add(new THREE.BoxGeometry(w * 0.92, loLen, w * 0.92), mat(loColor), 0, -loLen / 2, 0, joint);
    if (footColor) add(new THREE.BoxGeometry(w + 0.03, 0.1, 0.27), mat(footColor), 0, -loLen - 0.04, 0.05, joint);
    pivot.joint = joint;
    return pivot;
  };

  // legs: skin thigh, sock shin, dark boot · arms: short sleeves (skin forearm), GK long sleeves
  const legL = mkLimb(-0.14, 0.62, 0.16, 0.3, 0.28, skinTone, socks, '#4a4f5c');
  const legR = mkLimb(0.14, 0.62, 0.16, 0.3, 0.28, skinTone, socks, '#4a4f5c');
  const armL = mkLimb(-0.38, 1.4, 0.12, 0.27, 0.23, sleeve, isGK ? sleeve : skinTone);
  const armR = mkLimb(0.38, 1.4, 0.12, 0.27, 0.23, sleeve, isGK ? sleeve : skinTone);

  if (opts.captain) add(new THREE.BoxGeometry(0.15, 0.09, 0.15), mat('#f0c890'), 0, -0.14, 0, armL);

  // floating name tag above the head (billboard sprite, subtle);
  // counter-scaled so tag legibility doesn't shrink with the rig
  if (opts.name && canPaint) {
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nameTexture(opts.name), transparent: true, opacity: 0.82, depthWrite: false,
    }));
    tag.scale.set(1.9 / (PLAYER.vis ?? 1), 0.48 / (PLAYER.vis ?? 1), 1);
    tag.position.set(0, 2.32, 0);
    tag.renderOrder = 5;
    g.add(tag);
  }

  g.scale.setScalar(PLAYER.vis ?? 1);

  return {
    group: g, torso,
    legL, legR, armL, armR,
    kneeL: legL.joint, kneeR: legR.joint,
    elbL: armL.joint, elbR: armR.joint,
    phase: Math.random() * 6.28,
    idleT: Math.random() * 6.28, // breathing / idle sway clock
    bicycleT: 0,  // 1.05s three-phase backflip
    slideT: 0,    // slide tackle
    flickT: 0,    // sombrero heel flick
    finesseT: 0,  // curled-shot follow-through
    kickT: 0,     // standard strike: plant + leg swings through
    headT: 0,     // header: leap, arch back, snap forward to nod the ball
    chipT: 0,     // scooped lob: toe under the ball, lean back
    throwT: 0,    // throw-in release: arms whip overhead → forward
    diveT: 0,     // GK dive; diveDir = ±1 lateral side
    diveDir: 1,
    holdBall: false, // throw-in stance: ball held two-handed overhead
  };
}

// Decal a custom face texture onto the FRONT (+z) of the head. Idempotent:
// re-calling swaps the texture on the existing plane. MeshBasic so the face
// reads clearly regardless of pitch lighting. Used for multiplayer avatars.
export function setFace(rig, texture) {
  if (!rig?.group || !texture) return;
  if (!rig._face) {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.32),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    plane.position.set(0, 1.66, 0.205); // head is an r=0.22 icosphere at y=1.66
    plane.renderOrder = 4;
    rig.group.add(plane);
    rig._face = plane;
  } else {
    rig._face.material.map = texture;
    rig._face.material.needsUpdate = true;
  }
}

const TAU = Math.PI * 2;

export function animateRig(rig, speed, dt) {
  const g = rig.group;
  rig.idleT += dt;

  // --- bicycle kick: crouch -> backflip strike -> land & recover ---
  if (rig.bicycleT > 0) {
    rig.bicycleT = Math.max(0, rig.bicycleT - dt);
    const t = 1.05 - rig.bicycleT;
    if (t < 0.15) {                    // 1. crouch, lean back
      const q = t / 0.15;
      g.rotation.x = -0.35 * q;
      g.position.y = -0.16 * q;
      rig.legL.rotation.x = 0.5 * q; rig.legR.rotation.x = 0.5 * q;
      rig.kneeL.rotation.x = -0.9 * q; rig.kneeR.rotation.x = -0.9 * q;
      rig.armL.rotation.x = -1.2 * q; rig.armR.rotation.x = -1.2 * q;
    } else if (t < 0.55) {             // 2. launch, scissor, full backflip
      const q = (t - 0.15) / 0.4;
      g.rotation.x = -0.35 - q * (TAU - 0.35);
      g.position.y = Math.sin(q * Math.PI) * 1.05 - 0.05;
      const s = Math.sin(q * Math.PI);
      rig.legL.rotation.x = -2.3 * s;
      rig.legR.rotation.x = 1.7 * Math.sin(q * Math.PI + 0.6);
      rig.kneeL.rotation.x = -0.4 * s; rig.kneeR.rotation.x = -0.7 * (1 - s);
      rig.armL.rotation.z = -1.1 * s; rig.armR.rotation.z = 1.1 * s;
    } else {                           // 3. land on the grass, roll up
      const q = (t - 0.55) / 0.5;
      g.rotation.x = -TAU - 0.3 * Math.sin(q * Math.PI) + TAU; // settle around 0 with a small rock
      g.position.y = -0.25 * (1 - q);
      rig.legL.rotation.x = -0.6 * (1 - q); rig.legR.rotation.x = 0.4 * (1 - q);
      rig.kneeL.rotation.x = -0.5 * (1 - q); rig.kneeR.rotation.x = -0.5 * (1 - q);
      rig.armL.rotation.z = -0.5 * (1 - q); rig.armR.rotation.z = 0.5 * (1 - q);
      rig.armL.rotation.x = 0; rig.armR.rotation.x = 0;
    }
    return;
  }

  // --- slide tackle: low lunge, trailing leg folded, arms out ---
  if (rig.slideT > 0) {
    rig.slideT = Math.max(0, rig.slideT - dt);
    g.rotation.x = -1.15;
    g.position.y = -0.35;
    rig.legL.rotation.x = -0.4; rig.legR.rotation.x = 0.9;
    rig.kneeL.rotation.x = -1.2; rig.kneeR.rotation.x = -0.1;
    rig.armL.rotation.z = -1.2; rig.armR.rotation.z = 1.2;
    return;
  }

  // --- GK dive: launch sideways, arms stretched, roll back up ---
  if (rig.diveT > 0) {
    rig.diveT = Math.max(0, rig.diveT - dt);
    const q = 1 - rig.diveT / 0.62;
    const s = Math.sin(q * Math.PI);           // out and back
    const d = rig.diveDir || 1;
    g.rotation.z = -d * 1.35 * s;
    g.rotation.x = 0;
    g.position.y = 0.28 * Math.sin(Math.min(1, q * 1.6) * Math.PI) - 0.22 * s;
    rig.armL.rotation.z = d * 2.5 * s; rig.armR.rotation.z = d * 2.5 * s;
    rig.armL.rotation.x = 0; rig.armR.rotation.x = 0;
    rig.legL.rotation.x = 0.25 * s; rig.legR.rotation.x = -0.2 * s;
    rig.kneeL.rotation.x = -0.5 * s; rig.kneeR.rotation.x = -0.3 * s;
    if (rig.diveT <= 0) { g.rotation.z = 0; rig.armL.rotation.z = 0; rig.armR.rotation.z = 0; }
    return;
  }

  // --- header: spring off the turf, arch back, then whip forward to nod it ---
  if (rig.headT > 0) {
    rig.headT = Math.max(0, rig.headT - dt);
    const q = 1 - rig.headT / 0.42;
    const jump = Math.sin(q * Math.PI);                 // up and back down
    const nod = Math.sin(Math.min(1, q * 1.35) * Math.PI / 2); // arch → snap through contact
    g.position.y = 0.5 * jump;
    g.rotation.x = 0.28 - 0.62 * nod;                   // lean back, then head drives forward
    g.rotation.z = 0;
    rig.legL.rotation.x = -0.55 * jump; rig.legR.rotation.x = 0.45 * jump; // legs tuck & trail
    rig.kneeL.rotation.x = -0.8 * jump; rig.kneeR.rotation.x = -0.6 * jump;
    rig.armL.rotation.x = -1.1 * jump; rig.armR.rotation.x = -1.1 * jump;  // arms up for lift/balance
    rig.armL.rotation.z = -0.5 * jump; rig.armR.rotation.z = 0.5 * jump;
    rig.elbL.rotation.x = 0.3; rig.elbR.rotation.x = 0.3;
    rig.torso.rotation.x = 0;
    if (rig.headT <= 0) {
      g.position.y = 0; g.rotation.x = 0;
      rig.armL.rotation.z = 0; rig.armR.rotation.z = 0;
    }
    return;
  }

  g.rotation.x = 0;
  g.rotation.z = 0;
  g.position.y = 0;
  rig.torso.rotation.x = 0;
  rig.armL.rotation.z = 0; rig.armR.rotation.z = 0;

  // --- throw-in release: arms whip from overhead to full follow-through ---
  if (rig.throwT > 0) {
    rig.throwT = Math.max(0, rig.throwT - dt);
    const q = 1 - rig.throwT / 0.45;
    const arm = 3.0 - 3.7 * Math.min(1, q * 1.25); // overhead → out front
    rig.armL.rotation.x = arm; rig.armR.rotation.x = arm;
    rig.elbL.rotation.x = 0.5 * (1 - q); rig.elbR.rotation.x = 0.5 * (1 - q);
    g.rotation.x = -0.14 + 0.3 * Math.sin(Math.min(1, q * 1.3) * Math.PI / 2); // arch → snap forward
    rig.legL.rotation.x = -0.2 * q; rig.legR.rotation.x = 0.25 * q;
    if (rig.throwT <= 0) {
      rig.armL.rotation.x = 0; rig.armR.rotation.x = 0;
      rig.elbL.rotation.x = 0; rig.elbR.rotation.x = 0;
      g.rotation.x = 0;
    }
    return;
  }

  // --- throw-in stance: both arms straight up holding the ball, slight arch ---
  if (rig.holdBall) {
    rig.armL.rotation.x = 3.0; rig.armR.rotation.x = 3.0;
    rig.elbL.rotation.x = 0.4; rig.elbR.rotation.x = 0.4;
    g.rotation.x = -0.1;
    rig.legL.rotation.x = 0; rig.legR.rotation.x = 0;
    rig.kneeL.rotation.x = 0; rig.kneeR.rotation.x = 0;
    return;
  }

  // --- sombrero: hop + heel flick ---
  if (rig.flickT > 0) {
    rig.flickT = Math.max(0, rig.flickT - dt);
    const q = 1 - rig.flickT / 0.4;
    const s = Math.sin(q * Math.PI);
    g.position.y = 0.14 * s;
    rig.legR.rotation.x = 1.5 * s;        // heel snaps up behind
    rig.kneeR.rotation.x = -1.6 * s;      // shin folds so the heel does the work
    rig.legL.rotation.x = -0.3 * s;
    rig.armL.rotation.x = -0.6 * s; rig.armR.rotation.x = -0.6 * s;
    return;
  }

  // --- finesse: striking leg sweeps across, torso follows through ---
  if (rig.finesseT > 0) {
    rig.finesseT = Math.max(0, rig.finesseT - dt);
    const q = 1 - rig.finesseT / 0.55;
    const sweep = Math.sin(Math.min(q * 1.6, 1) * Math.PI);
    rig.legR.rotation.x = -0.9 + 2.1 * q;
    rig.legR.rotation.z = -0.5 * sweep;   // wraps across the body
    rig.kneeR.rotation.x = -0.8 * (1 - q); // cocked, then extends through contact
    rig.legL.rotation.x = -0.15;
    rig.kneeL.rotation.x = -0.25;
    rig.armL.rotation.x = 0.8 * sweep; rig.armR.rotation.x = -0.8 * sweep;
    rig.torso.rotation.y = 0.4 * sweep;
    if (rig.finesseT <= 0) { rig.legR.rotation.z = 0; rig.torso.rotation.y = 0; rig.kneeR.rotation.x = 0; }
    return;
  }

  // --- chip: toe scoops under the ball, body leans back, arms flare ---
  if (rig.chipT > 0) {
    rig.chipT = Math.max(0, rig.chipT - dt);
    const q = 1 - rig.chipT / 0.4;
    const s = Math.sin(q * Math.PI);
    rig.legR.rotation.x = 0.5 - 1.7 * Math.min(1, q * 1.4); // short backswing, scoop through
    rig.kneeR.rotation.x = -1.0 * (1 - Math.min(1, q * 1.4)); // folded, snaps straight for the scoop
    rig.legL.rotation.x = 0.12 * s;
    g.rotation.x = -0.14 * s;              // lean back
    rig.armL.rotation.x = -0.7 * s; rig.armR.rotation.x = 0.5 * s;
    if (rig.chipT <= 0) { g.rotation.x = 0; rig.kneeR.rotation.x = 0; }
    return;
  }

  // --- standard kick: plant left, right leg cocks at the knee and drives through ---
  if (rig.kickT > 0) {
    rig.kickT = Math.max(0, rig.kickT - dt);
    const q = 1 - rig.kickT / 0.32;
    rig.legR.rotation.x = 0.9 - 2.5 * q;   // + is backswing, − swings through
    rig.kneeR.rotation.x = -1.3 * Math.max(0, 1 - q * 1.6); // folded in backswing, whips straight
    rig.legL.rotation.x = -0.15;
    rig.kneeL.rotation.x = -0.2;           // plant leg soft at the knee
    rig.armL.rotation.x = -0.6 * Math.sin(q * Math.PI);
    rig.armR.rotation.x = 0.6 * Math.sin(q * Math.PI);
    g.rotation.x = 0.08 * Math.sin(q * Math.PI); // slight lean over the ball
    if (rig.kickT <= 0) { g.rotation.x = 0; rig.kneeR.rotation.x = 0; rig.kneeL.rotation.x = 0; }
    return;
  }

  // --- run cycle: hip swing + knee fold on recovery, pumping bent arms, bob & lean ---
  // Smooth the driving speed so abrupt changes (net snapshots, quick stops)
  // don't pop the joints, then CROSSFADE idle↔run over a speed band instead of a
  // hard cutoff — removes the visible snap when a player starts/stops moving.
  // Full-run (run=1) and full-idle (run=0) poses are identical to before.
  rig.dispSpeed = (rig.dispSpeed ?? speed) + (speed - (rig.dispSpeed ?? speed)) * Math.min(1, dt * 10);
  const sp = rig.dispSpeed;
  rig.phase += Math.min(sp, 10) * dt * 1.55;
  const amp = Math.min(sp / 8, 1) * 0.85;
  const s = Math.sin(rig.phase);
  const run = Math.min(1, Math.max(0, (sp - 0.15) / 1.05)); // 0 = idle … 1 = running
  const idle = 1 - run;
  const b = Math.sin(rig.idleT * 1.7);              // breathing sway
  const mix = (r, i) => r * run + i * idle;

  rig.legL.rotation.x = mix(s * amp, s * amp * 0.2);
  rig.legR.rotation.x = mix(-s * amp, -s * amp * 0.2);
  // knee folds as the leg swings forward under the body, near-straight at plant
  rig.kneeL.rotation.x = mix(-amp * 1.05 * Math.max(0, Math.sin(rig.phase - 1.9)), -0.06);
  rig.kneeR.rotation.x = mix(-amp * 1.05 * Math.max(0, Math.sin(rig.phase + Math.PI - 1.9)), -0.06);
  rig.armL.rotation.x = mix(-s * amp * 0.7, -0.05 + 0.03 * b);
  rig.armR.rotation.x = mix(s * amp * 0.7, -0.05 + 0.03 * b);
  rig.elbL.rotation.x = mix(amp * (0.85 + 0.2 * s), 0.22 + 0.04 * b);
  rig.elbR.rotation.x = mix(amp * (0.85 - 0.2 * s), 0.22 + 0.04 * b);
  rig.torso.rotation.x = mix(0.16 * Math.min(sp / 8, 1), 0.02 + 0.015 * b);
  g.position.y = Math.abs(Math.cos(rig.phase)) * 0.045 * amp * run;   // stride bob fades out
}
