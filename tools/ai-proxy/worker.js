// Cloudflare Worker: Gemini image-stylize proxy for BhatBall custom faces.
//
// Keeps the Gemini API key SERVER-SIDE so the static GitHub Pages build can
// offer AI-styled avatars without exposing credentials in client JS. The
// request/response contract matches src/avatar.js exactly:
//
//   POST { image: <dataURL>, prompt?: <string> }  ->  { image: <dataURL> }
//
// Point the game at it with, before the module scripts in index.html:
//   window.BHATBALL_AI = { url: 'https://bhatball-ai-proxy.<you>.workers.dev' };
//
// Deploy: see README.md (wrangler deploy + `wrangler secret put GEMINI_API_KEY`).

const DEFAULT_PROMPT =
  'Restyle this person as a friendly low-poly pastel soccer-game avatar: soft '
  + 'flat shading, gentle pastel colors, front-facing head-and-shoulders, plain '
  + 'light background, keep them clearly recognizable. Square headshot.';

const MODEL = 'gemini-2.5-flash-image'; // image-in → image-out ("nano-banana")
const MAX_IMAGE_BYTES = 2_000_000;      // ~2MB dataURL cap to curb abuse

// Restrict CORS to your own site(s) so randoms can't burn your Gemini quota.
// ALLOWED_ORIGIN is a comma-separated list of origins, or '*' to allow any.
function corsHeaders(origin, allowed) {
  const list = allowed.split(',').map((s) => s.trim()).filter(Boolean);
  const any = list.includes('*');
  const ok = any || (origin && list.includes(origin));
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : (list[0] || '*'),
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const headers = corsHeaders(origin, allowed);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method === 'GET') return json({ ok: true, model: MODEL }, 200, headers);
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, headers);
    if (!env.GEMINI_API_KEY) return json({ error: 'server not configured' }, 500, headers);

    // Per-IP rate limit (guarded so the Worker still runs if the binding is off).
    if (env.AVATAR_LIMIT) {
      const ip = request.headers.get('CF-Connecting-IP') || 'anon';
      const { success } = await env.AVATAR_LIMIT.limit({ key: ip });
      if (!success) return json({ error: 'rate limited — try again in a minute' }, 429, headers);
    }
    // Global spend cap (constant key) — stops a many-IP flood draining the quota.
    if (env.GLOBAL_LIMIT) {
      const { success } = await env.GLOBAL_LIMIT.limit({ key: 'global' });
      if (!success) return json({ error: 'busy — the face styler is at capacity, try again shortly' }, 429, headers);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, headers); }

    const image = body?.image;
    if (typeof image !== 'string' || !image.startsWith('data:')) {
      return json({ error: 'missing image dataURL' }, 400, headers);
    }
    if (image.length > MAX_IMAGE_BYTES) return json({ error: 'image too large' }, 413, headers);

    const mime = (image.match(/^data:(.*?);/) || [])[1] || 'image/jpeg';
    const b64 = image.split(',')[1] || '';
    const prompt = (typeof body.prompt === 'string' && body.prompt.slice(0, 600)) || DEFAULT_PROMPT;

    const ep = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
    let g;
    try {
      g = await fetch(ep, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
        }),
      });
    } catch {
      return json({ error: 'upstream unreachable' }, 502, headers);
    }

    if (!g.ok) return json({ error: 'gemini error', status: g.status }, 502, headers);

    const j = await g.json();
    const parts = j?.candidates?.[0]?.content?.parts || [];
    const inl = parts.map((p) => p.inline_data || p.inlineData).find(Boolean);
    if (!inl?.data) return json({ error: 'no image returned' }, 502, headers);

    const outMime = inl.mime_type || inl.mimeType || 'image/png';
    return json({ image: `data:${outMime};base64,${inl.data}` }, 200, headers);
  },
};
