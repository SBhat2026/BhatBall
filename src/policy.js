// Lightweight learned policy: a tiny MLP (16→16→2, tanh) whose output is a
// small clamped offset on the utility AI's movement target. It can refine
// positioning but never override football logic. ~300 params, negligible cost.
import { WEIGHTS } from './policy-weights.js';

export const NET_IN = 16;
export const NET_H = 16;

export function makeNet(theta) {
  // theta: flat Float array, length NET_IN*NET_H + NET_H + NET_H*2 + 2
  return theta;
}

export const NET_PARAMS = NET_IN * NET_H + NET_H + NET_H * 2 + 2;

const _h = new Float64Array(NET_H);

// inp: length-16 array. out: [dx, dz] in meters (already scaled+clamped).
export function runNet(theta, inp, out) {
  let k = 0;
  for (let j = 0; j < NET_H; j++) {
    let s = 0;
    for (let i = 0; i < NET_IN; i++) s += theta[k++] * inp[i];
    _h[j] = Math.tanh(s + theta[NET_IN * NET_H + j]);
  }
  k = NET_IN * NET_H + NET_H;
  for (let o = 0; o < 2; o++) {
    let s = 0;
    for (let j = 0; j < NET_H; j++) s += theta[k++] * _h[j];
    out[o] = Math.tanh(s + theta[NET_IN * NET_H + NET_H + NET_H * 2 + o]) * 2.2;
  }
  return out;
}

// The shipped net (trained offline), or null.
export const TRAINED_NET = WEIGHTS ? Float64Array.from(WEIGHTS) : null;
