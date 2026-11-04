// Shared helpers for the browser QA tools (tools/smoke.mjs, tools/playtest-bot.mjs, tools/perf.mjs).
// Static file server for a Vite build + headless Chromium launcher (SwiftShader WebGL2 when no GPU).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const require = createRequire(import.meta.url);

export function loadChromium() {
  const candidates = ['playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright'];
  for (const c of candidates) {
    try {
      return require(c).chromium;
    } catch {
      /* try next */
    }
  }
  throw new Error('Playwright not found. Install with: npm i -D playwright@1.49.1 && npx playwright install chromium');
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.ktx2': 'image/ktx2',
};

/** Serves `dist` on a random localhost port. Returns { url, close }. */
export async function serveDist(distDir) {
  const dist = resolve(distDir);
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`No build at ${dist} (index.html missing). Build first: npx vite build --outDir ${dist}`);
  }
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const file = normalize(join(dist, url === '/' ? 'index.html' : url));
    if (!file.startsWith(dist)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) };
}

/** Headless Chromium with a software WebGL2 fallback (SwiftShader). Set QA_GPU=1 to use the real GPU. */
export async function launchBrowser() {
  const chromium = loadChromium();
  const args = process.env.QA_GPU
    ? ['--ignore-gpu-blocklist', '--enable-gpu']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  // keep rAF running at full speed in a background/headless tab
  args.push('--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows');
  return chromium.launch({ args });
}

/** Seeds localStorage with a save before the game boots (fresh profile per page). */
export function saveInitScript(save) {
  return `try { localStorage.setItem('last-lantern-save-v1', ${JSON.stringify(JSON.stringify(save))}); } catch {}`;
}

/** Minimal save matching src/core/Save.ts defaultSave(), with QA-friendly settings. */
export function qaSave(overrides = {}) {
  return {
    version: 1, ash: 0, totalAsh: 0, bestTime: 0, bestKills: 0, runs: 0, victories: 0, meta: {},
    unlocked: ['char_keeper', 'biome_pines'], selectedCharacter: 'char_keeper', achievements: [], biomesCleared: [],
    settings: { masterVolume: 0, musicVolume: 0, sfxVolume: 0, screenShake: false, damageNumbers: false, quality: 'low', showFps: false },
    ...overrides,
  };
}

/** Tiny `--key value` / `--flag` argv parser. */
export function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[k] = true;
    else {
      out[k] = typeof defaults[k] === 'number' ? Number(next) : next;
      i++;
    }
  }
  return out;
}

/** Waits until window.__game exists (boot + asset load). */
export async function waitForGame(page, timeout = 60_000) {
  await page.waitForFunction(() => !!window.__game, null, { timeout, polling: 250 });
}
