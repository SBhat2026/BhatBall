// Custom player faces: take an uploaded photo, (optionally) restyle it into the
// game's pastel low-poly look with Gemini, and turn it into a square texture
// that gets decaled onto the front of a rig's head. Used for multiplayer
// identity — your face rides your player and everyone in the room sees it.
//
// The AI step is OPTIONAL and pluggable so this works on a static site:
//   • window.BHATBALL_AI = { url: 'https://your-proxy/stylize' }  ← recommended
//       POST { image, prompt } → { image }  (keeps your key server-side)
//   • window.BHATBALL_AI = { key: 'GEMINI_KEY' }  ← direct, key is exposed
//   • localStorage 'bhatball_gemini_key'          ← per-device, brought by the player
// With none configured we just use the cropped photo — no failure, no AI.

import * as THREE from 'three';

const AI_PROMPT =
  'Restyle this person as a friendly low-poly pastel soccer-game avatar: soft '
  + 'flat shading, gentle pastel colors, front-facing head-and-shoulders, plain '
  + 'light background, keep them clearly recognizable. Square headshot.';

export function aiConfig() {
  if (typeof window === 'undefined') return null;
  if (window.BHATBALL_AI?.url) return { url: window.BHATBALL_AI.url };
  const key = window.BHATBALL_AI?.key || (typeof localStorage !== 'undefined' && localStorage.getItem('bhatball_gemini_key'));
  return key ? { key } : null;
}
export const aiEnabled = () => !!aiConfig();

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

// Center-crop any image dataURL to a square, downscaled for cheap network sends.
export async function squareDataURL(dataURL, size = 256) {
  const img = await loadImage(dataURL);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const s = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  return cv.toDataURL('image/jpeg', 0.85);
}

// Build a THREE texture from a (square) dataURL, ready to decal on a head.
export async function faceTexture(dataURL) {
  const img = await loadImage(dataURL);
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Restyle via Gemini (image-in → image-out) if configured; otherwise return the
// input unchanged. Never throws — a failed/absent AI call falls back to the crop.
export async function stylize(dataURL) {
  const cfg = aiConfig();
  if (!cfg) return dataURL;
  try {
    if (cfg.url) {
      const r = await fetch(cfg.url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: dataURL, prompt: AI_PROMPT }),
      });
      const j = await r.json();
      return j.image || dataURL;
    }
    // Direct Google Generative Language API (gemini-2.5-flash-image / "nano-banana").
    const mime = (dataURL.match(/^data:(.*?);/) || [])[1] || 'image/jpeg';
    const b64 = dataURL.split(',')[1];
    const ep = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${cfg.key}`;
    const r = await fetch(ep, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: AI_PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
      }),
    });
    const j = await r.json();
    const parts = j?.candidates?.[0]?.content?.parts || [];
    const inl = parts.map((p) => p.inline_data || p.inlineData).find(Boolean);
    if (inl?.data) return `data:${inl.mime_type || inl.mimeType || 'image/png'};base64,${inl.data}`;
  } catch { /* fall back to the plain crop */ }
  return dataURL;
}

// Full pipeline: raw photo dataURL → square crop → AI restyle → shareable dataURL.
export async function makeAvatar(rawDataURL) {
  const square = await squareDataURL(rawDataURL);
  return stylize(square);
}
