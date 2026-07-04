// Evolution-strategies self-play trainer for the micro-positioning policy net.
//   node tools/train-policy.mjs [generations] [popPairs] [matchMin]
// Antithetic ES from a zero seed (zero weights = exactly baseline behavior).
// Fitness: goal difference + a little possession shaping vs the un-netted AI.
// Writes the best theta to src/policy-weights.js only if it beats baseline
// in a held-out eval; otherwise leaves WEIGHTS = null.
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setField } from '../src/config.js';
import { TEAMS } from '../src/teams.js';
import { Match } from '../src/match.js';
import { NET_PARAMS } from '../src/policy.js';

const GENS = +process.argv[2] || 40;
const PAIRS = +process.argv[3] || 10;
const MIN = +process.argv[4] || 1.5;
const SIGMA = 0.25;
const LR = 0.2;

setField('11');

const hooks = { banner: () => {}, sfx: () => {}, onGoal: () => {}, onBicycle: () => {}, onFullTime: () => {}, coach: () => {} };
const idx = (c) => TEAMS.findIndex((t) => t.code === c);
const FIXTURES = [['FRA', 'CRO'], ['BRA', 'ARG'], ['ESP', 'GER'], ['ENG', 'POR']];

// one match: side 'A' or 'B' carries the net; returns fitness from the net side's view
function playMatch(theta, netSide, fixture) {
  const [ca, cb] = fixture;
  const m = new Match(new THREE.Scene(), {
    teamADef: TEAMS[idx(ca)], teamBDef: TEAMS[idx(cb)],
    diffKey: 'classic', lengthMin: MIN, sizeKey: '11', seats: [], hooks,
  });
  m.teamA.diff = m.teamB.diff; // fair sim: no human-mate handicap
  const netTeam = netSide === 'A' ? m.teamA : m.teamB;
  netTeam.policyNet = theta;

  let done = false;
  const h = { ...hooks, onFullTime: () => { done = true; } };
  m.hooks = h;
  const dt = 1 / 60;
  let steps = 0, poss = 0, possN = 0, terr = 0;
  const maxSteps = (MIN * 60 + 120) * 60;
  while (!done && steps++ < maxSteps) {
    m.update(dt, {}, {});
    if (m.controllerTeam) { possN++; if (m.controllerTeam === netTeam) poss++; }
    terr += m.ball.pos.x * netTeam.dir;
  }
  const gf = netSide === 'A' ? m.scoreA : m.scoreB;
  const ga = netSide === 'A' ? m.scoreB : m.scoreA;
  const possShare = possN ? poss / possN : 0.5;
  // goals dominate; possession + territory give a dense gradient between them
  return (gf - ga) + (possShare - 0.5) * 1.5 + (terr / steps / 52.5) * 2;
}

function evaluate(theta, nMatches) {
  let f = 0;
  for (let i = 0; i < nMatches; i++) {
    f += playMatch(theta, i % 2 ? 'B' : 'A', FIXTURES[i % FIXTURES.length]);
  }
  return f / nMatches;
}

const gaussR = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

let theta = new Float64Array(NET_PARAMS); // zero seed = baseline
console.log(`ES: ${NET_PARAMS} params, ${GENS} gens × ${PAIRS} antithetic pairs, ${MIN}min matches`);

const t0 = Date.now();
for (let g = 0; g < GENS; g++) {
  const eps = [], fits = [];
  for (let p = 0; p < PAIRS; p++) {
    const e = Float64Array.from({ length: NET_PARAMS }, gaussR);
    for (const sign of [1, -1]) {
      const cand = theta.map((w, i) => w + sign * SIGMA * e[i]);
      fits.push(evaluate(cand, 4));
      eps.push({ e, sign });
    }
  }
  // rank-normalize fitness
  const order = fits.map((f, i) => [f, i]).sort((a, b) => a[0] - b[0]);
  const rank = new Array(fits.length);
  order.forEach(([, i], r) => { rank[i] = fits.length === 1 ? 0 : r / (fits.length - 1) - 0.5; });
  const grad = new Float64Array(NET_PARAMS);
  for (let i = 0; i < eps.length; i++) {
    const { e, sign } = eps[i];
    for (let j = 0; j < NET_PARAMS; j++) grad[j] += rank[i] * sign * e[j];
  }
  for (let j = 0; j < NET_PARAMS; j++) theta[j] += (LR / (eps.length * SIGMA)) * grad[j];
  const mean = fits.reduce((a, b) => a + b, 0) / fits.length;
  console.log(`gen ${String(g + 1).padStart(3)}  meanFit ${mean.toFixed(3)}  |θ| ${Math.hypot(...theta).toFixed(2)}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

console.log('\nHeld-out eval (trained vs baseline, 32 matches)…');
const trained = evaluate(theta, 32);
const baseline = evaluate(new Float64Array(NET_PARAMS), 32);
console.log(`trained ${trained.toFixed(3)}  baseline ${baseline.toFixed(3)}  edge ${(trained - baseline).toFixed(3)}`);

const out = join(dirname(fileURLToPath(import.meta.url)), '../src/policy-weights.js');
if (trained > baseline + 0.05) {
  const arr = Array.from(theta, (w) => Math.round(w * 1e4) / 1e4);
  writeFileSync(out, `// ES-trained micro-positioning net (${new Date().toISOString().slice(0, 10)}). Edge vs baseline: ${(trained - baseline).toFixed(3)}.\nexport const WEIGHTS = ${JSON.stringify(arr)};\n`);
  console.log(`✅ wrote ${out}`);
} else {
  console.log('⬜ no clear edge — policy-weights.js left as-is (WEIGHTS = null)');
}
