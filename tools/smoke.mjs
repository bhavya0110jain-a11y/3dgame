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
const dist = resolve('dist');
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
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://localhost:${port}/`);
await page.waitForTimeout(2500);
await page.screenshot({ path: join(outDir, 'smoke-01-menu.png') });

await page.click('[data-act=play]');
await page.waitForTimeout(500);
await page.screenshot({ path: join(outDir, 'smoke-02-setup.png') });
await page.click('[data-act=start]');
await page.waitForTimeout(1000);

// Hold movement and fast-forward the simulation; auto-pick level-ups.
await page.keyboard.down('KeyD');
for (let i = 0; i < 14; i++) {
  await page.evaluate(() => { const g = window.__game; g.debug.timeScale = 3; });
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => window.__game.state);
  if (state === 'levelup') {
    if (i === 3) await page.screenshot({ path: join(outDir, 'smoke-04-levelup.png') });
    await page.keyboard.press('Digit1');
  }
  if (i === 6) { await page.keyboard.up('KeyD'); await page.keyboard.down('KeyW'); }
  if (state === 'gameover') break;
}
await page.evaluate(() => { window.__game.debug.timeScale = 1; });
await page.waitForTimeout(400);
await page.screenshot({ path: join(outDir, 'smoke-03-gameplay.png') });
const summary = await page.evaluate(() => {
  const g = window.__game;
  return { state: g.state, elapsed: g.run.elapsed.toFixed(1), level: g.run.level, kills: g.run.kills, enemies: g.enemies.activeCount, weapons: g.run.weapons.map((w) => w.def.id + ':' + w.level), light: Math.round(g.player.lightValue) };
});
console.log('summary', JSON.stringify(summary));

// Force a game over to capture that screen.
await page.evaluate(() => window.__game.endRun(false));
await page.waitForTimeout(600);
await page.screenshot({ path: join(outDir, 'smoke-05-gameover.png') });

await browser.close();
server.close();
if (errors.length) {
  console.error('CONSOLE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('smoke OK ->', outDir);
