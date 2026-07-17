// Cloudflare Worker: ElevenLabs commentary-voice proxy for BhatBall.
//
// Keeps the ElevenLabs API key SERVER-SIDE so the static GitHub Pages build can
// offer broadcast-quality booth voices without exposing credentials in client
// JS. The request/response contract matches src/commentary.js:
//
//   GET                                        -> { ok: true, configured: <bool> }
//   POST { text, voice, model?, settings? }    -> audio/mpeg bytes
//
// Point the game at it with, before the module scripts in index.html:
//   window.BHATBALL_TTS = { url: 'https://bhatball-tts-proxy.<you>.workers.dev' };
//
// Deploy: wrangler deploy + `wrangler secret put ELEVENLABS_API_KEY`. Until the
// secret is set, GET reports configured:false and the game silently stays on
// its in-browser voices (Kokoro/Piper) — nothing breaks.

const DEFAULT_MODEL = 'eleven_flash_v2_5'; // low latency + multilingual (HYPE's Spanish)
const MAX_TEXT = 300;                      // booth lines are one sentence; cap abuse
const OUTPUT = 'mp3_22050_32';             // small + decodeAudioData-friendly

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
    if (request.method === 'GET') {
      return json({ ok: true, configured: !!env.ELEVENLABS_API_KEY, model: DEFAULT_MODEL }, 200, headers);
    }
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, headers);
    if (!env.ELEVENLABS_API_KEY) return json({ error: 'server not configured' }, 503, headers);

    // Per-IP + global rate limits (guarded so the Worker still runs unbound).
    if (env.TTS_LIMIT) {
      const ip = request.headers.get('CF-Connecting-IP') || 'anon';
      const { success } = await env.TTS_LIMIT.limit({ key: ip });
      if (!success) return json({ error: 'rate limited' }, 429, headers);
    }
    if (env.GLOBAL_LIMIT) {
      const { success } = await env.GLOBAL_LIMIT.limit({ key: 'all' });
      if (!success) return json({ error: 'rate limited (global)' }, 429, headers);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, headers); }
    const text = String(body.text || '').slice(0, MAX_TEXT).trim();
    const voice = String(body.voice || '');
    if (!text) return json({ error: 'text required' }, 400, headers);
    if (!/^[A-Za-z0-9]{12,32}$/.test(voice)) return json({ error: 'bad voice id' }, 400, headers);
    const model = typeof body.model === 'string' && /^eleven_[a-z0-9_]+$/.test(body.model)
      ? body.model : DEFAULT_MODEL;
    const s = body.settings || {};
    const clamp01 = (v, d) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
    const voice_settings = {
      stability: clamp01(s.stability, 0.45),
      similarity_boost: clamp01(s.similarity_boost, 0.8),
      style: clamp01(s.style, 0.3),
      use_speaker_boost: false,
    };

    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${OUTPUT}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: model, voice_settings }),
      },
    );
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return json({ error: `elevenlabs ${r.status}`, detail: detail.slice(0, 200) }, 502, headers);
    }
    return new Response(r.body, {
      status: 200,
      headers: { ...headers, 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
    });
  },
};
