// Replay Theater — save goal replays, rewatch them any time, string them into a
// highlights reel, and export/import to share. Works for single-player AND
// online (host + client both capture), which the in-match replay never did.
//
// A saved replay is self-contained: the two team defs + kits + ball + the tape
// (same [x,z,ry,speed,fx] rows the live Recorder and NetView already speak), so
// it can be re-rendered later through a spectator NetView with zero coupling to
// the locked in-match replay path.

const KEY = 'pp-replays';
const CAP = 8;                 // keep storage well under the localStorage budget
const MAX_FRAMES = 180;        // ~6s at 30Hz — the meaningful run-up to a goal
const r2 = (v) => Math.round(v * 100) / 100;

export function listReplays() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function writeReplays(l) { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* full/private */ } }

// rec: { aDef, bDef, mode, stadium, ball, meta, score:[a,b], scorer, frames:[{ps,b}] }
export function saveReplay(rec) {
  const frames = rec.frames.slice(-MAX_FRAMES).map((f) => ({
    ps: f.ps.map((p) => [r2(p[0]), r2(p[1]), r2(p[2]), r2(p[3]), p[4]]),
    b: [r2(f.b[0]), r2(f.b[1]), r2(f.b[2])],
  }));
  const entry = { ...rec, frames, id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ts: Date.now() };
  const l = listReplays();
  l.unshift(entry);
  while (l.length > CAP) l.pop();
  writeReplays(l);
  return entry;
}

export function deleteReplay(id) { writeReplays(listReplays().filter((r) => r.id !== id)); }
export function clearReplays() { writeReplays([]); }

// --- share: export one replay as a downloadable file, import one back ---------
export function exportReplay(rec) {
  const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const tag = `${rec.aCode || 'A'}-${rec.bCode || 'B'}`.replace(/[^A-Za-z0-9-]/g, '');
  a.href = url; a.download = `bhatball-goal-${tag}-${rec.id || Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importReplay(file) {
  const text = await file.text();
  const rec = JSON.parse(text);
  if (!rec || !Array.isArray(rec.frames) || !rec.aDef || !rec.bDef) throw new Error('not a BhatBall replay');
  // give it a fresh id + persist so it shows up in the shelf
  return saveReplay({ ...rec, imported: true });
}

export function replayLabel(rec) {
  const a = rec.aCode || rec.aDef?.code || 'A';
  const b = rec.bCode || rec.bDef?.code || 'B';
  const sc = rec.score ? `${rec.score[0]}–${rec.score[1]}` : '';
  return `${a} ${sc} ${b}`.trim();
}
