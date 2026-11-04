# Steam integration (optional, documented step)

The desktop build runs fine **without** Steamworks. That gives the DRM-free itch.io build and the Steam build
before an App ID exists. This page covers the optional steps that turn on Steam features.

## 1. What already exists
| Piece | File | State |
|---|---|---|
| Desktop shell, fullscreen, single instance, offline `app://` origin | `electron/main.cjs` | done |
| Page API `window.lanternDesktop` (`unlockAchievement`, `steamStatus`, `quit`, `openExternal`, fullscreen) | `electron/preload.cjs` | done |
| Steamworks bridge (loads `steamworks.js` if present, otherwise a no-op) | `electron/steam.cjs` | done, inert until §2 |
| Achievement data (24, ids `ach_*`) and the `achievement:unlocked` event | `src/data/achievements.ts`, `src/game/Achievements.ts` | done |
| Game → Steam call | `src/game/Game.ts` / `Achievements.ts` (gameplay owner) | **TODO** (backlog P0-5) |

## 2. Turn it on
1. **Install the native module** (pin exactly. N-API prebuilds cover Win x64, macOS universal and Linux x64):
   `flock /tmp/npm.lock npm install -D steamworks.js@<exact version>`
2. **App ID:** put it in CI as `LL_STEAM_APPID` (the build writes `steam_appid.txt`, used only for testing outside
   the Steam client). When players launch through Steam, the client provides the App ID itself.
3. **Build:** `npm run package:steam -- linux:dir` (and `win:dir`, `mac:dir` in the CI matrix). It copies
   `steamworks.js` into the staged app.
4. **Game hook** (one line in the gameplay-owned code that handles `achievement:unlocked`):
   ```ts
   // after the in-game toast
   void (window as any).lanternDesktop?.unlockAchievement?.(id);
   ```
   Also call it for every id in `save.achievements` once at boot. That syncs achievements earned offline or in the
   web demo (the bridge ignores ones Steam already has).
5. **Steamworks partner site → Achievements:** create 24 achievements whose **API names are exactly the
   `ach_*` ids** in `src/data/achievements.ts`. Display names and descriptions come from the same file. Mark
   `ach_ruins` and `ach_absurd` as hidden (they're `secret: true` in-game). Icons: 64×64 PNG, made from
   `src/ui/icons.ts` glyphs on the amber medallion (locked = desaturated).
6. **Overlay:** `steam.cjs` calls `electronEnableSteamOverlay()`. Test Shift+Tab in fullscreen on Windows. If the
   overlay doesn't draw, add `--in-process-gpu` to Electron's command-line switches (a known Electron/overlay
   interaction).

## 3. Steam Cloud
Saves currently live in Chromium `localStorage` under `%APPDATA%/Last Lantern/Local Storage/leveldb`. That's a
binary LevelDB, and **unsafe to sync with Steam Auto-Cloud** (it's locked while the game runs and keeps
multiple files). Backlog P1-4: mirror the save JSON to `userData/save.json` via a preload `saveFile/loadFile` API
(atomic write + `.bak`), and point Auto-Cloud at:
- Windows: `%APPDATA%/Last Lantern/save.json`
- macOS: `~/Library/Application Support/Last Lantern/save.json`
- Linux: `~/.config/Last Lantern/save.json`

Do not tick "Steam Cloud" in the store categories until this ships.

## 4. SteamPipe depots
Upload the **unpacked** `dir` builds (no installer, since Steam handles install/update/uninstall):

```
release/desktop/win-unpacked/    → depot <appid+1> (Windows)   launch: Last Lantern.exe
release/desktop/mac/Last Lantern.app → depot <appid+2> (macOS) launch: Last Lantern.app
release/desktop/linux-unpacked/  → depot <appid+3> (Linux + SteamOS)  launch: last-lantern
```

`app_build_<appid>.vdf` sketch (stored in CI, not the repo):
```
"AppBuild" { "AppID" "<appid>" "Desc" "v1.0.0" "BuildOutput" "../output/"
  "Depots" {
    "<appid+1>" { "FileMapping" { "LocalPath" "../release/desktop/win-unpacked/*" "DepotPath" "." "recursive" "1" } }
    "<appid+3>" { "FileMapping" { "LocalPath" "../release/desktop/linux-unpacked/*" "DepotPath" "." "recursive" "1" } }
  } }
```
Run `steamcmd +login <builder> +run_app_build app_build_<appid>.vdf +quit`, then set the build live on the
`beta` branch → smoke test → `default`.

**Launch options:** the default runs the exe with no arguments. Add "Windowed" (`--windowed`, supported by
`electron/main.cjs`; `--fullscreen` forces the opposite) and "Safe graphics" (`--use-angle=gl`, for driver issues).

**Linux sandbox note:** Electron's `chrome-sandbox` needs SUID root, which Steam doesn't preserve. The Steam Linux
Runtime (Sniper) container works with the default namespace sandbox. If a user reports a sandbox crash, the
fallback launch option is `--no-sandbox`. Verify on the Deck before release.

## 5. Steam Deck checklist
- Starts fullscreen at 1280×800 (default on first launch, `window-state.json`). ✅
- Full controller navigation of every menu + pad glyphs. ✅ (`Button Prompts: Auto/Pad`)
- Text ≥ 9 px at 800p: verify UI Scale default on Deck (`navigator.userAgent` contains `SteamOS`?), backlog P1-8.
- No launcher, no account login, no external browser required. ✅
- Suspend/resume: the game must pause on `blur`/`visibilitychange`. Verify.
