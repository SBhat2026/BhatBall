// Match-ball styles: stylized takes on famous World Cup balls, painted onto
// equirect canvas textures (headless-safe: falls back to the plain low-poly ball).
// Unlocks are driven by career wins vs the AI (single-player + World Cup mode).
import * as THREE from 'three';
import { BALL } from './config.js';

const INK = '#2c2c30';
const WHITE = '#f6f4ee';

function pent(ctx, x, y, r, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * 2 * Math.PI) / 5;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

function wave(ctx, W, y0, amp, phase, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let x = -10; x <= W + 10; x += 8) {
    const y = y0 + Math.sin((x / W) * Math.PI * 2 + phase) * amp;
    ctx[x < 0 ? 'moveTo' : 'lineTo'](x, y);
  }
  ctx.stroke();
}

// Each style: id, name, era note, wins needed, paint(ctx, W, H).
export const BALL_STYLES = [
  {
    id: 'classic', name: 'Telstar \'70', note: 'The original — 0 wins', wins: 0,
    paint(ctx, W, H) {
      ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = INK;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 6; c++) {
          pent(ctx, (c + (r % 2) * 0.5) * (W / 6) + W / 12, (r + 0.5) * (H / 3), 19);
        }
      }
    },
  },
  {
    id: 'tango', name: 'Tango \'82', note: 'España triads — 2 wins', wins: 2,
    paint(ctx, W, H) {
      ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = INK;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 4; c++) {
          const x = (c + (r % 2) * 0.5) * (W / 4) + W / 8, y = (r + 0.5) * (H / 2);
          ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(x, y, 26, 0, 6.29); ctx.stroke();
          ctx.lineWidth = 11;
          for (let k = 0; k < 3; k++) {
            const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
            ctx.beginPath(); ctx.arc(x, y, 40, a - 0.42, a + 0.42); ctx.stroke();
          }
        }
      }
    },
  },
  {
    id: 'teamgeist', name: 'Teamgeist \'06', note: 'Berlin propellers — 4 wins', wins: 4,
    paint(ctx, W, H) {
      ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H);
      for (let c = 0; c < 3; c++) {
        const x = c * (W / 3) + W / 6;
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.moveTo(x - 52, H * 0.18);
        ctx.quadraticCurveTo(x + 10, H * 0.5, x - 52, H * 0.82);
        ctx.quadraticCurveTo(x + 46, H * 0.5, x - 52, H * 0.18);
        ctx.fill();
        ctx.strokeStyle = '#cfa54a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - 58, H * 0.14);
        ctx.quadraticCurveTo(x + 18, H * 0.5, x - 58, H * 0.86);
        ctx.stroke();
      }
    },
  },
  {
    id: 'jabulani', name: 'Jabulani \'10', note: 'South Africa swoops — 7 wins', wins: 7,
    paint(ctx, W, H) {
      ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H);
      wave(ctx, W, H * 0.30, 26, 0.4, 16, '#4a9e63');
      wave(ctx, W, H * 0.50, 30, 2.1, 16, '#e0b64f');
      wave(ctx, W, H * 0.70, 26, 3.9, 16, '#c9524a');
      wave(ctx, W, H * 0.30, 26, 0.4, 3, INK);
      wave(ctx, W, H * 0.50, 30, 2.1, 3, INK);
      wave(ctx, W, H * 0.70, 26, 3.9, 3, INK);
    },
  },
  {
    id: 'brazuca', name: 'Brazuca \'14', note: 'Rio ribbons — 10 wins', wins: 10,
    paint(ctx, W, H) {
      ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H);
      wave(ctx, W, H * 0.26, 34, 0.0, 20, '#e8843c');
      wave(ctx, W, H * 0.50, 38, 2.4, 20, '#3f7fb5');
      wave(ctx, W, H * 0.74, 34, 4.6, 20, '#57a86b');
      ctx.fillStyle = INK;
      for (let c = 0; c < 5; c++) {
        ctx.beginPath();
        ctx.arc(c * (W / 5) + W / 10, H * (0.34 + 0.32 * (c % 2)), 7, 0, 6.29);
        ctx.fill();
      }
    },
  },
  {
    id: 'telstar18', name: 'Telstar 18', note: 'Moscow mosaic — 14 wins', wins: 14,
    paint(ctx, W, H) {
      ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H);
      const cell = 10;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 6; c++) {
          const cx = (c + (r % 2) * 0.5) * (W / 6) + W / 12, cy = (r + 0.5) * (H / 3);
          for (let gy = -3; gy <= 3; gy++) {
            for (let gx = -3; gx <= 3; gx++) {
              const d = Math.hypot(gx, gy);
              if (d > 3.2) continue;
              const shade = 44 + d * 46;
              ctx.fillStyle = `rgb(${shade},${shade},${shade + 6})`;
              ctx.fillRect(cx + gx * cell - cell / 2 + 1, cy + gy * cell - cell / 2 + 1, cell - 2, cell - 2);
            }
          }
        }
      }
    },
  },
  {
    id: 'alrihla', name: 'Al Rihla \'22', note: 'Doha sails — 18 wins', wins: 18,
    paint(ctx, W, H) {
      ctx.fillStyle = '#f2f1f5'; ctx.fillRect(0, 0, W, H);
      const cols = ['#3f7fb5cc', '#c9524acc', '#e0b64fcc', '#7cc0d8cc'];
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 4; c++) {
          const x = (c + (r % 2) * 0.5) * (W / 4) + W / 8, y = (r + 0.5) * (H / 2);
          ctx.fillStyle = cols[(c + r) % cols.length];
          ctx.beginPath();
          ctx.moveTo(x, y - 34);
          ctx.quadraticCurveTo(x + 40, y, x, y + 34);
          ctx.quadraticCurveTo(x - 14, y + 6, x, y - 34);
          ctx.fill();
          ctx.strokeStyle = '#3a3a44';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      }
    },
  },
  {
    id: 'trionda', name: 'Trionda \'26', note: 'Three waves, one cup — 25 wins', wins: 25,
    paint(ctx, W, H) {
      ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H);
      // the tri-nation waves: red (CAN) / green (MEX) / blue (USA)
      wave(ctx, W, H * 0.28, 30, 0.6, 26, '#c9524a');
      wave(ctx, W, H * 0.50, 34, 2.7, 26, '#57a86b');
      wave(ctx, W, H * 0.72, 30, 4.8, 26, '#3f7fb5');
      ctx.fillStyle = '#cfa54a';
      for (let c = 0; c < 6; c++) {
        const x = c * (W / 6) + W / 12, y = H * (c % 2 ? 0.39 : 0.61);
        ctx.beginPath();
        ctx.moveTo(x, y - 9); ctx.lineTo(x + 8, y + 7); ctx.lineTo(x - 8, y + 7);
        ctx.closePath(); ctx.fill();
      }
    },
  },
];

// --- unlock persistence (career wins vs the AI) ------------------------------

const KEY_WINS = 'pp-wins';
const KEY_BALL = 'pp-ball';
const store = typeof localStorage !== 'undefined' ? localStorage : null;

export function getWins() { return store ? +store.getItem(KEY_WINS) || 0 : 0; }
export function isUnlocked(style) { return getWins() >= style.wins; }

// records one win; returns any styles this win just unlocked
export function addWin() {
  if (!store) return [];
  const before = getWins();
  store.setItem(KEY_WINS, String(before + 1));
  return BALL_STYLES.filter((s) => s.wins > before && s.wins <= before + 1);
}

export function currentBallId() {
  const id = store?.getItem(KEY_BALL);
  const st = BALL_STYLES.find((s) => s.id === id);
  return st && isUnlocked(st) ? st.id : 'classic';
}
export function setBallId(id) { store?.setItem(KEY_BALL, id); }

// --- mesh / texture -----------------------------------------------------------

const texCache = new Map();
function ballTexture(style) {
  if (texCache.has(style.id)) return texCache.get(style.id);
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  style.paint(cv.getContext('2d'), 512, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(style.id, tex);
  return tex;
}

// small round swatch for the menu chips
const prevCache = new Map();
export function previewURL(style) {
  if (typeof document === 'undefined') return '';
  if (prevCache.has(style.id)) return prevCache.get(style.id);
  const big = document.createElement('canvas');
  big.width = 512; big.height = 256;
  style.paint(big.getContext('2d'), 512, 256);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 36;
  const ctx = cv.getContext('2d');
  ctx.beginPath(); ctx.arc(18, 18, 17, 0, 6.29); ctx.clip();
  ctx.drawImage(big, 150, 40, 176, 176, 0, 0, 36, 36);
  const url = cv.toDataURL();
  prevCache.set(style.id, url);
  return url;
}

export function buildBallMesh(styleId = 'classic') {
  // headless (sim/tests): keep the untextured low-poly ball
  if (typeof document === 'undefined') {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(BALL.r, 1),
      new THREE.MeshStandardMaterial({ color: '#f7f5f0', roughness: 0.85, metalness: 0, flatShading: true }),
    );
    mesh.castShadow = true;
    return mesh;
  }
  const style = BALL_STYLES.find((s) => s.id === styleId) ?? BALL_STYLES[0];
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL.r, 24, 16),
    new THREE.MeshStandardMaterial({ map: ballTexture(style), roughness: 0.55, metalness: 0 }),
  );
  mesh.castShadow = true;
  return mesh;
}
