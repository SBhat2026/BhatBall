# BhatBall ⚽

A pastel, FIFA-style 11v11 soccer game that runs entirely in your web browser — real ball physics, utility-based AI that adapts to how you play, 16 national teams with authentic formations and play styles, set pieces, skill moves, and a knockout cup.

Built with Three.js. No installs, no accounts, no downloads.

## ▶️ Play now

**https://sbhat2026.github.io/BhatBall/**

Open that link in Safari, Chrome, or any modern browser and press **Kick Off**. That's it — it works on school Macs (or any locked-down computer) because nothing gets downloaded or installed.

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
- **Teams play like themselves** — Spain keeps the ball, France counters hard, Croatia sits solid, Brazil brings the flair. The opposing AI also quietly studies your habits during a match and adjusts.
- **Difficulties** — Chill, Classic, Legend.

## 💻 Running it locally on a Mac (optional)

Only needed if you want to play offline or hack on the code. macOS already ships with everything required:

```bash
git clone https://github.com/SBhat2026/BhatBall.git
cd BhatBall
python3 -m http.server 8000
```

Then open **http://localhost:8000** in your browser. (`python3` is preinstalled on macOS — no downloads. Any static file server works; Node.js is *not* required.)

> Don't have git on the school Mac? Use GitHub's green **Code → Download ZIP** button instead, unzip it, and run the same `python3` command inside the folder.

## 🌐 Multiplayer

LAN rooms (1v1 and a 16-team knockout cup) currently need the optional Node server (`npm install && npm start` on one machine on the network). Serverless online multiplayer via WebRTC — including new 3v3 and 5v5 street modes — is in the works and will run on the same static site above.

## License

MIT
