export const FIELD = {
  length: 105, width: 68,
  halfL: 52.5, halfW: 34,
  goalHalf: 3.66, goalHeight: 2.44, postR: 0.07,
};

export const BALL = {
  r: 0.18, g: 9.81,
  drag: 0.012,        // quadratic air drag coefficient (per m)
  magnus: 0.0045,     // spin-lift coefficient
  restitution: 0.62,
  rollFriction: 3.4,  // m/s^2 ground decel
};

export const PLAYER = {
  speed: 7.0, sprint: 9.3,
  kickRange: 1.55, controlRange: 1.35,
  height: 1.8,
};

export const DIFFICULTY = {
  chill:   { name: 'Chill',   react: 0.28, speed: 0.88, passErr: 0.18, shootErr: 0.16, tackleAggro: 0.35 },
  classic: { name: 'Classic', react: 0.13, speed: 0.99, passErr: 0.08, shootErr: 0.09, tackleAggro: 0.65 },
  legend:  { name: 'Legend',  react: 0.07, speed: 1.06, passErr: 0.03, shootErr: 0.04, tackleAggro: 0.95 },
};

// Teammate AI on the user's team (fixed, independent of opponent difficulty)
export const MATE_DIFF = { react: 0.14, speed: 0.96, passErr: 0.09, shootErr: 0.10, tackleAggro: 0.6 };

// 4-3-3, team-local coords: x negative = own half, attack toward +x. [role, x, z]
export const FORMATION = [
  ['GK', -50, 0],
  ['DF', -38, -22], ['DF', -40, -7.5], ['DF', -40, 7.5], ['DF', -38, 22],
  ['MF', -22, -14], ['MF', -25, 0],    ['MF', -22, 14],
  ['FW', -9, -20],  ['FW', -5, 0],     ['FW', -9, 20],
];
export const CONTROLLED_INDEX = 9; // center striker

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const damp = (k, dt) => 1 - Math.exp(-k * dt);
export const rand = (a, b) => a + Math.random() * (b - a);
