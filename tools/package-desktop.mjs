// Builds the Last Lantern desktop app with electron-builder.
//
//   node tools/package-desktop.mjs [--build] [--dist <dir>] [--steam] [--stage-only] [<targets>...]
//
//   --build       regenerate the model manifest and `vite build` into release/.stage-web first
//   --dist        Vite build to ship (default: dist/, or the fresh build with --build)
//   --steam       also bundle steamworks.js (must be installed) + steam_appid.txt from env LL_STEAM_APPID
//   --stage-only  only assemble release/stage-desktop (fast; `electron release/stage-desktop` runs it)
//   targets       electron-builder CLI style, e.g.  linux:dir  linux:AppImage  win:nsis  win:zip  mac:dmg
//                 Default: "<host>:dir" (an unpacked folder — exactly what a Steam depot contains).
//
// Output: release/desktop/ (gitignored). Cross-building Windows/macOS from Linux is not reliable
// (signing, rcedit, notarization) — use the CI matrix in production/release/ci/release-desktop.yml.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { thirdPartyNotices } from './package-lib.mjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const optValues = new Set(['--dist'].map((f) => opt(f, null)).filter(Boolean));
const targets = args.filter((a) => !a.startsWith('--') && !optValues.has(a));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const fail = (m) => { console.error(`\n✖ package-desktop: ${m}`); process.exit(1); };

// ---------- game build ----------
let dist = resolve(root, opt('--dist', 'dist'));
if (flag('--build')) {
  if (!args.includes('--dist')) dist = join(root, 'release', '.stage-web');
  execFileSync(process.execPath, [join(root, 'tools/gen-model-manifest.mjs')], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir'],
    { cwd: root, stdio: 'inherit' });
}
if (!existsSync(join(dist, 'index.html'))) fail(`no index.html in ${dist} — run \`npm run build\` or pass --build`);

// ---------- stage a minimal app ----------
const stage = join(root, 'release', 'stage-desktop');
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'assets', 'icons'), { recursive: true });
for (const f of ['main.cjs', 'preload.cjs', 'steam.cjs']) cpSync(join(root, 'electron', f), join(stage, f));
for (const f of ['icon.png', 'icon.ico']) {
  if (!existsSync(join(root, 'electron', 'assets', f))) fail(`electron/assets/${f} missing — run node tools/package-icons.mjs`);
  cpSync(join(root, 'electron', 'assets', f), join(stage, 'assets', f));
}
cpSync(dist, join(stage, 'game'), { recursive: true, filter: (src) => !src.endsWith('.map') });
// Licence texts must travel with redistributed copies (MIT/ISC/OFL); Electron/Chromium notices are added by electron-builder.
writeFileSync(join(stage, 'THIRD_PARTY_NOTICES.txt'), thirdPartyNotices(root));
if (existsSync(join(root, 'CREDITS.md'))) cpSync(join(root, 'CREDITS.md'), join(stage, 'CREDITS.md'));
const appPkg = {
  name: 'last-lantern',
  productName: 'Last Lantern',
  version: pkg.version,
  description: 'Carry the last light through a night that wants it out. A 3D roguelite survival game where your light is your life.',
  author: { name: 'Last Lantern team', email: 'hello@lastlantern.example' }, // TODO(release): real studio contact
  license: 'UNLICENSED',
  private: true,
  main: 'main.cjs',
  desktopName: 'last-lantern.desktop', // Linux: links the running window to the .desktop entry (WM_CLASS)
  dependencies: {},
};
if (flag('--steam')) {
  let swPkg;
  try { swPkg = require('steamworks.js/package.json'); } catch { fail('--steam needs steamworks.js: flock /tmp/npm.lock npm install -D steamworks.js@<exact>'); }
  appPkg.dependencies['steamworks.js'] = swPkg.version;
  cpSync(join(root, 'node_modules', 'steamworks.js'), join(stage, 'node_modules', 'steamworks.js'), { recursive: true });
  if (process.env.LL_STEAM_APPID) writeFileSync(join(stage, 'steam_appid.txt'), String(process.env.LL_STEAM_APPID));
}
writeFileSync(join(stage, 'package.json'), JSON.stringify(appPkg, null, 2));
console.log(`✔ staged ${stage} (v${pkg.version}${flag('--steam') ? ', steamworks.js' : ''})`);
if (flag('--stage-only')) process.exit(0);

// ---------- electron-builder ----------
const hostOs = { linux: 'linux', win32: 'win', darwin: 'mac' }[process.platform];
const wanted = targets.length ? targets : [`${hostOs}:dir`];
const byOs = {};
for (const t of wanted) {
  const [os, target] = t.split(':');
  if (!['linux', 'win', 'mac'].includes(os) || !target) fail(`bad target "${t}" (use e.g. linux:dir, win:nsis, mac:dmg)`);
  (byOs[os] ??= []).push(target);
}
const config = { ...require(join(root, 'electron', 'electron-builder.config.cjs')) };
// Building for the host OS: reuse the already-downloaded Electron (no network needed for "dir").
const localDist = join(root, 'node_modules', 'electron', 'dist');
if (Object.keys(byOs).length === 1 && byOs[hostOs] && existsSync(localDist)) config.electronDist = localDist;

const { build, Platform } = require('electron-builder');
const targetsMap = new Map();
const plat = { linux: Platform.LINUX, win: Platform.WINDOWS, mac: Platform.MAC };
for (const [os, list] of Object.entries(byOs)) {
  for (const [k, v] of plat[os].createTarget(list)) targetsMap.set(k, v);
}
try {
  // projectDir = the stage itself, so dependencies resolve from the staged package.json only (otherwise
  // electron-builder falls back to the repo's node_modules and ships three/fontsource sources in the asar).
  const outputs = await build({ projectDir: stage, config, targets: targetsMap });
  console.log('✔ desktop build complete:\n  ' + [config.directories.output, ...outputs].join('\n  '));
} catch (e) {
  fail(e?.stack ?? String(e));
}
