import * as THREE from 'three';
import { FIELD, rand } from './config.js';

export const STADIUMS = [
  {
    id: 'day', name: 'Meadow Day', desc: 'Soft blue sky · warm sun · cream stands',
    sky: '#bfe0f0', fog: '#c9e4f0', ground: '#b9d9ae',
    grassA: '#a9d3a0', grassB: '#b8dfae', line: '#fbfaf5',
    hemiSky: '#dff0fa', hemiGround: '#b9d9ae', hemiInt: 0.75,
    sun: { color: '#fff3dd', int: 1.6, pos: [60, 90, 45] },
    stand: '#efe6d8', roof: '#f7f2e9', floodlights: false, clouds: true,
    crowd: ['#f2cfc4', '#c9dff0', '#f0e6c0', '#d5e8cf', '#e8d5ec', '#f5f0e8'],
  },
  {
    id: 'sunset', name: 'Peach Sunset', desc: 'Pink-orange sky · low golden light',
    sky: '#f4c3a8', fog: '#f2cdb5', ground: '#c2c99f',
    grassA: '#a9c896', grassB: '#b9d5a3', line: '#fdf6ec',
    hemiSky: '#f8d7bd', hemiGround: '#b3ab8e', hemiInt: 0.7,
    sun: { color: '#ffb27a', int: 1.7, pos: [-95, 22, 60] },
    stand: '#e6d0c0', roof: '#f0e0d2', floodlights: false, clouds: true, sunDisc: true,
    crowd: ['#f2c4b0', '#e8d0a8', '#d9b8c9', '#f0e0c8', '#c9c0e0', '#f5e8dc'],
  },
  {
    id: 'night', name: 'Mint Night', desc: 'Teal night · floodlight towers · cool matte',
    sky: '#141c2b', fog: '#1a2436', ground: '#3d5548',
    grassA: '#5f8f74', grassB: '#6a9d80', line: '#e8f2ec',
    hemiSky: '#5a7590', hemiGround: '#2c4038', hemiInt: 0.5,
    sun: { color: '#9fb8d8', int: 0.35, pos: [-40, 80, -60] },
    stand: '#2a3548', roof: '#354258', floodlights: true, clouds: false, stars: true,
    crowd: ['#8fb8c9', '#c9b8d9', '#b8d9c0', '#d9c9a8', '#a8b8e0', '#e0d0c8'],
  },
];

const matte = (c, extra = {}) => new THREE.MeshStandardMaterial({
  color: c, roughness: 0.95, metalness: 0, ...extra,
});

// apron of grass beyond the lines, matches the pitch plane in buildStadium
export const PITCH_PAD = { x: 7.5, z: 8 };

function pitchTexture(preset) {
  const { halfL, halfW, goalHalf, boxL, boxHalfW, penSpot, sixL, circleR } = FIELD;
  const PXM = 12; // px per meter
  const W = (halfL + PITCH_PAD.x) * 2 * PXM, H = (halfW + PITCH_PAD.z) * 2 * PXM;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const mx = (x) => (x + halfL + PITCH_PAD.x) * PXM;   // world x → px
  const mz = (z) => (z + halfW + PITCH_PAD.z) * PXM;   // world z → px

  ctx.fillStyle = preset.grassA;
  ctx.fillRect(0, 0, W, H);
  // mowing stripes
  ctx.fillStyle = preset.grassB;
  const stripeW = (halfL * 2) / 10;
  for (let i = 0; i < 10; i++) {
    if (i % 2 === 0) ctx.fillRect(mx(-halfL + i * stripeW), 0, stripeW * PXM, H);
  }

  ctx.strokeStyle = preset.line;
  ctx.lineWidth = 0.14 * PXM;
  const rect = (x1, z1, x2, z2) => ctx.strokeRect(mx(x1), mz(z1), (x2 - x1) * PXM, (z2 - z1) * PXM);

  rect(-halfL, -halfW, halfL, halfW);                    // border
  ctx.beginPath(); ctx.moveTo(mx(0), mz(-halfW)); ctx.lineTo(mx(0), mz(halfW)); ctx.stroke();
  ctx.beginPath(); ctx.arc(mx(0), mz(0), circleR * PXM, 0, 6.29); ctx.stroke();
  ctx.beginPath(); ctx.arc(mx(0), mz(0), 0.25 * PXM, 0, 6.29); ctx.fillStyle = preset.line; ctx.fill();

  for (const s of [-1, 1]) {
    const gl = s * halfL;
    rect(gl, -boxHalfW, gl - s * boxL, boxHalfW);        // penalty box
    rect(gl, -goalHalf - sixL, gl - s * sixL, goalHalf + sixL); // six-yard
    ctx.beginPath(); ctx.arc(mx(gl - s * penSpot), mz(0), 0.25 * PXM, 0, 6.29); ctx.fill(); // spot
    ctx.save();                                           // D arc
    ctx.beginPath(); ctx.rect(mx(gl - s * boxL) - (s > 0 ? circleR * PXM : 0), mz(-boxHalfW), circleR * PXM, boxHalfW * 2 * PXM);
    ctx.clip();
    ctx.beginPath(); ctx.arc(mx(gl - s * penSpot), mz(0), circleR * PXM, 0, 6.29); ctx.stroke();
    ctx.restore();
    // corner arcs
    for (const sz of [-1, 1]) {
      ctx.beginPath(); ctx.arc(mx(gl), mz(sz * halfW), 1 * PXM, 0, 6.29); ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function buildGoal(scene, sx) {
  const { halfL, goalHalf, goalHeight } = FIELD;
  const postR = 0.09; // chunkier visual frame than the physics cylinder
  const g = new THREE.Group();
  const white = matte('#f5f4ef', { roughness: 0.6 });
  const post = new THREE.CylinderGeometry(postR, postR, goalHeight, 8);
  for (const sz of [-1, 1]) {
    const m = new THREE.Mesh(post, white);
    m.position.set(sx * halfL, goalHeight / 2, sz * goalHalf);
    m.castShadow = true;
    g.add(m);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, goalHalf * 2 + postR * 2, 8), white);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(sx * halfL, goalHeight, 0);
  bar.castShadow = true;
  g.add(bar);

  // simple net: translucent gridded box behind the line
  const netMat = new THREE.MeshBasicMaterial({
    color: '#ffffff', wireframe: true, transparent: true, opacity: 0.22,
  });
  const net = new THREE.Mesh(new THREE.BoxGeometry(1.8, goalHeight, goalHalf * 2, 3, 5, 9), netMat);
  net.position.set(sx * (halfL + 0.9), goalHeight / 2, 0);
  net.userData.sx = sx;
  g.add(net);
  scene.add(g);
  return net;
}

function buildAdBoards(scene, preset) {
  const { halfL, halfW } = FIELD;
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f7f3ec';
  ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = '#9db8e8';
  ctx.font = '900 40px -apple-system, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('P A S T E L   P I T C H  ⚽', 256, 34);
  const adTex = new THREE.CanvasTexture(cv);
  adTex.colorSpace = THREE.SRGBColorSpace;

  const plains = ['#e8d5ec', '#d5e8cf', '#f0e6c0', '#c9dff0'];
  const mk = (w, x, z, rotY, i) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.9, 0.12),
      i % 3 === 0
        ? new THREE.MeshStandardMaterial({ map: adTex, roughness: 0.9 })
        : matte(plains[i % plains.length]),
    );
    m.position.set(x, 0.45, z);
    m.rotation.y = rotY;
    m.castShadow = true;
    scene.add(m);
  };
  const n = 10, segW = (halfL * 2) / n - 0.5;
  for (let i = 0; i < n; i++) {
    const x = -halfL + segW / 2 + i * (halfL * 2 / n);
    mk(segW, x, halfW + 2.6, 0, i);
    mk(segW, x, -(halfW + 2.6), 0, i + 1);
  }
  const nE = 7, segE = (halfW * 2) / nE - 0.5;
  for (let i = 0; i < nE; i++) {
    const z = -halfW + segE / 2 + i * (halfW * 2 / nE);
    mk(segE, halfL + 2.6, z, Math.PI / 2, i);
    mk(segE, -(halfL + 2.6), z, Math.PI / 2, i + 1);
  }
}

function buildFlags(scene) {
  const { halfL, halfW } = FIELD;
  const flags = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5), matte('#f5f4ef'));
      pole.position.set(sx * halfL, 0.8, sz * halfW);
      scene.add(pole);
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.32),
        new THREE.MeshStandardMaterial({ color: '#f2b8c4', roughness: 0.9, side: THREE.DoubleSide }),
      );
      flag.position.set(sx * halfL, 1.42, sz * halfW);
      flag.userData.base = Math.random() * 6.28;
      flags.push(flag);
      scene.add(flag);
    }
  }
  return flags;
}

function buildBenches(scene, preset) {
  const { halfW } = FIELD;
  for (const sx of [-1, 1]) {
    const dug = new THREE.Mesh(new THREE.BoxGeometry(7, 1.6, 1.6), matte(preset.roof));
    dug.position.set(sx * 12, 0.8, halfW + 5.5);
    scene.add(dug);
    for (let i = 0; i < 5; i++) {
      const sub = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 6), matte(sx < 0 ? '#c9dff0' : '#f2cfc4'));
      body.position.y = 0.55;
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), matte('#e5b58f'));
      head.position.y = 0.95;
      sub.add(body, head);
      sub.position.set(sx * 12 - 2.4 + i * 1.2, 0, halfW + 5.1);
      scene.add(sub);
    }
  }
}

function buildStands(scene, preset) {
  const { halfL, halfW } = FIELD;
  const standMat = matte(preset.stand);
  const roofMat = matte(preset.roof);
  const seats = [];

  const tierBox = (cx, cz, w, d, y, rotY) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), standMat);
    m.position.set(cx, y, cz);
    m.rotation.y = rotY;
    m.receiveShadow = true;
    scene.add(m);
  };

  const sides = [
    { cx: 0, cz: 1, len: halfL * 2 + 14, off: halfW, rot: 0 },       // touchlines
    { cx: 1, cz: 0, len: halfW * 2 + 14, off: halfL, rot: Math.PI / 2 }, // goal ends
  ];
  for (const side of sides) {
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const dist = side.off + 9 + k * 4;
        const y = 1.1 + k * 2.3;
        if (side.cz) tierBox(0, s * dist, side.len, 4, y, 0);
        else tierBox(s * dist, 0, 4, side.len, y, 0);
        // seat rows on top of each tier
        for (let row = 0; row < 2; row++) {
          const rd = dist - 1 + row * 1.6;
          const n = Math.floor(side.len / 1.15);
          for (let i = 0; i < n; i++) {
            const along = -side.len / 2 + 1 + i * 1.15 + rand(-0.15, 0.15);
            const sy = y + 1.55 + rand(-0.05, 0.1);
            if (side.cz) seats.push([along, sy, s * rd]);
            else seats.push([s * rd, sy, along]);
          }
        }
      }
      // roof slab
      const dist = side.off + 9 + 2 * 4;
      if (side.cz) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(side.len, 0.4, 8), roofMat);
        r.position.set(0, 10.5, s * (dist + 1));
        scene.add(r);
      } else {
        const r = new THREE.Mesh(new THREE.BoxGeometry(8, 0.4, side.len), roofMat);
        r.position.set(s * (dist + 1), 10.5, 0);
        scene.add(r);
      }
    }
  }

  // crowd: instanced pastel spheres
  const geo = new THREE.IcosahedronGeometry(0.34, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
  const inst = new THREE.InstancedMesh(geo, mat, seats.length);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  seats.forEach((p, i) => {
    m4.setPosition(p[0], p[1], p[2]);
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, col.set(preset.crowd[(Math.random() * preset.crowd.length) | 0]));
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  scene.add(inst);
  return { inst, seats };
}

function buildFloodlights(scene) {
  const { halfL, halfW } = FIELD;
  let shadowsLeft = 1;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (halfL + 13), z = sz * (halfW + 13);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 24, 6), matte('#3c4658'));
      pole.position.set(x, 12, z);
      scene.add(pole);
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, 1.6, 0.7),
        new THREE.MeshStandardMaterial({ color: '#dceefc', emissive: '#cfe8ff', emissiveIntensity: 1.6 }),
      );
      head.position.set(x, 23.5, z);
      head.lookAt(sx * 18, 0, sz * 10);
      scene.add(head);

      const spot = new THREE.SpotLight('#cfe4ff', 2400, 220, 0.55, 0.45, 1.6);
      spot.position.set(x, 24, z);
      spot.target.position.set(sx * 14, 0, sz * 8);
      if (shadowsLeft-- > 0) {
        spot.castShadow = true;
        spot.shadow.mapSize.set(1024, 1024);
      }
      scene.add(spot, spot.target);

      // visible light cone
      const coneLen = Math.hypot(x - sx * 14, 24, z - sz * 8);
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(13, coneLen, 20, 1, true),
        new THREE.MeshBasicMaterial({
          color: '#bfe0ff', transparent: true, opacity: 0.032,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      cone.position.copy(spot.position).lerp(spot.target.position, 0.5);
      cone.lookAt(spot.target.position);
      cone.rotateX(-Math.PI / 2);
      scene.add(cone);
    }
  }
}

function buildClouds(scene, preset) {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 1, metalness: 0, flatShading: true,
    transparent: true, opacity: 0.85,
  });
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(3, 6.5), 0), mat);
      puff.position.set(rand(-6, 6), rand(-1, 1.5), rand(-3, 3));
      puff.scale.y = 0.55;
      c.add(puff);
    }
    const ang = rand(0, Math.PI * 2);
    const dist = rand(120, 200);
    c.position.set(Math.cos(ang) * dist, rand(35, 60), Math.sin(ang) * dist);
    c.userData.drift = rand(0.6, 1.8);
    clouds.push(c);
    scene.add(c);
  }
  return clouds;
}

// lazy gulls circling the ground on daylight presets
function buildBirds(scene) {
  const birds = [];
  const dark = new THREE.MeshBasicMaterial({ color: '#4a4f5c', side: THREE.DoubleSide });
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Group();
    const wl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.35), dark);
    const wr = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.35), dark);
    wl.position.x = -0.6; wr.position.x = 0.6;
    b.add(wl, wr);
    b.userData = {
      wl, wr,
      r: rand(45, 100), h: rand(16, 30),
      a: rand(0, Math.PI * 2), sp: rand(0.08, 0.16) * (Math.random() < 0.5 ? 1 : -1),
      flap: rand(0, 6.28),
    };
    scene.add(b);
    birds.push(b);
  }
  return birds;
}

// fireflies drifting low around the night pitch
function buildFireflies(scene) {
  const n = 42;
  const pos = new Float32Array(n * 3);
  const seed = [];
  for (let i = 0; i < n; i++) {
    seed.push({ x: rand(-60, 60), y: rand(0.5, 4), z: rand(-40, 40), p: rand(0, 6.28) });
    pos[i * 3] = seed[i].x; pos[i * 3 + 1] = seed[i].y; pos[i * 3 + 2] = seed[i].z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: '#d9e8a0', size: 0.22, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  return { pts, seed, pos, mat };
}

function buildStars(scene) {
  const n = 350;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), r = rand(180, 320), y = rand(40, 200);
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color: '#dce8f5', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.8,
  }));
  scene.add(pts);
}

export function buildStadium(scene, preset) {
  scene.background = new THREE.Color(preset.sky);
  scene.fog = new THREE.Fog(preset.fog, 120, 340);

  const hemi = new THREE.HemisphereLight(preset.hemiSky, preset.hemiGround, preset.hemiInt);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(preset.sun.color, preset.sun.int);
  sun.position.set(...preset.sun.pos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 55; sc.bottom = -55;
  sc.near = 10; sc.far = 300;
  scene.add(sun);

  // pitch
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry((FIELD.halfL + PITCH_PAD.x) * 2, (FIELD.halfW + PITCH_PAD.z) * 2),
    new THREE.MeshStandardMaterial({ map: pitchTexture(preset), roughness: 1, metalness: 0 }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  scene.add(pitch);

  // outer ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), matte(preset.ground));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  const nets = [buildGoal(scene, -1), buildGoal(scene, 1)];
  const crowd = buildStands(scene, preset);
  buildAdBoards(scene, preset);
  const flags = buildFlags(scene);
  buildBenches(scene, preset);
  if (preset.floodlights) buildFloodlights(scene);
  const clouds = preset.clouds ? buildClouds(scene, preset) : [];
  const birds = preset.clouds ? buildBirds(scene) : [];
  const flies = preset.stars ? buildFireflies(scene) : null;
  if (preset.stars) buildStars(scene);
  if (preset.sunDisc) {
    const disc = new THREE.Mesh(
      new THREE.SphereGeometry(14, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ffd9a8' }),
    );
    disc.position.set(-260, 42, 160);
    scene.add(disc);
  }

  // live effects handle: waving flags, net ripple, crowd bounce on goals,
  // drifting clouds, circling gulls, fireflies, an idle crowd sway
  const m4 = new THREE.Matrix4();
  let t = 0, netPulse = 0, pulseNet = null, crowdWave = 0, swayCursor = 0;
  return {
    update(dt) {
      t += dt;
      for (const f of flags) f.rotation.y = 0.35 * Math.sin(t * 2.6 + f.userData.base);

      for (const c of clouds) {
        c.position.x += c.userData.drift * dt;
        if (c.position.x > 240) c.position.x = -240;
      }
      for (const b of birds) {
        const u = b.userData;
        u.a += u.sp * dt;
        u.flap += dt * 9;
        b.position.set(Math.cos(u.a) * u.r, u.h + Math.sin(t * 0.7 + u.flap) * 1.5, Math.sin(u.a) * u.r);
        b.rotation.y = -u.a - Math.sign(u.sp) * Math.PI / 2;
        const w = Math.sin(u.flap) * 0.55;
        u.wl.rotation.z = w; u.wr.rotation.z = -w;
      }
      if (flies) {
        for (let i = 0; i < flies.seed.length; i++) {
          const s = flies.seed[i];
          flies.pos[i * 3] = s.x + Math.sin(t * 0.5 + s.p) * 3;
          flies.pos[i * 3 + 1] = s.y + Math.sin(t * 0.9 + s.p * 2) * 0.8;
          flies.pos[i * 3 + 2] = s.z + Math.cos(t * 0.4 + s.p) * 3;
        }
        flies.pts.geometry.attributes.position.needsUpdate = true;
        flies.mat.opacity = 0.45 + 0.3 * Math.sin(t * 2.3);
      }

      const { inst, seats } = crowd;
      if (netPulse > 0) {
        netPulse -= dt;
        const k = Math.max(0, netPulse / 0.9);
        pulseNet.scale.x = 1 + 0.35 * Math.sin((0.9 - netPulse) * 22) * k;
        if (netPulse <= 0) pulseNet.scale.x = 1;
      }
      if (crowdWave > 0) {
        crowdWave -= dt;
        for (let i = 0; i < seats.length; i++) {
          const s = seats[i];
          const hop = Math.max(0, Math.sin(crowdWave * 7 + i * 0.35)) * 0.4 * Math.min(1, crowdWave);
          m4.setPosition(s[0], s[1] + hop, s[2]);
          inst.setMatrixAt(i, m4);
        }
        inst.instanceMatrix.needsUpdate = true;
      } else {
        // idle sway: refresh a slice of the crowd each frame (cheap breathing bob)
        const slice = Math.ceil(seats.length / 10);
        const end = Math.min(seats.length, swayCursor + slice);
        for (let i = swayCursor; i < end; i++) {
          const s = seats[i];
          m4.setPosition(s[0], s[1] + 0.05 * Math.sin(t * 1.7 + i * 0.6), s[2]);
          inst.setMatrixAt(i, m4);
        }
        swayCursor = end >= seats.length ? 0 : end;
        inst.instanceMatrix.needsUpdate = true;
      }
    },
    goal(side) {
      netPulse = 0.9;
      pulseNet = nets[side > 0 ? 1 : 0];
      crowdWave = 2.2;
    },
  };
}

// pastel comet trail for curled shots
export class BallTrail {
  constructor(scene) {
    this.n = 24;
    this.positions = new Float32Array(this.n * 3);
    const colors = new Float32Array(this.n * 3);
    const head = new THREE.Color('#f7b8d0');
    const tail = new THREE.Color('#20242e');
    const c = new THREE.Color();
    for (let i = 0; i < this.n; i++) {
      c.lerpColors(head, tail, i / (this.n - 1));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.line.frustumCulled = false;
    scene.add(this.line);
  }

  update(ball, dt) {
    const active = ball.isShot && ball.spin.lengthSq() > 12 && !ball.owner && !ball.heldBy;
    const mat = this.line.material;
    if (active) {
      // shift history back, write head
      for (let i = this.n - 1; i > 0; i--) {
        this.positions[i * 3] = this.positions[(i - 1) * 3];
        this.positions[i * 3 + 1] = this.positions[(i - 1) * 3 + 1];
        this.positions[i * 3 + 2] = this.positions[(i - 1) * 3 + 2];
      }
      this.positions[0] = ball.pos.x; this.positions[1] = ball.pos.y; this.positions[2] = ball.pos.z;
      this.line.geometry.attributes.position.needsUpdate = true;
      mat.opacity = Math.min(0.85, mat.opacity + 6 * dt);
    } else {
      mat.opacity = Math.max(0, mat.opacity - 3 * dt);
      if (mat.opacity === 0) {
        // park the trail on the ball so it doesn't streak on next activation
        for (let i = 0; i < this.n; i++) {
          this.positions[i * 3] = ball.pos.x;
          this.positions[i * 3 + 1] = ball.pos.y;
          this.positions[i * 3 + 2] = ball.pos.z;
        }
        this.line.geometry.attributes.position.needsUpdate = true;
      }
    }
  }
}

// pastel confetti burst for goals
export class Confetti {
  constructor(scene) {
    this.n = 350;
    this.pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.life = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const colors = new Float32Array(this.n * 3);
    const palette = ['#f2cfc4', '#c9dff0', '#f0e6c0', '#d5e8cf', '#e8d5ec', '#f7b8c4'];
    const c = new THREE.Color();
    for (let i = 0; i < this.n; i++) {
      c.set(palette[(Math.random() * palette.length) | 0]);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.mat = new THREE.PointsMaterial({
      size: 0.28, vertexColors: true, transparent: true, opacity: 0, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(x, z) {
    this.life = 2.6;
    for (let i = 0; i < this.n; i++) {
      this.pos[i * 3] = x + rand(-1, 1);
      this.pos[i * 3 + 1] = rand(0.5, 2.5);
      this.pos[i * 3 + 2] = z + rand(-1, 1);
      this.vel[i * 3] = rand(-6, 6);
      this.vel[i * 3 + 1] = rand(6, 15);
      this.vel[i * 3 + 2] = rand(-6, 6);
    }
    this.mat.opacity = 1;
  }

  update(dt) {
    if (this.life <= 0) return;
    this.life -= dt;
    for (let i = 0; i < this.n; i++) {
      this.vel[i * 3 + 1] -= 12 * dt;
      this.vel[i * 3] *= 1 - 1.2 * dt;
      this.vel[i * 3 + 2] *= 1 - 1.2 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.05, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.mat.opacity = Math.min(1, this.life);
  }
}
