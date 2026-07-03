import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TEAMS } from './teams.js';
import { STADIUMS, buildStadium, Confetti, BallTrail } from './stadium.js';
import { DIFFICULTY, FIELD, CONTROLLED_INDEX, clamp } from './config.js';
import { Input } from './input.js';
import { Match } from './match.js';
import { GameCamera } from './camera.js';
import { AudioEngine } from './audio.js';
import { Net, RemoteInput, encodeSnapshot } from './net.js';
import { NetView } from './netview.js';

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

// --- menu wiring ------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const sel = { teamA: 0, teamB: 'random', stadium: 'day', diff: 'classic', len: 4 };

const chipHTML = (t) => `<span class="sw" style="background:${t.shirt}; --sw2:${t.sleeve}"></span>${t.code}`;

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
[2, 4, 6].forEach((n) => {
  const el = document.createElement('div');
  el.className = 'chip';
  el.textContent = `${n} min`;
  el.onclick = () => { sel.len = n; refresh(); };
  el.dataset.id = n;
  $('lens').appendChild(el);
});

function refresh() {
  [...$('gridA').children].forEach((el, i) => el.classList.toggle('sel', i === sel.teamA));
  [...$('gridB').children].forEach((el, i) =>
    el.classList.toggle('sel', sel.teamB === 'random' ? i === 0 : i - 1 === sel.teamB));
  [...$('stadiums').children].forEach((el) => el.classList.toggle('sel', el.dataset.id === sel.stadium));
  [...$('diffs').children].forEach((el) => el.classList.toggle('sel', el.dataset.id === sel.diff));
  [...$('lens').children].forEach((el) => el.classList.toggle('sel', +el.dataset.id === sel.len));
  $('btnResume').style.display = localStorage.getItem('pp-save') ? '' : 'none';
}
refresh();

$('btnWC').onclick = () => $('wcOverlay').classList.remove('hidden');
$('btnWCBack').onclick = () => $('wcOverlay').classList.add('hidden');
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

function setScoreboard(codeA, colorA, codeB, colorB) {
  $('swA').style.background = colorA;
  $('swB').style.background = colorB;
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
  return { scene, sfx, confetti, cam, composer: makeComposer(scene, preset), preset };
}

// --- game lifecycle ----------------------------------------------------------

let game = null;

// cfg: { aIdx, bIdx, stadiumId, diffKey, len, golden, hostSide, remoteA, remoteB, spectate, lan, restore, onEnd }
function startHostedMatch(cfg) {
  const teamADef = TEAMS[cfg.aIdx];
  const teamBDef = TEAMS[cfg.bIdx];
  const base = buildScene(cfg.stadiumId);
  const trail = new BallTrail(base.scene);

  const controlled = {
    A: (cfg.hostSide === 'A' || cfg.remoteA) ? CONTROLLED_INDEX : null,
    B: (cfg.hostSide === 'B' || cfg.remoteB) ? CONTROLLED_INDEX : null,
  };

  const g = {
    kind: cfg.lan ? 'host' : 'sp',
    ...base, trail,
    paused: false, slow: -1, tabOpen: false,
    cfg,
    castT: 0,
  };

  const match = new Match(base.scene, {
    teamADef, teamBDef,
    diffKey: cfg.diffKey,
    lengthMin: cfg.len,
    goldenGoal: cfg.golden,
    controlled,
    hooks: {
      banner: (text, ms) => { showBanner(text, ms); castAll({ k: 'banner', text, ms }); },
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
  if (cfg.restore) match.restoreState(cfg.restore);
  base.cam.snap(match.ball);

  setScoreboard(teamADef.code, teamADef.shirt, teamBDef.code, teamBDef.shirt);
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

function startSP(restore = null) {
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
    golden: false, hostSide: 'A', lan: false, restore,
    onEnd: (m) => {
      localStorage.removeItem('pp-save');
      const a = m.scoreA, b = m.scoreB;
      $('endTitle').textContent = 'FULL-TIME';
      $('endScore').textContent = `${m.teamA.def.code} ${a} – ${b} ${m.teamB.def.code}`;
      $('endNote').textContent = a === b ? 'A draw — honors shared.'
        : (a > b ? `${m.teamA.def.name} take it. Lovely stuff.` : `${m.teamB.def.name} edge it this time.`);
      $('endscreen').classList.remove('hidden');
    },
  });
}

// --- pause / tab menus ---------------------------------------------------------

function togglePause(force) {
  if (!game || game.kind === 'client') return;
  game.paused = force ?? !game.paused;
  $('pauseMenu').classList.toggle('hidden', !game.paused);
  $('btnSaveQuit').style.display = game.kind === 'sp' ? '' : 'none';
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
  let side, teamDef, players;
  if (game.kind === 'client') {
    side = clientSide;
    if (!side) return;
    teamDef = side === 'A' ? clientFixture.aDef : clientFixture.bDef;
    players = teamDef.xi.map(([num, name], i) => ({ num, name, i, role: i === 0 ? 'GK' : i < 5 ? 'DF' : i < 8 ? 'MF' : 'FW' }));
  } else {
    side = game.cfg.hostSide;
    if (!side) return;
    const team = game.match.team(side);
    teamDef = team.def;
    players = team.players.map((p) => ({ num: p.num, name: p.name, i: p.idx, role: p.role }));
  }
  const grid = $('tabGrid');
  grid.innerHTML = '';
  for (const p of players) {
    const el = document.createElement('div');
    el.className = 'chip';
    el.style.minWidth = '150px';
    el.innerHTML = `<span class="sw" style="background:${teamDef.shirt}"></span><b>${p.num}</b>&nbsp;${p.name}&nbsp;<span style="color:#9aa2b1">${p.role}</span>`;
    if (p.i === 0) { el.style.opacity = 0.4; el.style.cursor = 'default'; }
    else el.onclick = () => {
      if (game.kind === 'client') net?.sendInput({ e: [{ type: 'switchTo', idx: p.i }] });
      else game.match.switchControlled(side, p.i);
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

// --- LAN ------------------------------------------------------------------------

let net = null;
let netRole = null;         // 'host' | 'client'
let myId = null;
let roster = [];
let myTeamPick = null;
const remoteInputs = new Map();
let cup = null;
let hostFixture = null;     // {e1, e2} entrants for current LAN match
let clientFixture = null;   // client-side: {aDef, bDef}
let clientSide = null;      // 'A' | 'B' | null
let clientView = null;
let lastSnapScore = null;

$('btnLAN').onclick = () => {
  $('menu').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  $('lobbyChoice').classList.remove('hidden');
  $('lobbyRoom').classList.add('hidden');
  $('lanError').textContent = '';
};
$('btnLobbyBack').onclick = () => { net?.ws?.close(); net = null; $('lobby').classList.add('hidden'); toMenu(); };
$('btnLeaveRoom').onclick = () => { net?.ws?.close(); net = null; $('lobby').classList.add('hidden'); toMenu(); };

buildChips($('lanTeams'), TEAMS, chipHTML, (t, i) => {
  myTeamPick = i;
  net?.pickTeam(i);
  [...$('lanTeams').children].forEach((el, j) => el.classList.toggle('sel', j === i));
});

async function connectNet() {
  net = new Net();
  await net.connect();
  net.on('err', (m) => { $('lanError').textContent = m.msg; });
  net.on('roster', (m) => { roster = m.roster; renderRoster(); });
  net.on('close', () => { if (netRole) { showBanner('CONNECTION LOST', 2500); toMenu(); netRole = null; } });
}

$('btnHost').onclick = async () => {
  audio.init();
  try { await connectNet(); } catch { $('lanError').textContent = 'Could not reach server'; return; }
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
  try { await connectNet(); } catch { $('lanError').textContent = 'Could not reach server'; return; }
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

function teamOf(entrant) { return entrant.team ?? ((Math.random() * TEAMS.length) | 0); }

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
  hostFixture = { e1, e2 };

  const hostSide = e1.clientId === 0 ? 'A' : e2.clientId === 0 ? 'B' : null;
  const remoteA = e1.clientId > 0 ? (remoteInputs.get(e1.clientId) ?? remoteInputs.set(e1.clientId, new RemoteInput()).get(e1.clientId)) : null;
  const remoteB = e2.clientId > 0 ? (remoteInputs.get(e2.clientId) ?? remoteInputs.set(e2.clientId, new RemoteInput()).get(e2.clientId)) : null;

  const sides = {};
  if (e1.clientId > 0) sides[e1.clientId] = 'A';
  if (e2.clientId > 0) sides[e2.clientId] = 'B';
  castAll({
    k: 'fixture', a: e1.team, b: e2.team, stadium: sel.stadium, sides,
    label: `${e1.name} (${TEAMS[e1.team].code})  vs  ${e2.name} (${TEAMS[e2.team].code})`,
  });

  startHostedMatch({
    aIdx: e1.team, bIdx: e2.team,
    stadiumId: sel.stadium, diffKey: sel.diff, len: sel.len,
    golden, hostSide, remoteA, remoteB, lan: true,
    onEnd,
  });
  game.remoteA = remoteA;
  game.remoteB = remoteB;
}

$('btnLan1v1').onclick = () => {
  const joiner = roster.find((r) => r.id !== 0);
  if (!joiner) { showBanner('NEED A JOINER', 1500); return; }
  const me = roster.find((r) => r.id === 0);
  cup = null;
  startLanMatch(
    { name: me.name, team: me.team, clientId: 0 },
    { name: joiner.name, team: joiner.team, clientId: joiner.id },
    false,
    (m) => {
      castAll({ k: 'end', text: `${m.teamA.def.code} ${m.scoreA} – ${m.scoreB} ${m.teamB.def.code}` });
      $('endTitle').textContent = 'FULL-TIME';
      $('endScore').textContent = `${m.teamA.def.code} ${m.scoreA} – ${m.scoreB} ${m.teamB.def.code}`;
      $('endNote').textContent = 'Friendly over — back to the room.';
      $('endscreen').classList.remove('hidden');
      $('btnRematch').style.display = 'none';
      setTimeout(() => { $('endscreen').classList.add('hidden'); $('btnRematch').style.display = ''; backToRoom(); }, 3500);
    },
  );
};

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
  cup.rounds.forEach((round, ri) => {
    const title = round.length === 1 ? 'Final' : round.length === 2 ? 'Semis' : round.length === 4 ? 'Quarters' : `Round of ${round.length * 2}`;
    html += `<div style="min-width:170px;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9aa2b1;margin-bottom:6px;">${title}</div>`;
    for (const m of round) {
      const row = (e, win) => e
        ? `<div style="display:flex;gap:6px;align-items:center;${win ? 'font-weight:800;' : 'opacity:.75;'}">
             <span class="sw" style="width:10px;height:10px;border-radius:3px;background:${e.team != null ? TEAMS[e.team].shirt : '#ddd'}"></span>
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
      clientFixture = { aDef: TEAMS[d.a], bDef: TEAMS[d.b] };
      clientSide = d.sides[myId] ?? null;
      const base = buildScene(d.stadium);
      clientView = new NetView(base.scene, clientFixture.aDef, clientFixture.bDef, clientSide);
      game = { kind: 'client', ...base, view: clientView, sendT: 0, tabOpen: false, slow: -1, paused: false };
      setScoreboard(clientFixture.aDef.code, clientFixture.aDef.shirt, clientFixture.bDef.code, clientFixture.bDef.shirt);
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
        lastSnapScore = d.sc;
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

  const gameplay = [];
  for (const e of events) {
    if (e.type === 'camera') game.cam.toggle();
    else if (e.type === 'help') $('helpPanel').classList.toggle('hidden');
    else if (e.type === 'mute') showBanner(audio.toggleMute() ? 'MUTED' : 'SOUND ON', 900);
    else if (e.type === 'tab') game.tabOpen ? closeTabMenu() : openTabMenu();
    else if (e.type === 'pause') {
      if (game.tabOpen) closeTabMenu();
      else togglePause();
    } else gameplay.push(e);
  }

  if (game.kind === 'client') {
    // send my input to the host at ~30Hz
    if (clientSide && net) {
      game.sendT -= dt;
      if (game.sendT <= 0 || gameplay.length) {
        game.sendT = 1 / 30;
        net.sendInput({ a: input.moveDir(), s: input.sprinting(), e: gameplay });
      }
    }
    game.view.update(dt);
    game.confetti.update(dt);
    game.sfx.update(dt);
    game.cam.update(dt, game.view.ballProxy, game.view.playerProxy);
    const md = game.view.minimapData();
    drawMinimapPts(md.a, md.b, md.ball, clientFixture.aDef.shirt, clientFixture.bDef.shirt,
      clientSide ? game.view.playerProxy.pos : null);
    const chip = clientSide && game.view.snap
      ? game.view.players[clientSide === 'A' ? game.view.snap.ctA : 11 + game.view.snap.ctB]?.name : '';
    $('playerChip').textContent = chip || '';
    const charging = input.charging;
    $('powerwrap').style.opacity = charging ? 1 : 0;
    if (charging) $('powerbar').style.width = `${input.chargePower() * 100}%`;
    game.composer.render();
    return;
  }

  // sp / host
  const spPause = game.paused || (game.kind === 'sp' && game.tabOpen);
  if (!spPause) {
    let scale = 1;
    if (game.slow > 0) { game.slow -= dt; scale = 0.35; }
    else if (game.slow > -0.25) { game.slow -= dt; scale = 0.7; }
    const simDt = dt * scale;

    // route inputs/events per side
    const hostSide = game.cfg.hostSide;
    const inputs = { A: null, B: null };
    const evmap = { A: [], B: [] };
    if (hostSide) { inputs[hostSide] = input; evmap[hostSide] = gameplay; }
    for (const [side, ri] of [['A', game.remoteA], ['B', game.remoteB]]) {
      if (!ri) continue;
      inputs[side] = ri;
      const evts = ri.takeEvents();
      for (const e of evts) {
        if (e.type === 'switchTo') game.match.switchControlled(side, e.idx);
        else if (e.type === 'tab' || e.type === 'camera' || e.type === 'pause' || e.type === 'help' || e.type === 'mute') continue;
        else evmap[side].push(e);
      }
    }
    // host-side local tab switching handled via menu clicks; switch events from menu are immediate

    game.match.update(simDt, inputs, evmap);
    game.confetti.update(simDt);
    game.sfx.update(simDt);
    game.trail.update(game.match.ball, simDt);
    game.cam.update(dt, game.match.ball, game.match.humans[hostSide ?? 'A'] ?? game.match.teamA.players[9]);

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
  const hp = game.cfg.hostSide ? m.humans[game.cfg.hostSide] : null;
  $('playerChip').textContent = hp ? `${hp.num} · ${hp.name}` : '';
  drawMinimapPts(
    m.teamA.players.map((p) => p.pos), m.teamB.players.map((p) => p.pos), m.ball.pos,
    m.teamA.def.shirt, m.teamB.def.shirt, hp?.pos,
  );

  const charging = input.charging;
  $('powerwrap').style.opacity = charging ? 1 : 0;
  if (charging) $('powerbar').style.width = `${input.chargePower() * 100}%`;

  game.composer.render();
}
requestAnimationFrame(frame);

// dev shortcut: ?autostart[&stadium=day|sunset|night]
const qs = new URLSearchParams(location.search);
if (qs.has('autostart')) {
  if (qs.get('stadium')) sel.stadium = qs.get('stadium');
  startSP();
}
