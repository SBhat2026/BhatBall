// Real-browser smoke: menu, kits, throw-in set piece, goal replay + Enter skip,
// scoreline mood, and the World Cup overlay. Run with a local server up:
//   python3 -m http.server 8009 &   then   node tools/smoke.mjs [url]
import { chromium } from '/Users/siddhantbhat/bhatbot/node_modules/playwright/index.mjs';

const URL = process.argv[2] || 'http://localhost:8009';
let failures = 0;
const ok = (cond, name) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// --- menu ---------------------------------------------------------------------
await page.goto(URL);
await page.waitForTimeout(800);
ok(await page.locator('#gridA .chip').count() === 17, 'menu: 17 teams (Cabo Verde in)');
ok((await page.locator('#gridA .chip').allTextContents()).some((t) => t.includes('CPV')), 'menu: CPV chip present');
const lens = await page.locator('#lens .chip').allTextContents();
ok(lens.length === 3 && lens[0].includes('5') && lens[1].includes('10') && lens[2].includes('15'),
  `menu: lengths are 5/10/15 (${lens.join(', ')})`);

// --- world cup overlay ----------------------------------------------------------
await page.click('#btnWC');
await page.waitForTimeout(400);
ok(!(await page.locator('#wcOverlay').evaluate((el) => el.classList.contains('hidden'))), 'wc: overlay opens');
ok((await page.locator('#wcView').innerHTML()).includes('GROUP A'), 'wc: group tables render');
ok((await page.locator('#wcSub').textContent()).includes('Matchday 1'), 'wc: matchday 1 fixture ready');
await page.click('#btnWCBack');
await page.evaluate(() => localStorage.removeItem('pp-wc'));

// --- match: kits, throw-in, replay, mood ---------------------------------------
await page.goto(URL + '/?autostart');
await page.waitForTimeout(1500);
ok(await page.evaluate(() => !!window.pp.game?.match), 'match: autostarted');
ok(await page.evaluate(() => window.pp.game.match.halves === 1), 'match: 5-min game has no half-time');
ok(await page.evaluate(() => {
  const m = window.pp.game.match;
  return !!m.teamA.kit?.shirt && !!m.teamB.kit?.shirt && m.teamA.kit.shirt !== m.teamB.kit.shirt;
}), 'match: kits resolved, no clash');

// force the ball over the sideline → throw-in set piece
await page.evaluate(() => {
  const m = window.pp.game.match;
  m.state = 'PLAY';
  m.ball.owner = null; m.ball.heldBy = null;
  m.ball.pos.set(5, 0.2, 40);
});
await page.waitForTimeout(400);
const spKind = await page.evaluate(() => window.pp.game.match.setPiece?.kind);
ok(spKind === 'throwin', `throw-in: set piece entered (${spKind})`);
ok(await page.evaluate(() => window.pp.game.match.setPiece?.taker.rig.holdBall === true),
  'throw-in: taker holds ball overhead');
// if the human is the taker, press J (short throw); AI takers release on their own.
// headless rAF can run below 60fps (sim caps dt), so retry until it releases.
let released = false;
for (let i = 0; i < 6 && !released; i++) {
  await page.waitForTimeout(1200);
  await page.keyboard.press('j');
  await page.waitForTimeout(400);
  released = await page.evaluate(() => window.pp.game.match.state === 'PLAY' && !window.pp.game.match.setPiece);
}
ok(released, 'throw-in: released, play resumed');

// force a goal (inside the mouth, out of the keeper's reach) → replay
await page.evaluate(() => {
  const m = window.pp.game.match;
  m.state = 'PLAY';
  m.setPiece = null;
  m.ball.owner = null; m.ball.heldBy = null;
  m.ball.vel.set(20, 0, 0);
  m.ball.pos.set(52.75, 0.5, 2.5);
});
await page.waitForTimeout(3500); // goal + 1.05 sim-sec replay delay (headless runs slow)
ok(await page.evaluate(() => !!window.pp.game.replay), 'replay: started after goal');
ok(!(await page.locator('#replayChip').evaluate((el) => el.classList.contains('hidden'))), 'replay: chip visible');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
ok(await page.evaluate(() => !window.pp.game.replay), 'replay: Enter skips');
ok(await page.locator('#replayChip').evaluate((el) => el.classList.contains('hidden')), 'replay: chip hidden again');

// scoreline mood: put team A 2 down late and let the 3s mood clock tick
await page.evaluate(() => {
  const g = window.pp.game;
  const m = g.match;
  g.replayIn = null;
  m.ball.reset(0, 0);   // pull the ball out of the net so PLAY doesn't re-score
  m.state = 'PLAY';     // skip the rest of the goal celebration
  m.scoreB = m.scoreA + 2;
  m.elapsed = m.halfLen * 1.6;
});
for (let i = 0; i < 16; i++) { // poll: headless sim runs below real time
  await page.waitForTimeout(1000);
  if (await page.evaluate(() => window.pp.game.match.teamA.mood > 0)) break;
}
const mood = await page.evaluate(() => {
  const t = window.pp.game.match.teamA;
  return { mood: t.mood, risk: t.style.risk, baseRisk: t.baseStyle.risk, regime: t.moodRegime };
});
ok(mood.mood > 0.3 && mood.risk > mood.baseRisk, `mood: losing side chasing (mood ${mood.mood?.toFixed(2)}, risk ${mood.baseRisk?.toFixed(2)}→${mood.risk?.toFixed(2)})`);
const moodB = await page.evaluate(() => {
  const t = window.pp.game.match.teamB;
  return { mood: t.mood, line: t.style.line, baseLine: t.baseStyle.line };
});
ok(moodB.mood < -0.15 && moodB.line < moodB.baseLine, `mood: leading side protecting (mood ${moodB.mood?.toFixed(2)}, line ${moodB.baseLine?.toFixed(2)}→${moodB.line?.toFixed(2)})`);

// let it run a few more seconds for stability
await page.waitForTimeout(4000);
ok(await page.evaluate(() => {
  const m = window.pp.game.match;
  return Number.isFinite(m.ball.pos.x) && m.teamA.players.every((p) => Number.isFinite(p.pos.x));
}), 'stability: no NaN after forced chaos');

ok(errors.length === 0, `console: zero errors${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);

await browser.close();
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
process.exit(failures ? 1 : 0);
