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
| BUG-QA-007 | S2-High | P1 | Open | Save + Renderer | Unknown `settings.quality` in a save bricks boot ("The lantern would not light") |
| BUG-QA-001 | S2-High | P1 | Open | Game state machine | Dawn choice from a previous run's boss kill leaks into the next run |
| BUG-QA-002 | S2-High | P2 | Open | Game state machine | Boss killed and paused before the 2.2 s dawn timer fires: the dawn/endless choice never appears |
| BUG-QA-005 | S3-Medium | P2 | Open | Save | `loadSave()` accepts wrong field types (`unlocked: null`, `meta: null`, `ash: "x"`) and crashes later |
| BUG-QA-003 | S4-Low | P3 | Open | Game state machine | `skipUpgrade()` / `rerollUpgrades()` have no `state === 'levelup'` guard |
| BUG-QA-006 | S4-Low | P3 | Open | Core RNG | `Rng` state is never wrapped to uint32 and drifts off mulberry32 after ~4.9M draws |
| BUG-QA-008 | S4-Low | P3 | Open | Input / Game loop | Small per-frame allocations in the input path (`anyPressed(...codes)`, `gp.buttons.forEach` closure) |
| BUG-QA-009 | S4-Low | P4 | Open (debug only) | Game loop | `debug.timeScale` multiplies the already-clamped dt, so steps above 0.05 s can tunnel projectiles |

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
- **Test**: `tests/unit/save.test.ts › loadSave_unknownQualityTier_fallsBackToDefaultTier` (`it.fails`).

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
- **Test**: `tests/unit/game-state.test.ts › bossKilled_thenNewRunWithin2s_dawnDoesNotLeakIntoNewRun` (`it.fails`).

## BUG-QA-002 — Dawn choice lost if paused when the timer fires
- **Severity**: S2-High · **Priority**: P2 · **System**: `src/game/Game.ts`
- **Repro**: kill the boss, press Esc within 2.2 s, wait, then resume.
- **Expected**: the dawn/endless choice appears after resuming.
- **Actual**: the timer sets `dawnPending = true`, but only `afterChoice()` and `closeChest()` consume it. The run continues past the boss
  with only the trickle of adds and no choice until the next level-up, which can take a long time at high level. A tab switch also
  auto-pauses, so this is easy to hit.
- **Fix**: at the end of `updateRun` (after the level-up check):
  `if (this.state === 'playing' && this.dawnPending) this.openDawnChoice();`. The game-time approach in BUG-QA-001 also fixes it.
- **Test**: `tests/unit/game-state.test.ts › bossKilled_pausedWhenTimerFires_dawnAppearsAfterResume` (`it.fails`).

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
- **Tests**: `tests/unit/save.test.ts › Save: corrupt field types` (3 × `it.fails`).

## BUG-QA-003 — Skip/reroll callable outside level-up
- **Severity**: S4-Low · **Priority**: P3 · **System**: `src/game/Game.ts`
- **Repro**: call `game.skipUpgrade()` while playing, e.g. a focused-but-hidden Skip button activated by gamepad A from the pause menu.
- **Actual**: burns the run's skip, grants +5 Ash, and decrements `pendingLevelUps`.
- **Fix**: first line of `skipUpgrade()` and `rerollUpgrades()`: `if (this.state !== 'levelup') return;`
- **Test**: `tests/unit/game-state.test.ts › skipUpgrade_whilePlaying_ignored` (`it.fails`).

## BUG-QA-006 — RNG state drift
- **Severity**: S4-Low · **Priority**: P3 · **System**: `src/core/Rng.ts`
- **Detail**: `this.s += 0x6d2b79f5` grows without bound. After about 4.9M `next()` calls the float state passes 2^53 and the
  sequence no longer matches mulberry32. Output stays statistically OK but stops being exactly reproducible against a reference.
  Long or endless runs make millions of draws.
- **Fix**: `let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);`. The output is identical up to the precision-loss point.
- **Test**: `tests/unit/core.test.ts › next_afterFiveMillionCalls_stillMatchesUint32Reference` (`it.fails`).

## BUG-QA-008 — Per-frame allocations in input handling
- **Severity**: S4-Low (perf hygiene) · **System**: `src/core/Input.ts`, `src/game/Game.ts`
- `anyPressed(...codes)` allocates a rest array on each call (about 10 calls per frame from `handleGlobalInput`).
  `gp.buttons.forEach((b, i) => …)` allocates a closure each frame while a pad is connected.
- `PickupManager.spawn` (`src/entities/Pickups.ts`) runs `Object.assign(p, { active, kind, x, z, ... })`, which allocates an
  object literal per drop. That's one per kill: 10–20/s late game, plus the 36-enemy swarm bursts.
- **Fix**: use fixed-arity overloads or a `for` loop over a static `readonly string[]`, and a plain `for` loop over `gp.buttons`.
  In `spawn`, assign the fields directly (`p.active = true; p.kind = kind; …`).

## BUG-QA-009 — timeScale tunnelling (debug only)
- **Severity**: S4-Low · **System**: `src/game/Game.ts` `frame()`
- `dt = min(0.05, real) * timeScale` means `debug.timeScale = 3` gives 0.15 s steps. Fast projectiles can skip past enemies, so
  automation that uses timeScale under-reports weapon effectiveness. `tools/playtest-bot.mjs` avoids this with fixed 1/30 s
  substeps through `updateRun`.
- **Fix (optional)**: in `frame()`, loop `updateRun` in ≤ 1/30 s substeps when `timeScale > 1`.

---

## State-machine edge cases verified OK (automated, `tests/unit/game-state.test.ts`)
- Esc during level-up: ignored (no pause, choice kept). Tab hidden during level-up: stays on level-up.
- Tab hidden while playing: pauses, stays paused when the tab returns, and the simulation does not advance while paused.
- Chest during level-up: applied immediately with a toast, and the level-up overlay is kept. Chest with a pending level-up: the
  level-up follows the reliquary. The reliquary auto-closes on its timer.
- Death and level-up in the same frame: game over wins. Death in the same frame a chest opens: game over after the reveal.
- Boss kill and death in the same frame: counts as a victory, and the stale dawn timer does not reopen anything after game over.
- `endRun` twice: counted once. `chooseUpgrade` after game over: ignored. Banishing every offer never leaves an empty card list.
- Resize to portrait mid-run (Playwright 390×844): the HUD fits, the camera FOV switches to 62°, no errors (`smoke-08-portrait.png`).
