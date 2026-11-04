# Last Lantern: launch checklist (v1.0)

> Owner: release-manager. Tick items in PRs. Each line names the evidence that closes it.
> Related: `production/milestones/v1.0.md` (backlog), `docs/store/*` (copy), `production/release/ci/release-desktop.yml`.

## 0. Business & legal (before the Coming Soon page)
- [ ] **Name clearance for "Last Lantern"**: USPTO + EUIPO (classes 9, 41), Steam, itch.io, App Store / Google Play,
      domain + social handles. Alternates ready: *Lanternfall*, *Keep the Light*, *Gloomward*.
      Evidence: `production/release/name-check.md`.
- [ ] Steamworks partner account, tax + bank interview, Steam Direct fee paid (30-day new-app wait starts).
- [ ] itch.io creator account, payout + tax info. Revenue share set.
- [ ] Final `appId` in `electron/electron-builder.config.cjs` (reverse-DNS on a domain we own) and the studio contact
      in `tools/package-desktop.mjs` (`author`).
- [ ] **AI-content disclosure** filed: Steamworks Content Survey + itch.io "AI generation" field. Same text as
      `docs/store/steam-page.md`.
- [ ] IARC rating questionnaire (expected PEGI 7 / ESRB E10+).
- [ ] Privacy statement on the store page / website: "Last Lantern collects no personal data. Saves are stored
      locally." (true today: no telemetry, no network calls).
- [ ] `CREDITS.md` + `THIRD_PARTY_NOTICES.txt` shipped in every build ✅ (package scripts add them automatically).
- [ ] Template credit: Claude Code Game Studios by Donchitos (MIT). The `LICENSE` file is kept in the repo ✅.

## 1. Build & platform
- [ ] Version bumped in `package.json` (semver: `1.0.0`). The title screen shows `v1.0.0` (`__APP_VERSION__`).
- [ ] CI green on the release commit: `npm run typecheck`, `npm test`, smoke (`node tools/smoke.mjs`),
      `npm run package:web` (`--verify` = boots from an itch-style sub-folder with 0 missing files / 0 console errors).
- [ ] Windows: NSIS installer **signed**, installs per-user without admin, Start-menu + desktop shortcut, uninstall keeps
      saves. SmartScreen reputation check on a clean VM.
- [ ] macOS: universal DMG **signed + notarized + stapled**. Opens on a clean macOS 12 machine without a Gatekeeper prompt.
- [ ] Linux: AppImage + tar.gz launch on Ubuntu 22.04 / Fedora. `linux:dir` used for the Steam depot.
- [ ] Steam Deck: fullscreen at 1280×800, full pad navigation, ≥ 60 fps at the default preset, suspend/resume
      pauses the run. Submit for Deck Verified review.
- [ ] Offline: the desktop build runs with networking disabled (everything ships in `app://game`).
- [ ] Release builds: devtools blocked (`devTools: !app.isPackaged`), Ctrl+R blocked, no menu bar. Electron fuses:
      RunAsNode off, NODE_OPTIONS off, `--inspect` off, ASAR integrity on ✅.
- [ ] Single instance: a second launch focuses the running window ✅ (verified on Linux).
- [ ] F11 / Alt+Enter toggle fullscreen; the preference persists in `userData/window-state.json` ✅.
- [ ] `--windowed` / `--fullscreen` launch options work (Steam "Launch Options").
- [ ] Saves: upgrade test from every previously shipped save version. Corrupted save → defaults + toast (P0-4).
- [ ] Performance: 60 fps p95 with 300+ enemies on min-spec (P0-7). Store-page requirements updated from the results.
- [ ] Installed size and download size recorded for the store page (Linux dir build today: ~305 MB unpacked, ~125 MB
      compressed).

## 2. Steam
- [ ] Store page complete (`docs/store/steam-page.md`): short + long description, 20 tags, requirements, all
      capsules, ≥ 5 screenshots (aim for 10), 4 GIFs, trailer, content disclosures.
- [ ] Store page **reviewed by Valve** (takes 3–5 business days) and Coming Soon live ≥ 2 weeks before release
      (Valve's minimum, our plan is ~4 months).
- [ ] Build uploaded through SteamPipe (`docs/store/steam-integration.md` §4). Default branch set. Launch options set.
- [ ] Build **reviewed by Valve** (3–5 business days, submit ≥ 2 weeks before launch).
- [ ] 24 achievements created with API names = `ach_*` ids, icons uploaded. Hidden: `ach_ruins`, `ach_absurd`.
      Unlock tested in a Steam build (P0-5).
- [ ] Steam Cloud enabled **only if** P1-4 shipped. Otherwise leave it off.
- [ ] Launch discount (20%, 7 days) scheduled in Steamworks → Discounts.
- [ ] Release date set. "Release" button pressed on launch day at 10:00 PT.
- [ ] Demo app (separate App ID) for Next Fest, reviewed, linked from the main page.

## 3. itch.io & web
- [ ] `release/last-lantern-web.zip` from `npm run package:web`. The `--verify` pass shows 0 missing files.
- [ ] Web demo flag (P1-2) on for the free build. Wishlist links tested.
- [ ] itch page per `docs/store/itch-page.md` (viewport 1280×720, mobile friendly, fullscreen button,
      AI disclosure).
- [ ] Desktop channels pushed with butler (`windows`, `mac`, `linux`) using the same version as Steam.
- [ ] Browser matrix: Chrome, Edge, Firefox, Safari 17+ (WebGL 2), Android Chrome, iOS Safari (touch +
      portrait HUD).

## 4. Marketing & community
- [ ] Press kit page live (`docs/store/press-kit.md`) with downloadable zip (logos, key art, screenshots).
- [ ] Announcement trailer (30 s, `docs/store/trailer-script.md`) on YouTube + Steam. Vertical cut on Shorts/TikTok.
- [ ] Launch trailer (60–75 s) ready one week before launch.
- [ ] Key list: 100 creators + 30 press, sent through Steam's key request tool or Keymailer one week before launch, with the
      embargo lifting at launch time.
- [ ] Discord server: #announcements, #bug-reports (template: platform, version, steps, `Copy debug info`),
      #builds, #fan-art. Moderation rules posted.
- [ ] Launch-day posts scheduled: Steam announcement, Bluesky/X, Reddit (r/roguelites, r/IndieGaming,
      r/SteamDeck), itch devlog.
- [ ] Patch-notes template ready (`/patch-notes`). Hotfix plan: triage within 24 h, 1.0.1 within 72 h if any S1.

## 5. Launch day runbook (T = 10:00 PT)
| Time | Action | Who |
|---|---|---|
| T−24 h | Final build live on Steam `default` branch (unreleased). itch pages ready but hidden | release |
| T−2 h | Smoke test the Steam build on Win/Mac/Deck from a clean account | qa |
| T | Press **Release** on Steam. Publish the itch page. Lift the embargo | release |
| T+15 min | Announcement posts. Discord ping. Pin the launch trailer | community |
| T+1 h…+48 h | Watch the Steam forums, Discord #bug-reports and reviews every 2 h. Log issues in `production/qa/bugs.md` | community + qa |
| T+24 h | Go/no-go on hotfix 1.0.1 | producer |
| T+7 d | Launch discount ends. Retrospective (`/retrospective`). Plan update #1 | producer |

## 6. Wishlist & sales tracking (weekly)
| Week of | Wishlists (total) | Δ | Source notes |
|---|---|---|---|
| | | | |

Go/no-go: **≥ 7,000 wishlists one week before launch**, otherwise slip 4–6 weeks (see
`docs/store/pricing-and-launch.md` §2).
