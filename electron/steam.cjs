// Last Lantern — OPTIONAL Steamworks bridge (achievements). Inert unless all of these are true:
//   1. the native module `steamworks.js` is installed:   flock /tmp/npm.lock npm install steamworks.js@<exact>
//      and listed in the staged app's dependencies (tools/package-desktop.mjs --steam copies it in),
//   2. an App ID is configured: env LL_STEAM_APPID, or electron/steam_appid.txt (the Steam client
//      supplies it automatically when launched from Steam),
//   3. the Steam client is running.
// Any failure logs once and degrades to a no-op, so the DRM-free / itch.io build is unaffected.
// Achievement API names must match src/data/achievements.ts ids (ach_first_vigil, ...) — create them in
// Steamworks with exactly those API names. See docs/store/steam-integration.md.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

let client = null;
let appId = null;
let lastError = null;

function readAppId() {
  const env = Number(process.env.LL_STEAM_APPID);
  if (Number.isInteger(env) && env > 0) return env;
  for (const p of [path.join(__dirname, 'steam_appid.txt'), path.join(process.cwd(), 'steam_appid.txt')]) {
    try {
      const n = Number(fs.readFileSync(p, 'utf8').trim());
      if (Number.isInteger(n) && n > 0) return n;
    } catch { /* not present */ }
  }
  return null;
}

function init() {
  appId = readAppId();
  if (!appId) return false;
  let steamworks;
  try {
    steamworks = require('steamworks.js');
  } catch {
    lastError = 'steamworks.js not installed';
    console.warn('[last-lantern] Steam App ID set but steamworks.js is not bundled; achievements disabled.');
    return false;
  }
  try {
    client = steamworks.init(appId);
    // Required for the Steam overlay in Electron (Shift+Tab).
    if (typeof steamworks.electronEnableSteamOverlay === 'function') steamworks.electronEnableSteamOverlay();
    return true;
  } catch (e) {
    lastError = String(e && e.message ? e.message : e);
    console.warn('[last-lantern] Steam init failed (is the Steam client running?):', lastError);
    client = null;
    return false;
  }
}

function unlockAchievement(id) {
  if (!client || !/^[A-Za-z0-9_]{1,64}$/.test(id)) return false;
  try {
    if (client.achievement.isActivated(id)) return true;
    return !!client.achievement.activate(id);
  } catch (e) {
    console.warn('[last-lantern] achievement failed', id, e);
    return false;
  }
}

function status() {
  let user = null;
  try { user = client ? client.localplayer.getName() : null; } catch { /* ignore */ }
  return { enabled: !!client, appId, user, error: lastError };
}

module.exports = { init, unlockAchievement, status };
