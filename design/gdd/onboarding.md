# Onboarding (first-run hints)

**Owner:** gameplay (logic) · UI (presentation). **Code:** `src/game/Tutorial.ts`, `src/data/tutorial.ts`, wiring in
`src/game/Game.ts` (`wireEvents`, `openLevelUp`, `updateRun`).

## Overview
A first-time buyer must understand the game in 30 seconds without a tutorial level. The game teaches by
*moment*: the first time something important happens, one short line explains it. No pop-up blocks play.

## Player fantasy
"I was never confused, and nobody stopped the game to lecture me."

## Rules
- Active only while `save.runs < TUTORIAL_RUNS` (2) **and** `save.settings.hints` is on.
- Each hint id fires at most once per save (`save.hintsSeen`, persisted immediately). A second run only teaches
  what the first one never reached (elites, reliquaries, the boss…).
- Game emits `events.emit('tutorial:hint', { id, text, duration, priority })`; the UI renders it (non-blocking banner).
  If a hint is on screen and a new one arrives, the UI shows the higher `priority` first and queues the other.
- Text is chosen per input device at emit time: touch > gamepad > keyboard (`HintDef.touch/gamepad/text`).

| id | Trigger (first time) | Priority | Text (keyboard) |
|---|---|---|---|
| move | 0.8 s after the run starts | 3 | WASD / arrow keys to move — your weapons fire on their own |
| ember | first kill after 7 s | 2 | Gather the embers they leave behind to grow stronger |
| damage | first hit taken | 4 | Your light is your life — don't let it go out |
| levelup | first level-up overlay | 3 | Choose a gift. A weapon at MAX level evolves when you also carry its paired relic |
| oil | first oil flask dropped | 3 | An oil flask! Grab it to refill your lantern |
| lowlight | light < 35 % | 5 | Your light is fading — keep moving and find oil |
| elite | first elite spawned (`elite:spawned`) | 3 | An elite approaches — defeat it to earn a reliquary |
| chest | first reliquary dropped | 4 | A reliquary! Walk over it to claim its gifts |
| boss | boss arrives | 5 | The master has come and your lantern flares — step out of the glowing rings before they strike |

## Edge cases
- Hints never fire in the menu, while paused, after game over, or during the level-up overlay (except `levelup`).
- A hint that cannot fire (inactive tutorial) is **not** marked seen.
- Turning hints off in Settings stops them immediately on the next run.
- Corrupt `hintsSeen` in a save is sanitised to a string array (`sanitizeSave`).

## Tuning knobs
`TUTORIAL_RUNS` (Save.ts), `HINT_MOVE_DELAY`, `HINT_EMBER_AFTER`, `HINT_LOW_LIGHT`, per-hint `duration`/`priority`
(src/data/tutorial.ts).

## Acceptance criteria
- Fresh save: the move hint appears within 1 s of the run starting; a hit taken shows the light hint.
- After two finished runs no hint fires. Tests: `tests/unit/tutorial.test.ts`, `tests/unit/game-state.test.ts`.
