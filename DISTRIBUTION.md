# Getting BhatBall onto a locked-down / school computer

GitHub Pages (`sbhat2026.github.io`) is category-blocked by some school filters
(GoGuardian), and `git clone` needs Xcode Command Line Tools that a managed Mac
won't let you install. Neither is a problem with the game — it's a static site.
Here are three ways around it, in order of least friction.

## 1. Hosted mirror (no setup for your friend) — try this first
The game is mirrored on Cloudflare Pages, which is a *different domain* and often
isn't category-blocked the way `github.io` is:

**→ https://bhatball.pages.dev**

If that loads on the school network, you're done — just share the link.
If IT filters it too, ask them to whitelist the single domain `bhatball.pages.dev`
(one line for a GoGuardian admin).

Re-deploy after changes:
```
npm run dist                 # builds dist/
npx wrangler pages deploy dist/BhatBall --project-name=bhatball --branch=main --commit-dirty
```

## 2. Google Drive (schools almost always allow Drive)
```
npm run dist
```
That produces **`dist/BhatBall-offline.zip`** (~650 KB). Upload it to Google
Drive, share it to your friend's school Google account, he downloads + unzips
(double-click on macOS), then follows `HOW-TO-PLAY.md` inside:
- **Double-click `bhatball.html`** to play instantly, or
- `cd BhatBall && python3 -m http.server 8000` → open `http://localhost:8000`
  for full features (saved data + neural commentary).

USB stick works the same way and bypasses the network entirely.

## 3. Single file
`dist/BhatBall/bhatball.html` is the *entire game in one self-contained file*
(three.js + peerjs + all game code inlined). Email it, AirDrop it, drop it on a
USB stick — double-click to play. Multiplayer still works (it's peer-to-peer over
WebRTC, no server needed). Note: some browsers restrict saved data (career /
custom teams / replays) and disable Web Workers from a `file://` page — if you
want those, use the `python3 -m http.server` route instead.

## How the build works
`npm run dist` (`tools/build-dist.sh`):
- copies `index.html` + `src/` + `vendor/`, trimming `vendor/jsm` from 13 MB to
  the ~10 postprocessing files the game actually imports,
- bundles `src/main.js` (+ all modules, three, addons) with esbuild and inlines
  it — plus peerjs — into one `bhatball.html` (`tools/build-single.mjs`),
- zips the folder for Drive/USB.

Nothing in `dist/` is committed (it's regenerated on demand).
