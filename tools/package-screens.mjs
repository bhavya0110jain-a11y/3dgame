// Captures the store screenshot set (docs/store/press-kit.md §6) from a production build, so every store
// refresh uses the same moments. Run it on a machine with a real GPU for final art. Under SwiftShader it
// works but is slow and the frame pacing looks off.
//
//   node tools/package-screens.mjs [outDir=release/screens] [--dist dist] [--res 1920x1080] [--clean] [--only 3,5]
//
//   --clean   hide the DOM UI/HUD (for key-art plates and the library hero). Default: HUD visible, as Steam
//             wants real gameplay screenshots.
//   --only    capture only these shot numbers
//
// Uses the debug hooks exposed by src/main.ts (window.__game, window.__weapons). If a hook is renamed, the
// affected shot logs a warning and the rest still run.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const optVals = new Set(['--dist', '--res', '--only'].map((f) => opt(f, null)).filter(Boolean));
const outDir = resolve(root, args.find((a) => !a.startsWith('--') && !optVals.has(a)) ?? 'release/screens');
const dist = resolve(root, opt('--dist', process.env.DIST ?? 'dist'));
const [W, H] = opt('--res', '1920x1080').split('x').map(Number);
const clean = args.includes('--clean');
const only = opt('--only', null)?.split(',').map(Number);
mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.json': 'application/json', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = url === '/' ? 'index.html' : url;
  try {
    const body = readFileSync(join(dist, file));
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(240_000);
const wait = (ms) => page.waitForTimeout(ms);
const g = (fn, arg) => page.evaluate(fn, arg);

async function boot(biome = 'biome_pines') {
  await page.goto(`http://localhost:${port}/`);
  await page.waitForFunction(() => !!window.__game);
  await g(() => { const s = window.__game.save.settings; s.quality = 'high'; s.damageNumbers = true; window.__game.applySettings(); });
  await g((b) => { window.__game.selectedBiome = b; }, biome);
  await wait(1500);
}
async function startRun(biome) {
  await boot(biome);
  await g(() => window.__game.startRun());
  await wait(800);
}
/** Fast-forward the run, auto-picking the first level-up offer, keeping the bearer alive. */
async function play(seconds, moveKey = 'KeyD') {
  await page.keyboard.down(moveKey);
  const steps = Math.ceil(seconds / 2);
  for (let i = 0; i < steps; i++) {
    await g(() => { const gm = window.__game; gm.debug.timeScale = 4; gm.player.invuln = 999; });
    await wait(500);
    if ((await g(() => window.__game.state)) === 'levelup') await g(() => window.__game.chooseUpgrade(0));
  }
  await page.keyboard.up(moveKey);
  await g(() => { window.__game.debug.timeScale = 1; });
}
async function give(ids) {
  await g((list) => {
    const gm = window.__game;
    for (const id of list) {
      if (gm.run.weapons.some((w) => w.def.id === id)) continue;
      const def = (window.__weapons ?? []).find?.((w) => w.id === id);
      if (def) gm.run.weapons.push(def.create(gm));
    }
  }, ids);
}
async function ring(count, ids, rMin = 5, rSpread = 12) {
  await g(({ count, ids, rMin, rSpread }) => {
    const gm = window.__game;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 * 5 + Math.random() * 0.3;
      const r = rMin + Math.random() * rSpread;
      gm.enemies.spawn(ids[i % ids.length], gm.player.x + Math.cos(a) * r, gm.player.z + Math.sin(a) * r);
    }
  }, { count, ids, rMin, rSpread });
}
async function shot(n, name) {
  if (clean) await g(() => { const ui = document.getElementById('ui-root'); if (ui) ui.style.visibility = 'hidden'; });
  await wait(600);
  const file = join(outDir, `${String(n).padStart(2, '0')}-${name}${clean ? '-clean' : ''}.png`);
  await page.screenshot({ path: file });
  console.log('  ✔', file);
}

const SHOTS = [
  [1, 'title', async () => { await boot(); await wait(2500); }],
  [2, 'first-minute-pines', async () => { await startRun('biome_pines'); await play(30); }],
  [3, 'swarm-300', async () => {
    await startRun('biome_pines'); await play(20);
    await give(['cinder_halo', 'spark_chain', 'flare_nova', 'gloam_beam']);
    await ring(300, ['shade', 'crawler', 'wisp', 'stalker', 'gloam_jelly', 'cinder_tick', 'brute']);
    await wait(1800);
  }],
  [4, 'gloom-closing-in', async () => {
    await startRun('biome_pines'); await play(16);
    await ring(120, ['shade', 'wisp', 'crawler', 'stalker'], 7, 10);
    await g(() => { const p = window.__game.player; p.lightValue = window.__game.run.stats.maxLight * 0.18; });
    await wait(1500);
  }],
  [5, 'level-up-choice', async () => {
    await startRun('biome_pines');
    await page.keyboard.down('KeyD');
    for (let i = 0; i < 40 && (await g(() => window.__game.state)) !== 'levelup'; i++) {
      await g(() => { window.__game.debug.timeScale = 4; window.__game.player.invuln = 999; }); await wait(400);
    }
    await page.keyboard.up('KeyD');
    await g(() => { window.__game.debug.timeScale = 1; });
  }],
  [6, 'boss-hollow-stag', async () => {
    await startRun('biome_pines'); await play(10);
    await give(['spark_chain', 'flare_nova']);
    await g(() => { const gm = window.__game; gm.enemies.spawn(gm.world.biome.bossId, gm.player.x + 2, gm.player.z - 8); });
    await ring(60, ['shade', 'wisp'], 6, 8);
    await wait(1800);
  }],
  [7, 'sunken-marsh', async () => {
    await startRun('biome_marsh'); await play(20, 'KeyW');
    await ring(140, ['bog_lurker', 'gloam_jelly', 'jellyling', 'spitter', 'wisp']);
    await give(['frost_shards', 'moth_lantern']);
    await wait(1500);
  }],
  [8, 'ashen-ruins-king', async () => {
    await startRun('biome_ruins'); await play(20, 'KeyA');
    await give(['brazier', 'vesper_bell', 'cinder_halo']);
    await g(() => { const gm = window.__game; gm.enemies.spawn(gm.world.biome.bossId, gm.player.x - 3, gm.player.z - 9); });
    await ring(120, ['knight', 'cinder_tick', 'hollow_warden', 'shade']);
    await wait(1800);
  }],
  [9, 'hearth', async () => { await boot(); await g(() => { window.__game.save.ash = 2400; window.__game.ui.showHearth(); }); await wait(1200); }],
  [10, 'victory', async () => {
    await startRun('biome_pines'); await play(12);
    await g(() => { const gm = window.__game; gm.run.victory = true; gm.endRun(true); });
    await wait(1000);
  }],
];

console.log(`capturing ${only ? only.join(',') : 'all'} shots at ${W}×${H}${clean ? ' (clean)' : ''} → ${outDir}`);
let failed = 0;
for (const [n, name, setup] of SHOTS) {
  if (only && !only.includes(n)) continue;
  try {
    await setup();
    await shot(n, name);
  } catch (e) {
    failed++;
    console.warn(`  ! shot ${n} (${name}) failed: ${String(e).split('\n')[0]}`);
  }
}
await browser.close();
server.close();
if (failed) process.exitCode = 1;
