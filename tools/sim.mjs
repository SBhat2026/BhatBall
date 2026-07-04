// Headless AI-vs-AI balance sim: node tools/sim.mjs [matches] [minutes]
// No humans seated — pure brain-vs-brain. Reports goals, shots, possession,
// action mix, and screams if anything goes NaN.
import * as THREE from 'three';
import { setField } from '../src/config.js';
import { TEAMS } from '../src/teams.js';
import { Match } from '../src/match.js';

const N = +process.argv[2] || 6;
const MIN = +process.argv[3] || 4;
const SIZE = process.argv[4] || '11';

setField(SIZE);

const hooks = {
  banner: () => {},
  sfx: () => {},
  onGoal: () => {},
  onBicycle: () => {},
  onFullTime: () => {},
  coach: () => {},
};

const idx = (code) => TEAMS.findIndex((t) => t.code === code);
const fixtures = [
  ['FRA', 'CRO'], ['BRA', 'ARG'], ['ESP', 'GER'], ['JPN', 'NED'],
  ['ENG', 'POR'], ['URU', 'MAR'],
];

let totGoals = 0, nan = 0;
const actCounts = {};

for (let m = 0; m < N; m++) {
  const [ca, cb] = fixtures[m % fixtures.length];
  const match = new Match(new THREE.Scene(), {
    teamADef: TEAMS[idx(ca)], teamBDef: TEAMS[idx(cb)],
    diffKey: 'classic', lengthMin: MIN, sizeKey: SIZE,
    seats: [], hooks,
  });
  // teamA normally uses MATE_DIFF (human side); for a fair sim both play 'classic'
  match.teamA.diff = match.teamB.diff;
  for (const p of match.teamA.players) p.diff = undefined;

  const dt = 1 / 60;
  let done = false;
  hooks.onFullTime = () => { done = true; };
  let steps = 0, possA = 0, possN = 0;
  const maxSteps = (MIN * 60 + 120) * 60;
  while (!done && steps++ < maxSteps) {
    match.update(dt, {}, {});
    if (match.controllerTeam) { possN++; if (match.controllerTeam === match.teamA) possA++; }
    if (steps % 30 === 0) {
      for (const t of [match.teamA, match.teamB]) {
        for (const p of t.players) {
          if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.z)) nan++;
          actCounts[p.act] = (actCounts[p.act] || 0) + 1;
        }
      }
      if (!Number.isFinite(match.ball.pos.x)) nan++;
    }
  }
  totGoals += match.scoreA + match.scoreB;
  const poss = possN ? Math.round((possA / possN) * 100) : 50;
  console.log(`${ca} ${match.scoreA}–${match.scoreB} ${cb}  poss ${poss}%/${100 - poss}%  steps ${steps}${done ? '' : '  ⚠️ NO FULL-TIME'}`);
}

const totalActs = Object.values(actCounts).reduce((a, b) => a + b, 0);
const mix = Object.entries(actCounts).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${(100 * v / totalActs).toFixed(1)}%`).join('  ');
console.log(`\nGoals/match: ${(totGoals / N).toFixed(2)}   NaN hits: ${nan}`);
console.log(`Action mix: ${mix}`);
