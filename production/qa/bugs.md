# Last Lantern — QA bug list

Exploratory pass over the game state machine, input, save and core utilities (code reading + targeted
automated repros). Build: working tree of 2026-11-04 (v0.1.0). Platform: headless Chromium 1.63 / SwiftShader,
Node 22 (Vitest).

**Known-bug tests.** Bugs that live in files QA does not own are pinned by tests marked `it.fails(...)`. Each one
asserts the *correct* behaviour, so it fails today (and vitest counts that as a pass). When the fix lands, vitest
reports "expected to fail but passed". Flip `it.fails` → `it` at that point, and the test becomes the regression
guard. Every one of them was also run as a plain `it` to confirm it fails for the reason stated.

| ID | Sev | Pri | Status | System | Title |
|---|---|---|---|---|---|
| BUG-QA-004 | S1-Critical | P1 | **Fixed (QA)** | Input (`src/core/Input.ts`) | Touch: taps on menu/HUD buttons never register, so mobile players are stuck on the main menu |
| BUG-QA-007 | S2-High | P1 | **Fixed (gameplay, Save side)** · Renderer guard requested | Save + Renderer | Unknown `settings.quality` in a save bricks boot ("The lantern would not light") |
| BUG-QA-001 | S2-High | P1 | **Fixed (gameplay)** | Game state machine | Dawn choice from a previous run's boss kill leaks into the next run |
| BUG-QA-002 | S2-High | P2 | **Fixed (gameplay)** | Game state machine | Boss killed and paused before the 2.2 s dawn timer fires: the dawn/endless choice never appears |
| BUG-QA-005 | S3-Medium | P2 | **Fixed (gameplay)** | Save | `loadSave()` accepts wrong field types (`unlocked: null`, `meta: null`, `ash: "x"`) and crashes later |
| BUG-QA-003 | S4-Low | P3 | **Fixed (gameplay)** | Game state machine | `skipUpgrade()` / `rerollUpgrades()` have no `state === 'levelup'` guard |
| BUG-QA-006 | S4-Low | P3 | **Fixed (gameplay)** | Core RNG | `Rng` state is never wrapped to uint32 and drifts off mulberry32 after ~4.9M draws |
| BUG-QA-008 | S4-Low | P3 | **Fixed: Input** · Pickups.spawn requested | Input / Game loop | Small per-frame allocations in the input path (`anyPressed(...codes)`, `gp.buttons.forEach` closure) |
| BUG-QA-009 | S4-Low | P4 | **Fixed (gameplay)** | Game loop | `debug.timeScale` multiplies the already-clamped dt, so steps above 0.05 s can tunnel projectiles |
| BUG-QA-010 | S1-Critical | P0 | **Fixed** (verified S3 QA: bearer follows the run in every smoke/explore shot) | Player (`src/entities/Player.ts`) | Bearer model + lantern PointLight stay at the world origin during runs (group.position never synced) |
| BUG-QA-011 | S3-Medium | P2 | **Fixed** (verified S3 gameplay: `appliedQuality` guard in `applySettings`) | Game / Settings | Every Settings change (each volume-slider input event) re-applies the quality tier and resets the auto fallback |
| BUG-QA-012 | S3-Medium | P2 | **Fixed** (verified S3 gameplay: `enemies.renderQuality = renderer.effectiveQuality` in `frame()`) | Game / Enemies | Enemy horde LOD + moon shadows follow the Settings tier, not the Renderer's automatic fallback |
| BUG-QA-013 | S3-Medium | P2 | **Fixed** (verified S3 gameplay: `chestTimer = max(…, ui.chestHold)`) | Game / UI | Reliquary auto-continues after 2.8 s, before a 3–4 item reveal has been readable (ui.chestHold ignored) |
| BUG-QA-014 | S3-Medium | P3 | **Fixed** (verified S3 QA: `Renderer.render` scales `uDamage` ×0.35 under `a11y-noflash`) | Renderer / a11y | Reduce Flashing does not dim the full-screen red damage pulse |
| BUG-QA-015 | S4-Low | P3 | **Fixed** (verified S3 QA: `if (!(q in TIERS)) q = 'high'` in `setQuality`) | Renderer | `Renderer.setQuality` still has no unknown-tier guard (BUG-QA-007 belt-and-braces) |
| BUG-QA-016 | S4-Low | P3 | **Verified** (S3 QA: field-by-field spawn in Enemies/Pickups/Projectiles; pooled-reuse tests in `tests/unit/sprint3-qa.test.ts`) | Pickups / Enemies | Per-spawn object literals: `PickupManager.spawn` and `EnemyManager.spawn` still `Object.assign(x, {...})` |
| BUG-QA-017 | S4-Low | P4 | **Verified** (S3 QA browser: Shift+1 tap released before the frame banished, 1 → 0) | Input | Shift+1..4 banish reads Shift at frame time; a quick tap released before the next frame picks the card instead |
| BUG-QA-018 | S3-Medium | P2 | **Verified** (S3 QA: 11 achievements → 3 cards + "+8 more", buttons at y≤693 of 720) | UI (`src/ui/UI.ts` FIT) | Game-over screen overflows 1280×720 when a run earns several achievements; buttons below the fold |
| BUG-QA-019 | S4-Low | P3 | **Verified** (S3 QA: burst of elite/swarm/rush + duplicate shows one banner at a time at 22 %; follow-ups BUG-QA-023/024) | Director announcements | Simultaneous announcements ('An elite approaches…', 'Cinders on the wind!', boss) draw on top of each other |
| BUG-QA-020 | S4-Low | P3 | **Fixed** (S3 UI: stale 'lowlight' dropped + `Tutorial.forget`; unit-tested; browser check inconclusive, see S3 section) | Tutorial | 'Your light is fading' hint is replayed later at 100 % light (stale queued hint) |
| BUG-QA-021 | S4-Low | P4 | **Fixed** (verified S3 QA: `CameraRig.snap` sets `mode = 'follow'`) | CameraRig | `snap()` before the first `follow()` of a run does not cancel the menu→run swoop (tools/package-screens, smoke) |
| BUG-QA-022 | S3-Medium | P2 | **Open** · Player.ts (world-look) | Player x-ray / perf | X-ray silhouette doubles every bearer mesh: +16 draw calls (low 72 → 88, +22 %; high 131 → 152), trips the perf gate |
| BUG-QA-023 | S4-Low | P3 | **Open** · Enemies.ts / Player.ts / Fx.ts | Announcer | Legacy Fx 'ft-big' banners ('ENRAGED', 'REKINDLED') are hidden by CSS while a UI banner shows, and enrage shows two banners for one event |
| BUG-QA-024 | S4-Low | P3 | **Open** · UI.ts | Announcer | `UI.announce` queues 'boss' banners LIFO: 'has come' plays before 'stirs…', 'is enraged!' before 'has come' |
| BUG-QA-025 | S4-Low | P4 | **Open** · Game.ts | Boss outro | A reliquary picked up during the 1.3 s boss-collapse outro opens immediately and freezes the collapse |
| BUG-QA-026 | S4-Low | P4 | **Open** · Game.ts | Boss outro | Unused boss slow-mo (`slowT`) survives the dawn screen; the endless night can resume at 0.35× |
| BUG-QA-027 | S4-Low | P3 | **Open** · UI.ts | Announcer / tutorial | First runs: announcements queued behind a hint card are dropped after 3 s, including 'boss' banners |
| BUG-QA-028 | S4-Low | P4 | **Fixed (QA)** | tools/smoke.mjs | Smoke fast-forward died at 0:34 on a starved machine (key steering only reaches the sim on real frames) |
| BUG-QA-029 | S2-High | P1 | **Open** · readability (Projectiles.ts / Fx.ts) + world-look (WorldShading) | Readability / VFX | Late-game centre white-out still above target with FX aged: Pines 26.7 % / 13.7 %, Ruins 16.9 % / 11.2 % (target ≤ 10 %); Glacier Heart shard starburst hides the bearer |

---

## BUG-QA-004 — Touch: UI taps swallowed by the move stick  ✅ fixed by QA
- **Severity**: S1-Critical · **Priority**: P1-Fix this sprint · **Status**: Fixed (verify)
- **System**: Input (`src/core/Input.ts`, owner: engine/gameplay). QA made a 4-line additive fix after confirming the bug in a browser.
- **Category**: Input / Platform · **Frequency**: 100% on touch devices · **Platform**: mobile web (Poki/CrazyGames target), tablets
- **Repro**:
  1. Open the build in a touch-only browser (Playwright `hasTouch: true, isMobile: true`, 844×390).
  2. Tap **Play** on the main menu.
- **Expected**: the setup screen opens.
- **Actual**: nothing happens. 0 `click` events reach the document. The HUD pause button doesn't respond to taps either.
- **Cause**: `Input` listens to `touchstart` on `#game-root`, which also contains `#ui-root`, and calls `e.preventDefault()`.
  A `preventDefault()` on `touchstart` stops the browser from synthesizing the click, and it also blocks scrolling in menu screens.
- **Fix (applied)**: `onTouchStart` returns early when the touch target is inside `.screen, button, a, input, select, textarea, [data-act]`.
  The canvas still gets the stick.
- **Verification**: `tests/unit/input.test.ts` fails without the guard and passes with it. In the browser, tap Play opens setup,
  tap Start begins a run, and tap pause pauses. A CDP touch-drag on the canvas still moves the player (`moveX = 1`). `tools/smoke.mjs`
  now has a touch + portrait phase (`smoke-08-portrait.png`) that fails the smoke if tapping Play doesn't open setup.

## BUG-QA-007 — Unknown quality tier in save crashes boot
- **Severity**: S2-High · **Priority**: P1 · **System**: Save (`src/core/Save.ts`) + Renderer (`src/render/Renderer.ts`)
- **Repro**: `localStorage['last-lantern-save-v1'] = {"version":1,"settings":{"quality":"ultra"}}` → reload.
- **Expected**: the game boots on the default tier.
- **Actual**: `TypeError: Cannot read properties of undefined (reading 'moonShadow')` at `Renderer.applyTier ← setQuality ← Game.applySettings ← new Game`.
  The fatal "The lantern would not light" screen shows on **every** launch until site data is cleared. It can happen after a
  future tier rename/removal, or with a hand-edited or partially written save.
- **Fix**: (a) in `Renderer.setQuality(q)`: `if (!(q in TIERS)) q = 'high';`. (b) Validate in `loadSave()` (see BUG-QA-005).
- **Test**: `tests/unit/save.test.ts › loadSave_unknownQualityTier_fallsBackToDefaultTier` (now a plain `it`).
- **Fixed (Sprint 2, gameplay)**: `sanitizeSave()` coerces `settings.quality` with `safeQuality()` (`QUALITY_TIERS` /
  `DEFAULT_QUALITY` exported from `src/core/Save.ts`), and `Game.applySettings()` re-coerces before calling
  `renderer.setQuality`, so a bad tier can no longer reach the Renderer from the save or from Settings. The
  defensive `if (!(q in TIERS)) q = 'high'` inside `Renderer.setQuality` is requested from the render owner (belt and braces).

## BUG-QA-001 — Dawn choice leaks into the next run
- **Severity**: S2-High · **Priority**: P1 · **System**: `src/game/Game.ts` (`wireEvents` → `boss:killed`)
- **Repro**: kill the boss, then die (or abandon via pause) within 2.2 s, then press **Again** within 2.2 s of the kill.
- **Expected**: a fresh run in `playing`.
- **Actual**: the old `window.setTimeout(..., 2200)` fires, sees `state === 'playing'` and opens "The master has fallen" in
  the new run. Picking "Greet the Dawn" ends the new run as a victory: a free boss-victory payout and night unlock.
- **Fix**:
  ```ts
  ev.on('boss:killed', () => {
    ...
    const run = this.run;
    window.setTimeout(() => {
      if (this.run !== run) return;          // run changed (restart / menu) — drop the stale timer
      if (this.state === 'playing') this.openDawnChoice();
      else if (this.state === 'levelup' || this.state === 'paused') this.dawnPending = true;
    }, 2200);
  });
  ```
  Better still: drive the delay from game time, e.g. `this.dawnAt = this.run.elapsed + 2.2` checked in `updateRun`. That also makes it
  pause-aware and timeScale-aware, and it fixes BUG-QA-002.
- **Test**: `tests/unit/game-state.test.ts › bossKilled_thenNewRunWithin2s_dawnDoesNotLeakIntoNewRun` (flipped to `it`).
- **Fixed (Sprint 2, gameplay)**: the timer captures the run and returns if `this.run !== run` or the game is in
  menu/gameover; it only sets `dawnPending` (opening immediately when playing). `endRun`/`toMenu` clear `dawnPending`.

## BUG-QA-002 — Dawn choice lost if paused when the timer fires
- **Severity**: S2-High · **Priority**: P2 · **System**: `src/game/Game.ts`
- **Repro**: kill the boss, press Esc within 2.2 s, wait, then resume.
- **Expected**: the dawn/endless choice appears after resuming.
- **Actual**: the timer sets `dawnPending = true`, but only `afterChoice()` and `closeChest()` consume it. The run continues past the boss
  with only the trickle of adds and no choice until the next level-up, which can take a long time at high level. A tab switch also
  auto-pauses, so this is easy to hit.
- **Fix**: at the end of `updateRun` (after the level-up check):
  `if (this.state === 'playing' && this.dawnPending) this.openDawnChoice();`. The game-time approach in BUG-QA-001 also fixes it.
- **Test**: `tests/unit/game-state.test.ts › bossKilled_pausedWhenTimerFires_dawnAppearsAfterResume` (flipped to `it`).
- **Fixed (Sprint 2, gameplay)**: `updateRun` ends with `else if (state === 'playing' && dawnPending) openDawnChoice()`.

## BUG-QA-005 — Save loader trusts field types
- **Severity**: S3-Medium · **Priority**: P2 · **System**: `src/core/Save.ts`
- **Repro**: a save with `"unlocked": null, "meta": null` boots, then throws on the first `save.unlocked.includes` /
  `save.meta[id]` (setup screen, Hearth, level-up roll). `"ash": "lots"` turns into `NaN` Ash.
- **Fix**: after the merge in `loadSave()`, coerce each field:
  ```ts
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const arr = (v: unknown, d: string[]) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : d);
  out.ash = num(out.ash, 0); out.totalAsh = num(out.totalAsh, 0); out.bestTime = num(out.bestTime, 0); ...
  out.unlocked = [...new Set([...def.unlocked, ...arr(out.unlocked, [])])];
  out.meta = out.meta && typeof out.meta === 'object' && !Array.isArray(out.meta) ? out.meta : {};
  if (!['low', 'medium', 'high'].includes(out.settings.quality)) out.settings.quality = def.settings.quality;
  ```
- **Tests**: `tests/unit/save.test.ts › Save: corrupt field types` (flipped to `it`) + `tests/unit/save-sanitize.test.ts` (20 cases).
- **Fixed (Sprint 2, gameplay)**: `sanitizeSave()` in `src/core/Save.ts` coerces every known field (numbers finite and ≥ 0,
  string arrays filtered, `meta`/`lifetime` number records, settings clamped), keeping unknown keys for forward compatibility.

## BUG-QA-003 — Skip/reroll callable outside level-up
- **Severity**: S4-Low · **Priority**: P3 · **System**: `src/game/Game.ts`
- **Repro**: call `game.skipUpgrade()` while playing, e.g. a focused-but-hidden Skip button activated by gamepad A from the pause menu.
- **Actual**: burns the run's skip, grants +5 Ash, and decrements `pendingLevelUps`.
- **Fix**: first line of `skipUpgrade()` and `rerollUpgrades()`: `if (this.state !== 'levelup') return;`
- **Test**: `tests/unit/game-state.test.ts › skipUpgrade_whilePlaying_ignored` (flipped to `it`).
- **Fixed (Sprint 2, gameplay)**: both methods (and `resolveDawn`) return unless `state === 'levelup'` in the right mode.

## BUG-QA-006 — RNG state drift
- **Severity**: S4-Low · **Priority**: P3 · **System**: `src/core/Rng.ts`
- **Detail**: `this.s += 0x6d2b79f5` grows without bound. After about 4.9M `next()` calls the float state passes 2^53 and the
  sequence no longer matches mulberry32. Output stays statistically OK but stops being exactly reproducible against a reference.
  Long or endless runs make millions of draws.
- **Fix**: `let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);`. The output is identical up to the precision-loss point.
- **Test**: `tests/unit/core.test.ts › next_afterFiveMillionCalls_stillMatchesUint32Reference` (flipped to `it`).
- **Fixed (Sprint 2, gameplay)**: state wrapped with `>>> 0` every draw.

## BUG-QA-008 — Per-frame allocations in input handling
- **Severity**: S4-Low (perf hygiene) · **System**: `src/core/Input.ts`, `src/game/Game.ts`
- `anyPressed(...codes)` allocates a rest array on each call (about 10 calls per frame from `handleGlobalInput`).
  `gp.buttons.forEach((b, i) => …)` allocates a closure each frame while a pad is connected.
- `PickupManager.spawn` (`src/entities/Pickups.ts`) runs `Object.assign(p, { active, kind, x, z, ... })`, which allocates an
  object literal per drop. That's one per kill: 10–20/s late game, plus the 36-enemy swarm bursts.
- **Fix**: use fixed-arity overloads or a `for` loop over a static `readonly string[]`, and a plain `for` loop over `gp.buttons`.
  In `spawn`, assign the fields directly (`p.active = true; p.kind = kind; …`).
- **Fixed (Sprint 2, gameplay) — Input side**: `anyPressed(a, b?, c?)` is fixed-arity; gamepad buttons use a plain loop and
  precomputed `PAD_CODES`; touch handlers mutate their vectors in place. **Open — Pickups side**: `PickupManager.spawn`'s
  `Object.assign` is in `src/entities/Pickups.ts` (not gameplay-owned) — requested from its owner.

## BUG-QA-009 — timeScale tunnelling (debug only)
- **Severity**: S4-Low · **System**: `src/game/Game.ts` `frame()`
- `dt = min(0.05, real) * timeScale` means `debug.timeScale = 3` gives 0.15 s steps. Fast projectiles can skip past enemies, so
  automation that uses timeScale under-reports weapon effectiveness. `tools/playtest-bot.mjs` avoids this with fixed 1/30 s
  substeps through `updateRun`.
- **Fix (optional)**: in `frame()`, loop `updateRun` in ≤ 1/30 s substeps when `timeScale > 1`.
- **Fixed (Sprint 2, gameplay)**: exactly that (`MAX_SUBSTEP = 1/30`, only when `timeScale > 1`, so normal play is unchanged).
  Test: `tests/unit/game-state.test.ts › timeScaleAboveOne_simulatesInSmallSteps`.

---

## Sprint 2 QA pass (2026-11-04, working tree after the six sprint-2 agents)

Build `npx vite build` (scratchpad `s2-qa-build`), headless Chromium + SwiftShader, 4-core box shared with another
agent's probe (load 6–9). Evidence: `production/qa/evidence/s2-qa-*.png`.

### BUG-QA-010 — Bearer model and lantern light never leave the origin (S1, P0)
- **System**: `src/entities/Player.ts` `update()` (not QA-owned). Reported independently by world-render and release.
- **Repro**: start a run, hold D for 6 s. `__game.player.x ≈ 3.8`, `__game.player.group.position.x === 0`.
- **Actual**: the hooded bearer, the lantern glass and the lantern **PointLight** (the warm pool, the prop cube shadow)
  stay at (0,0) while camera, enemies, weapons and the light-wash shader follow `player.x/z`. Every gameplay frame
  after the first steps shows an empty centre (`s2-qa-smoke-03-gameplay.png`, `-06-combat.png`, `-07-boss.png`).
- **Cause**: eb9cca8 removed `this.group.position.set(this.x, 0, this.z)` when it added `animate()`.
- **Fix**: in `Player.update()`, right before `this.animate(dt, time, speed)` (Player.ts ~line 452):
  `this.group.position.set(this.x, 0, this.z);`
- **Tests**: `tests/unit/sprint2-qa.test.ts › update_movingRightForThreeSeconds_groupPositionMatchesPlayerXZ`
  (`it.fails`, watched failing: group 0 vs player 17.66 — flip to `it` with the fix). `tools/smoke.mjs` now FAILS with
  "bearer model not at player position" until fixed. Afterwards delete the WORKAROUND block in `tools/package-screens.mjs`.

### BUG-QA-011 — Settings changes re-apply the render tier (S3)
- **System**: `src/game/Game.ts` `applySettings()` → `renderer.setQuality(s.quality)` on every call; the Settings screen
  calls `applySettings()` on every slider `input` event and every toggle.
- **Measured**: 5 volume-slider input events = 5 `setQuality` calls. Each runs `applyTier()` (shadow-map + post
  quality, `resize()` of every render target, `renderQuality.version++` → World re-applies grass / props tiers) and
  **resets the automatic fallback** (`effective = quality`, ceiling cleared), so a player whose machine had been
  stepped down gets the heavy tier back just by touching the music slider.
- **Fix** (Game.ts): remember the applied tier — `if (s.quality !== this.appliedQuality) { this.appliedQuality = s.quality; this.renderer.setQuality(s.quality); }`
- **Test**: `tests/unit/game-state.test.ts › applySettings_volumeChangeOnly_doesNotReapplyQualityTier` (`it.fails`, watched failing: 2 calls vs 0).

### BUG-QA-012 — Enemy LOD / shadows ignore the automatic fallback (S3)
- `EnemyManager.renderQuality` exists but nothing sets it, so the horde LOD and enemy moon shadows follow
  `save.settings.quality` while the Renderer (and World) may be drawing a lower tier. **Fix** (Game.ts `frame()`, before
  `updateRun`): `this.enemies.renderQuality = this.renderer.effectiveQuality;`. Covered on the Enemies side by
  `sprint2-qa.test.ts › renderQualityOverride_lowWhileSettingsHigh_usesLod`.

### BUG-QA-013 — Reliquary closes before it can be read (S3)
- `Game.openChest()` sets `chestTimer = evolved ? 4.5 : 2.8`; the UI reveal for 3–4 items lands its last card at
  ~2.3 s and publishes `ui.chestHold` (up to ~3.7 s) that Game ignores. **Fix**: after `ui.showChest(...)`:
  `this.chestTimer = Math.max(this.chestTimer, (this.ui as unknown as { chestHold?: number }).chestHold ?? 0);`

### BUG-QA-014 — Reduce Flashing leaves the red damage pulse at full strength (S3, accessibility)
- `Renderer.render()` writes `uDamage = damagePulse` unscaled; Fx honours `a11y-noflash`, the post grade does not.
  **Fix** (Renderer.ts render): `u.uDamage.value = this.damagePulse * (document.documentElement.classList.contains('a11y-noflash') ? 0.35 : 1);`

### BUG-QA-015 / 016 / 017 (S4)
- **015**: `Renderer.setQuality(q)`: add `if (!(q in TIERS)) q = 'high';` (Game/Save already sanitise).
- **016**: `PickupManager.spawn` (Pickups.ts:93) and `EnemyManager.spawn` (Enemies.ts ~242) allocate an object literal per
  spawn via `Object.assign`; assign fields directly. Enemy spawn also counts its type with an O(n) scan of `list`.
- **017**: banish hotkey: `Game.handleGlobalInput` checks `inp.keys.has('ShiftLeft')` when the frame runs, not when Digit
  was pressed. On a slow frame a quick Shift+1 tap chooses card 1 instead of banishing it (seen in the exploratory
  script). Record `e.shiftKey` with the press in Input, or treat `Shift` as held until `endFrame`.

### BUG-QA-018 — Game-over screen overflows at 720p (S3)
- Repro: a long first run that earns 6 achievements (exploratory pass: First Vigil, Five Minutes, Deep Night, Unscathed,
  Dawn Keeper, Absurd Light) at 1280×720 → the "This vigil" list runs off the bottom; Main Menu / Light Again are
  below the fold (`s2-qa-ex-10-gameover.png`). Sprint 2 made menu/level-up/chest/dawn/pause shrink-to-fit, not game over.
- Fix (`src/ui/UI.ts` FIT table, line ~49): add `gameover: ['.go-wrap', 0.6],` (and cap the list with its own scroll
  or a "+N more" line if the zoom floor is reached).

### BUG-QA-019 — Director announcements overlap (S4)
- `Director.ts` lines 150/275/297/309 all call `fx.text(player.x, 3.5, player.z, …, 'ft-big')` at the same spot; in the
  endless night (boss return + swarm + elite) they render as one unreadable smear (`s2-qa-ex-09-endless.png`).
- Fix: one announcer that queues big banners (≥ 1.2 s apart) or offsets each concurrent one by a line, e.g. route
  through `ui.toast` with a queue.

### BUG-QA-020 — Stale low-light hint (S4)
- The 'lowlight' hint fired at 30 % light, the boss flare refilled to 100 %, and the hint card was then shown
  (queued/replayed) at 100/100 (`s2-qa-ex-07-boss.png`, `-ex-09-endless.png`).
- Fix: let a hint carry a `stillValid()` check (or have UI drop `lowlight` when light ≥ HINT_LOW_LIGHT when its turn comes).

### BUG-QA-021 — CameraRig.snap() during the swoop (S4, tooling)
- `snap()` sets `blend = 1`, but while `mode` is still 'menu' the next `follow()` resets `blend = 0` and plays the swoop
  from the menu pose. Hits automation that snaps right after `startRun()` (`s2-qa-ex-12-restart.png`, release's
  package-screens note). Fix (`src/render/CameraRig.ts` snap): also set `this.mode = 'follow'` (and copy the
  desired pose). `tools/smoke.mjs` now calls `follow()` once before `snap()` as a workaround.

### Notes (no bug filed)
- Boss collapse: in normal play the dawn choice opens 2.2 s (real time) after `boss:killed`, so the 1.2 s collapse is
  visible (characters' "frozen on first frame" note does not reproduce). Only if the player pauses inside that window
  does the dawn screen open on the first resumed frame and cut the collapse short.
- Endless returning masters cycle through all three nights' bosses (Mire Mother appeared on Pines at 18:00); looks
  intentional (`bosses[endlessBosses % 3]`), flagging for design confirmation.
- `navigator.webdriver` disables the automatic quality fallback, so smoke/perf/bots never exercise it; it has no
  automated coverage (needs WebGL). Recommend extracting the window/step state machine from Renderer.ts into a pure
  class so it can be unit-tested.

### Verified OK this pass
- Reliquary reveal (plain + evolution), Continue button, Space-skip-then-Enter; dawn screen after `boss:killed`, its
  0.9 s input lock, Endless Night continues with `run.endless`, the victory screen after an endless death, Light Again
  and Main Menu from game over; settings quality low/high from menu and pause; Reduce Flashing sets `a11y-noflash`;
  first-run intro card is non-blocking; tutorial hint card shows; no console errors in smoke or the exploratory pass.
- `tools/smoke.mjs` extended: `smoke-09-chest`, `-10-chest-evolution`, `-11-dawn`, `-12-endless`, `-13-victory`, a
  bearer-position assertion, god mode without the invuln blink, damage-pulse reset before shots, boss spawn played
  out in sim time, portrait shot fast-forwarded past the camera swoop.

## Sprint 3 QA pass (2026-11-04, working tree after readability / world-look / ui / gameplay)

**Build:** scratchpad `s3-qa-build` (vite build of the working tree). **Automated:** `tsc --noEmit` clean; Vitest
**20 files / 261 tests pass** (248 + 13 new). New regression file `tests/unit/sprint3-qa.test.ts` (11 tests) plus
`Game S3 QA` block in `tests/unit/game-state.test.ts` (2 tests; the Player mock now has the `setXray` no-op world-look
asked for). Every new regression test was run against a copy of the tree with its fix reverted (contact-cd/number-handle
reset, i-frame gate, NUMBERS_CROWD, hostile palette, onHit reset, Fx banner de-dup, Fx `activeNums` decrement/clear,
outro guard, `setXray` call) and **all 10 targeted tests failed there**, then pass on the real tree.
**Browser:** smoke (`tools/smoke.mjs`), two exploratory flow scripts (scratchpad `s3-explore.mjs`, `s3-explore2.mjs`),
a death probe and `tools/perf.mjs`. The machine ran at load average 12–27 (other agents' browsers), so SwiftShader
frames took seconds; real-time checks were replaced by fixed-step sim checks where noted.

### BUG-QA-022 — X-ray silhouette doubles the bearer's draw calls (S3, perf)
- `Player.mountRig()` (Player.ts ~196–212) adds an x-ray `Mesh` child to **every** non-basic bearer mesh: 16 extra
  draws, always on in a run. perf.mjs: low 72 → **88** draws (+22 %, both 100 and 350 enemies), high 131 → **152** (100)
  and 142 → **156** (350); the per-mesh census shows `Head_1`, `Body_1`, `Body_2`, a 2nd `Staff_1` etc. Far inside the
  220 budget, but it trips the +15 % regression gate and is a fixed cost on the low tier (phones).
- Fix (Player.ts:204): only silhouette the parts that make the outline, e.g. before the loop
  `parts.sort((a, b) => (b.geometry.boundingSphere?.radius ?? 0) - (a.geometry.boundingSphere?.radius ?? 0)); parts.length = Math.min(parts.length, 5);`
  (call `computeBoundingSphere()` first), or match by name (`/body|robe|hood|head|cape/i`). Optionally skip x-ray on
  `quality === 'low'`. Re-baseline perf after.

### BUG-QA-023 — Legacy Fx banners swallowed / doubled (S4)
- `style.css` hides `.fx-banner` while `#ui-root.announcing`, but Fx keeps playing its 1.2 s banner underneath, so an
  'ENRAGED' / 'REKINDLED' that coincides with a UI banner is never seen (explore2: UI 'An elite approaches…' and Fx
  'ENRAGED' both "on" in the same sample; the Fx one was invisible). On boss enrage the player also gets two banners
  for one event: Enemies 'ENRAGED' (Fx) and Game's `'<Boss> is enraged!'` (UI).
- Fix: Enemies.ts:801 delete `ctx.fx.text(e.x, 4.5, e.z, 'ENRAGED', 'ft-big');` (Game's `boss:enraged` handler already
  announces). Fx.ts:388 `banner()`: `if (this.bannerSink) { this.bannerSink(str); return; }` with
  `bannerSink: ((s: string) => void) | null = null;`, and in Game's constructor after the UI exists:
  `this.fx.bannerSink = (s) => this.announce(s, 'buff');` — Player 'REKINDLED' (Player.ts:482) then goes through the
  UI queue too.

### BUG-QA-024 — Boss banners play in reverse order (S4)
- UI.ts:666 `if (a.kind === 'boss') this.annQ.unshift(a);` — two queued boss banners are LIFO. Seen in explore2 with a
  backed-up queue: `['The master of this night has come.', 'The master of this night stirs…', …]`. Also hits
  'has come' + 'is enraged!' in a short fight.
- Fix (UI.ts:666): insert after the last queued boss banner:
  `if (a.kind === 'boss') { const i = this.annQ.findIndex((q) => q.kind !== 'boss'); this.annQ.splice(i < 0 ? this.annQ.length : i, 0, a); }`

### BUG-QA-025 — Reliquary can interrupt the boss collapse (S4)
- `chest:opened` (Game.ts:280) calls `openChest()` straight away; level-ups and the dawn wait for `outroT`, a chest
  does not. An elite chest collected within the 1.3 s outro freezes the collapse behind the reliquary.
- Fix (Game.ts:280): `ev.on('chest:opened', () => { if (this.outroT > 0) this.chestQueued = true; else this.openChest(); });`
  and in `updateRun` after the outro guard: `if (this.chestQueued) { this.chestQueued = false; this.openChest(); return; }`
  (reset `chestQueued` in `startRun`).

### BUG-QA-026 — Boss slow-mo can outlive the dawn screen (S4)
- `slowT` only drains on frames where `state === 'playing'`. When the dawn opens before 0.6 s of real playing frames
  have passed (ff tools, very slow devices; explore2: `slow: 0.45` after choosing Endless Night) the endless night resumes
  in 0.35× slow motion.
- Fix (Game.ts:556 `openDawnChoice()` first line): `this.slowT = 0;` (and in `updateRun` when `outroT` crosses 0).

### BUG-QA-027 — First-run announcements dropped behind hint cards (S4)
- `UI.tickAnnounce` (UI.ts:684–686) ages queued banners while a hint card is up and drops them after
  `ANNOUNCE_MAX_WAIT` (3 s). Hint cards stay ~5–7 s, so on runs 1–3 an elite / boss warning raised during a hint is
  lost (explore pass 1: a burst of 3 banners during the WASD hint → none ever shown). Intended for 'danger' spam,
  but 'boss' and 'elite' carry gameplay information.
- Fix (UI.ts:685): `if (!(this.hintCur && (this.annQ[i].kind === 'boss' || this.annQ[i].kind === 'elite'))) this.annQ[i].wait += dt;`

### BUG-QA-028 — Smoke fast-forward died at 0:34 under load (tooling, fixed by QA)
- `tools/smoke.mjs` steered with held keys, but `Input.update()` only runs on real frames; at ~0.2 fps the D→W switch
  never reached the sim, the bearer ran head-on into a rock at x ≈ 160 and was swarmed (death probe: pinned at
  x = 160.5 / 102.9 in 2 of 3 runs). Every later smoke shot was the game-over screen.
- Fixed: the fast-forward sets `g.input.moveX/moveZ` per step; `SMOKE_TIMEOUT_MS` raises the 180 s step timeout.
- Also fixed: smoke sim loops now call `g.fx.update(1/30)` after `updateRun`, so bursts age with the sim. Without it the
  boss close-up showed the boss-spawn + lantern-flare bursts un-aged as one white blob (`evidence/s3-qa-smoke-07-boss-unaged-fx.png`) —
  a tool artifact, not a game bug (re-shot with aged FX: `evidence/s3-qa-smoke-07-boss.png`, clean; final smoke run OK, 12 shots).

### BUG-QA-029 — Late-game white-out above target; Glacier Heart hides the bearer (S2)
- QA re-ran readability's horde probe (`scratchpad/s3-readability/probe.mjs horde`, its `sim` calls `fx.update`, so FX
  age) on the QA build and measured with its `luma.py` (share of luma > 0.85 in the centre 40 %, 1280×720, high):
  **Pines 26.7 % / 13.7 %, Ruins 16.9 % / 11.2 %** (readability reported 10.7 / 5.6 and 17.4 / 9.5; target ≤ 10 %).
  Centre mean luma 0.64–0.73. Evidence: `evidence/s3-qa-luma-horde-pines-0.png`, `-ruins-0.png`.
- Ruins: the Glacier Heart volley is a ring of ~24 ice shards plus a white core **on the bearer** — she is not findable
  in that frame. The shard bodies are `ProjectileManager.shards` (MeshStandardMaterial, emissive ×1.6·gain), which has
  no focus falloff; `fx.glacierNova` adds a 2.0-intensity white shock + rune at her feet.
- Pines: Solar Crown / Cathedral Toll rings over a lantern pool that world-look made brighter (pool luma 0.54 → 0.70,
  their own open note) — the cream centre is mostly pool + rings, not particles.
- Fix (readability): Projectiles.ts:385 scale shards by the focus falloff,
  `tmpS.set(1.25 * sc, 1.1 * sc, 1.1 * sc).multiplyScalar(0.35 + 0.65 * focusFactor(p.x - player.x, p.z - player.z));`
  (import `focusFactor` from `../render/vfx/focus`; `player` is in scope in `update`), or spawn Glacier Heart shards at
  ≥ 1.2 m. Fx.ts:1099–1101 `glacierNova`: start the shock at 1.2 m and halve it — `GM_SHOCK, x, z, 1.2, 3.4, 0.35, 0xd8f8ff, 1.0, 0.1`,
  rune intensity 1.4 → 0.6. Fix (world-look): cap the pool's amber push so Pines pool luma ≤ ~0.6 (their tuning knob in
  WorldShading). Then re-measure with fx aging; a real-GPU check is still owed.

### Sprint 3 items verified
- **BUG-QA-016**: pooled spawn resets incl. the new `contactCd` / `numSlot` / `numSerial` (unit). **BUG-QA-017**: browser
  Shift+1 tap released before the frame → banish (1 → 0). **BUG-QA-018**: 11 achievements → 3 cards + "+8 more", all
  three buttons on screen at 1280×720. **BUG-QA-019**: elite + swarm + rush + duplicate in one frame → one UI banner at a
  time at 22 % (de-dup works; Fx path de-dups too). **BUG-QA-020**: unit-tested (`Tutorial.forget`); in the browser the
  stale 'lowlight' never surfaced after a refill (the WASD hint was still up, so inconclusive rather than a pass).
- Boss outro: kill → `outroT 1.3 / slowT 0.6`; the 2.2 s dawn timer fired mid-outro and only flagged `dawnPending`; the
  dawn opened when the outro ended (sim) — and stays closed while paused (new unit test).
- Endless: first returning master on Pines is `boss_hollow_stag` (night's own). Fresh run after menu: no boss, victory
  false, outro/slow 0, banner queues empty, x-ray off on menu / on in run.
- Fx layer (`visibility: hidden`) under the level-up modal; boss bar at the bottom centre (y 643–717 of 720).
- Contact cooldown is not burnt during i-frames; non-crit numbers hidden above 150 enemies; hostile shots within ±8° of
  #ff3df0 for warm and cool casters; damage-number cap frees up as numbers expire (all unit).
- **BUG-QA-010, 014, 015, 021** were already fixed in the sprint-2 commit (code checked), now closed.
- No console errors in either exploratory pass.

### Notes (no bug filed)
- Death probe: holding one direction into a rock pins the bearer (purely radial push-out, no slide) — fine for real
  input, but bots should steer.
- Endless with a stationary god-mode bearer: the horde piles into a mound that hides her completely; the x-ray
  silhouette is not readable through 3+ layers of enemies (`s3ex2-04-endless.png`). Only reachable with god mode.
- The UI banner at 22 % sits over a boss entering from the top (`s3ex2-02-boss.png`, `-04-endless.png`); 1.2 s only.
- The bottom-centre boss bar now covers the strip where enemies approach from the camera side (~75 px).
- World-look occlusion dither: a waist-high rock on the camera side of the bearer turns into a large blue Bayer-halftone
  patch (`evidence/s3-qa-smoke-03-gameplay.png`, also `perf-high-350.png`) — reads like a rendering glitch. Suggest
  limiting the ramp to fragments above ~1.2 m or closer to the camera than the bearer by > 1 m (world-look's own known item).
- Readability "Crits only" damage-number setting (readability request to UI) is not implemented yet.
- `tools/perf.mjs` high/350 sim read 4.09 ms at load ~25; the quiet re-run (load 6–8) gives **1.55 ms** (S2 1.81), low/350
  1.85 ms (S2 2.28) — no sim regression. Draw calls: see BUG-QA-022. Details in `perf-report.md`.

## State-machine edge cases verified OK (automated, `tests/unit/game-state.test.ts`)
- Esc during level-up: ignored (no pause, choice kept). Tab hidden during level-up: stays on level-up.
- Tab hidden while playing: pauses, stays paused when the tab returns, and the simulation does not advance while paused.
- Chest during level-up: applied immediately with a toast, and the level-up overlay is kept. Chest with a pending level-up: the
  level-up follows the reliquary. The reliquary auto-closes on its timer.
- Death and level-up in the same frame: game over wins. Death in the same frame a chest opens: game over after the reveal.
- Boss kill and death in the same frame: counts as a victory, and the stale dawn timer does not reopen anything after game over.
- `endRun` twice: counted once. `chooseUpgrade` after game over: ignored. Banishing every offer never leaves an empty card list.
- Resize to portrait mid-run (Playwright 390×844): the HUD fits, the camera FOV switches to 62°, no errors (`smoke-08-portrait.png`).
