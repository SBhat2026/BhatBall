# BhatBall TTS proxy (ElevenLabs)

Broadcast-quality booth voices for the commentary. The static site can't hold
an API key, so this Worker keeps it server-side and rate-limits per IP + globally.

## Deploy

```
cd tools/tts-proxy
npx wrangler deploy
npx wrangler secret put ELEVENLABS_API_KEY   # paste the key once
```

Until the secret is set, `GET /` returns `configured:false` and the game stays
on its free in-browser voices (Kokoro/Piper) — the premium tier just never
activates. No client change needed after setting the secret.

## Contract

- `GET /` → `{ ok, configured, model }` — the game probes this once per session.
- `POST / { text, voice, model?, settings? }` → `audio/mpeg`.
  - `text` ≤ 300 chars, `voice` = an ElevenLabs voice id.
  - `settings.stability/style/similarity_boost` are 0..1; the booth maps its
    excitement level onto style (up) and stability (down) per line.

## Voices

Persona → voice ids live in `src/commentary.js` (`PERSONAS[*].eleven`). Override
per deploy without code changes via:

```html
window.BHATBALL_TTS = {
  url: 'https://bhatball-tts-proxy.<you>.workers.dev',
  voices: { bbc: { pbp: '<id>', ana: '<id>' }, hype: {...}, dry: {...} },
};
```
