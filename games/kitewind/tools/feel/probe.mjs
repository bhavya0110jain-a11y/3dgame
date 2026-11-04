// Feel probe: screenshots the moments the feel pass cares about — cruise, full dive (FOV kick, speed lines,
// 3-D wind streaks), a ring pass (burst + shockwave + FOV punch), a whisker (slow-mo zoom) and a crash (dying cam).
// Usage: npm run build && node tools/feel/probe.mjs [outDir]
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
const outDir = resolve(process.argv[2] ?? join(here, '..', '..', 'feel-out'));
mkdirSync(outDir, { recursive: true });
const dist = resolve(join(here, '..', '..', 'dist'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = join(dist, url === '/' ? 'index.html' : url);
  try { const b = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240_000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const g = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await page.screenshot({ path: join(outDir, name) });
  console.log('shot', name);
};
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!window.__game, null, { timeout: 120_000 });

// settle the camera: n real-time camera frames without stepping the sim
await g(() => {
  window.__cam = (n, dt = 1 / 60) => { const G = window.__game; for (let i = 0; i < n; i++) { G.updateCamera(dt); G.fx.update(dt * 0.25); } G.renderFrame(0); };
});
await g(() => { const G = window.__game; G.manual = true; G.startRun({ seed: 1234567 }); G.run.invuln = 99; G.simulate(4, 'auto'); window.__cam(40); });
await shot('feel-01-cruise.png');
const cruise = await g(() => ({ fov: window.__game.renderer.camera.fov, speed: window.__game.run.flight.airspeed }));

await g(() => { const G = window.__game; G.run.flight.y = 85; G.simulate(1.6, { steerX: 0.35, steerY: 0, dive: true }); window.__cam(60); });
await shot('feel-02-dive.png');
const dive = await g(() => ({ fov: window.__game.renderer.camera.fov, speed: window.__game.run.flight.airspeed, roll: window.__game.renderer.camera.rotation.z }));

// ring pass: fly until a ring is passed, then show the burst / shockwave a few frames later
const ring = await g(() => {
  const G = window.__game;
  let hit = null;
  const off = G.events.on('ring:passed', (p) => { hit = p; });
  for (let i = 0; i < 600 && !hit; i++) G.simulate(1 / 60, 'auto');
  off();
  for (let i = 0; i < 9; i++) { G.updateCamera(1 / 60); G.fx.update(1 / 60); }
  G.renderFrame(0);
  return hit;
});
await shot('feel-03-ring-pass.png');

// whisker: emit the event and hold the slow-mo time scale so the zoom + flash + shockwave read
await g(() => {
  const G = window.__game;
  G.events.emit('whisker', { x: 0, y: 0, z: 0, points: 250 });
  G.timeScale = 0.3;
  for (let i = 0; i < 20; i++) { G.renderFrame(1 / 60); G.updateCamera(1 / 60); G.fx.update(1 / 60 * 0.3); }
  G.timeScale = 0.3;
  G.renderFrame(0);
});
await shot('feel-04-whisker.png');
const wh = await g(() => window.__game.renderer.camera.fov);

// crash: drop the kite onto the sea
await g(() => { const G = window.__game; G.timeScale = 1; G.run.invuln = 0; G.run.shields = 0; G.run.flight.y = 7; for (let i = 0; i < 90 && G.state === 'playing'; i++) G.simulate(1 / 60, { steerX: 0, steerY: -1, dive: true }); G.simulate(0.3, 'auto'); for (let i = 0; i < 25; i++) { G.updateCamera(1 / 60); G.fx.update(1 / 60); } G.renderFrame(0); });
await shot('feel-05-crash.png');
const st = await g(() => window.__game.state);

console.log(JSON.stringify({ cruise, dive, ringPassed: !!ring, whiskerFov: wh, stateAfterCrash: st }));
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no page errors');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
