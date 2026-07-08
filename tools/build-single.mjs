// Build a single self-contained bhatball.html: inline peerjs + the esbuild
// bundle, drop the importmap + module <script src>. Run AFTER esbuild writes
// /tmp/bhatball-bundle.js (see the npm-free command in dist notes).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const peerjs = fs.readFileSync(path.join(ROOT, 'vendor/peerjs.min.js'), 'utf8');
const bundle = fs.readFileSync('/tmp/bhatball-bundle.js', 'utf8');

// NOTE: use function replacers everywhere. peerjs/three are minified and contain
// `$`-sequences (`$&`, `` $` ``, `$'`) that String.replace treats as special
// patterns when the replacement is a STRING — which silently corrupts the output.
// A function's return value is inserted literally.
let out = html
  // inline peerjs (classic script, sets window.Peer)
  .replace('<script src="./vendor/peerjs.min.js"></script>', () => `<script>${peerjs}</script>`)
  // the importmap is only needed for the module version — drop it
  .replace(/<script type="importmap">[\s\S]*?<\/script>/, () => '')
  // swap the module entry for the inlined IIFE bundle
  .replace('<script type="module" src="./src/main.js"></script>', () => `<script>${bundle}</script>`);

const dest = path.join(ROOT, 'dist/BhatBall/bhatball.html');
fs.writeFileSync(dest, out);
console.log(`wrote ${dest} (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
