# BhatBall ⚽

A FIFA-style 11v11 soccer game that runs entirely in your web browser — real ball physics, utility-based AI that adapts to how you play, several national teams with authentic formations and play styles, set pieces, skill moves, and a knockout cup.

Built with Three.js. No installs, no accounts, no downloads.

## ▶️ Play now

**https://sbhat2026.github.io/BhatBall/**

Open that link and press **Kick Off**.

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

## 🌐 Multiplayer

Click **🌐 Online Room** — no server needed. Rooms connect peer-to-peer over WebRTC: the host gets a 4-letter code, friends type it in from anywhere (works on the static site above, including school Macs).

- **⚔️ 1v1** — host vs first joiner, full 11v11.
- **🏆 Knockout Cup** — every human seeded into a golden-goal bracket, CPU nations fill the rest.
- **🛹 3v3 / ⚡ 5v5 street** — small pitch, one player per person, bot goalkeepers, AI fills empty spots. Extra joiners spectate.

(If you're offline on a shared LAN, the old relay still works: `npm install && npm start` on one machine, then open its address with `?ws` added to the URL.)

## License

MIT
