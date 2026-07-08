#!/usr/bin/env bash
# Build the offline distribution (for locked-down machines that can't reach
# GitHub Pages or use git): a slim runnable folder, a zip of it, and a single
# double-click bhatball.html. Output lands in dist/. Needs Node + npx (esbuild
# is fetched on demand). Nothing here is committed — it's regenerated on demand.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

echo "› assembling slim folder (index.html + src + vendor, trimmed jsm)…"
rm -rf dist
mkdir -p dist/BhatBall
cp -R index.html src vendor dist/BhatBall/

# The full three addons (vendor/jsm) are 13MB; the game only pulls a handful.
# Keep just the postprocessing chain that main.js imports (+ transitive deps).
rm -rf dist/BhatBall/vendor/jsm
mkdir -p dist/BhatBall/vendor/jsm/postprocessing dist/BhatBall/vendor/jsm/shaders
for f in postprocessing/EffectComposer postprocessing/RenderPass postprocessing/UnrealBloomPass \
         postprocessing/OutputPass postprocessing/MaskPass postprocessing/ShaderPass postprocessing/Pass \
         shaders/CopyShader shaders/LuminosityHighPassShader shaders/OutputShader; do
  cp "vendor/jsm/$f.js" "dist/BhatBall/vendor/jsm/$f.js"
done

echo "› writing HOW-TO-PLAY.md…"
# (kept in git as tools/dist-readme.md so edits are tracked)
cp tools/dist-readme.md dist/BhatBall/HOW-TO-PLAY.md

echo "› bundling single-file bhatball.html (esbuild)…"
npx --yes esbuild src/main.js \
  --bundle --format=iife --minify \
  --alias:three="$ROOT/vendor/three.module.js" \
  --alias:three/addons/postprocessing/EffectComposer.js="$ROOT/vendor/jsm/postprocessing/EffectComposer.js" \
  --alias:three/addons/postprocessing/RenderPass.js="$ROOT/vendor/jsm/postprocessing/RenderPass.js" \
  --alias:three/addons/postprocessing/UnrealBloomPass.js="$ROOT/vendor/jsm/postprocessing/UnrealBloomPass.js" \
  --alias:three/addons/postprocessing/OutputPass.js="$ROOT/vendor/jsm/postprocessing/OutputPass.js" \
  --outfile=/tmp/bhatball-bundle.js
node tools/build-single.mjs

echo "› zipping for Google Drive / USB…"
( cd dist && zip -rq BhatBall-offline.zip BhatBall -x '*.DS_Store' )

echo ""
echo "✅ dist/ built:"
echo "   dist/BhatBall/              → run: cd dist/BhatBall && python3 -m http.server 8000"
echo "   dist/BhatBall/bhatball.html → double-click to play"
echo "   dist/BhatBall-offline.zip   → upload to Google Drive ($(du -h dist/BhatBall-offline.zip | cut -f1))"
