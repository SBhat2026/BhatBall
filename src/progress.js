// Player Progression — COSMETIC ONLY. Playing, winning, and scoring earn XP that
// raises your level, title, and badges. Nothing here touches gameplay stats; it's
// a persistent identity/status layer shown on your profile card + HUD. Per-device
// (localStorage), matching the "local for personal progress" call.

const KEY = 'pp-progress';
const FRESH = { xp: 0, matches: 0, wins: 0, draws: 0, goals: 0, streak: 0, bestStreak: 0, badges: [] };

export function load() {
  try { return { ...FRESH, ...(JSON.parse(localStorage.getItem(KEY) || '{}')) }; }
  catch { return { ...FRESH }; }
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }

// Level curve: each level costs a bit more than the last (quadratic). Level 1
// starts at 0 XP; ~level 30 is a serious grind. Cap keeps titles meaningful.
const LEVEL_STEP = 300;
export const xpForLevel = (lvl) => Math.round(LEVEL_STEP * (lvl - 1) * (1 + (lvl - 1) * 0.06));
export function levelFor(xp) {
  let lvl = 1;
  while (lvl < 60 && xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}

const TITLES = [
  [1, 'Rookie'], [3, 'Amateur'], [6, 'Semi-Pro'], [10, 'Professional'],
  [15, 'Veteran'], [22, 'Star'], [30, 'Legend'], [42, 'Icon'], [55, 'Immortal'],
];
export function titleFor(level) {
  let t = TITLES[0][1];
  for (const [lv, name] of TITLES) if (level >= lv) t = name;
  return t;
}

export const BADGES = {
  firstWin:  { icon: '🥇', name: 'First Win' },
  hatTrick:  { icon: '🎩', name: 'Hat-Trick Hero' },       // 3+ team goals in a match
  streak5:   { icon: '🔥', name: 'On Fire' },              // 5-win streak
  wins25:    { icon: '🏆', name: '25 Wins' },
  goals100:  { icon: '⚽', name: 'Century of Goals' },
  century:   { icon: '💯', name: '100 Matches' },
  sharpshoot:{ icon: '🎯', name: 'Sharpshooter' },         // 5+ goals in one match
};

// Award a finished match. result = { won, draw, goalsFor }. Returns what changed
// so the caller can toast level-ups / new badges.
export function awardMatch({ won = false, draw = false, goalsFor = 0 } = {}) {
  const s = load();
  const beforeLevel = levelFor(s.xp);
  s.matches += 1;
  s.goals += goalsFor;
  if (won) { s.wins += 1; s.streak += 1; s.bestStreak = Math.max(s.bestStreak, s.streak); }
  else { if (draw) s.draws += 1; s.streak = 0; }
  // XP: showing up + result + goals scored
  s.xp += 40 + (won ? 100 : draw ? 45 : 20) + goalsFor * 15;

  const newBadges = [];
  const give = (id) => { if (!s.badges.includes(id)) { s.badges.push(id); newBadges.push(id); } };
  if (won) give('firstWin');
  if (goalsFor >= 3) give('hatTrick');
  if (goalsFor >= 5) give('sharpshoot');
  if (s.streak >= 5) give('streak5');
  if (s.wins >= 25) give('wins25');
  if (s.goals >= 100) give('goals100');
  if (s.matches >= 100) give('century');

  save(s);
  const level = levelFor(s.xp);
  return { level, title: titleFor(level), leveledUp: level > beforeLevel, newBadges, state: s };
}

// Snapshot for the profile card + HUD.
export function summary() {
  const s = load();
  const level = levelFor(s.xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return {
    ...s, level, title: titleFor(level),
    intoLevel: s.xp - base, levelSpan: Math.max(1, next - base),
    winRate: s.matches ? Math.round((s.wins / s.matches) * 100) : 0,
  };
}
