// Last Lantern — Electron desktop shell.
//
// Loads the Vite production build (dist/) fully offline through a privileged custom scheme
// (app://game/…), so fetch() of GLB models / OGG audio works (file:// cannot be fetched in
// Chromium) and localStorage lives on a stable origin across launches and updates.
//
//   dev:       npm run desktop            (loads ../dist, devtools allowed)
//   packaged:  node tools/package-desktop.mjs  (game files are staged next to this file in ./game)
//
// Keys: F11 / Alt+Enter toggle fullscreen. Ctrl+Shift+I opens devtools only in unpackaged
// builds or when launched with LL_DEBUG=1.
'use strict';

const { app, BrowserWindow, Menu, ipcMain, protocol, net, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const steam = require('./steam.cjs');

const APP_NAME = 'Last Lantern';
const SCHEME = 'app';
const HOST = 'game';
const DEBUG = !app.isPackaged || process.env.LL_DEBUG === '1';
// Launch options (Steam "Launch Options" / shortcuts): --windowed or --fullscreen override the saved preference.
const FORCE_WINDOWED = process.argv.includes('--windowed') || process.env.LL_WINDOWED === '1';
const FORCE_FULLSCREEN = process.argv.includes('--fullscreen');
const APP_VERSION = (() => {
  if (app.isPackaged) return app.getVersion();
  try { return require('../package.json').version; } catch { return app.getVersion(); }
})();

app.setName(APP_NAME);
// Stable userData folder name regardless of package name casing ("Last Lantern" on all OSes).
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));

// ---------- single instance ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------- game root ----------
function resolveGameRoot() {
  const candidates = [
    process.env.LL_GAME_DIR,                  // explicit override (CI / custom builds)
    path.join(__dirname, 'game'),             // packaged: staged by tools/package-desktop.mjs
    path.join(__dirname, '..', 'dist'),       // dev: repo checkout after `npm run build`
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return path.resolve(dir);
  }
  return null;
}
const GAME_ROOT = resolveGameRoot();

// Must run before app ready: lets app:// behave like https (fetch, storage, secure context, media).
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// Content Security Policy for the game document. Everything is local; no remote code.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.ktx2': 'image/ktx2',
};

function registerGameProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST || !GAME_ROOT) return new Response('Not found', { status: 404 });
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(GAME_ROOT, rel));
    // Path traversal guard: never serve anything outside the game folder.
    if (file !== GAME_ROOT && !file.startsWith(GAME_ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const res = await net.fetch(pathToFileURL(file).toString());
      if (!res.ok) return new Response('Not found', { status: 404 });
      const headers = new Headers(res.headers);
      const type = MIME[path.extname(file).toLowerCase()];
      if (type) headers.set('content-type', type);
      if (file.endsWith('.html')) headers.set('content-security-policy', CSP);
      return new Response(res.body, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------- window state (fullscreen preference + windowed bounds) ----------
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    return { fullscreen: s.fullscreen !== false, width: s.width | 0 || 1600, height: s.height | 0 || 900, x: s.x, y: s.y };
  } catch {
    // First launch: fullscreen like most PC games (also what Steam Deck expects).
    return { fullscreen: true, width: 1600, height: 900 };
  }
}
function saveWindowState(win) {
  try {
    const fullscreen = win.isFullScreen();
    const b = fullscreen ? (win.__lastBounds ?? win.getNormalBounds()) : win.getNormalBounds();
    fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ fullscreen, ...b }));
  } catch { /* non-fatal */ }
}
function boundsOnScreen(st) {
  if (typeof st.x !== 'number' || typeof st.y !== 'number') return {};
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return st.x >= a.x - 50 && st.y >= a.y - 50 && st.x < a.x + a.width - 100 && st.y < a.y + a.height - 100;
  });
  return visible ? { x: st.x, y: st.y } : {};
}

// ---------- window ----------
let mainWindow = null;

function iconPath() {
  const p = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  return fs.existsSync(p) ? p : path.join(__dirname, 'assets', 'icon.png');
}

function createWindow() {
  const st = loadWindowState();
  if (FORCE_WINDOWED) st.fullscreen = false;
  else if (FORCE_FULLSCREEN) st.fullscreen = true;
  const win = new BrowserWindow({
    title: APP_NAME,
    icon: iconPath(),
    width: Math.max(1024, st.width),
    height: Math.max(600, st.height),
    ...boundsOnScreen(st),
    minWidth: 960,
    minHeight: 540,
    fullscreen: st.fullscreen,
    fullscreenable: true,
    backgroundColor: '#120b2e', // matches the game's theme-color: no white flash on boot
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: DEBUG,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required', // music can start on the title screen
      backgroundThrottling: true,
      additionalArguments: [`--ll-version=${APP_VERSION}`],
    },
  });
  mainWindow = win;
  win.__lastBounds = win.getNormalBounds();

  win.once('ready-to-show', () => win.show());
  win.on('enter-full-screen', () => { win.webContents.send('ll:fullscreen', true); });
  win.on('leave-full-screen', () => { win.webContents.send('ll:fullscreen', false); });
  win.on('resize', () => { if (!win.isFullScreen()) win.__lastBounds = win.getNormalBounds(); });
  win.on('move', () => { if (!win.isFullScreen()) win.__lastBounds = win.getNormalBounds(); });
  win.on('close', () => saveWindowState(win));
  // Keep the product name in the title bar even though index.html sets <title>.
  win.on('page-title-updated', (e) => e.preventDefault());

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key;
    if (key === 'F11' || (key === 'Enter' && input.alt)) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    } else if (DEBUG && (key === 'F12' || (input.control && input.shift && key.toLowerCase() === 'i'))) {
      event.preventDefault();
      win.webContents.toggleDevTools();
    } else if (!DEBUG && input.control && key.toLowerCase() === 'r') {
      event.preventDefault(); // no accidental reload mid-run in release builds
    }
  });

  // Never navigate away from the game; open http(s) links (wishlist, Discord, credits) in the browser.
  const isGameUrl = (u) => u.startsWith(`${SCHEME}://${HOST}/`);
  win.webContents.on('will-navigate', (e, url) => {
    if (isGameUrl(url)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[last-lantern] renderer gone:', details.reason);
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.reload();
  });

  if (GAME_ROOT) {
    void win.loadURL(`${SCHEME}://${HOST}/index.html`);
  } else {
    const msg = encodeURIComponent(
      '<body style="background:#120b2e;color:#ffd27a;font:18px sans-serif;padding:40px">' +
      '<h1>Last Lantern</h1><p>Game files not found. Run <code>npm run build</code> first.</p></body>');
    void win.loadURL(`data:text/html,${msg}`);
  }
  return win;
}

// ---------- IPC (exposed to the page via preload.cjs) ----------
ipcMain.handle('ll:toggle-fullscreen', () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()); return mainWindow?.isFullScreen() ?? false; });
ipcMain.handle('ll:set-fullscreen', (_e, on) => { if (mainWindow) mainWindow.setFullScreen(!!on); return mainWindow?.isFullScreen() ?? false; });
ipcMain.handle('ll:is-fullscreen', () => mainWindow?.isFullScreen() ?? false);
ipcMain.handle('ll:quit', () => app.quit());
ipcMain.handle('ll:open-external', (_e, url) => { if (typeof url === 'string' && /^https:\/\//.test(url)) void shell.openExternal(url); });
ipcMain.handle('ll:unlock-achievement', (_e, id) => (typeof id === 'string' ? steam.unlockAchievement(id) : false));
ipcMain.handle('ll:steam-status', () => steam.status());

// ---------- app lifecycle ----------
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  // No default menu (it would expose reload/devtools). macOS keeps a minimal app menu for Cmd+Q / Cmd+H.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: APP_NAME, submenu: [{ role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
  registerGameProtocol();
  steam.init();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => app.quit());

// Smoke hook (release verification, not used by players):
//   LL_SMOKE_SCREENSHOT=<png>  capture the window after LL_SMOKE_DELAY ms (default 6000), print a JSON report, quit.
//   LL_SMOKE_PLAY=<ms>         before capturing, click "Begin the Vigil" → "Start" and let the run play for <ms>.
// Exit code 1 on any renderer console error.
const smokeErrors = [];
if (process.env.LL_SMOKE_SCREENSHOT) {
  app.on('web-contents-created', (_e, wc) => {
    wc.on('console-message', (...a) => {
      // Electron ≥ 35 passes one details object; older versions pass (event, level, message).
      const d = a[0] && typeof a[0].level === 'string' ? a[0] : { level: a[1] === 3 ? 'error' : 'info', message: a[2] };
      if (d.level === 'error') smokeErrors.push(String(d.message));
    });
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => mainWindow.webContents.executeJavaScript(code);
  app.whenReady().then(async () => {
    try {
      await wait(Number(process.env.LL_SMOKE_DELAY ?? 6000));
      const playMs = Number(process.env.LL_SMOKE_PLAY ?? 0);
      if (playMs > 0) {
        await js('document.querySelector("[data-act=play]")?.click()');
        await wait(1500);
        await js('document.querySelector("[data-act=start]")?.click()');
        await wait(playMs);
      }
      // Wait for two fresh animation frames so the capture reflects the current state, not a cached frame.
      await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0))))');
      mainWindow.webContents.invalidate();
      await wait(1000);
      const img = await mainWindow.webContents.capturePage();
      fs.writeFileSync(process.env.LL_SMOKE_SCREENSHOT, img.toPNG());
      const info = await js(
        'JSON.stringify({ title: document.title, desktop: window.lanternDesktop?.isDesktop ?? false, version: window.lanternDesktop?.version, ' +
        'state: window.__game?.state ?? null, origin: location.origin, ' +
        'storage: (() => { try { localStorage.setItem("ll-smoke", "1"); return localStorage.getItem("ll-smoke") === "1"; } catch { return false; } })() })');
      console.log('[last-lantern] smoke', info, `windowTitle="${mainWindow.getTitle()}"`, `packaged=${app.isPackaged}`,
        `devtools=${DEBUG}`, `consoleErrors=${smokeErrors.length}`);
      if (smokeErrors.length) {
        console.error('[last-lantern] smoke console errors:\n  ' + smokeErrors.join('\n  '));
        process.exitCode = 1;
      }
    } catch (e) {
      console.error('[last-lantern] smoke failed', e);
      process.exitCode = 1;
    }
    app.quit();
  });
}
