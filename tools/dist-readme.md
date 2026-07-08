# ⚽ BhatBall — how to run it (no install, no GitHub)

This is the whole game in one folder. Your Mac already has everything needed
(`python3` is built in). Two ways to play:

## Easiest: double-click
Open **`bhatball.html`** (the single-file version, if it's in this folder).
It just opens in your browser. Note: on some school Macs, *saved data*
(career/custom teams/replays) and the neural commentary voices may not work
from a double-clicked file — if you want those, use the server way below.

## Full features: 2 lines in Terminal
1. Open **Terminal** (Spotlight → type "Terminal").
2. Paste these two lines (drag the folder onto Terminal after typing `cd ` to
   fill in the path automatically):

   ```
   cd /path/to/BhatBall
   python3 -m http.server 8000
   ```

3. Open your browser to **http://localhost:8000**

That's it. Leave the Terminal window open while you play; close it when done.

## Multiplayer
Click **🌐 Online Room**. The host clicks *Host a room* and shares the 4-letter
code; friends type it in from anywhere. It connects peer-to-peer — no server,
no shared network needed. Works between two school Macs, or school ↔ home.

## Troubleshooting
- **"command not found: python3"** → try `python -m http.server 8000`.
- **Port already in use** → change `8000` to `8001` (and the URL to match).
- **Blank page on double-click** → use the Terminal way; some browsers block
  the game's modules from `file://`.
