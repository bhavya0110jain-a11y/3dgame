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
// SMOKE_TIMEOUT_MS raises it further when several agents share the CPU (load average > 20 timed out at 180 s).
const STEP_TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS) || 180_000;
page.setDefaultTimeout(STEP_TIMEOUT);
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
  await page.evaluate((dir) => {
    const g = window.__game;
    // Steer the sim directly: Input.update() only runs on real frames, so on a starved ~0.2 fps SwiftShader the D→W
    // key switch below never reached the fast-forward, the bearer ran head-on into a rock and died at 0:34 (S3 QA).
    for (let k = 0; k < 90 && g.state === 'playing'; k++) { g.input.moveX = dir[0]; g.input.moveZ = dir[1]; g.updateRun(1 / 30); g.fx.update(1 / 30); }
    g.renderer.rig.follow(1 / 30, g.player.x, g.player.z, 0, 0, 0, 0, NaN, NaN); g.renderer.rig.snap(g.player.x, g.player.z); // follow() first: snap() alone does not end the menu->run swoop // fast-forward outruns the dt-smoothed camera on ~1 fps SwiftShader
  }, i < 7 ? [1, 0] : [0, -1]);
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
if (!levelShot) console.warn('WARN: no level-up reached during the fast-forward (smoke-04-levelup.png not captured)');
// the red damage vignette decays per RENDERED frame; after seconds of fast-forwarded hits it would tint the whole shot
await page.evaluate(() => { window.__game.debug.timeScale = 1; window.__game.renderer.damagePulse = 0; });
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
  // god mode WITHOUT invuln: invuln > 0.4 blinks the bearer group (and its lantern light) off every other 50 ms
  g.__realDamage = g.player.damage;
  g.player.damage = () => {};
  g.renderer.rig.follow(1 / 30, g.player.x, g.player.z, 0, 0, 0, 0, NaN, NaN); g.renderer.rig.snap(g.player.x, g.player.z); // follow() first: snap() alone does not end the menu->run swoop
});
await page.waitForTimeout(1500);
await page.screenshot({ path: join(outDir, 'smoke-06-combat.png') });
// Boss close-up
await page.evaluate(() => {
  const g = window.__game;
  g.enemies.clear();
  g.enemies.spawn(g.world.biome.bossId, g.player.x, g.player.z - 7);
  // play the 1 s rise-from-the-ground spawn in sim time (SwiftShader frames are too slow to advance it)
  for (let k = 0; k < 45 && g.state === 'playing'; k++) { g.updateRun(1 / 30); g.fx.update(1 / 30); } // fx.update: FX age with the sim (else bursts pile up un-aged: S3 QA smoke-07 white blob)
  g.renderer.rig.follow(1 / 30, g.player.x, g.player.z, 0, 0, 0, 0, NaN, NaN); g.renderer.rig.snap(g.player.x, g.player.z); // follow() first: snap() alone does not end the menu->run swoop
  g.renderer.damagePulse = 0;
});
await page.waitForTimeout(1200);
await page.screenshot({ path: join(outDir, 'smoke-07-boss.png') });
// Reliquary reveal (S2 chest screen): a plain chest, then an evolution chest. Game.openChest runs on 'chest:opened'.
const failures = [];
await page.evaluate(() => { window.__game.enemies.clear(); });
const chestShot = async (name) => {
  await page.evaluate(() => {
    const g = window.__game;
    g.events.emit('chest:opened', {});
    g.chestTimer = 600; // hold the reveal (auto-continue is ~2.8 s of game time) while SwiftShader catches up
  });
  await page.waitForTimeout(3200); // the item fly-out is real-time CSS (~2.3 s for 4 items)
  await settle();
  const st = await page.evaluate(() => ({ state: window.__game.state, mode: window.__game.levelMode, vis: !!document.querySelector('.screen-chest.visible'), evolved: window.__game.lastChest?.evolved }));
  if (st.state !== 'levelup' || st.mode !== 'chest' || !st.vis) failures.push(`${name}: reliquary screen not shown (${JSON.stringify(st)})`);
  await page.screenshot({ path: join(outDir, name) });
  // Continue via the real button (first press may only skip the animation)
  for (let k = 0; k < 3 && (await page.evaluate(() => window.__game.state)) === 'levelup'; k++) {
    await page.click('.screen-chest [data-act=continue]').catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => { const g = window.__game; for (let n = 0; n < 8 && g.state === 'levelup'; n++) (g.levelMode === 'chest' ? g.closeChest() : g.chooseUpgrade(0)); });
  if ((await page.evaluate(() => window.__game.state)) !== 'playing') failures.push(`${name}: Continue did not return to play`);
  return st;
};
await chestShot('smoke-09-chest.png');
// evolution: max out Ember Bolt and own its catalyst (Flint) so rollChest leads with the evolution
await page.evaluate(() => {
  const g = window.__game;
  const w = g.run.weapons.find((x) => x.def.evolvesInto && x.def.evolvesWith);
  if (w) { w.level = w.def.maxLevel; g.run.passives.set(w.def.evolvesWith, Math.max(1, g.run.passives.get(w.def.evolvesWith) ?? 0)); }
});
const evo = await chestShot('smoke-10-chest-evolution.png');
if (!evo.evolved) failures.push('smoke-10: evolution chest did not evolve');
// Bearer model must follow the simulated position (regression: eb9cca8 dropped group.position sync)
const pos = await page.evaluate(() => { const p = window.__game.player; return { x: p.x, z: p.z, gx: p.group.position.x, gz: p.group.position.z }; });
if (Math.hypot(pos.x - pos.gx, pos.z - pos.gz) > 0.05) failures.push(`bearer model not at player position: player (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}) vs group (${pos.gx.toFixed(2)}, ${pos.gz.toFixed(2)})`);
await page.evaluate(() => { const g = window.__game; g.player.damage = g.__realDamage; g.player.invuln = 0; });
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

// Restart from the game-over screen, kill the master, take the dawn choice -> Endless Night -> victory screen.
await page.click('.screen.visible [data-act=again]');
await page.waitForTimeout(800);
if ((await page.evaluate(() => window.__game.state)) !== 'playing') failures.push('gameover: Light Again did not start a new run');
await page.evaluate(() => {
  const g = window.__game;
  g.player.damage = () => {};
  for (let k = 0; k < 60 && g.state === 'playing'; k++) { g.updateRun(1 / 30); g.fx.update(1 / 30); } // fx.update: FX age with the sim (else bursts pile up un-aged: S3 QA smoke-07 white blob)
  g.renderer.rig.follow(1 / 30, g.player.x, g.player.z, 0, 0, 0, 0, NaN, NaN); g.renderer.rig.snap(g.player.x, g.player.z); // follow() first: snap() alone does not end the menu->run swoop
  g.events.emit('boss:killed', { defId: g.world.biome.bossId }); // dawn choice opens 2.2 s (real time) later
});
await page.waitForFunction(() => window.__game.levelMode === 'dawn' && window.__game.state === 'levelup', null, { timeout: 60_000 }).catch(() => failures.push('dawn: choice never opened after boss:killed'));
await page.waitForTimeout(2500); // sunrise animation + 0.9 s input lock
await settle();
if (!(await page.evaluate(() => !!document.querySelector('.screen-dawn.visible .dawn-card[data-i="1"]')))) failures.push('dawn: dawn screen / Endless card not visible');
await page.screenshot({ path: join(outDir, 'smoke-11-dawn.png') });
await page.click('.screen-dawn .dawn-card[data-i="1"]').catch((e) => failures.push('dawn: endless click failed ' + e));
await page.waitForTimeout(700);
const endless = await page.evaluate(() => ({ state: window.__game.state, endless: window.__game.run.endless }));
if (endless.state !== 'playing' || !endless.endless) failures.push('dawn: Endless Night did not continue the run ' + JSON.stringify(endless));
await page.evaluate(() => {
  const g = window.__game;
  for (let k = 0; k < 90 && g.state === 'playing'; k++) { g.updateRun(1 / 30); g.fx.update(1 / 30); } // fx.update: FX age with the sim (else bursts pile up un-aged: S3 QA smoke-07 white blob)
  g.renderer.rig.follow(1 / 30, g.player.x, g.player.z, 0, 0, 0, 0, NaN, NaN); g.renderer.rig.snap(g.player.x, g.player.z); // follow() first: snap() alone does not end the menu->run swoop
});
await settle();
await page.screenshot({ path: join(outDir, 'smoke-12-endless.png') });
await page.evaluate(() => window.__game.endRun(false)); // run.victory is already set -> victory screen
await page.waitForTimeout(600);
await settle();
await page.screenshot({ path: join(outDir, 'smoke-13-victory.png') });
await page.click('.screen.visible [data-act=menu]');
await page.waitForTimeout(800);
if ((await page.evaluate(() => window.__game.state)) !== 'menu') failures.push('victory: Main Menu did not return to the menu');

// Touch + portrait phone: taps must reach menu buttons (regression for BUG-QA-004) and the HUD must fit portrait.
// Set SMOKE_TOUCH=0 to skip (adds ~20 s under SwiftShader).
if (process.env.SMOKE_TOUCH !== '0') {
  await page.close(); // free the main page's render loop before booting a second game instance
  const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const tpage = await tctx.newPage();
  tpage.setDefaultTimeout(STEP_TIMEOUT);
  tpage.on('pageerror', (e) => errors.push('[touch] ' + String(e)));
  await tpage.goto(`http://localhost:${port}/`);
  await tpage.waitForFunction(() => !!window.__game, null, { timeout: STEP_TIMEOUT });
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
  // fixed-step fast-forward + camera snap: a timeScale wait covers ~0 s of game time at SwiftShader's ~1 fps and
  // left the shot on the first frame of the menu -> run camera swoop (00:00, hero framing)
  await tpage.evaluate(() => {
    const g = window.__game;
    for (let k = 0; k < 90 && g.state === 'playing'; k++) { g.updateRun(1 / 30); g.fx.update(1 / 30); } // fx.update: FX age with the sim (else bursts pile up un-aged: S3 QA smoke-07 white blob)
    g.renderer.rig.follow(1 / 30, g.player.x, g.player.z, 0, 0, 0, 0, NaN, NaN); g.renderer.rig.snap(g.player.x, g.player.z); // follow() first: snap() alone does not end the menu->run swoop
  });
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
