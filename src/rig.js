import * as THREE from 'three';

// Low-poly player: hex-cylinder torso, icosphere head, box limbs. Matte pastel materials.

const HAIR_COLORS = ['#2e2a28', '#4a3826', '#7a5a38', '#c9b18a', '#5a5f6b'];
const numberTexCache = new Map();

function numberTexture(n) {
  if (numberTexCache.has(n)) return numberTexCache.get(n);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#4a4f5c';
  ctx.font = '900 92px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  numberTexCache.set(n, tex);
  return tex;
}

export function buildRig(kit, skinTone, isGK, opts = {}) {
  const shirt = isGK ? kit.gk : kit.shirt;
  const sleeve = isGK ? kit.gk : kit.sleeve;
  const shorts = isGK ? '#5c6478' : kit.shorts;

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

  const torso = add(new THREE.CylinderGeometry(0.26, 0.32, 0.68, 6), mat(shirt), 0, 1.12, 0);
  add(new THREE.CylinderGeometry(0.3, 0.3, 0.24, 6), mat(shorts), 0, 0.72, 0);
  add(new THREE.IcosahedronGeometry(0.22, 1), mat(skinTone), 0, 1.66, 0);

  // shirt number on the back (rig faces +z, so back is -z)
  if (opts.number != null && typeof document !== 'undefined') {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.34),
      new THREE.MeshBasicMaterial({ map: numberTexture(opts.number), transparent: true }),
    );
    plate.position.set(0, 1.2, -0.31);
    plate.rotation.y = Math.PI;
    g.add(plate);
  }

  // hair: polygon caps in a few styles
  const style = opts.hairStyle ?? Math.floor(Math.random() * 5);
  const hairC = mat(HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)]);
  if (style === 1) add(new THREE.IcosahedronGeometry(0.2, 0), hairC, 0, 1.78, -0.03).scale.set(1.1, 0.55, 1.05); // crop
  else if (style === 2) add(new THREE.IcosahedronGeometry(0.24, 0), hairC, 0, 1.8, -0.02); // afro
  else if (style === 3) { // bun
    add(new THREE.IcosahedronGeometry(0.19, 0), hairC, 0, 1.79, -0.03).scale.set(1.05, 0.5, 1);
    add(new THREE.IcosahedronGeometry(0.09, 0), hairC, 0, 1.87, -0.16);
  } else if (style === 4) add(new THREE.BoxGeometry(0.3, 0.12, 0.3), hairC, 0, 1.85, 0); // flat top
  // style 0: bald

  const mkLimb = (x, y, w, len, color, footColor) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    g.add(pivot);
    add(new THREE.BoxGeometry(w, len, w), mat(color), 0, -len / 2, 0, pivot);
    if (footColor) add(new THREE.BoxGeometry(w + 0.03, 0.1, 0.27), mat(footColor), 0, -len - 0.04, 0.05, pivot);
    return pivot;
  };

  const legL = mkLimb(-0.14, 0.62, 0.16, 0.58, skinTone, '#4a4f5c');
  const legR = mkLimb(0.14, 0.62, 0.16, 0.58, skinTone, '#4a4f5c');
  const armL = mkLimb(-0.38, 1.4, 0.12, 0.5, sleeve);
  const armR = mkLimb(0.38, 1.4, 0.12, 0.5, sleeve);

  if (opts.captain) add(new THREE.BoxGeometry(0.15, 0.09, 0.15), mat('#f0c890'), 0, -0.14, 0, armL);

  return {
    group: g, torso,
    legL, legR, armL, armR,
    phase: Math.random() * 6.28,
    bicycleT: 0,  // 1.05s three-phase backflip
    slideT: 0,    // slide tackle
    flickT: 0,    // sombrero heel flick
    finesseT: 0,  // curled-shot follow-through
  };
}

const TAU = Math.PI * 2;

export function animateRig(rig, speed, dt) {
  const g = rig.group;

  // --- bicycle kick: crouch -> backflip strike -> land & recover ---
  if (rig.bicycleT > 0) {
    rig.bicycleT = Math.max(0, rig.bicycleT - dt);
    const t = 1.05 - rig.bicycleT;
    if (t < 0.15) {                    // 1. crouch, lean back
      const q = t / 0.15;
      g.rotation.x = -0.35 * q;
      g.position.y = -0.16 * q;
      rig.legL.rotation.x = 0.5 * q; rig.legR.rotation.x = 0.5 * q;
      rig.armL.rotation.x = -1.2 * q; rig.armR.rotation.x = -1.2 * q;
    } else if (t < 0.55) {             // 2. launch, scissor, full backflip
      const q = (t - 0.15) / 0.4;
      g.rotation.x = -0.35 - q * (TAU - 0.35);
      g.position.y = Math.sin(q * Math.PI) * 1.05 - 0.05;
      const s = Math.sin(q * Math.PI);
      rig.legL.rotation.x = -2.3 * s;
      rig.legR.rotation.x = 1.7 * Math.sin(q * Math.PI + 0.6);
      rig.armL.rotation.z = -1.1 * s; rig.armR.rotation.z = 1.1 * s;
    } else {                           // 3. land on the grass, roll up
      const q = (t - 0.55) / 0.5;
      g.rotation.x = -TAU - 0.3 * Math.sin(q * Math.PI) + TAU; // settle around 0 with a small rock
      g.position.y = -0.25 * (1 - q);
      rig.legL.rotation.x = -0.6 * (1 - q); rig.legR.rotation.x = 0.4 * (1 - q);
      rig.armL.rotation.z = -0.5 * (1 - q); rig.armR.rotation.z = 0.5 * (1 - q);
      rig.armL.rotation.x = 0; rig.armR.rotation.x = 0;
    }
    return;
  }

  // --- slide tackle: low lunge, arms out ---
  if (rig.slideT > 0) {
    rig.slideT = Math.max(0, rig.slideT - dt);
    g.rotation.x = -1.15;
    g.position.y = -0.35;
    rig.legL.rotation.x = -0.4; rig.legR.rotation.x = 0.9;
    rig.armL.rotation.z = -1.2; rig.armR.rotation.z = 1.2;
    return;
  }

  g.rotation.x = 0;
  g.position.y = 0;
  rig.armL.rotation.z = 0; rig.armR.rotation.z = 0;

  // --- sombrero: hop + heel flick ---
  if (rig.flickT > 0) {
    rig.flickT = Math.max(0, rig.flickT - dt);
    const q = 1 - rig.flickT / 0.4;
    const s = Math.sin(q * Math.PI);
    g.position.y = 0.14 * s;
    rig.legR.rotation.x = 1.5 * s;        // heel snaps up behind
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
    rig.armL.rotation.x = 0.8 * sweep; rig.armR.rotation.x = -0.8 * sweep;
    rig.torso.rotation.y = 0.4 * sweep;
    if (rig.finesseT <= 0) { rig.legR.rotation.z = 0; rig.torso.rotation.y = 0; }
    return;
  }

  // --- run cycle ---
  rig.phase += Math.min(speed, 10) * dt * 1.55;
  const amp = Math.min(speed / 8, 1) * 0.85;
  const s = Math.sin(rig.phase);
  rig.legL.rotation.x = s * amp;
  rig.legR.rotation.x = -s * amp;
  rig.armL.rotation.x = -s * amp * 0.7;
  rig.armR.rotation.x = s * amp * 0.7;
  if (speed < 0.3) {
    rig.legL.rotation.x *= 0.2; rig.legR.rotation.x *= 0.2;
    rig.armL.rotation.x *= 0.2; rig.armR.rotation.x *= 0.2;
  }
}
