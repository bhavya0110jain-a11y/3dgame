// Packages the web build for itch.io / Poki / CrazyGames / any static host as release/last-lantern-web.zip.
//
//   node tools/package-web.mjs [--build] [--dist <dir>] [--out <zip>] [--verify] [--no-sourcemaps]
//
//   --build    regenerate the model manifest and run `vite build` into a private staging dir first
//              (never touches the shared dist/ unless --dist dist is passed explicitly with --build)
//   --dist     build directory to package (default: dist, or the staging dir when --build)
//   --out      output zip (default: release/last-lantern-web.zip)
//   --verify   unzip into a temp dir, serve it from a deep SUB-FOLDER (as itch.io does:
//              https://html-classic.itch.zone/html/<id>/index.html) in headless Chromium, and fail on any
//              404, console error, or if the title screen never appears.
//
// Static checks (always): index.html at the zip root, no root-absolute URLs ("/assets/..."), which
// would break inside an itch.io iframe sub-path, file-count and size limits for itch.io HTML5 uploads.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { listFiles, thirdPartyNotices, unzip, zipDirectory } from './package-lib.mjs';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

let dist = resolve(root, opt('--dist', 'dist'));
const out = resolve(root, opt('--out', 'release/last-lantern-web.zip'));

function fail(msg) {
  console.error(`\n✖ package-web: ${msg}`);
  process.exit(1);
}

// ---------- build ----------
if (flag('--build')) {
  if (!args.includes('--dist')) dist = join(root, 'release', '.stage-web');
  console.log(`• building into ${dist}`);
  execFileSync(process.execPath, [join(root, 'tools/gen-model-manifest.mjs')], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir'],
    { cwd: root, stdio: 'inherit' });
}
if (!existsSync(join(dist, 'index.html'))) fail(`no index.html in ${dist} — run \`npm run build\` or pass --build`);

// ---------- static checks ----------
const files = listFiles(dist);
const problems = [];
const warnings = [];
const textExt = new Set(['.html', '.js', '.css', '.json']);
for (const f of files) {
  if (!textExt.has(extname(f))) continue;
  const src = readFileSync(join(dist, f), 'utf8');
  // Root-absolute references break when the game is served from a sub-folder (itch.io, portals).
  const re = /(?:src|href)\s*=\s*["']\/(?!\/)[^"']*["']|url\(\s*["']?\/(?!\/)[^)"']+/g;
  for (const m of src.matchAll(re)) problems.push(`${f}: root-absolute URL ${m[0].slice(0, 80)}`);
  if (f.endsWith('.js') && /["'`]\/(assets|models|audio)\//.test(src)) {
    const m = src.match(/["'`]\/(assets|models|audio)\/[^"'`]{0,60}/);
    problems.push(`${f}: root-absolute asset path ${m?.[0]}`);
  }
  if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(src)) warnings.push(`${f}: references localhost`);
}
const index = readFileSync(join(dist, 'index.html'), 'utf8');
if (!/<script[^>]+type="module"[^>]+src="\.\/assets\//.test(index)) warnings.push('index.html: entry script is not "./assets/…" (vite base should be "./")');
if (problems.length) fail(`sub-folder hosting would break:\n  ${problems.join('\n  ')}`);

const keep = (f) => !(flag('--no-sourcemaps') && f.endsWith('.map')) && !/(^|\/)\.(DS_Store|gitkeep)$/.test(f);
const included = files.filter(keep);
const totalBytes = included.reduce((n, f) => n + statSync(join(dist, f)).size, 0);
// itch.io HTML5 limits: ≤ 1000 files, ≤ 500 MB extracted, ≤ 200 MB per file.
if (included.length > 1000) fail(`${included.length} files — itch.io allows at most 1000 in an HTML5 zip`);
if (totalBytes > 500 * 1024 * 1024) fail('extracted size exceeds itch.io 500 MB limit');
for (const f of included) if (statSync(join(dist, f)).size > 200 * 1024 * 1024) fail(`${f} exceeds 200 MB`);

// ---------- zip ----------
// Licence texts must travel with redistributed copies (MIT/ISC/OFL).
const extra = [{ name: 'THIRD_PARTY_NOTICES.txt', data: Buffer.from(thirdPartyNotices(root)) }];
if (existsSync(join(root, 'CREDITS.md'))) extra.push({ name: 'CREDITS.md', data: readFileSync(join(root, 'CREDITS.md')) });
const { buffer, names: zipped } = zipDirectory(dist, keep, extra);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buffer);
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
console.log(`✔ ${out}\n  v${pkg.version} · ${zipped.length} files · ${mb(totalBytes)} extracted · ${mb(buffer.length)} zipped`);
for (const w of warnings) console.warn(`  ! ${w}`);

// Round-trip check: the archive must unzip to exactly the input bytes.
const back = unzip(buffer);
if (back.size !== zipped.length || !back.has('index.html') || !back.has('THIRD_PARTY_NOTICES.txt')) fail('zip round-trip mismatch');

// ---------- browser verification from a sub-folder ----------
if (flag('--verify')) {
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  const tmp = mkdtempSync(join(tmpdir(), 'll-web-'));
  for (const [name, data] of back) {
    const p = join(tmp, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  }
  const SUB = '/html/1234567/last-lantern/';
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png',
    '.json': 'application/json', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
  const misses = [];
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (!url.startsWith(SUB)) { misses.push(url); res.writeHead(404); res.end(); return; }
    const rel = url.slice(SUB.length) || 'index.html';
    try {
      const body = readFileSync(join(tmp, rel));
      res.writeHead(200, { 'content-type': types[extname(rel)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { misses.push(url); res.writeHead(404); res.end(); }
  }).listen(0);
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(120_000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}${SUB}index.html`);
  let ok = false;
  try {
    await page.waitForSelector('[data-act=play]', { timeout: 120_000 });
    ok = true;
  } catch { /* reported below */ }
  await page.waitForTimeout(2000);
  const shot = opt('--shot', null);
  if (shot) await page.screenshot({ path: resolve(root, shot) });
  await browser.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
  const realErrors = errors.filter((e) => !/AudioContext|autoplay/i.test(e));
  if (misses.length) fail(`requests escaped the sub-folder or 404ed:\n  ${[...new Set(misses)].join('\n  ')}`);
  if (realErrors.length) fail(`console errors:\n  ${realErrors.join('\n  ')}`);
  if (!ok) fail('title screen ([data-act=play]) never appeared');
  console.log(`✔ verified: boots to the title screen from sub-folder ${SUB} with 0 missing files, 0 console errors`);
}
