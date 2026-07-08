# BhatBall AI face proxy (Cloudflare Worker)

Keeps your **Gemini API key server-side** so the static GitHub Pages build can
offer AI-styled avatars without shipping credentials to the browser. The client
(`src/avatar.js`) POSTs `{ image, prompt }` and gets back `{ image }`.

## Deploy (one time)

```sh
cd tools/ai-proxy
npm i -g wrangler            # if you don't have it
wrangler login              # opens the browser — run with a `! ` prefix in Claude Code
wrangler secret put GEMINI_API_KEY   # paste your Google AI Studio key (aistudio.google.com/apikey)
wrangler deploy
```

`wrangler deploy` prints your URL, e.g.
`https://bhatball-ai-proxy.<your-subdomain>.workers.dev`.

## Point the game at it

In `index.html`, before the module scripts, uncomment/set:

```js
window.BHATBALL_AI = { url: 'https://bhatball-ai-proxy.<your-subdomain>.workers.dev' };
```

That's it — the lobby "Your face" uploader now routes photos through Gemini and
decals the styled result onto your player. With no `BHATBALL_AI` set, the game
falls back to a plain center-crop (no AI, no failure).

## Notes

- **CORS is locked** to `ALLOWED_ORIGIN` in `wrangler.toml` (your Pages site +
  localhost). Widen or add origins there; use `"*"` only for quick tests.
- **Abuse guard:** requests over ~2MB are rejected (`MAX_IMAGE_BYTES` in
  `worker.js`); the client already downscales to a 256px JPEG first.
- **Cost:** each face is one `gemini-2.5-flash-image` call. For a public room,
  consider adding Cloudflare rate limiting or `BotID` in front of the Worker.
- **Test it:**
  ```sh
  curl https://bhatball-ai-proxy.<sub>.workers.dev            # {"ok":true,...}
  ```
