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

Click **🌐 Online Room**, pick a **connection mode**, host a room, share the
4-letter code. All modes play identically — they differ only in how packets get
from a joiner to the host. **Nothing needs installing for any of them except the
last one.**

| | ⚡ **Same Wi-Fi** (default) | 🌍 **Anywhere** | 🖧 **LAN server** |
|---|---|---|---|
| Gameplay path | browser → browser, local candidates only | browser → browser, relay if needed | browser → `server.js` → browser |
| Needs installing | nothing | nothing | Node, `npm install`, `npm start` |
| Needs internet | only to trade the 4-letter code | yes | **no — works fully offline** |
| Typical latency | 1–3ms | 1–3ms same Wi-Fi, 30–80ms relayed | 1–3ms |
| Everyone must be… | on one Wi-Fi | anywhere | on one Wi-Fi, on the host's page |

**⚡ Same Wi-Fi** is the default and needs no setup at all. The room code is
traded through the signalling cloud (a few hundred bytes), then the data channel
is pinned to **local candidates only** — no STUN, no TURN — so gameplay is a
straight hop across the room. Open the game however you like: this page, the
offline file, a USB copy. If the two of you turn out not to be on one network, no
candidate pair forms and the joiner **falls back to Anywhere automatically** after
~7 seconds; the readout then says so. A host always gathers full ICE, so a room
started in Same Wi-Fi mode is still joinable from anywhere.

**🌍 Anywhere** runs over the open internet **independent of how you loaded the
game** — even a double-clicked offline file can host a room.

**🖧 LAN server** is the old `?ws` mode. It's the only one that needs `npm start`
and the only one that works with the internet completely unplugged (no signalling
cloud at all). The card appears only when a server is actually running.

Your name, mode choice, and **Copy invite link** (a `?room=CODE` deep link that
opens the lobby with the code filled in) are all remembered to save typing. The
lobby and the in-match pill show the live round trip to the host, so you can see
what a mode actually costs you.

- **⚔️ 1v1** — host vs first joiner, full 11v11.
- **🏆 Knockout Cup** — every human seeded into a golden-goal bracket, CPU nations fill the rest.
- **🛹 3v3 / ⚡ 5v5 street** — small pitch, one player per person, bot goalkeepers, AI fills empty spots. Extra joiners spectate.

### If a join hangs (restrictive network) — try in this order

1. **Both on the same Wi‑Fi? ⚡ Same Wi‑Fi mode is already the default** and
   needs nothing installed — it skips STUN and TURN entirely, so a blocked relay
   can't stop it. Only the room-code handshake goes out to the internet. If even
   that is blocked, run `npm install && npm start` on one machine, open the
   printed `LAN: http://192.168.x.x:3080` address on both, and pick **🖧 LAN
   server** — that path touches no external service at all.
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

**Rooms that used to work suddenly hang?** Check the TURN relay before anything
else — `node tools/turn/check.mjs` (see `tools/turn/fly/README.md`). A stopped
relay is invisible from inside the game.

## License

MIT
