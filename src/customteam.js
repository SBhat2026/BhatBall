// Custom Teams — draft your own XI from real players across every nation, under
// a rating BUDGET so 1v1 online stays balanced (you can't field 11 galácticos).
// A built team is just a synthetic `def` (code 'CUS' → buildLineup falls back to
// 4-3-3, which is exactly how xi is ordered), so it drops into Match/resolveKits
// with no special-casing. Saved per-device in localStorage; the host's + each
// joiner's custom XI is synced through the existing fixture cast.

import { TEAMS } from './teams.js';

// role by 4-3-3 slot index: GK · DF×4 · MF×3 · FW×3
export const roleOf = (i) => (i === 0 ? 'GK' : i <= 4 ? 'DF' : i <= 7 ? 'MF' : 'FW');
const ROLE_BUMP = { GK: -2, DF: -1, MF: 1, FW: 3 };

// tiny deterministic hash so player ratings vary but are stable across devices
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

// Per-player rating derived from the nation rating + role + a stable jitter.
// Keeps elite forwards on strong nations expensive (Mbappé/FRA → ~94) and role
// players cheap, which is what makes the budget force real trade-offs.
export function playerRating(teamRating, idx, name) {
  const j = ((hash(name) % 5) + 5) % 5 - 2; // -2..+2, stable
  return Math.max(58, Math.min(99, teamRating + ROLE_BUMP[roleOf(idx)] + j));
}

// Flat pool of every listed player, tagged with nation + derived rating + role.
export const PLAYER_POOL = TEAMS.flatMap((t) =>
  t.xi.map(([num, name], idx) => ({
    id: `${t.code}-${idx}`,
    num, name, nation: t.code, nationName: t.name,
    role: roleOf(idx),
    rating: playerRating(t.rating, idx, name),
  })),
);

export const poolByRole = (role) =>
  PLAYER_POOL.filter((p) => p.role === role).sort((a, b) => b.rating - a.rating);

// Default squad budget. Median XI ~ 900; elite XI ~ 1030 — so this affords a
// strong side but not all superstars. Exposed so the UI can show it.
export const BUDGET = 900;

export const squadCost = (players) => players.reduce((s, p) => s + (p?.rating ?? 0), 0);
export const squadRating = (players) => Math.round(squadCost(players) / (players.filter(Boolean).length || 1));

// Downgrade random slots until the squad fits the budget. Always terminates
// (worst case = the cheapest player at every slot, which is < BUDGET by design).
function fitBudget(players) {
  let guard = 0;
  while (squadCost(players) > BUDGET && guard++ < 300) {
    const i = (Math.random() * 11) | 0;
    const pool = poolByRole(roleOf(i));
    const cheaper = pool.filter((p) => p.rating < players[i].rating);
    players[i] = cheaper.length ? cheaper[(Math.random() * cheaper.length) | 0] : pool[pool.length - 1];
  }
  return players;
}

// A pre-filled, in-budget starting squad (best per slot, then repaired to fit)
// so the builder never opens empty.
export function defaultSquad() {
  const picked = Array.from({ length: 11 }, (_, i) => poolByRole(roleOf(i))[0]);
  return fitBudget(picked);
}

// A random in-budget XI: pick random per slot, then downgrade random slots until
// it fits. Always terminates (worst case = the cheapest player at each slot).
export function randomSquad() {
  const rnd = (arr) => arr[(Math.random() * arr.length) | 0];
  const players = Array.from({ length: 11 }, (_, i) => rnd(poolByRole(roleOf(i))));
  return fitBudget(players);
}

const KIT_PRESETS = {
  crimson: { shirt: '#c0504f', sleeve: '#e0c060', shorts: '#3a3a44', gk: '#6fb392' },
  azure:   { shirt: '#4a72c4', sleeve: '#f4f5f0', shorts: '#26304a', gk: '#d9a75f' },
  emerald: { shirt: '#3f9e79', sleeve: '#f2efe6', shorts: '#2a4a3a', gk: '#d9c05c' },
  violet:  { shirt: '#8a6fc0', sleeve: '#efe6f4', shorts: '#3a2f50', gk: '#e0904f' },
  slate:   { shirt: '#4a505c', sleeve: '#c9ced8', shorts: '#2a2e36', gk: '#c0d95e' },
  amber:   { shirt: '#e0a24f', sleeve: '#3a3a44', shorts: '#3a3a44', gk: '#6fae85' },
};
export const KIT_NAMES = Object.keys(KIT_PRESETS);
export const kitSwatch = (name) => (KIT_PRESETS[name] || KIT_PRESETS.crimson).shirt;

// Build the synthetic team `def` a Match consumes from a picked squad.
export function buildCustomDef(players, { name = 'MY XI', kit = 'crimson', away = 'slate' } = {}) {
  const home = { ...(KIT_PRESETS[kit] || KIT_PRESETS.crimson) };
  const awayKit = { ...(KIT_PRESETS[away] || KIT_PRESETS.slate) };
  const nm = (name || 'MY XI').slice(0, 16).toUpperCase();
  // 3-letter scoreboard code from the name (buildLineup falls back to 4-3-3 for
  // any code not in TEAM_TACTICS, so a custom code is safe).
  const code = (nm.replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'CUS').padEnd(3, 'X');
  return {
    code,
    name: nm,
    custom: true,
    rating: squadRating(players),
    home, away: awayKit,
    xi: players.map((p, i) => [p?.num ?? i + 1, p?.name ?? `Player ${i + 1}`]),
  };
}

// --- persistence -------------------------------------------------------------
const KEY = 'pp-customxi';

export function saveSquad(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}
export function loadSquad() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!s || !Array.isArray(s.ids) || s.ids.length !== 11) return null;
    const players = s.ids.map((id) => PLAYER_POOL.find((p) => p.id === id)).filter(Boolean);
    if (players.length !== 11) return null;
    return { players, name: s.name || 'MY XI', kit: s.kit || 'crimson', away: s.away || 'slate' };
  } catch { return null; }
}
export const squadState = (players, name, kit, away) => ({ ids: players.map((p) => p.id), name, kit, away });
