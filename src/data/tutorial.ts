/**
 * First-run onboarding hints (design/gdd/onboarding.md). Text lives here so it can be tuned/localised without code.
 * `text` may differ per input device; the device is picked when the hint fires (touch > gamepad > keyboard).
 * `duration` is the suggested on-screen time in seconds (the UI may hold it longer while the player reads).
 */
export interface HintDef {
  id: string;
  text: string;
  touch?: string;
  gamepad?: string;
  duration: number;
  /** Higher = more important: if two hints overlap, the UI may replace a lower-priority one. */
  priority: number;
}

export const HINTS: Record<string, HintDef> = {
  move: {
    id: 'move', priority: 3, duration: 6,
    text: 'WASD / arrow keys to move — your weapons fire on their own',
    touch: 'Drag anywhere to move — your weapons fire on their own',
    gamepad: 'Left stick to move — your weapons fire on their own',
  },
  ember: { id: 'ember', priority: 2, duration: 5, text: 'Gather the embers they leave behind to grow stronger' },
  damage: { id: 'damage', priority: 4, duration: 5, text: "Your light is your life — don't let it go out" },
  levelup: {
    id: 'levelup', priority: 3, duration: 7,
    text: 'Choose a gift. A weapon at MAX level evolves when you also carry its paired relic',
  },
  oil: { id: 'oil', priority: 3, duration: 5, text: 'An oil flask! Grab it to refill your lantern' },
  lowlight: { id: 'lowlight', priority: 5, duration: 5, text: 'Your light is fading — keep moving and find oil' },
  elite: { id: 'elite', priority: 3, duration: 5, text: 'An elite approaches — defeat it to earn a reliquary' },
  chest: { id: 'chest', priority: 4, duration: 5, text: 'A reliquary! Walk over it to claim its gifts' },
  boss: {
    id: 'boss', priority: 5, duration: 6,
    text: 'The master has come and your lantern flares — step out of the glowing rings before they strike',
  },
};

/** Seconds after the run starts before the movement hint appears (lets the camera settle). */
export const HINT_MOVE_DELAY = 0.8;
/** Run seconds before the 'ember' hint may fire (the movement hint gets its time on screen first). */
export const HINT_EMBER_AFTER = 7;
/** Light fraction below which the low-light hint fires. */
export const HINT_LOW_LIGHT = 0.35;
