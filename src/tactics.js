// Team tactical identities: real formations + style DNA per nation.
// Formations sourced from 2026 WC tactical previews (ESPN/FWC Times/MundialAnalytics):
// ESP/ARG/FRA/POR run 4-3-3 variants, ENG/GER 4-2-3-1, NED back-three, JPN 3-4-2-1.
// Style knobs are 0..1 and feed the utility AI in brain.js.

// How attack-minded each role is (also a policy-net input).
export const ROLE_ATT = {
  GK: 0, CB: 0.12, FB: 0.3, WB: 0.45, DM: 0.35, CM: 0.5,
  WM: 0.6, AM: 0.7, W: 0.8, ST2: 0.85, ST: 0.92,
};

// Slots are team-local: attack toward +x, own goal at -halfL. [role, x, z]
export const FORMATIONS = {
  '433': {
    kicker: 9,
    slots: [
      ['GK', -50, 0],
      ['FB', -38, -22], ['CB', -40, -7.5], ['CB', -40, 7.5], ['FB', -38, 22],
      ['CM', -23, -13], ['DM', -26, 0], ['CM', -23, 13],
      ['W', -9, -20], ['ST', -5, 0], ['W', -9, 20],
    ],
  },
  '4231': {
    kicker: 9,
    slots: [
      ['GK', -50, 0],
      ['FB', -38, -22], ['CB', -40, -7.5], ['CB', -40, 7.5], ['FB', -38, 22],
      ['DM', -27, -7], ['DM', -27, 7], ['AM', -13, 0],
      ['W', -9, -21], ['ST', -5, 0], ['W', -9, 21],
    ],
  },
  '442': {
    kicker: 9,
    slots: [
      ['GK', -50, 0],
      ['FB', -38, -22], ['CB', -40, -7.5], ['CB', -40, 7.5], ['FB', -38, 22],
      ['CM', -25, -7], ['CM', -25, 7], ['ST2', -11, 4],
      ['WM', -20, -21], ['ST', -6, -3], ['WM', -20, 21],
    ],
  },
  '3421': {
    kicker: 10,
    slots: [
      ['GK', -50, 0],
      ['CB', -41, -11], ['CB', -42, 0], ['CB', -41, 11],
      ['WB', -28, -23], ['WB', -28, 23],
      ['CM', -24, -7], ['CM', -24, 7],
      ['AM', -12, -10], ['AM', -12, 10], ['ST', -5, 0],
    ],
  },
};

// Small-sided (LAN street modes). Coordinates already in street-pitch meters.
// xi picks pull each nation's stars forward (front three for 3v3).
export const STREET = {
  '3': {
    kicker: 3,
    xi: [0, 8, 9, 10],
    slots: [['GK', -20, 0], ['CB', -12, 0], ['WM', -4, -7], ['ST', -4, 7]],
  },
  '5': {
    kicker: 5,
    xi: [0, 2, 3, 7, 10, 9],
    slots: [
      ['GK', -27, 0], ['CB', -20, -6], ['CB', -20, 6],
      ['CM', -11, 0], ['W', -4, -11], ['ST', -4, 9],
    ],
  },
};

// Style DNA (0..1):
//   line       defensive line height (low = park deep)
//   press      pressing intensity / how many hunt the ball
//   width      attacking width, overlap appetite
//   directness verticality: long/through balls vs patient recycling
//   risk       shot & killer-pass threshold
//   flair      skill moves, fancy finishes
//   chemistry  pass accuracy bonus + coordinated off-ball runs
//   aggression tackle appetite
//   counter    transition speed after winning the ball
export const DEFAULT_STYLE = {
  line: 0.5, press: 0.5, width: 0.6, directness: 0.5, risk: 0.5,
  flair: 0.4, chemistry: 0.6, aggression: 0.55, counter: 0.6,
};

export const TEAM_TACTICS = {
  // 4-3-3 family
  ARG: { formation: '433', style: { line: 0.55, press: 0.6, width: 0.6, directness: 0.45, risk: 0.55, flair: 0.55, chemistry: 0.95, aggression: 0.55, counter: 0.6 } },
  FRA: { formation: '433', style: { line: 0.55, press: 0.7, width: 0.6, directness: 0.8, risk: 0.6, flair: 0.6, chemistry: 0.6, aggression: 0.65, counter: 0.95 } },
  ESP: { formation: '433', style: { line: 0.75, press: 0.8, width: 0.7, directness: 0.2, risk: 0.45, flair: 0.5, chemistry: 0.85, aggression: 0.5, counter: 0.5 } },
  POR: { formation: '433', style: { line: 0.6, press: 0.6, width: 0.6, directness: 0.45, risk: 0.55, flair: 0.7, chemistry: 0.7, aggression: 0.55, counter: 0.55 } },
  MEX: { formation: '433', style: { line: 0.6, press: 0.65, width: 0.7, directness: 0.55, risk: 0.55, flair: 0.55, chemistry: 0.6, aggression: 0.6, counter: 0.6 } },
  ITA: { formation: '433', style: { line: 0.35, press: 0.45, width: 0.55, directness: 0.55, risk: 0.4, flair: 0.45, chemistry: 0.6, aggression: 0.75, counter: 0.6 } },
  CRO: { formation: '433', style: { line: 0.4, press: 0.4, width: 0.55, directness: 0.4, risk: 0.3, flair: 0.35, chemistry: 0.75, aggression: 0.55, counter: 0.5 } },
  MAR: { formation: '433', style: { line: 0.25, press: 0.35, width: 0.55, directness: 0.75, risk: 0.45, flair: 0.5, chemistry: 0.55, aggression: 0.7, counter: 0.9 } },
  // 4-2-3-1 family
  BRA: { formation: '4231', style: { line: 0.55, press: 0.55, width: 0.75, directness: 0.5, risk: 0.7, flair: 0.95, chemistry: 0.7, aggression: 0.5, counter: 0.65 } },
  GER: { formation: '4231', style: { line: 0.7, press: 0.8, width: 0.65, directness: 0.55, risk: 0.55, flair: 0.5, chemistry: 0.65, aggression: 0.6, counter: 0.6 } },
  ENG: { formation: '4231', style: { line: 0.6, press: 0.6, width: 0.6, directness: 0.5, risk: 0.5, flair: 0.45, chemistry: 0.6, aggression: 0.55, counter: 0.6 } },
  BEL: { formation: '4231', style: { line: 0.55, press: 0.55, width: 0.6, directness: 0.6, risk: 0.7, flair: 0.6, chemistry: 0.6, aggression: 0.5, counter: 0.6 } },
  // 4-4-2 grit
  USA: { formation: '442', style: { line: 0.6, press: 0.7, width: 0.6, directness: 0.7, risk: 0.55, flair: 0.4, chemistry: 0.55, aggression: 0.65, counter: 0.75 } },
  URU: { formation: '442', style: { line: 0.45, press: 0.6, width: 0.55, directness: 0.7, risk: 0.5, flair: 0.4, chemistry: 0.6, aggression: 0.95, counter: 0.7 } },
  // back-three
  JPN: {
    formation: '3421', xiMap: [0, 1, 2, 3, 4, 10, 5, 6, 7, 8, 9],
    style: { line: 0.65, press: 0.85, width: 0.6, directness: 0.6, risk: 0.55, flair: 0.5, chemistry: 0.6, aggression: 0.6, counter: 0.8 },
  },
  NED: {
    formation: '3421', xiMap: [0, 2, 3, 4, 1, 8, 5, 6, 7, 10, 9],
    style: { line: 0.5, press: 0.6, width: 0.8, directness: 0.55, risk: 0.5, flair: 0.5, chemistry: 0.6, aggression: 0.55, counter: 0.6 },
  },
};

const IDENT = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Resolve a team's lineup: slots with roles/positions + which xi entry fills each.
export function buildLineup(def, sizeKey = '11') {
  const tt = TEAM_TACTICS[def.code] ?? { formation: '433' };
  const style = { ...DEFAULT_STYLE, ...(tt.style ?? {}) };
  if (sizeKey !== '11') {
    const f = STREET[sizeKey];
    return {
      kicker: f.kicker, style,
      slots: f.slots.map(([role, x, z], i) => ({ role, x, z, xi: f.xi[i] })),
    };
  }
  const f = FORMATIONS[tt.formation];
  const map = tt.xiMap ?? IDENT;
  return {
    kicker: f.kicker, style,
    slots: f.slots.map(([role, x, z], i) => ({ role, x, z, xi: map[i] })),
  };
}
