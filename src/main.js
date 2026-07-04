import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TEAMS, resolveKits } from './teams.js';
import { newCup, myFixture, advance as advanceWC, simToEnd, cupHTML, roundName } from './worldcup.js';
import { STADIUMS, buildStadium, Confetti, BallTrail } from './stadium.js';
import { DIFFICULTY, FIELD, setField, clamp } from './config.js';
import { TEAM_TACTICS, FORMATIONS, buildLineup } from './tactics.js';
import { Input } from './input.js';
import { Match } from './match.js';
import { GameCamera } from './camera.js';
import { AudioEngine } from './audio.js';
import { Net, RemoteInput, encodeSnapshot, rigFx } from './net.js';
import { BALL_STYLES, getWins, addWin, isUnlocked, currentBallId, setBallId, previewURL } from './balls.js';
import { flagURL, flagHTML } from './flags.js';
import { RtcNet } from './rtc-net.js';
import { NetView } from './netview.js';
import { animateRig } from './rig.js';
import { TRAINED_NET } from './policy.js';

// --- renderer -------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.id = 'game';
document.body.prepend(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 600);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (game?.composer) game.composer.setSize(innerWidth, innerHeight);
});

function makeComposer(scene, preset) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    preset.floodlights ? 0.55 : 0.28, 0.6, 0.82,
  ));
  composer.addPass(new OutputPass());
  return composer;
}

const input = new Input();
const audio = new AudioEngine();

// mouse → pitch-plane aim point (fills input.aim for pass/shot targeting)
const aimRaycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimVec = new THREE.Vector3();
function updateAim() {
  if (!input.mouse.active) return;
  aimRaycaster.setFromCamera(input.mouse, camera);
  if (aimRaycaster.ray.intersectPlane(aimPlane, aimVec)) {
    input.aim = { x: aimVec.x, z: aimVec.z };
  }
}

function makeReticle(scene) {
  const grp = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({
    color: '#ffffff', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.47, 24), m);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), m);
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = 0.03;
  grp.add(ring, dot);
  grp.visible = false;
  scene.add(grp);
  return grp;
}

// show the aim ring while charging a mouse-aimed action
function updateReticle(g) {
  const aim = input.charging ? input.aimPoint() : null;
  g.reticle.visible = !!aim;
  if (aim) g.reticle.position.set(aim.x, 0, aim.z);
}

function makePassRing(scene) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.82, 26),
    new THREE.MeshBasicMaterial({
      color: '#a8e8b8', transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  scene.add(ring);
  return ring;
}

// while charging a pass/chip, ring the teammate the release would pick
function updatePassRing(g) {
  const m = g.match;
  const ch = input.charging;
  const h = m?.seats?.H;
  let mate = null;
  if (h && ch && (ch.type === 'pass' || ch.type === 'chip') && m.ball.owner === h) {
    const held = (performance.now() - ch.t0) / 1000;
    const aim = input.aimPoint();
    mate = ch.type === 'chip'
      ? m._passTargetFor(h, input, 8, 16 + 30 * Math.min(1, held / 0.9), true, aim)
      : m._passTargetFor(h, input, held > 0.32 ? 6 : 4, held > 0.32 ? 45 : 34, held > 0.32, aim);
  }
  g.passRing.visible = !!mate;
  if (mate) g.passRing.position.set(mate.pos.x, 0, mate.pos.z);
}

// --- dev mode (invisible adaptation feed) -----------------------------------

const dev = { on: sessionStorage.getItem('pp-dev') === '1' };
const DEV_PW = '1s2i3d4d';
$('devIcon').onclick = () => {
  if (dev.on) {
    dev.on = false;
    sessionStorage.removeItem('pp-dev');
    $('devIcon').style.opacity = 0.18;
    return;
  }
  const pw = window.prompt('');
  if (pw === DEV_PW) {
    dev.on = true;
    sessionStorage.setItem('pp-dev', '1');
    $('devIcon').style.opacity = 0.7;
    coachToast('dev mode on — AI adaptation feed live');
  }
};
if (dev.on) $('devIcon').style.opacity = 0.7;

function coachToast(msg) {
  if (!dev.on) return;
  const box = $('devToasts');
  const el = document.createElement('div');
  el.className = 'devToast';
  el.textContent = `🧠 ${msg}`;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = 0; }, 4200);
  setTimeout(() => el.remove(), 5000);
  while (box.children.length > 5) box.firstChild.remove();
}

// --- menu wiring ------------------------------------------------------------

function $(id) { return document.getElementById(id); }
const sel = {
  teamA: 0, teamB: 'random', stadium: 'day', diff: 'classic', len: 5,
  neural: localStorage.getItem('pp-neural') !== '0',
  ball: currentBallId(),
};

const chipHTML = (t) => `${flagHTML(t.code)}${t.code}`;

function buildChips(container, items, render, onPick) {
  container.innerHTML = '';
  items.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'chip';
    el.innerHTML = render(item, i);
    el.onclick = () => onPick(item, i);
    container.appendChild(el);
  });
}

buildChips($('gridA'), TEAMS, chipHTML, (t, i) => { sel.teamA = i; if (sel.teamB === i) sel.teamB = 'random'; refresh(); });
buildChips($('gridB'), ['random', ...TEAMS], (t) => t === 'random' ? '🎲 Random' : chipHTML(t),
  (t, i) => { sel.teamB = t === 'random' ? 'random' : i - 1; refresh(); });

STADIUMS.forEach((s) => {
  const el = document.createElement('div');
  el.className = 'miniCard';
  el.innerHTML = `<b>${s.name}</b><span>${s.desc}</span>`;
  el.onclick = () => { sel.stadium = s.id; refresh(); };
  el.dataset.id = s.id;
  $('stadiums').appendChild(el);
});
Object.entries(DIFFICULTY).forEach(([key, d]) => {
  const el = document.createElement('div');
  el.className = 'miniCard';
  el.innerHTML = `<b>${d.name}</b><span>${key === 'chill' ? 'Relaxed defenders, forgiving' : key === 'classic' ? 'A fair contest' : 'Sharp, fast, ruthless'}</span>`;
  el.onclick = () => { sel.diff = key; refresh(); };
  el.dataset.id = key;
  $('diffs').appendChild(el);
});
[5, 10, 15].forEach((n) => {
  const el = document.createElement('div');
  el.className = 'chip';
  el.textContent = n === 5 ? '5 min · no break' : `${n} min`;
  el.onclick = () => { sel.len = n; refresh(); };
  el.dataset.id = n;
  $('lens').appendChild(el);
});
$('neuralChip').onclick = () => {
  sel.neural = !sel.neural;
  localStorage.setItem('pp-neural', sel.neural ? '1' : '0');
  refresh();
};

// match-ball rack: famous balls unlock with career wins vs the AI
function renderBallChips() {
  const box = $('balls');
  box.innerHTML = '';
  const wins = getWins();
  for (const s of BALL_STYLES) {
    const el = document.createElement('div');
    el.className = 'chip';
    const open = isUnlocked(s);
    if (open) {
      el.innerHTML = `<img src="${previewURL(s)}" style="width:18px;height:18px;border-radius:50%;" />${s.name}`;
      el.title = s.note;
      el.onclick = () => { sel.ball = s.id; setBallId(s.id); refresh(); };
      el.classList.toggle('sel', sel.ball === s.id);
    } else {
      el.innerHTML = `🔒 ${s.name} <span style="color:#9aa2b1;font-weight:600;">· ${s.wins} wins</span>`;
      el.style.opacity = 0.55;
      el.style.cursor = 'default';
      el.title = s.note;
    }
    box.appendChild(el);
  }
  $('winCount').textContent = `${wins} career win${wins === 1 ? '' : 's'} vs the AI`;
}

// count a single-player / World Cup win and surface any fresh unlocks
function recordAIWin() {
  const fresh = addWin();
  renderBallChips();
  return fresh.length ? `🔓 New ball unlocked: ${fresh.map((s) => s.name).join(', ')}!` : null;
}

function teamStyleBlurb(i) {
  const t = TEAMS[i];
  const tt = TEAM_TACTICS[t.code];
  return tt ? `${t.name} · ${tt.formation.split('').join('-')}` : t.name;
}

function refresh() {
  [...$('gridA').children].forEach((el, i) => el.classList.toggle('sel', i === sel.teamA));
  [...$('gridB').children].forEach((el, i) =>
    el.classList.toggle('sel', sel.teamB === 'random' ? i === 0 : i - 1 === sel.teamB));
  [...$('stadiums').children].forEach((el) => el.classList.toggle('sel', el.dataset.id === sel.stadium));
  [...$('diffs').children].forEach((el) => el.classList.toggle('sel', el.dataset.id === sel.diff));
  [...$('lens').children].forEach((el) => el.classList.toggle('sel', +el.dataset.id === sel.len));
  $('neuralChip').classList.toggle('sel', sel.neural);
  $('neuralChip').style.display = TRAINED_NET ? '' : 'none';
  renderBallChips();
  $('btnResume').style.display = localStorage.getItem('pp-save') ? '' : 'none';
  $('btnWC').textContent = localStorage.getItem('pp-wc') ? '🏆 World Cup · continue' : '🏆 World Cup';
  $('styleNote').textContent = teamStyleBlurb(sel.teamA);
}
refresh();

$('btnRematch').onclick = () => { $('endscreen').classList.add('hidden'); startSP(); };
$('btnMenu').onclick = () => { $('endscreen').classList.add('hidden'); toMenu(); };
$('btnStart').onclick = () => { audio.init(); startSP(); };
$('btnResume').onclick = () => {
  audio.init();
  const save = JSON.parse(localStorage.getItem('pp-save') || 'null');
  if (save) startSP(save);
};

function toMenu() {
  game = null;
  $('hud').classList.add('hidden');
  $('pauseMenu').classList.add('hidden');
  $('tabMenu').classList.add('hidden');
  $('bracketOverlay').classList.add('hidden');
  $('menu').classList.remove('hidden');
  refresh();
}

// --- HUD -------------------------------------------------------------------

let bannerTimer = null;
function showBanner(text, ms) {
  const b = $('banner');
  if (!text) { b.style.opacity = 0; return; }
  b.textContent = text;
  b.style.opacity = 1;
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(() => { b.style.opacity = 0; }, ms);
}

function setScoreboard(codeA, codeB) {
  $('swA').style.background = `url(${flagURL(codeA)}) center/cover`;
  $('swB').style.background = `url(${flagURL(codeB)}) center/cover`;
  $('codeA').textContent = codeA;
  $('codeB').textContent = codeB;
}
function setScore(a, b, clock) {
  $('score').textContent = `${a} – ${b}`;
  $('clock').textContent = clock;
}

const mmCtx = $('minimap').getContext('2d');
function drawMinimapPts(aPts, bPts, ball, colA, colB, me) {
  const W = 220, H = 150;
  mmCtx.clearRect(0, 0, W, H);
  mmCtx.fillStyle = '#a9d3a0dd';
  mmCtx.beginPath(); mmCtx.roundRect(0, 0, W, H, 10); mmCtx.fill();
  mmCtx.strokeStyle = '#ffffffaa'; mmCtx.lineWidth = 1;
  mmCtx.strokeRect(10, 8, W - 20, H - 16);
  mmCtx.beginPath(); mmCtx.moveTo(W / 2, 8); mmCtx.lineTo(W / 2, H - 8); mmCtx.stroke();
  const px = (x) => 10 + ((x + FIELD.halfL) / FIELD.length) * (W - 20);
  const pz = (z) => 8 + ((z + FIELD.halfW) / FIELD.width) * (H - 16);
  for (const [pts, color] of [[aPts, colA], [bPts, colB]]) {
    mmCtx.fillStyle = color;
    for (const p of pts) {
      mmCtx.beginPath(); mmCtx.arc(px(p.x), pz(p.z), 3, 0, 6.29); mmCtx.fill();
      mmCtx.strokeStyle = '#4a4f5c55'; mmCtx.stroke();
    }
  }
  if (me) {
    mmCtx.strokeStyle = '#ffffff'; mmCtx.lineWidth = 2;
    mmCtx.beginPath(); mmCtx.arc(px(me.x), pz(me.z), 5, 0, 6.29); mmCtx.stroke();
  }
  mmCtx.fillStyle = '#3c4048';
  mmCtx.beginPath(); mmCtx.arc(px(ball.x), pz(ball.z), 2.5, 0, 6.29); mmCtx.fill();
}

// --- shared scene builder ------------------------------------------------------

function buildScene(stadiumId) {
  const preset = STADIUMS.find((s) => s.id === stadiumId) ?? STADIUMS[0];
  const scene = new THREE.Scene();
  const sfx = buildStadium(scene, preset);
  const confetti = new Confetti(scene);
  const cam = new GameCamera(camera);
  const reticle = makeReticle(scene);
  const passRing = makePassRing(scene);
  return { scene, sfx, confetti, cam, reticle, passRing, composer: makeComposer(scene, preset), preset };
}

// --- goal replays (single-player): goal cam → player cam → cinematic ---------

const REPLAY_STAGES = [
  { cam: 'goal',   span: 3.4, rate: 1.0,  fov: 46, label: '▶ GOAL CAM' },
  { cam: 'player', span: 3.0, rate: 0.7,  fov: 50, label: '▶ PLAYER CAM' },
  { cam: 'cine',   span: 2.6, rate: 0.42, fov: 38, label: '▶ CINEMATIC' },
];

// rolling ~8s tape of every rig + the ball, sampled at 30Hz
class Recorder {
  constructor() { this.frames = []; this.acc = 0; }
  tick(match, dt) {
    this.acc -= dt;
    if (this.acc > 0) return;
    this.acc = 1 / 30;
    const ps = [];
    for (const team of [match.teamA, match.teamB]) {
      for (const p of team.players) {
        ps.push([p.pos.x, p.pos.z, p.rig.group.rotation.y, Math.hypot(p.vel.x, p.vel.z), rigFx(p.rig)]);
      }
    }
    const b = match.ball;
    this.frames.push({ ps, b: [b.pos.x, b.pos.y, b.pos.z] });
    if (this.frames.length > 240) this.frames.shift();
  }
}

function startReplay(g) {
  const m = g.match;
  const frames = g.rec.frames;
  if (frames.length < 45) return; // not enough tape — skip quietly
  const players = [...m.teamA.players, ...m.teamB.players];
  g.replay = {
    frames: frames.slice(), players,
    meta: g.replayMeta ?? { goalSign: 1, scorerGi: -1 },
    stage: 0, cursor: 0, cineA: Math.random() * 6.28,
    fxPrev: players.map(() => 0),
    saved: players.map((p) => ({ x: p.pos.x, z: p.pos.z, ry: p.rig.group.rotation.y })),
  };
  $('replayChip').classList.remove('hidden');
  showBanner(REPLAY_STAGES[0].label, 900);
}

function endReplay(g) {
  const r = g.replay;
  if (!r) return;
  g.replay = null;
  $('replayChip').classList.add('hidden');
  for (let k = 0; k < r.players.length; k++) {
    const p = r.players[k], s = r.saved[k], rig = p.rig;
    p.pos.set(s.x, 0, s.z); // pos aliases rig.group.position
    rig.group.rotation.set(0, s.ry, 0);
    rig.bicycleT = rig.slideT = rig.flickT = rig.finesseT = 0;
    rig.kickT = rig.chipT = rig.throwT = rig.diveT = 0;
    rig.holdBall = false;
  }
  g.match.ball.mesh.position.copy(g.match.ball.pos);
  camera.fov = 45;
  camera.updateProjectionMatrix();
  g.cam.snap(g.match.ball);
  showBanner('', 1);
}

function stepReplay(g, dt) {
  const r = g.replay;
  const st = REPLAY_STAGES[r.stage];
  const total = r.frames.length / 30;
  const span = Math.min(st.span, total - 0.15);
  r.cursor += dt * st.rate;
  if (r.cursor >= span) {
    r.stage++;
    r.cursor = 0;
    if (r.stage >= REPLAY_STAGES.length) return endReplay(g);
    r.fxPrev = r.players.map(() => 0);
    showBanner(REPLAY_STAGES[r.stage].label, 900);
    return;
  }

  const fi = (total - span + r.cursor) * 30;
  const i0 = Math.max(0, Math.min(r.frames.length - 1, Math.floor(fi)));
  const i1 = Math.min(r.frames.length - 1, i0 + 1);
  const q = fi - i0;
  const f0 = r.frames[i0], f1 = r.frames[i1];

  for (let k = 0; k < r.players.length; k++) {
    const a = f0.ps[k], b = f1.ps[k];
    const rig = r.players[k].rig;
    rig.group.position.x = a[0] + (b[0] - a[0]) * q;
    rig.group.position.z = a[1] + (b[1] - a[1]) * q;
    const dr = b[2] - a[2];
    rig.group.rotation.y = Math.abs(dr) > Math.PI ? b[2] : a[2] + dr * q;
    const fx = b[4];
    if ((fx & 1) && !(r.fxPrev[k] & 1)) rig.bicycleT = 1.05;
    if ((fx & 2) && !(r.fxPrev[k] & 2)) rig.slideT = 0.55;
    if ((fx & 4) && !(r.fxPrev[k] & 4)) rig.flickT = 0.4;
    if ((fx & 8) && !(r.fxPrev[k] & 8)) rig.finesseT = 0.55;
    if ((fx & 16) && !(r.fxPrev[k] & 16)) rig.throwT = 0.45;
    if ((fx & 32) && !(r.fxPrev[k] & 32)) rig.kickT = 0.32;
    if ((fx & 64) && !(r.fxPrev[k] & 64)) rig.chipT = 0.4;
    if ((fx & 256) && !(r.fxPrev[k] & 256)) { rig.diveT = 0.62; rig.diveDir = (fx & 512) ? 1 : -1; }
    rig.holdBall = !!(fx & 128);
    r.fxPrev[k] = fx;
    animateRig(rig, a[3] + (b[3] - a[3]) * q, dt * st.rate);
  }

  const bx = f0.b[0] + (f1.b[0] - f0.b[0]) * q;
  const by = f0.b[1] + (f1.b[1] - f0.b[1]) * q;
  const bz = f0.b[2] + (f1.b[2] - f0.b[2]) * q;
  g.match.ball.mesh.position.set(bx, by, bz);

  // camera per angle
  const meta = r.meta;
  if (st.cam === 'goal') {
    camera.position.set(meta.goalSign * (FIELD.halfL + 6.5), 3.0, clamp(bz * 0.5, -9, 9));
    camera.lookAt(bx, Math.max(by, 0.4), bz);
  } else if (st.cam === 'player' && meta.scorerGi >= 0) {
    const sp = r.players[meta.scorerGi].rig.group.position;
    const dx = bx - sp.x, dz = bz - sp.z;
    const dl = Math.hypot(dx, dz) || 1;
    camera.position.set(sp.x - (dx / dl) * 4.5, 2.4, sp.z - (dz / dl) * 4.5);
    camera.lookAt(bx, 0.8, bz);
  } else {
    r.cineA += dt * 0.32;
    const cx = (bx + meta.goalSign * FIELD.halfL * 0.8) / 2;
    camera.position.set(cx + Math.cos(r.cineA) * 15, 5.5, bz * 0.4 + Math.sin(r.cineA) * 15);
    camera.lookAt(bx, 1, bz);
  }
  if (camera.fov !== st.fov) {
    camera.fov = st.fov;
    camera.updateProjectionMatrix();
  }
}

// --- game lifecycle ----------------------------------------------------------

let game = null;

// cfg: { aIdx, bIdx, stadiumId, diffKey, len, golden, sizeKey,
//        seats: [{key, side, idx?}], remotes: Map(seatKey→RemoteInput),
//        lan, restore, onEnd }
function startHostedMatch(cfg) {
  const teamADef = TEAMS[cfg.aIdx];
  const teamBDef = TEAMS[cfg.bIdx];
  const kits = resolveKits(teamADef, teamBDef);
  setField(cfg.sizeKey ?? '11');
  const base = buildScene(cfg.stadiumId);
  const trail = new BallTrail(base.scene);

  const g = {
    kind: cfg.lan ? 'host' : 'sp',
    ...base, trail,
    paused: false, slow: -1, tabOpen: false,
    cfg, kits,
    remotes: cfg.remotes ?? new Map(),
    castT: 0,
    rec: new Recorder(),
    replay: null, replayIn: null,
  };

  const match = new Match(base.scene, {
    teamADef, teamBDef, kits,
    ballStyle: sel.ball,
    diffKey: cfg.diffKey,
    lengthMin: cfg.len,
    halves: cfg.len === 5 ? 1 : 2,
    goldenGoal: cfg.golden,
    sizeKey: cfg.sizeKey ?? '11',
    seats: cfg.seats,
    hooks: {
      banner: (text, ms) => { showBanner(text, ms); castAll({ k: 'banner', text, ms }); },
      coach: (msg) => coachToast(msg),
      onGoal: (scorer, x, z, toucher) => {
        base.confetti.burst(x, z);
        base.sfx.goal(x);
        base.cam.shake();
        audio.roar();
        const og = toucher && toucher.team !== scorer;
        const who = toucher ? `  —  ${toucher.name}${og ? ' (OG)' : ''}` : '';
        showBanner(`GOAL!  ${scorer.def.code}${who}`, 2600);
        castAll({ k: 'goal', x, z, text: `GOAL!  ${scorer.def.code}${who}` });
        setScore(match.scoreA, match.scoreB, match.clockText());
        // single-player: queue a multi-angle replay once the net stops rippling
        if (!cfg.lan) {
          const aCount = match.teamA.players.length;
          g.replayMeta = {
            goalSign: Math.sign(x || 1),
            scorerGi: toucher ? (toucher.team.key === 'B' ? aCount + toucher.idx : toucher.idx) : -1,
          };
          g.replayIn = 1.05;
        }
      },
      onBicycle: () => { g.slow = 0.45; base.cam.punch(); castAll({ k: 'sfx', n: 'kick', a: 1 }); },
      onFullTime: () => cfg.onEnd(match),
      sfx: (n, a) => {
        audio.event(n, a);
        if (n === 'whistle' || (n === 'kick' && a > 0.55)) castAll({ k: 'sfx', n, a });
      },
    },
  });
  match.setFirstKicker(match.teamA);
  if (sel.neural && TRAINED_NET) {
    match.teamA.policyNet = TRAINED_NET;
    match.teamB.policyNet = TRAINED_NET;
  }
  if (cfg.restore) match.restoreState(cfg.restore);
  base.cam.snap(match.ball);

  setScoreboard(teamADef.code, teamBDef.code);
  setScore(match.scoreA, match.scoreB, match.clockText());

  $('menu').classList.add('hidden');
  $('lobby').classList.add('hidden');
  $('bracketOverlay').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('helpPanel').classList.add('hidden');

  g.match = match;
  game = g;
  return g;
}

function startSP(restore = null, sizeKey = '11') {
  const aIdx = restore ? TEAMS.findIndex((t) => t.code === restore.a) : sel.teamA;
  let bIdx = restore ? TEAMS.findIndex((t) => t.code === restore.b) : sel.teamB;
  if (bIdx === 'random' || bIdx < 0) {
    do { bIdx = (Math.random() * TEAMS.length) | 0; } while (bIdx === aIdx);
  }
  startHostedMatch({
    aIdx, bIdx: typeof bIdx === 'number' ? bIdx : 0,
    stadiumId: restore?.stadium ?? sel.stadium,
    diffKey: restore?.diffKey ?? sel.diff,
    len: restore?.lengthMin ?? sel.len,
    golden: false, sizeKey,
    seats: [{ key: 'H', side: 'A' }],
    lan: false, restore,
    onEnd: (m) => {
      localStorage.removeItem('pp-save');
      const a = m.scoreA, b = m.scoreB;
      $('endTitle').textContent = 'FULL-TIME';
      $('endScore').textContent = `${m.teamA.def.code} ${a} – ${b} ${m.teamB.def.code}`;
      let note = a === b ? 'A draw — honors shared.'
        : (a > b ? `${m.teamA.def.name} take it. Lovely stuff.` : `${m.teamB.def.name} edge it this time.`);
      if (a > b) {
        const unlock = recordAIWin();
        if (unlock) note += `  ${unlock}`;
      }
      $('endNote').textContent = note;
      $('endscreen').classList.remove('hidden');
    },
  });
}

// --- World Cup mode ------------------------------------------------------------

let wc = null;
const WC_KEY = 'pp-wc';
function loadWC() {
  try { return JSON.parse(localStorage.getItem(WC_KEY) || 'null'); } catch { return null; }
}
function saveWC() { if (wc) localStorage.setItem(WC_KEY, JSON.stringify(wc)); }

function openWC() {
  if (!wc) wc = loadWC();
  if (!wc) { wc = newCup(sel.teamA); saveWC(); }
  renderWC();
  $('menu').classList.add('hidden');
  $('wcOverlay').classList.remove('hidden');
}

function renderWC() {
  const my = TEAMS[wc.my];
  const fx = myFixture(wc);
  $('wcView').innerHTML = cupHTML(wc);
  const play = $('btnWCPlay'), sim = $('btnWCSim');
  if (wc.champion != null) {
    $('wcSub').textContent = `${my.name} — tournament complete.`;
    play.style.display = 'none';
    sim.style.display = 'none';
  } else if (fx) {
    const opp = TEAMS[fx.h === wc.my ? fx.a : fx.h];
    const label = fx.stage === 'group'
      ? `Matchday ${fx.md}` : roundName(0, wc.ko.rounds[wc.ko.r].length);
    $('wcSub').textContent = `You are ${my.name}. Up next — ${label} vs ${opp.name}.`;
    play.textContent = `Play ${label} · vs ${opp.code} ▸`;
    play.style.display = '';
    sim.style.display = 'none';
  } else {
    $('wcSub').textContent = `${my.name} are out. Sim the rest to crown a champion.`;
    play.style.display = 'none';
    sim.style.display = '';
  }
}

$('btnWC').onclick = () => { audio.init(); openWC(); };
$('btnWCBack').onclick = () => { $('wcOverlay').classList.add('hidden'); toMenu(); };
$('btnWCNew').onclick = () => { wc = newCup(sel.teamA); saveWC(); renderWC(); };
$('btnWCSim').onclick = () => { simToEnd(wc); saveWC(); renderWC(); };

$('btnWCPlay').onclick = () => {
  const fx = myFixture(wc);
  if (!fx) return;
  const meFirst = fx.h === wc.my;
  const isKO = fx.stage === 'ko';
  $('wcOverlay').classList.add('hidden');
  startHostedMatch({
    aIdx: wc.my,
    bIdx: meFirst ? fx.a : fx.h,
    stadiumId: sel.stadium, diffKey: sel.diff, len: sel.len,
    golden: isKO, sizeKey: '11',
    seats: [{ key: 'H', side: 'A' }],
    lan: false, wc: true,
    onEnd: (m) => {
      const res = meFirst
        ? { h: fx.h, a: fx.a, sh: m.scoreA, sa: m.scoreB }
        : { h: fx.h, a: fx.a, sh: m.scoreB, sa: m.scoreA };
      advanceWC(wc, res);
      saveWC();
      const won = wc.champion === wc.my;
      let ft = won ? '🏆 WORLD CHAMPIONS!' : `FULL-TIME  ${m.scoreA} – ${m.scoreB}`;
      if (m.scoreA > m.scoreB) {
        const unlock = recordAIWin();
        if (unlock) ft += `  ·  ${unlock}`;
      }
      showBanner(ft, 2600);
      if (won) { game.confetti.burst(0, 0); audio.roar(); }
      setTimeout(() => {
        game = null;
        $('hud').classList.add('hidden');
        openWC();
      }, won ? 3600 : 2600);
    },
  });
};

// --- pause / tab menus ---------------------------------------------------------

function togglePause(force) {
  if (!game || game.kind === 'client') return;
  game.paused = force ?? !game.paused;
  $('pauseMenu').classList.toggle('hidden', !game.paused);
  $('btnSaveQuit').style.display = game.kind === 'sp' && !game.cfg?.wc ? '' : 'none';
  castAll({ k: 'banner', text: game.paused ? 'HOST PAUSED' : '', ms: game.paused ? 0 : 1 });
}
$('btnResumePlay').onclick = () => togglePause(false);
$('btnSaveQuit').onclick = () => {
  if (game?.match) {
    localStorage.setItem('pp-save', JSON.stringify({ ...game.match.serialize(), stadium: game.cfg.stadiumId }));
  }
  toMenu();
};
$('btnQuitNoSave').onclick = () => {
  if (game?.kind === 'host') { castAll({ k: 'aborted' }); backToRoom(); }
  else toMenu();
};

function openTabMenu() {
  if (!game) return;
  let seatKey, teamDef, players;
  if (game.kind === 'client') {
    seatKey = String(myId);
    if (!clientSide || clientFixture.mode !== '11') return;
    teamDef = clientSide === 'A' ? clientFixture.aDef : clientFixture.bDef;
    const lineup = buildLineup(teamDef, '11');
    players = lineup.slots.map((s, i) => {
      const [num, name] = teamDef.xi?.[s.xi] ?? [i + 1, `${teamDef.code} ${i + 1}`];
      return { num, name, i, role: s.role };
    });
  } else {
    if (game.match.sizeKey !== '11' || !game.match.seats.H) return;
    seatKey = 'H';
    const team = game.match.team(game.match.seatSide.H);
    teamDef = team.def;
    players = team.players.map((p) => ({ num: p.num, name: p.name, i: p.idx, role: p.role }));
  }
  const grid = $('tabGrid');
  grid.innerHTML = '';
  for (const p of players) {
    const el = document.createElement('div');
    el.className = 'chip';
    el.style.minWidth = '150px';
    el.innerHTML = `${flagHTML(teamDef.code)}<b>${p.num}</b>&nbsp;${p.name}&nbsp;<span style="color:#9aa2b1">${p.role}</span>`;
    if (p.i === 0) { el.style.opacity = 0.4; el.style.cursor = 'default'; }
    else el.onclick = () => {
      if (game.kind === 'client') net?.sendInput({ e: [{ type: 'switchTo', idx: p.i }] });
      else game.match.switchControlled('H', p.i);
      closeTabMenu();
    };
    grid.appendChild(el);
  }
  game.tabOpen = true;
  $('tabMenu').classList.remove('hidden');
}
function closeTabMenu() {
  if (game) game.tabOpen = false;
  $('tabMenu').classList.add('hidden');
}
$('tabMenu').onclick = (e) => { if (e.target.id === 'tabMenu') closeTabMenu(); };

// --- Online rooms (WebRTC peer-to-peer by default; ?ws forces the LAN relay) --

let net = null;
let netRole = null;         // 'host' | 'client'
let myId = null;
let roster = [];
let myTeamPick = null;
const remoteInputs = new Map();
let cup = null;
let clientFixture = null;   // client-side: {aDef, bDef, mode}
let clientSide = null;      // 'A' | 'B' | null
let clientView = null;

$('btnLAN').onclick = () => {
  $('menu').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  $('lobbyChoice').classList.remove('hidden');
  $('lobbyRoom').classList.add('hidden');
  $('lanError').textContent = '';
};
$('btnLobbyBack').onclick = () => { net?.close?.(); net = null; $('lobby').classList.add('hidden'); toMenu(); };
$('btnLeaveRoom').onclick = () => { net?.close?.(); net = null; $('lobby').classList.add('hidden'); toMenu(); };

buildChips($('lanTeams'), TEAMS, chipHTML, (t, i) => {
  myTeamPick = i;
  net?.pickTeam(i);
  [...$('lanTeams').children].forEach((el, j) => el.classList.toggle('sel', j === i));
});

const NO_SERVER_MSG = 'Could not start a room — check your internet connection and try again.';

async function connectNet() {
  net = new URLSearchParams(location.search).has('ws') ? new Net() : new RtcNet();
  await net.connect();
  net.on('err', (m) => { $('lanError').textContent = m.msg; });
  net.on('roster', (m) => { roster = m.roster; renderRoster(); });
  net.on('close', () => { if (netRole) { showBanner('CONNECTION LOST', 2500); toMenu(); netRole = null; } });
}

$('btnHost').onclick = async () => {
  audio.init();
  try { await connectNet(); } catch { $('lanError').textContent = NO_SERVER_MSG; return; }
  netRole = 'host';
  net.on('created', (m) => {
    $('roomCode').textContent = m.code;
    $('lobbyChoice').classList.add('hidden');
    $('lobbyRoom').classList.remove('hidden');
    $('hostControls').classList.remove('hidden');
    $('clientWait').classList.add('hidden');
  });
  net.on('input', (m) => {
    let ri = remoteInputs.get(m.from);
    if (!ri) { ri = new RemoteInput(); remoteInputs.set(m.from, ri); }
    ri.apply(m.d);
  });
  net.on('left', () => {});
  net.create($('lanName').value || 'Host', null);
};

$('btnJoin').onclick = async () => {
  audio.init();
  try { await connectNet(); } catch { $('lanError').textContent = NO_SERVER_MSG; return; }
  netRole = 'client';
  net.on('joined', (m) => {
    myId = m.id;
    $('roomCode').textContent = m.code;
    $('lobbyChoice').classList.add('hidden');
    $('lobbyRoom').classList.remove('hidden');
    $('hostControls').classList.add('hidden');
    $('clientWait').classList.remove('hidden');
  });
  net.on('cast', (m) => handleCast(m.d));
  net.join($('lanCode').value, $('lanName').value || 'Player');
};

function renderRoster() {
  const list = $('rosterList');
  list.innerHTML = '';
  for (const r of roster) {
    const t = r.team != null ? TEAMS[r.team] : null;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 10px;background:#fafbfd;border-radius:10px;';
    row.innerHTML = `<b>${r.name}</b>${r.id === 0 ? ' <span style="color:#9aa2b1;font-size:11px;">HOST</span>' : ''}
      <span style="margin-left:auto;">${t ? chipHTML(t) : '<span style="color:#c9ced8">picking…</span>'}</span>`;
    list.appendChild(row);
  }
}

function castAll(d) { if (netRole === 'host' && net) net.cast(d); }

function backToRoom() {
  game = null;
  clientView = null;
  $('hud').classList.add('hidden');
  $('pauseMenu').classList.add('hidden');
  if (cup) { renderBracket(); $('bracketOverlay').classList.remove('hidden'); }
  else $('lobby').classList.remove('hidden');
}

// --- host: fixtures --------------------------------------------------------------

function usedTeams() { return new Set(roster.map((r) => r.team).filter((v) => v != null)); }
function randomFreeTeam(used) {
  let i;
  do { i = (Math.random() * TEAMS.length) | 0; } while (used.has(i));
  used.add(i);
  return i;
}

function startLanMatch(e1, e2, golden, onEnd) {
  // e: {name, team, clientId}  clientId 0 = host, null = CPU
  const used = usedTeams();
  if (e1.team == null) e1.team = randomFreeTeam(used);
  if (e2.team == null) e2.team = randomFreeTeam(used);

  const seats = [];
  const remotes = new Map();
  const sides = {};
  for (const [e, side] of [[e1, 'A'], [e2, 'B']]) {
    if (e.clientId === 0) seats.push({ key: 'H', side });
    else if (e.clientId > 0) {
      const key = String(e.clientId);
      seats.push({ key, side });
      let ri = remoteInputs.get(e.clientId);
      if (!ri) { ri = new RemoteInput(); remoteInputs.set(e.clientId, ri); }
      remotes.set(key, ri);
      sides[e.clientId] = side;
    }
  }

  castAll({
    k: 'fixture', mode: '11', a: e1.team, b: e2.team, stadium: sel.stadium, sides,
    ball: sel.ball,
    label: `${e1.name} (${TEAMS[e1.team].code})  vs  ${e2.name} (${TEAMS[e2.team].code})`,
  });

  startHostedMatch({
    aIdx: e1.team, bIdx: e2.team,
    stadiumId: sel.stadium, diffKey: sel.diff, len: sel.len,
    golden, sizeKey: '11', seats, remotes, lan: true,
    onEnd,
  });
}

function friendlyEnd(m) {
  castAll({ k: 'end', text: `${m.teamA.def.code} ${m.scoreA} – ${m.scoreB} ${m.teamB.def.code}` });
  $('endTitle').textContent = 'FULL-TIME';
  $('endScore').textContent = `${m.teamA.def.code} ${m.scoreA} – ${m.scoreB} ${m.teamB.def.code}`;
  $('endNote').textContent = 'Friendly over — back to the room.';
  $('endscreen').classList.remove('hidden');
  $('btnRematch').style.display = 'none';
  setTimeout(() => { $('endscreen').classList.add('hidden'); $('btnRematch').style.display = ''; backToRoom(); }, 3500);
}

$('btnLan1v1').onclick = () => {
  const joiner = roster.find((r) => r.id !== 0);
  if (!joiner) { showBanner('NEED A JOINER', 1500); return; }
  const me = roster.find((r) => r.id === 0);
  cup = null;
  startLanMatch(
    { name: me.name, team: me.team, clientId: 0 },
    { name: joiner.name, team: joiner.team, clientId: joiner.id },
    false, friendlyEnd,
  );
};

// --- host: street modes (3v3 / 5v5) — one player per person, bot GKs ---------

function startStreetMatch(sizeKey) {
  const perSide = sizeKey === '3' ? 3 : 5;
  cup = null;
  const humans = roster.slice(0, perSide * 2); // overflow spectates
  const seats = [];
  const remotes = new Map();
  const sides = {};
  const counts = { A: 0, B: 0 };
  const pick = { A: null, B: null };
  for (const r of humans) {
    const side = counts.A <= counts.B ? 'A' : 'B'; // alternate in join order
    const idx = 1 + counts[side]++;               // street slot 0 is the bot GK
    if (pick[side] == null && r.team != null) pick[side] = r.team;
    if (r.id === 0) seats.push({ key: 'H', side, idx });
    else {
      seats.push({ key: String(r.id), side, idx });
      let ri = remoteInputs.get(r.id);
      if (!ri) { ri = new RemoteInput(); remoteInputs.set(r.id, ri); }
      remotes.set(String(r.id), ri);
      sides[r.id] = side;
    }
  }
  const used = usedTeams();
  const a = pick.A ?? randomFreeTeam(used);
  used.add(a);
  let b = pick.B;
  if (b == null || b === a) b = randomFreeTeam(used);

  castAll({
    k: 'fixture', mode: sizeKey, a, b, stadium: sel.stadium, sides,
    ball: sel.ball,
    label: `${perSide}v${perSide} STREET · ${TEAMS[a].code} vs ${TEAMS[b].code}`,
  });
  startHostedMatch({
    aIdx: a, bIdx: b,
    stadiumId: sel.stadium, diffKey: sel.diff, len: sel.len,
    golden: false, sizeKey, seats, remotes, lan: true,
    onEnd: friendlyEnd,
  });
}

$('btnLan3v3').onclick = () => startStreetMatch('3');
$('btnLan5v5').onclick = () => startStreetMatch('5');

// --- host: knockout cup ------------------------------------------------------------

$('btnLanCup').onclick = () => {
  const humans = roster.map((r) => ({ name: r.name, team: r.team, clientId: r.id }));
  const size = humans.length <= 4 ? 4 : humans.length <= 8 ? 8 : 16;
  const used = usedTeams();
  const entrants = [...humans];
  while (entrants.length < size) {
    const t = randomFreeTeam(used);
    entrants.push({ name: TEAMS[t].name, team: t, clientId: null });
  }
  // light shuffle so CPU seeds vary, humans spread
  for (let i = entrants.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [entrants[i], entrants[j]] = [entrants[j], entrants[i]];
  }
  const first = [];
  for (let i = 0; i < size; i += 2) first.push({ e1: entrants[i], e2: entrants[i + 1], winner: null });
  cup = { size, rounds: [first] };
  renderBracket();
  castBracket();
  $('lobby').classList.add('hidden');
  $('bracketOverlay').classList.remove('hidden');
};

function cupNextMatch() {
  const round = cup.rounds[cup.rounds.length - 1];
  return round.find((m) => !m.winner);
}

function advanceCup() {
  const round = cup.rounds[cup.rounds.length - 1];
  if (round.every((m) => m.winner)) {
    if (round.length === 1) { // champion
      const champ = round[0].winner;
      showBanner(`🏆 ${champ.name}`, 4000);
      castAll({ k: 'banner', text: `🏆 CHAMPION: ${champ.name}`, ms: 4000 });
      castBracket(true);
      return;
    }
    const next = [];
    for (let i = 0; i < round.length; i += 2) next.push({ e1: round[i].winner, e2: round[i + 1].winner, winner: null });
    cup.rounds.push(next);
  }
  renderBracket();
  castBracket();
}

$('btnNextMatch').onclick = () => {
  if (!cup) return;
  let m = cupNextMatch();
  // auto-resolve CPU-vs-CPU ties instantly
  while (m && m.e1.clientId === null && m.e2.clientId === null) {
    m.winner = Math.random() < 0.5 ? m.e1 : m.e2;
    advanceCup();
    m = cupNextMatch();
  }
  if (!m) { advanceCup(); return; }
  startLanMatch(m.e1, m.e2, true, (mm) => {
    m.winner = mm.scoreA > mm.scoreB ? m.e1 : m.e2;
    castAll({ k: 'end', text: `${mm.teamA.def.code} ${mm.scoreA} – ${mm.scoreB} ${mm.teamB.def.code}` });
    setTimeout(() => { backToRoom(); advanceCup(); }, 2800);
  });
};
$('btnCupExit').onclick = () => { cup = null; $('bracketOverlay').classList.add('hidden'); $('lobby').classList.remove('hidden'); };

function bracketHTML() {
  let html = '';
  cup.rounds.forEach((round) => {
    const title = round.length === 1 ? 'Final' : round.length === 2 ? 'Semis' : round.length === 4 ? 'Quarters' : `Round of ${round.length * 2}`;
    html += `<div style="min-width:170px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9aa2b1;margin-bottom:6px;">${title}</div>`;
    for (const m of round) {
      const row = (e, win) => e
        ? `<div style="display:flex;gap:6px;align-items:center;${win ? 'font-weight:800;' : 'opacity:.75;'}">
             ${e.team != null ? flagHTML(TEAMS[e.team].code) : '<span class="sw" style="width:10px;height:10px;border-radius:3px;background:#ddd"></span>'}
             ${e.name}${e.clientId === null ? ' <span style="font-size:10px;color:#b5bac4">CPU</span>' : ''}</div>`
        : '<div style="color:#c9ced8">—</div>';
      html += `<div style="background:#fafbfd;border-radius:10px;padding:7px 10px;margin-bottom:7px;font-size:12.5px;">
        ${row(m.e1, m.winner === m.e1)}${row(m.e2, m.winner === m.e2)}</div>`;
    }
    html += '</div>';
  });
  return html;
}
function renderBracket() { $('bracketView').innerHTML = bracketHTML(); }
function castBracket(done = false) {
  castAll({ k: 'bracket', html: bracketHTML(), done });
}

// --- client: cast handling ----------------------------------------------------------

function handleCast(d) {
  switch (d.k) {
    case 'fixture': {
      clientFixture = { aDef: TEAMS[d.a], bDef: TEAMS[d.b], mode: d.mode ?? '11' };
      clientFixture.kits = resolveKits(clientFixture.aDef, clientFixture.bDef);
      clientSide = d.sides[myId] ?? null;
      setField(clientFixture.mode);
      const base = buildScene(d.stadium);
      clientView = new NetView(base.scene, clientFixture.aDef, clientFixture.bDef, clientFixture.mode, String(myId), d.ball);
      game = { kind: 'client', ...base, view: clientView, sendT: 0, tabOpen: false, slow: -1, paused: false };
      setScoreboard(clientFixture.aDef.code, clientFixture.bDef.code);
      $('lobby').classList.add('hidden');
      $('bracketOverlay').classList.add('hidden');
      $('hud').classList.remove('hidden');
      showBanner(clientSide ? 'YOU PLAY!' : `SPECTATING · ${d.label}`, 2500);
      break;
    }
    case 'snap':
      if (clientView) {
        clientView.applySnapshot(d);
        setScore(d.sc[0], d.sc[1], d.ck);
      }
      break;
    case 'banner': showBanner(d.text, d.ms); break;
    case 'goal':
      if (game?.kind === 'client') {
        game.confetti.burst(d.x, d.z);
        game.sfx.goal(d.x);
        game.cam.shake();
        audio.roar();
        showBanner(d.text, 2600);
      }
      break;
    case 'sfx': audio.event(d.n, d.a); break;
    case 'end':
      showBanner(d.text, 3000);
      setTimeout(() => {
        game = null; clientView = null;
        $('hud').classList.add('hidden');
        $('lobby').classList.remove('hidden');
      }, 3200);
      break;
    case 'bracket':
      $('bracketView').innerHTML = d.html;
      $('btnNextMatch').style.display = 'none';
      $('btnCupExit').style.display = d.done ? '' : 'none';
      if (!game) $('bracketOverlay').classList.remove('hidden');
      break;
    case 'aborted':
      game = null; clientView = null;
      $('hud').classList.add('hidden');
      $('lobby').classList.remove('hidden');
      showBanner('HOST ENDED MATCH', 2000);
      break;
    case 'hostleft':
      toMenu();
      showBanner('HOST LEFT', 2500);
      break;
  }
}

// --- main loop ---------------------------------------------------------------

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;

  const events = input.takeEvents();
  if (!game) return;
  updateAim();

  const gameplay = [];
  for (const e of events) {
    if (e.type === 'skip') { if (game.replay) endReplay(game); }
    else if (e.type === 'camera') game.cam.toggle();
    else if (e.type === 'help') $('helpPanel').classList.toggle('hidden');
    else if (e.type === 'mute') showBanner(audio.toggleMute() ? 'MUTED' : 'SOUND ON', 900);
    else if (e.type === 'tab') game.tabOpen ? closeTabMenu() : openTabMenu();
    else if (e.type === 'pause') {
      if (game.replay) endReplay(game);
      else if (game.tabOpen) closeTabMenu();
      else togglePause();
    } else gameplay.push(e);
  }

  if (game.kind === 'client') {
    // send my input to the host at ~30Hz
    if (clientSide && net) {
      game.sendT -= dt;
      if (game.sendT <= 0 || gameplay.length) {
        game.sendT = 1 / 30;
        net.sendInput({ a: input.moveDir(), s: input.sprinting(), e: gameplay, m: input.aimPoint() });
      }
    }
    updateReticle(game);
    game.view.update(dt);
    game.confetti.update(dt);
    game.sfx.update(dt);
    game.cam.update(dt, game.view.ballProxy, game.view.playerProxy);
    const md = game.view.minimapData();
    drawMinimapPts(md.a, md.b, md.ball, clientFixture.kits.a.shirt, clientFixture.kits.b.shirt,
      clientSide ? game.view.playerProxy.pos : null);
    $('playerChip').textContent = game.view.myName() ?? '';
    const charging = input.charging;
    $('powerwrap').style.opacity = charging ? 1 : 0;
    if (charging) $('powerbar').style.width = `${input.chargePower() * 100}%`;
    game.composer.render();
    return;
  }

  // sp / host
  if (game.replayIn != null) {
    game.replayIn -= dt;
    if (game.replayIn <= 0) { game.replayIn = null; startReplay(game); }
  }
  if (game.replay) {
    stepReplay(game, dt);
    game.confetti.update(dt);
    game.sfx.update(dt);
    game.composer.render();
    return;
  }

  const spPause = game.paused || (game.kind === 'sp' && game.tabOpen);
  if (!spPause) {
    let scale = 1;
    if (game.slow > 0) { game.slow -= dt; scale = 0.35; }
    else if (game.slow > -0.25) { game.slow -= dt; scale = 0.7; }
    const simDt = dt * scale;

    // route inputs/events per seat: 'H' is this keyboard, the rest are remote
    const inputs = { H: input };
    const evmap = { H: gameplay };
    for (const [seatKey, ri] of game.remotes) {
      inputs[seatKey] = ri;
      evmap[seatKey] = [];
      for (const e of ri.takeEvents()) {
        if (e.type === 'switchTo') game.match.switchControlled(seatKey, e.idx);
        else if (e.type === 'tab' || e.type === 'camera' || e.type === 'pause' || e.type === 'help' || e.type === 'mute') continue;
        else evmap[seatKey].push(e);
      }
    }

    game.match.update(simDt, inputs, evmap);
    updateReticle(game);
    updatePassRing(game);
    // crowd leans in when the ball reaches an attacking third
    game.tensionT = (game.tensionT ?? 0) - dt;
    if (game.tensionT <= 0) {
      game.tensionT = 0.3;
      const bx = Math.abs(game.match.ball.pos.x) / FIELD.halfL;
      audio.setTension(clamp((bx - 0.55) / 0.45, 0, 1));
    }
    game.rec?.tick(game.match, simDt);
    game.confetti.update(simDt);
    game.sfx.update(simDt);
    game.trail.update(game.match.ball, simDt);
    const hero = game.match.seats.H ?? game.match.teamA.players[game.match.teamA.kickerIdx];
    // near-side throw-ins: cut to an infield angle facing the thrower, then back
    const spNow = game.match.setPiece;
    const throwSp = spNow?.kind === 'throwin' && spNow.taker.pos.z > 0 ? spNow : null;
    game.cam.update(dt, game.match.ball, hero, throwSp);

    // cast snapshots at 15Hz
    if (game.kind === 'host' && net) {
      game.castT -= dt;
      if (game.castT <= 0) {
        game.castT = 1 / 15;
        castAll(encodeSnapshot(game.match));
      }
    }
  }

  const m = game.match;
  setScore(m.scoreA, m.scoreB, m.clockText());
  const hp = m.seats.H ?? null;
  $('playerChip').textContent = hp ? `${hp.num} · ${hp.name}` : '';
  drawMinimapPts(
    m.teamA.players.map((p) => p.pos), m.teamB.players.map((p) => p.pos), m.ball.pos,
    m.teamA.kit.shirt, m.teamB.kit.shirt, hp?.pos,
  );

  const charging = input.charging;
  $('powerwrap').style.opacity = charging ? 1 : 0;
  if (charging) $('powerbar').style.width = `${input.chargePower() * 100}%`;

  game.composer.render();
}
requestAnimationFrame(frame);

// dev/test hook: reach the live game from the console
window.pp = { get game() { return game; }, get wc() { return wc; } };

// dev shortcut: ?autostart[&stadium=day|sunset|night][&mode=3|5|11]
const qs = new URLSearchParams(location.search);
if (qs.has('autostart')) {
  if (qs.get('stadium')) sel.stadium = qs.get('stadium');
  startSP(null, qs.get('mode') ?? '11');
}
