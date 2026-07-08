# BhatBall ⚽

A FIFA-style 11v11 soccer game that runs entirely in your web browser — real ball physics, utility-based AI that adapts to how you play, several national teams with authentic formations and play styles, set pieces, skill moves, and a knockout cup.

Built with Three.js. No installs, no accounts, no downloads.

## ▶️ Play now

**https://bhatball.pages.dev** &nbsp;·&nbsp; mirror: **https://sbhat2026.github.io/BhatBall/**

Open either link and press **Kick Off**. They're identical — the `pages.dev` one
is a second domain in case a school/office filter blocks `github.io`.

> **On a locked-down computer** (school Mac, no admin, GitHub blocked, can't
> install git)? See **[DISTRIBUTION.md](DISTRIBUTION.md)** — you can run the whole
> game from a single file emailed or shared over Google Drive, and multiplayer
> still works.

## 🎮 How to play (single player)

Pick your team, an opponent (or 🎲 Random), a stadium, difficulty, and match length — then Kick Off.

| Key | Action |
|---|---|
| **WASD** / arrow keys | Move |
| **Shift** | Sprint |
| **J** | Tap = pass · hold = through ball |
| **Space** | Shoot (hold for power) |
| **I** | Finesse curl |
| **L** | Chip / lob |
| **Q** | Sombrero flick |
| **E** | Bicycle kick (when the ball is in the air) |
| **K** | Slide tackle |
| **Tab** | Switch player |
| **C** | Camera (broadcast ↔ first-person) |
| **H** | Controls panel |
| **P** / **Esc** | Pause |
| **M** | Mute |

- **Save & resume** — pause mid-match and choose *Save & return to menu*; the Resume button brings it back later.
- **Difficulties** — Chill, Classic, Legend.

## 💻 Running it locally on a Mac (optional)

Only needed if you want to play offline or hack on the code. macOS already ships with everything required:

```bash
git clone https://github.com/SBhat2026/BhatBall.git
cd BhatBall
python3 -m http.server 8000
```

Then open **http://localhost:8000** in your browser. (`python3` is preinstalled on macOS — no downloads. Any static file server works; Node.js is *not* required.)

> **No git / GitHub blocked?** A managed Mac often can't install git (it wants
> Xcode Command Line Tools). Grab the offline bundle instead — see
> **[DISTRIBUTION.md](DISTRIBUTION.md)**: `npm run dist` produces a ~650 KB zip
> (share it via Google Drive or email) and a single double-click `bhatball.html`.
> Both run with the same `python3 -m http.server`.

## 🌐 Multiplayer

Click **🌐 Online Room** — no server needed. Rooms connect **peer-to-peer over
WebRTC**: the host gets a 4-letter code, friends type it in from anywhere.

**Key point:** the multiplayer connection runs over the open internet (WebRTC),
**independent of how you loaded the game**. So even if you're playing from a
double-clicked offline file (because `github.io` is blocked), Online Rooms still
work — as long as your network lets WebRTC out. Load the game any way that works
for you, then just use Online Rooms.

- **⚔️ 1v1** — host vs first joiner, full 11v11.
- **🏆 Knockout Cup** — every human seeded into a golden-goal bracket, CPU nations fill the rest.
- **🛹 3v3 / ⚡ 5v5 street** — small pitch, one player per person, bot goalkeepers, AI fills empty spots. Extra joiners spectate.

### If a join hangs (restrictive network) — try in this order

1. **Both on the same Wi‑Fi? Use LAN mode — no internet needed.** On one machine
   run `npm install && npm start`, note the printed `LAN: http://192.168.x.x:3080`
   line, and have **everyone** (host included) open that address with **`?ws`**
   added — e.g. `http://192.168.x.x:3080/?ws`. This never touches the internet,
   PeerJS, or STUN/TURN. (Needs Node.js on the one host machine.)
2. **Different networks? Add a TURN relay on port 443.** Strict firewalls block
   WebRTC's usual UDP but allow HTTPS (443). Free tier at
   [metered.ca](https://www.metered.ca) gives you TURN over 443 that looks like
   normal web traffic — set `window.BHATBALL_ICE_URL` in `index.html` (see the
   commented block there). This is the single most reliable fix for school/office
   Wi‑Fi.
3. **Tether one side to a phone hotspot.** Cellular NAT + TURN almost always
   connects when locked-down Wi‑Fi won't.

STUN (built in) already covers most home networks; you only need the above when a
network actively blocks WebRTC.

## License

MIT
