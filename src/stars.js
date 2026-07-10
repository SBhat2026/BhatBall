// Star-player identity: per-name stat kits, read by the AI ONLY — a human in
// control of a star gets no buff, so online 1v1 stays fair. Each team carries
// one true star (full kit + signature trait) and one lesser talisman (a single
// standout stat). Names must match teams.js xi entries exactly.
//
// Multiplier axes sit near 1 (noticeable band ≈ 1.08–1.2):
//   pace     AI top speed, jog and burst (burst is capped under a human sprint)
//   dribble  close control: fewer heavy touches, harder to dispossess, carries more
//            (on a GK: bigger claim reach + composed short build-up under press)
//   finish   shot error shrink + shooting appetite
//   vision   pass/through error shrink + killer-ball appetite
//   flair    skill-move rate (sombreros, flicks)
//   aerial   heading: contest reach + header pace
//   defense  tackle-reflex win rate + tighter marking utility
//   engine   AI burst stamina drains this much slower (workrate)
//   saves    GK only: shrinks the miss chance of the save roll (roll stays
//            probabilistic — the locked pSave formula is untouched)
// Additive/flag traits:
//   power    extra shot speed in m/s
//   runner   extra utility on run-behind AND overlap slots (late/overlap runs)
//   finesse  unlocks the curler regardless of team flair, and picks it more often
//   longshot shooting range extends 30→38m with extra appetite from distance
//   clutch   the whole kit swells ×1.6 when the team trails or in the last quarter
export const STARS = {
  // ARG — La Pulga: not fast, all touch and brain
  'Messi': { dribble: 1.2, finish: 1.15, vision: 1.2, flair: 1.15, finesse: true },
  'Mac Allister': { vision: 1.12 },
  // POR — power finisher, dominant in the air, arrives late in the box
  'Ronaldo': { finish: 1.12, power: 2.5, aerial: 1.2, runner: 2.5, pace: 1.06 },
  'B. Fernandes': { vision: 1.15 },
  // ESP — wing wizard: skill moves, cut-inside curler, burst pace
  'L. Yamal': { dribble: 1.2, flair: 1.2, pace: 1.1, vision: 1.08, finesse: true },
  'Pedri': { vision: 1.12 },
  // USA — Captain America: quick and slippery, swells in big moments
  'Pulisic': { pace: 1.12, dribble: 1.15, finish: 1.08, clutch: true },
  'Weah': { pace: 1.1 },
  // BRA — wing wizard down the left
  'Vinícius Jr': { dribble: 1.2, flair: 1.2, pace: 1.1, finish: 1.08 },
  'Raphinha': { finish: 1.12 },
  // FRA — the fastest player in the game, runs in behind all day
  'Mbappé': { pace: 1.15, finish: 1.12, runner: 2.5, dribble: 1.08 },
  'Dembélé': { dribble: 1.12 },
  // GER — the glider through midfield; Neuer the legend behind
  'Musiala': { dribble: 1.2, flair: 1.15, vision: 1.08, pace: 1.08 },
  'Wirtz': { vision: 1.12 },
  'Neuer': { saves: 1.45 },
  // ENG — the complete striker
  'Kane': { finish: 1.15, power: 2.5, vision: 1.12 },
  'Bellingham': { runner: 2.5 },
  // ITA — explosive diagonal winger
  'Chiesa': { pace: 1.12, dribble: 1.15, finish: 1.08, finesse: true },
  'Barella': { engine: 1.5 },
  // NED — the colossus: first defender star
  'Van Dijk': { defense: 1.25, aerial: 1.2, vision: 1.1 },
  'Gakpo': { finish: 1.12 },
  // JPN — the dribble king
  'Mitoma': { dribble: 1.2, flair: 1.15, pace: 1.1 },
  'Kubo': { dribble: 1.12 },
  // MEX — fox in the box; Ochoa the wall behind
  'S. Giménez': { finish: 1.15, runner: 2.5, aerial: 1.15 },
  'H. Lozano': { pace: 1.12 },
  'Ochoa': { saves: 1.45 },
  // CRO — the ageless maestro
  'Modrić': { vision: 1.2, dribble: 1.1, clutch: true },
  'Gvardiol': { defense: 1.15 },
  // MAR — rocket fullback who owns the right flank
  'Hakimi': { pace: 1.15, runner: 2.5, defense: 1.12 },
  'Ziyech': { vision: 1.12 },
  // URU — the Falcon: hits missiles from range and never stops running
  'Valverde': { power: 3, longshot: true, engine: 1.4, pace: 1.08 },
  'Núñez': { pace: 1.12 },
  // BEL — assist king with a cannon; Courtois the wall
  'De Bruyne': { vision: 1.2, power: 2.5, longshot: true, clutch: true },
  'Lukaku': { finish: 1.12 },
  'Courtois': { saves: 1.45 },
  // CPV — the star IS the keeper: legendary saves + composed feet
  'Vozinha': { saves: 1.6, dribble: 1.15 },
  'Ryan Mendes': { dribble: 1.12, vision: 1.1, clutch: true },
};

export function starOf(name) { return STARS[name] ?? null; }

// Effective multiplier for one axis; clutch kits amplify with p.clutchK
// (maintained by match._updateMood, 1 normally / 1.6 in big moments).
export function starMul(p, key) {
  const s = p.star;
  if (!s) return 1;
  const v = s[key];
  if (!v || v === 1) return 1;
  return 1 + (v - 1) * (s.clutch ? (p.clutchK ?? 1) : 1);
}

// Additive traits (power, runner) — 0 for non-stars.
export function starAdd(p, key) {
  const s = p.star;
  if (!s || !s[key]) return 0;
  return s[key] * (s.clutch ? (p.clutchK ?? 1) : 1);
}
