// Procedural national flags (real colors, simplified geometry) drawn once to
// small canvases and cached as data URLs. Used everywhere the UI showed a
// plain kit swatch: menu chips, scoreboard, brackets, World Cup tables.
const W = 60, H = 40;
const cache = new Map();

const horiz = (ctx, colors, weights) => {
  const total = weights?.reduce((a, b) => a + b, 0) ?? colors.length;
  let y = 0;
  colors.forEach((c, i) => {
    const h = (H * (weights?.[i] ?? 1)) / total;
    ctx.fillStyle = c;
    ctx.fillRect(0, y, W, h + 0.5);
    y += h;
  });
};
const vert = (ctx, colors, weights) => {
  const total = weights?.reduce((a, b) => a + b, 0) ?? colors.length;
  let x = 0;
  colors.forEach((c, i) => {
    const w = (W * (weights?.[i] ?? 1)) / total;
    ctx.fillStyle = c;
    ctx.fillRect(x, 0, w + 0.5, H);
    x += w;
  });
};
const disc = (ctx, x, y, r, c) => {
  ctx.fillStyle = c;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29); ctx.fill();
};
const star = (ctx, x, y, r, c, stroke = false) => {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5; // pentagram jump-2 order
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  if (stroke) { ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke(); }
  else { ctx.fillStyle = c; ctx.fill(); }
};

const DRAW = {
  BRA(ctx) {
    ctx.fillStyle = '#009739'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fedd00';
    ctx.beginPath();
    ctx.moveTo(W / 2, 4); ctx.lineTo(W - 6, H / 2); ctx.lineTo(W / 2, H - 4); ctx.lineTo(6, H / 2);
    ctx.closePath(); ctx.fill();
    disc(ctx, W / 2, H / 2, 8, '#012169');
  },
  ARG(ctx) {
    horiz(ctx, ['#75aadb', '#ffffff', '#75aadb']);
    disc(ctx, W / 2, H / 2, 5, '#fcbf49');
  },
  FRA(ctx) { vert(ctx, ['#0055a4', '#ffffff', '#ef4135']); },
  GER(ctx) { horiz(ctx, ['#0b0b0b', '#dd0000', '#ffce00']); },
  ESP(ctx) { horiz(ctx, ['#aa151b', '#f1bf00', '#aa151b'], [1, 2, 1]); },
  ENG(ctx) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ce1124';
    ctx.fillRect(W / 2 - 5, 0, 10, H);
    ctx.fillRect(0, H / 2 - 5, W, 10);
  },
  ITA(ctx) { vert(ctx, ['#008c45', '#ffffff', '#cd212a']); },
  POR(ctx) {
    vert(ctx, ['#046a38', '#da291c'], [2, 3]);
    disc(ctx, W * 0.4, H / 2, 7, '#ffe900');
    disc(ctx, W * 0.4, H / 2, 4, '#da291c');
  },
  NED(ctx) { horiz(ctx, ['#ae1c28', '#ffffff', '#21468b']); },
  JPN(ctx) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    disc(ctx, W / 2, H / 2, 11, '#bc002d');
  },
  USA(ctx) {
    ctx.fillStyle = '#b31942'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    for (let i = 1; i < 7; i += 2) ctx.fillRect(0, (H / 7) * i, W, H / 7);
    ctx.fillStyle = '#0a3161'; ctx.fillRect(0, 0, W * 0.44, H * 4 / 7);
    ctx.fillStyle = '#ffffff';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      disc(ctx, 4 + c * 6.5 + (r % 2) * 3, 4 + r * 7, 1.3, '#ffffff');
    }
  },
  MEX(ctx) {
    vert(ctx, ['#006341', '#ffffff', '#c8102e']);
    disc(ctx, W / 2, H / 2, 5, '#8a6d3b');
    disc(ctx, W / 2, H / 2 + 2.5, 2.5, '#4a7a3a');
  },
  CRO(ctx) {
    horiz(ctx, ['#ff0000', '#ffffff', '#171796']);
    const s = 5, x0 = W / 2 - s * 2, y0 = H / 2 - s * 2;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#ff0000' : '#ffffff';
      ctx.fillRect(x0 + c * s, y0 + r * s, s, s);
    }
    ctx.strokeStyle = '#00000022'; ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, s * 4, s * 4);
  },
  MAR(ctx) {
    ctx.fillStyle = '#c1272d'; ctx.fillRect(0, 0, W, H);
    star(ctx, W / 2, H / 2 + 1, 11, '#006233', true);
  },
  URU(ctx) {
    horiz(ctx, ['#ffffff', '#0038a8', '#ffffff', '#0038a8', '#ffffff', '#0038a8', '#ffffff', '#0038a8', '#ffffff']);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W * 0.42, H * 5 / 9);
    disc(ctx, W * 0.21, H * 0.28, 6, '#fcd116');
    ctx.strokeStyle = '#c58f22'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(W * 0.21 + Math.cos(a) * 6, H * 0.28 + Math.sin(a) * 6);
      ctx.lineTo(W * 0.21 + Math.cos(a) * 9, H * 0.28 + Math.sin(a) * 9);
      ctx.stroke();
    }
  },
  BEL(ctx) { vert(ctx, ['#0b0b0b', '#fdda24', '#ef3340']); },
  CPV(ctx) {
    ctx.fillStyle = '#003893'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, H * 0.5, W, H * 0.083);
    ctx.fillStyle = '#cf2027'; ctx.fillRect(0, H * 0.583, W, H * 0.083);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, H * 0.667, W, H * 0.083);
    for (let i = 0; i < 10; i++) {
      const a = (i * 2 * Math.PI) / 10;
      disc(ctx, W * 0.375 + Math.cos(a) * 8, H * 0.583 + Math.sin(a) * 8, 1.4, '#f7d116');
    }
  },
};

export function flagURL(code) {
  if (typeof document === 'undefined') return '';
  if (cache.has(code)) return cache.get(code);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  (DRAW[code] ?? ((c) => { c.fillStyle = '#c9ced8'; c.fillRect(0, 0, W, H); }))(ctx);
  // soft edge so flags sit nicely on the pastel cards
  ctx.strokeStyle = '#4a4f5c22'; ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, W, H);
  const url = cv.toDataURL();
  cache.set(code, url);
  return url;
}

export const flagHTML = (code) =>
  `<img class="flag" src="${flagURL(code)}" alt="${code}" />`;
