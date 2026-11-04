// Kitewind smoke test: boots the production build in headless Chromium (SwiftShader), drives the sim with
// fixed-step window.__game.simulate() calls (SwiftShader renders ~1 fps), captures screenshots of every screen
// and fails on console errors or broken flow.
// Usage: npm run build && node tools/smoke.mjs [outDir]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? join(here, '..', 'smoke-out'));
mkdirSync(outDir, { recursive: true });
const dist = resolve(process.env.DIST ?? join(here, '..', 'dist'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = join(dist, url === '/' ? 'index.html' : url);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const W = Number(process.env.SMOKE_W) || 1280, H = Number(process.env.SMOKE_H) || 720;
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(Number(process.env.SMOKE_TIMEOUT_MS) || 180_000);
const errors = [];
const failures = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const settle = (ms = 400) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))).then(() => page.waitForTimeout(ms));
const shot = async (name) => { await settle(); await page.screenshot({ path: join(outDir, name) }); console.log('shot', name); };
const g = (fn, arg) => page.evaluate(fn, arg);

await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!window.__game, null, { timeout: 120_000 });
// menu: fly the attract run a little so the kite is out over the islands
await g(() => { const G = window.__game; G.manual = true; G.simulate(4); G.renderFrame(1 / 60); });
await shot('kw-01-menu.png');
if (!(await g(() => !!document.querySelector('.screen-menu.visible [data-act=play]')))) failures.push('menu not visible');

// start a deterministic run via the real button, then pin the seed
await page.click('[data-act=play]');
await g(() => { const G = window.__game; G.startRun({ seed: 1234567 }); G.simulate(3.2, 'auto'); });
if ((await g(() => window.__game.state)) !== 'playing') failures.push('run did not start');
await shot('kw-02-flight-early.png');

// ring chain: fly until a combo of 4+ with a ring just ahead
const chain = await g(() => {
  const G = window.__game;
  G.run.shields = 99;
  for (let i = 0; i < 400; i++) {
    G.simulate(0.1, 'auto', true);
    const r = G.run;
    if (r.scoring.combo >= 4) {
      const f = r.flight;
      const ahead = r.world.active.some((c) => c.rings.some((x) => !x.passed && !x.missed && x.z > f.z + 12 && x.z < f.z + 45));
      if (ahead) break;
    }
  }
  G.renderFrame(1 / 60);
  return { combo: G.run.scoring.combo, dist: Math.round(G.run.distance), score: Math.round(G.run.scoring.score) };
});
console.log('chain', JSON.stringify(chain));
if (chain.combo < 3) failures.push('ring chain did not build: ' + JSON.stringify(chain));
await shot('kw-03-ring-chain.png');

// wind shrine approach (~650 m): the gate ~35 m ahead
await g(() => {
  const G = window.__game;
  for (let i = 0; i < 600 && G.state === 'playing' && G.run.distance < 650 - 38; i++) G.simulate(0.05, 'auto', false);
  G.renderFrame(1 / 60);
});
await shot('kw-04a-shrine.png');

// boon pick at the first wind shrine (~650 m)
const boon = await g(() => {
  const G = window.__game;
  for (let i = 0; i < 600 && G.state === 'playing'; i++) G.simulate(0.1, 'auto', false);
  G.renderFrame(1 / 60);
  return { state: G.state, dist: Math.round(G.run.distance), offer: G.boonOffer };
});
console.log('boon', JSON.stringify(boon));
if (boon.state !== 'boon') failures.push('no boon pick at the shrine: ' + JSON.stringify(boon));
await page.waitForTimeout(700); // card fly-in animation
await shot('kw-04-boon-pick.png');
if (boon.state === 'boon') {
  await page.click('.boon-card[data-id]');
  if ((await g(() => window.__game.state)) !== 'playing') failures.push('boon click did not resume');
}

// hazard section: Lantern Dusk (1500 m+), stop with spires/lightning or thunderclouds just ahead
const haz = await g(() => {
  const G = window.__game;
  G.run.shields = 99;
  let found = '';
  for (let i = 0; i < 2000 && !found; i++) {
    if (G.state === 'boon') G.chooseBoon(0);
    G.simulate(0.1, 'auto', true);
    const f = G.run.flight;
    if (f.z < 1550) continue;
    for (const c of G.run.world.active) {
      if (c.lightning.some((l) => l.az > f.z + 22 && l.az < f.z + 50 && l.state >= 1)) found = 'lightning';
      else if (c.thunderclouds.some((t) => t.z > f.z + 20 && t.z < f.z + 50)) found = 'thundercloud';
    }
  }
  G.renderFrame(1 / 60);
  return { found, dist: Math.round(G.run.distance), biome: G.run.biomeIndex, state: G.state };
});
console.log('hazard', JSON.stringify(haz));
if (!haz.found) failures.push('no hazard section found: ' + JSON.stringify(haz));
await shot('kw-05-hazard.png');

if (process.env.SMOKE_QUICK) {
  await browser.close();
  server.close();
  if (errors.length || failures.length) { console.error(errors.join('\n'), failures.join('\n')); process.exit(1); }
  console.log('smoke (quick) OK ->', outDir);
  process.exit(0);
}

// aurora + storm biomes (art review)
for (const [name, target] of [['kw-06-aurora.png', 3350], ['kw-07-storm.png', 4800]]) {
  const r = await g((target) => {
    const G = window.__game;
    G.run.shields = 99;
    for (let i = 0; i < 4000 && G.run.distance < target; i++) {
      if (G.state === 'boon') G.chooseBoon(0);
      if (G.state !== 'playing') break;
      G.simulate(0.1, 'auto', true);
    }
    G.renderFrame(1 / 60);
    return { dist: Math.round(G.run.distance), biome: G.run.biomeIndex, state: G.state };
  }, target);
  console.log(name, JSON.stringify(r));
  await shot(name);
}

// pause screen
await g(() => { const G = window.__game; if (G.state === 'boon') G.chooseBoon(0); G.pause(); });
await page.waitForTimeout(500);
if ((await g(() => window.__game.state)) !== 'paused') failures.push('pause failed');
await shot('kw-08-pause.png');
await page.click('.screen-pause [data-act=resume]');

// results: crash into the sea for real (shields off)
const res = await g(() => {
  const G = window.__game;
  G.run.shields = 0;
  G.run.invuln = 0;
  G.simulate(12, { steerX: 0, steerY: -1, dive: true });
  G.simulate(2, 'auto');
  return { state: G.state, cause: G.run.ended, glimmers: G.save.glimmers };
});
console.log('results', JSON.stringify(res));
if (res.state !== 'results') failures.push('crash did not reach results: ' + JSON.stringify(res));
await page.waitForTimeout(500);
await shot('kw-09-results.png');

// shop (kites + upgrades) via the real buttons
await page.click('.screen-results [data-act=shop]');
await page.waitForTimeout(400);
await page.click('.screen-shop [data-act=tab][data-id=kites]');
await page.waitForTimeout(400);
await shot('kw-10-shop-kites.png');
const bought = await g(() => {
  const G = window.__game;
  const btn = document.querySelector('.screen-shop [data-act=buyKite]:not([disabled])');
  if (btn) btn.click();
  return { kites: G.save.kites.slice(), glimmers: G.save.glimmers };
});
console.log('shop', JSON.stringify(bought));
await page.click('.screen-shop [data-act=tab][data-id=upgrades]');
await page.waitForTimeout(400);
await shot('kw-11-shop-upgrades.png');
await page.click('.screen-shop [data-act=back]');
await page.waitForTimeout(300);
await page.click('.screen-menu [data-act=settings]');
await page.waitForTimeout(400);
await shot('kw-12-settings.png');
await page.click('.screen-settings [data-act=settingsBack]');
await page.waitForTimeout(300);
if ((await g(() => window.__game.state)) !== 'menu') failures.push('did not return to the menu');
const saved = await g(() => JSON.parse(localStorage.getItem('kitewind-save-v1') || 'null'));
if (!saved || saved.runs < 1) failures.push('save not written after the run');

if (process.env.SMOKE_PORTRAIT !== '0') {
  await page.close();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const tp = await ctx.newPage();
  tp.on('pageerror', (e) => errors.push('[portrait] ' + String(e)));
  await tp.goto(`http://localhost:${port}/`);
  await tp.waitForFunction(() => !!window.__game, null, { timeout: 120_000 });
  await tp.tap('[data-act=play]');
  await tp.evaluate(() => { const G = window.__game; G.manual = true; G.startRun({ seed: 99 }); G.simulate(6, 'auto'); });
  await tp.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await tp.waitForTimeout(400);
  await tp.screenshot({ path: join(outDir, 'kw-13-portrait.png') });
  console.log('shot kw-13-portrait.png');
  await ctx.close();
}

await browser.close();
server.close();
if (errors.length || failures.length) {
  if (errors.length) console.error('CONSOLE ERRORS:\n' + errors.join('\n'));
  if (failures.length) console.error('SMOKE FAILURES:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('smoke OK ->', outDir);
