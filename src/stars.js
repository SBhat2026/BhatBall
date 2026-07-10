// Star-player identity: per-name stat kits, read by the AI ONLY — a human in
// control of a star gets no buff, so online 1v1 stays fair. Each team carries
// one true star (full kit + signature trait) and one lesser talisman (a single
// standout stat). Names must match teams.js xi entries exactly.
//
// Multiplier axes sit near 1 (noticeable band ≈ 1.08–1.2):
//   pace     AI top speed, jog and burst (burst is capped under a human sprint)
//   dribble  close control: fewer heavy touches, harder to dispossess, carries more
//   finish   shot error shrink + shooting appetite
//   vision   pass/through error shrink + killer-ball appetite
//   flair    skill-move rate (sombreros, flicks)
//   aerial   heading: contest reach + header pace
// Additive/flag traits:
//   power    extra shot speed in m/s
//   runner   extra utility on run-behind slots (late runs into the box)
//   finesse  unlocks the curler regardless of team flair, and picks it more often
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
