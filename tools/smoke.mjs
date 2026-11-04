// Smoke test: boots the production build in headless Chromium, starts a run,
// fast-forwards gameplay, captures screenshots and fails on console errors.
// Usage: node tools/smoke.mjs [outDir]   (expects `npm run build` first)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const outDir = resolve(process.argv[2] ?? 'production/qa/evidence');
mkdirSync(outDir, { recursive: true });
const dist = resolve(process.env.DIST ?? 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.json': 'application/json', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// SwiftShader frames can take seconds on a loaded machine; screenshots wait for a frame, so be generous.
page.setDefaultTimeout(180_000);
/** Waits for 3 rendered frames + a beat so CSS screen-in animations have actually played (SwiftShader can be ~1 fps). */
const settle = (p = page, ms = 500) =>
  p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r())))))
    .then(() => p.waitForTimeout(ms));
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://localhost:${port}/`);
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, 'smoke-01-menu.png') });

await page.click('[data-act=play]');
await page.waitForTimeout(500);
await settle();
await page.screenshot({ path: join(outDir, 'smoke-02-setup.png') });
await page.click('[data-act=start]');
await page.waitForTimeout(1000);

// Hold movement and fast-forward the simulation; auto-pick level-ups.
// Fast-forward = fixed 1/30 s steps through Game.updateRun (the same call the real loop makes while playing), so the
// amount of game time covered does not depend on how slow SwiftShader frames are on a loaded machine.
await page.keyboard.down('KeyD');
let levelShot = false;
for (let i = 0; i < 14; i++) {
  await page.evaluate(() => {
    const g = window.__game;
    for (let k = 0; k < 45 && g.state === 'playing'; k++) g.updateRun(1 / 30);
  });
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => window.__game.state);
  if (state === 'levelup') {
    if (!levelShot && (await page.evaluate(() => window.__game.levelMode)) === 'levelup') {
      await settle();
      await page.screenshot({ path: join(outDir, 'smoke-04-levelup.png') });
      levelShot = true;
    }
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(400);
    // reliquary / extra level-ups: keep the run moving
    await page.evaluate(() => {
      const g = window.__game;
      for (let n = 0; n < 8 && g.state === 'levelup'; n++) (g.levelMode === 'chest' ? g.closeChest() : g.chooseUpgrade(0));
    });
  }
  if (i === 6) { await page.keyboard.up('KeyD'); await page.keyboard.down('KeyW'); }
  if (state === 'gameover') break;
}
await page.keyboard.up('KeyW');
await page.evaluate(() => { window.__game.debug.timeScale = 1; });
await page.waitForTimeout(400);
await page.screenshot({ path: join(outDir, 'smoke-03-gameplay.png') });

// Dense combat: spawn a crowd of every enemy type around the player + give extra weapons.
await page.evaluate(() => {
  const g = window.__game;
  const ids = ['shade', 'crawler', 'wisp', 'brute', 'stalker', 'spitter', 'bog_lurker', 'knight'];
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2 * 3;
    const r = 4 + (i % 10);
    g.enemies.spawn(ids[i % ids.length], g.player.x + Math.cos(a) * r, g.player.z + Math.sin(a) * r);
  }
  for (const id of ['cinder_halo', 'spark_chain', 'brazier']) {
    if (!g.run.weapons.some((w) => w.def.id === id)) {
      const def = (window.__weapons ?? []).find?.((w) => w.id === id);
      if (def) g.run.weapons.push(def.create(g));
    }
  }
  g.player.invuln = 999;
});
await page.waitForTimeout(1500);
await page.screenshot({ path: join(outDir, 'smoke-06-combat.png') });
// Boss close-up
await page.evaluate(() => {
  const g = window.__game;
  g.enemies.clear();
  g.enemies.spawn(g.world.biome.bossId, g.player.x, g.player.z - 7);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: join(outDir, 'smoke-07-boss.png') });
await page.evaluate(() => { window.__game.player.invuln = 0; });
const summary = await page.evaluate(() => {
  const g = window.__game;
  return { state: g.state, elapsed: g.run.elapsed.toFixed(1), level: g.run.level, kills: g.run.kills, enemies: g.enemies.activeCount, weapons: g.run.weapons.map((w) => w.def.id + ':' + w.level), light: Math.round(g.player.lightValue) };
});
console.log('summary', JSON.stringify(summary));

// Force a game over to capture that screen.
await page.evaluate(() => window.__game.endRun(false));
await page.waitForTimeout(600);
await settle();
await page.screenshot({ path: join(outDir, 'smoke-05-gameover.png') });

// Touch + portrait phone: taps must reach menu buttons (regression for BUG-QA-004) and the HUD must fit portrait.
// Set SMOKE_TOUCH=0 to skip (adds ~20 s under SwiftShader).
const failures = [];
if (process.env.SMOKE_TOUCH !== '0') {
  await page.close(); // free the main page's render loop before booting a second game instance
  const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const tpage = await tctx.newPage();
  tpage.setDefaultTimeout(180_000);
  tpage.on('pageerror', (e) => errors.push('[touch] ' + String(e)));
  await tpage.goto(`http://localhost:${port}/`);
  await tpage.waitForFunction(() => !!window.__game, null, { timeout: 180_000 });
  await tpage.waitForSelector('.screen-menu.visible [data-act=play]', { state: 'visible' });
  await settle(tpage);
  await tpage.tap('[data-act=play]');
  await tpage.waitForTimeout(600);
  const setupVisible = await tpage.evaluate(() => !!document.querySelector('.screen-setup.visible'));
  if (!setupVisible) failures.push('touch: tapping Play did not open the setup screen');
  if (setupVisible) {
    await tpage.tap('[data-act=start]');
    await tpage.waitForTimeout(800);
  }
  if ((await tpage.evaluate(() => window.__game.state)) !== 'playing') {
    failures.push('touch: tapping Start did not start a run');
    await tpage.evaluate(() => window.__game.startRun());
  }
  await tpage.evaluate(() => { window.__game.debug.timeScale = 3; });
  await tpage.waitForTimeout(1500);
  await tpage.evaluate(() => { window.__game.debug.timeScale = 1; });
  await settle(tpage);
  await tpage.screenshot({ path: join(outDir, 'smoke-08-portrait.png') });
  await tctx.close();
}

await browser.close();
server.close();
if (errors.length || failures.length) {
  if (errors.length) console.error('CONSOLE ERRORS:\n' + errors.join('\n'));
  if (failures.length) console.error('SMOKE FAILURES:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('smoke OK ->', outDir);
