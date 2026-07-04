// FIELD is mutable so street modes can shrink the pitch before a match builds.
// Everything reads it live; call setField() before constructing Match/stadium.
export const FIELD_PRESETS = {
  '11': {
    length: 105, width: 68, goalHalf: 3.66, goalHeight: 2.44,
    boxL: 16.5, boxHalfW: 20.15, penSpot: 11, sixL: 5.5, circleR: 9.15,
  },
  '5': {
    length: 62, width: 40, goalHalf: 2.8, goalHeight: 2.2,
    boxL: 9, boxHalfW: 12, penSpot: 7, sixL: 3, circleR: 5,
  },
  '3': {
    length: 46, width: 30, goalHalf: 2.4, goalHeight: 2.05,
    boxL: 7, boxHalfW: 9.5, penSpot: 6, sixL: 2.5, circleR: 4,
  },
};

export const FIELD = { postR: 0.07 };
export function setField(sizeKey = '11') {
  Object.assign(FIELD, FIELD_PRESETS[sizeKey] ?? FIELD_PRESETS['11']);
  FIELD.halfL = FIELD.length / 2;
  FIELD.halfW = FIELD.width / 2;
  FIELD.sizeKey = sizeKey;
}
setField('11');

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

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const damp = (k, dt) => 1 - Math.exp(-k * dt);
export const rand = (a, b) => a + Math.random() * (b - a);
