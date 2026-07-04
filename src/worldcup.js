// Single-player World Cup: 16 of the 17 nations, 4 groups of 4, top two into
// a QF→SF→Final knockout. You play every one of your team's matches; every
// CPU-vs-CPU fixture resolves through a rating-driven Poisson sim.
// State is plain JSON (team indices into TEAMS) so it round-trips localStorage.
import { TEAMS } from './teams.js';
import { flagHTML } from './flags.js';

const GROUP_NAMES = ['A', 'B', 'C', 'D'];
// round-robin pairings inside a 4-team group, by matchday
const MD_PAIRS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[3, 0], [1, 2]]];

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function poisson(lam) {
  const L = Math.exp(-lam);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

export function simScore(hIdx, aIdx, noDraw = false) {
  const rH = TEAMS[hIdx].rating, rA = TEAMS[aIdx].rating;
  const lamH = Math.min(3.4, Math.max(0.35, 1.35 * Math.pow(10, (rH - rA) / 45)));
  const lamA = Math.min(3.4, Math.max(0.35, 1.35 * Math.pow(10, (rA - rH) / 45)));
  let sh = poisson(lamH), sa = poisson(lamA);
  if (noDraw && sh === sa) {
    // golden goal: rating-weighted sudden death
    if (Math.random() < rH / (rH + rA)) sh++; else sa++;
  }
  return [sh, sa];
}

export function newCup(myIdx) {
  const rest = shuffle(TEAMS.map((_, i) => i).filter((i) => i !== myIdx)).slice(0, 15);
  const teams = shuffle([myIdx, ...rest]);
  const groups = [0, 1, 2, 3].map((g) => teams.slice(g * 4, g * 4 + 4));
  const stats = {};
  for (const i of teams) stats[i] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  return {
    my: myIdx, teams, groups, stats,
    md: 1,               // group matchday 1..3; 4 = groups done
    results: [],         // [{md, h, a, sh, sa}]
    ko: null,            // { rounds: [[{h, a, sh, sa, done}]], r }
    out: false, champion: null,
  };
}

function record(cup, h, a, sh, sa, md) {
  cup.results.push({ md, h, a, sh, sa });
  const H = cup.stats[h], A = cup.stats[a];
  H.p++; A.p++; H.gf += sh; H.ga += sa; A.gf += sa; A.ga += sh;
  if (sh > sa) { H.w++; A.l++; H.pts += 3; }
  else if (sh < sa) { A.w++; H.l++; A.pts += 3; }
  else { H.d++; A.d++; H.pts++; A.pts++; }
}

export function groupTable(cup, g) {
  return [...cup.groups[g]].sort((x, y) => {
    const a = cup.stats[x], b = cup.stats[y];
    return (b.pts - a.pts) || ((b.gf - b.ga) - (a.gf - a.ga)) || (b.gf - a.gf)
      || (TEAMS[y].rating - TEAMS[x].rating);
  });
}

function groupFixtures(cup, md) {
  const out = [];
  for (let g = 0; g < 4; g++) {
    for (const [i, j] of MD_PAIRS[md - 1]) out.push([cup.groups[g][i], cup.groups[g][j]]);
  }
  return out;
}

// the fixture the human plays next, or null (out / waiting on KO / done)
export function myFixture(cup) {
  if (cup.champion != null || cup.out) return null;
  if (cup.md <= 3) {
    const f = groupFixtures(cup, cup.md).find(([h, a]) => h === cup.my || a === cup.my);
    return f ? { stage: 'group', md: cup.md, h: f[0], a: f[1] } : null;
  }
  if (!cup.ko) return null;
  const round = cup.ko.rounds[cup.ko.r];
  const m = round.find((x) => !x.done && (x.h === cup.my || x.a === cup.my));
  return m ? { stage: 'ko', r: cup.ko.r, h: m.h, a: m.a } : null;
}

export const roundName = (r, n) => (n === 1 ? 'Final' : n === 2 ? 'Semi-finals' : 'Quarter-finals');

function buildKO(cup) {
  const t = [0, 1, 2, 3].map((g) => groupTable(cup, g)); // [g][rank]
  cup.ko = {
    r: 0,
    rounds: [[
      { h: t[0][0], a: t[1][1], done: false },
      { h: t[2][0], a: t[3][1], done: false },
      { h: t[1][0], a: t[0][1], done: false },
      { h: t[3][0], a: t[2][1], done: false },
    ]],
  };
  cup.out = ![].concat(...cup.ko.rounds[0].map((m) => [m.h, m.a])).includes(cup.my);
}

function advanceKO(cup) {
  const round = cup.ko.rounds[cup.ko.r];
  if (!round.every((m) => m.done)) return;
  const winners = round.map((m) => (m.sh > m.sa ? m.h : m.a));
  if (winners.length === 1) { cup.champion = winners[0]; return; }
  const next = [];
  for (let i = 0; i < winners.length; i += 2) next.push({ h: winners[i], a: winners[i + 1], done: false });
  cup.ko.rounds.push(next);
  cup.ko.r++;
  if (cup.my != null && !winners.includes(cup.my)) cup.out = true;
}

// Advance the tournament: fold in the human result (if any), sim every other
// fixture due at this point, and roll stages forward. When the human is out
// (or was never due) this still moves exactly one "beat" so results stay
// readable; call repeatedly to sim to the end.
export function advance(cup, myResult = null) {
  if (cup.champion != null) return;

  if (cup.md <= 3) {
    const fixtures = groupFixtures(cup, cup.md);
    for (const [h, a] of fixtures) {
      if (myResult && ((h === myResult.h && a === myResult.a))) {
        record(cup, h, a, myResult.sh, myResult.sa, cup.md);
      } else {
        const [sh, sa] = simScore(h, a);
        record(cup, h, a, sh, sa, cup.md);
      }
    }
    cup.md++;
    if (cup.md > 3) buildKO(cup);
    return;
  }

  const round = cup.ko.rounds[cup.ko.r];
  for (const m of round) {
    if (m.done) continue;
    if (myResult && m.h === myResult.h && m.a === myResult.a) {
      m.sh = myResult.sh; m.sa = myResult.sa;
    } else {
      [m.sh, m.sa] = simScore(m.h, m.a, true);
    }
    m.done = true;
  }
  advanceKO(cup);
}

export function simToEnd(cup) {
  let guard = 12;
  while (cup.champion == null && guard-- > 0) advance(cup);
}

// --- rendering ----------------------------------------------------------------

const chip = (i, bold = false) => {
  const t = TEAMS[i];
  return `<span style="display:inline-flex;align-items:center;gap:5px;${bold ? 'font-weight:800;' : ''}">
    ${flagHTML(t.code)}${t.code}</span>`;
};

export function cupHTML(cup) {
  let html = '';

  if (cup.champion != null) {
    const c = TEAMS[cup.champion];
    html += `<div style="text-align:center;margin:10px 0 18px;">
      <div style="font-size:56px;">🏆</div>
      <div style="font-size:26px;font-weight:900;">${c.name} are World Champions!</div>
      ${cup.champion === cup.my ? '<div style="color:#7c88b5;font-weight:700;margin-top:4px;">GLORY. Absolute scenes.</div>'
        : cup.out ? '<div class="sub" style="margin-top:4px;">Your run ended earlier — next time.</div>' : ''}
    </div>`;
  }

  // groups
  html += '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px;">';
  for (let g = 0; g < 4; g++) {
    const rows = groupTable(cup, g).map((i, rank) => {
      const s = cup.stats[i];
      const me = i === cup.my;
      const thru = cup.md > 3 && rank < 2;
      return `<tr style="${me ? 'background:#f0f5fd;font-weight:800;' : ''}${thru ? 'color:#4a7a5c;' : ''}">
        <td style="padding:3px 6px;">${chip(i, me)}</td>
        <td>${s.p}</td><td>${s.gf}-${s.ga}</td><td style="font-weight:800;">${s.pts}</td></tr>`;
    }).join('');
    html += `<div style="flex:1;min-width:165px;background:#fafbfd;border-radius:12px;padding:10px 12px;">
      <div style="font-size:11px;letter-spacing:1.5px;color:#9aa2b1;margin-bottom:5px;">GROUP ${GROUP_NAMES[g]}</div>
      <table style="width:100%;font-size:12.5px;border-collapse:collapse;">
      <tr style="color:#b5bac4;font-size:10px;"><td></td><td>P</td><td>G</td><td>Pts</td></tr>${rows}</table></div>`;
  }
  html += '</div>';

  // knockout bracket
  if (cup.ko) {
    html += '<div style="display:flex;gap:16px;overflow-x:auto;padding:4px 0;">';
    cup.ko.rounds.forEach((round) => {
      html += `<div style="min-width:170px;"><div style="font-size:11px;letter-spacing:1.5px;color:#9aa2b1;margin-bottom:6px;text-transform:uppercase;">${roundName(cup.ko.r, round.length)}</div>`;
      for (const m of round) {
        const row = (i, s, win) =>
          `<div style="display:flex;justify-content:space-between;gap:8px;${win ? 'font-weight:800;' : m.done ? 'opacity:.6;' : ''}">
            ${chip(i, i === cup.my)}<span>${m.done ? s : ''}</span></div>`;
        html += `<div style="background:#fafbfd;border-radius:10px;padding:7px 10px;margin-bottom:7px;font-size:12.5px;">
          ${row(m.h, m.sh, m.done && m.sh > m.sa)}${row(m.a, m.sa, m.done && m.sa > m.sh)}</div>`;
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // latest results feed
  if (cup.results.length && cup.md <= 4 && !cup.ko) {
    const md = cup.md - 1;
    if (md >= 1) {
      const lines = cup.results.filter((r) => r.md === md)
        .map((r) => `${chip(r.h)} <b>${r.sh}–${r.sa}</b> ${chip(r.a)}`).join('<span style="color:#dfe3ea;margin:0 10px;">·</span>');
      html += `<div class="sub" style="margin-top:10px;">Matchday ${md}: ${lines}</div>`;
    }
  }

  return html;
}
