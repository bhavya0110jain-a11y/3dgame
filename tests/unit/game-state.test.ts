/**
 * Game state-machine tests (menu / playing / levelup[levelup|chest|dawn] / paused / gameover).
 * Rendering, world, UI, audio, input and the player avatar are mocked; the REAL Game, RunState, Director,
 * EnemyManager, ProjectileManager, PickupManager, Upgrades and Achievements run underneath.
 * Edge cases come from the exploratory QA pass (production/qa/bugs.md).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ------------------------------------------------------------------ DOM / browser shims (before Game is imported)
const noop = () => {};
const anyObj: object = new Proxy(function () {} as object, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' || k === Symbol.iterator ? undefined : anyObj),
  apply: () => anyObj,
  construct: () => anyObj,
  set: () => true,
});
type Listener = (e?: unknown) => void;
const docListeners = new Map<string, Listener[]>();
const doc = {
  hidden: false,
  createElement: () => ({ width: 64, height: 64, style: {}, getContext: () => anyObj, appendChild: noop, addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop } }),
  addEventListener: (t: string, fn: Listener) => docListeners.set(t, [...(docListeners.get(t) ?? []), fn]),
  removeEventListener: noop,
  querySelector: () => null,
  getElementById: () => null,
  body: {},
  activeElement: null,
};
const g = globalThis as Record<string, unknown>;
g.document = doc;
g.window = { addEventListener: noop, removeEventListener: noop, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };
g.requestAnimationFrame = noop;
g.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };

// ------------------------------------------------------------------ module mocks
vi.mock('../../src/render/Renderer', async () => {
  const THREE = await import('three');
  class Renderer {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();
    damagePulse = 0;
    lighting = { attachLantern: noop, setExtent: noop, follow: noop };
    rig = { zoom: 1, focus: { x: 0, z: 0 }, menu: noop, follow: noop };
    applyBiome = noop;
    setQuality = noop;
    render = noop;
  }
  return { Renderer };
});
vi.mock('../../src/world/World', async () => {
  const { getBiome } = await import('../../src/data/biomes');
  class World {
    biome = getBiome('biome_pines');
    setBiome(b: unknown) { this.biome = b as ReturnType<typeof getBiome>; }
    update = noop;
  }
  return { World };
});
vi.mock('../../src/render/Fx', () => ({ FxManager: class { constructor() { return anyObj; } } }));
vi.mock('../../src/audio/Audio', () => ({ AudioManager: class { constructor() { return anyObj; } } }));
vi.mock('../../src/core/Input', () => ({
  Input: class {
    keys = new Set<string>();
    moveX = 0;
    moveZ = 0;
    pressedNow = new Set<string>();
    pressed(c: string) { return this.pressedNow.has(c); }
    anyPressed(...c: string[]) { return c.some((x) => this.pressedNow.has(x)); }
    update = noop;
    endFrame() { this.pressedNow.clear(); }
  },
}));
vi.mock('../../src/ui/UI', () => ({
  UI: class {
    calls: string[] = [];
    fxLayer = {};
    constructor() {
      return new Proxy(this, {
        get: (t, k: string) => (k in t ? (t as Record<string, unknown>)[k] : (...args: unknown[]) => { t.calls.push(k); void args; }),
      });
    }
  },
}));
vi.mock('../../src/entities/Player', async () => {
  const THREE = await import('three');
  class Player {
    x = 0; z = 0; vx = 0; vz = 0; aimX = 1; aimZ = 0; radius = 0.5;
    lightValue = 100; invuln = 0; dead = false;
    group = new THREE.Group();
    light = new THREE.PointLight();
    lightColor = new THREE.Color();
    setRobeColor = noop;
    reset(max: number) { this.lightValue = max; this.dead = false; this.invuln = 0; this.x = this.z = 0; this.group.visible = true; }
    update(dt: number) { if (this.invuln > 0) this.invuln -= dt; }
    lightFrac(max: number) { return Math.max(0, Math.min(1, this.lightValue / max)); }
    lightRadius() { return 8; }
    damage(amount: number) {
      if (this.dead || this.invuln > 0) return;
      this.lightValue -= amount;
      if (this.lightValue <= 0) { this.lightValue = 0; this.dead = true; }
    }
    heal(amount: number) { this.lightValue = Math.min(100, this.lightValue + amount); }
  }
  return { Player };
});

import type { Game as GameT } from '../../src/game/Game';
let Game: typeof GameT;
beforeAll(async () => {
  ({ Game } = await import('../../src/game/Game'));
});

/** Private/test-only surface reached through a cast (TS reduces intersections with private members to never). */
interface Internals {
  frame(): void;
  last: number;
  ui: { calls: string[] };
  input: { pressedNow: Set<string> };
  pendingChoices: { id: string; kind: string }[];
}
type Priv = GameT;
const internals = (game: GameT) => game as unknown as Internals;

function newGame(): Priv {
  const canvas = { parentElement: {}, addEventListener: noop } as unknown as HTMLCanvasElement;
  const game = new Game(canvas);
  game.startRun();
  game.enemies.clear(); // keep the arena quiet unless a test spawns something
  return game;
}
/** One simulated frame (the real Game.frame, with rendering mocked). */
function tick(game: Priv, n = 1): void {
  for (let i = 0; i < n; i++) internals(game).frame();
}
function press(game: Priv, code: string): void {
  internals(game).input.pressedNow.add(code);
  tick(game);
}
function hideTab(hidden: boolean): void {
  doc.hidden = hidden;
  for (const fn of docListeners.get('visibilitychange') ?? []) fn();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  docListeners.clear();
  doc.hidden = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Game state machine: basics', () => {
  it('startRun_fromMenu_entersPlayingWithStartWeapon', () => {
    const game = newGame();
    expect(game.state).toBe('playing');
    expect(game.run.weapons).toHaveLength(1);
  });

  it('pendingLevelUp_whilePlaying_opensLevelUpThenChoiceReturnsToPlaying', () => {
    const game = newGame();
    game.run.addXp(game.run.xpToNext);
    tick(game);
    expect(game.state).toBe('levelup');
    expect(game.levelMode).toBe('levelup');
    game.chooseUpgrade(0);
    expect(game.state).toBe('playing');
    expect(game.run.pendingLevelUps).toBe(0);
  });

  it('multipleLevelUps_queued_openOneAfterAnother', () => {
    const game = newGame();
    game.run.addXp(500);
    const n = game.run.pendingLevelUps;
    expect(n).toBeGreaterThan(2);
    tick(game);
    for (let i = 0; i < n; i++) {
      expect(game.state, `pick ${i}`).toBe('levelup');
      game.chooseUpgrade(0);
    }
    expect(game.state).toBe('playing');
  });

  it('endRun_calledTwice_countsRunOnce', () => {
    const game = newGame();
    const runs = game.save.runs;
    game.endRun(false);
    game.endRun(false);
    expect(game.save.runs).toBe(runs + 1);
    expect(game.state).toBe('gameover');
  });
});

describe('Game state machine: pause & tab visibility', () => {
  it('escape_duringLevelUp_doesNotPauseOrDropTheChoice', () => {
    const game = newGame();
    game.run.addXp(game.run.xpToNext);
    tick(game);
    press(game, 'Escape');
    expect(game.state).toBe('levelup');
    expect(game.run.pendingLevelUps).toBe(1);
  });

  it('tabHidden_whilePlaying_pauses', () => {
    const game = newGame();
    hideTab(true);
    expect(game.state).toBe('paused');
    hideTab(false);
    expect(game.state).toBe('paused'); // player resumes explicitly
    game.togglePause();
    expect(game.state).toBe('playing');
  });

  it('tabHidden_duringLevelUp_staysOnLevelUp', () => {
    const game = newGame();
    game.run.addXp(game.run.xpToNext);
    tick(game);
    hideTab(true);
    expect(game.state).toBe('levelup');
  });

  it('paused_simulation_doesNotAdvance', () => {
    const game = newGame();
    tick(game, 3);
    game.togglePause();
    const t = game.run.elapsed;
    tick(game, 10);
    expect(game.run.elapsed).toBe(t);
  });
});

describe('Game state machine: chests', () => {
  it('chest_whilePlaying_showsReliquaryThenReturns', () => {
    const game = newGame();
    game.events.emit('chest:opened', {});
    expect(game.state).toBe('levelup');
    expect(game.levelMode).toBe('chest');
    game.closeChest();
    expect(game.state).toBe('playing');
  });

  it('chest_duringLevelUp_appliedAsToastAndLevelUpKept', () => {
    const game = newGame();
    game.run.addXp(game.run.xpToNext);
    tick(game);
    const before = game.run.chestsOpened;
    game.events.emit('chest:opened', {});
    expect(game.run.chestsOpened).toBe(before + 1);
    expect(game.state).toBe('levelup');
    expect(game.levelMode).toBe('levelup');
    game.chooseUpgrade(0);
    expect(game.state).toBe('playing');
  });

  it('chest_withPendingLevelUp_levelUpFollowsReliquary', () => {
    const game = newGame();
    game.events.emit('chest:opened', {});
    game.run.addXp(game.run.xpToNext);
    game.closeChest();
    expect(game.state).toBe('levelup');
    expect(game.levelMode).toBe('levelup');
  });

  it('chestTimer_expires_autoCloses', () => {
    const game = newGame();
    game.events.emit('chest:opened', {});
    for (let i = 0; i < 400 && game.state === 'levelup'; i++) {
      internals(game).last -= 50; // pretend 50 ms passed
      tick(game);
    }
    expect(game.state).toBe('playing');
  });
});

describe('Game state machine: death', () => {
  it('deathAndLevelUp_sameFrame_gameOverWins', () => {
    const game = newGame();
    game.run.addXp(game.run.xpToNext);
    game.player.dead = true;
    tick(game);
    expect(game.state).toBe('gameover');
    expect(internals(game).ui.calls).toContain('showGameOver');
  });

  it('deathAndChest_sameFrame_endsInGameOver', () => {
    const game = newGame();
    game.events.emit('chest:opened', {});
    game.player.dead = true;
    // chest overlay is up (sim frozen) — death is only processed when play resumes
    game.closeChest();
    tick(game);
    expect(game.state).toBe('gameover');
  });

  it('chooseUpgrade_afterGameOver_ignored', () => {
    const game = newGame();
    game.run.addXp(game.run.xpToNext);
    game.endRun(false);
    game.chooseUpgrade(0);
    expect(game.state).toBe('gameover');
  });
});

describe('Game state machine: boss & dawn', () => {
  it('bossKilled_whilePlaying_dawnChoiceAfterDelay', () => {
    const game = newGame();
    game.events.emit('boss:killed', { defId: 'boss_hollow_stag' });
    vi.advanceTimersByTime(2300);
    expect(game.state).toBe('levelup');
    expect(game.levelMode).toBe('dawn');
    game.chooseUpgrade(1); // endless
    expect(game.state).toBe('playing');
    expect(game.run.endless).toBe(true);
  });

  it('bossKilled_duringLevelUp_dawnFollowsTheChoice', () => {
    const game = newGame();
    game.events.emit('boss:killed', { defId: 'boss_hollow_stag' });
    game.run.addXp(game.run.xpToNext);
    tick(game);
    vi.advanceTimersByTime(2300);
    expect(game.levelMode).toBe('levelup');
    game.chooseUpgrade(0);
    expect(game.levelMode).toBe('dawn');
  });

  it('bossKillAndDeath_sameFrame_countsAsVictory', () => {
    const game = newGame();
    game.events.emit('boss:killed', { defId: 'boss_hollow_stag' });
    game.player.dead = true;
    tick(game);
    expect(game.state).toBe('gameover');
    expect(game.run.victory).toBe(true);
    vi.advanceTimersByTime(2300);
    expect(game.state).toBe('gameover'); // the pending dawn timer must not reopen anything
  });

  // BUG-QA-001 (S2): the dawn timer is not tied to the run. Killing the boss, dying and pressing "Again"
  // within 2.2 s pops the dawn choice in the NEW run (instant victory). Flip to `it` when Game.ts is fixed.
  it.fails('bossKilled_thenNewRunWithin2s_dawnDoesNotLeakIntoNewRun', () => {
    const game = newGame();
    game.events.emit('boss:killed', { defId: 'boss_hollow_stag' });
    game.endRun(true);
    game.startRun();
    vi.advanceTimersByTime(2300);
    expect(game.state).toBe('playing');
    expect(game.levelMode).toBe('levelup');
  });

  // BUG-QA-002 (S2): if the game is paused when the 2.2 s dawn timer fires, dawnPending is set but only
  // afterChoice/closeChest consume it — after unpausing the dawn choice never appears until the next level-up.
  it.fails('bossKilled_pausedWhenTimerFires_dawnAppearsAfterResume', () => {
    const game = newGame();
    game.events.emit('boss:killed', { defId: 'boss_hollow_stag' });
    game.togglePause();
    vi.advanceTimersByTime(2300);
    game.togglePause();
    tick(game);
    expect(game.levelMode).toBe('dawn');
  });
});

describe('Game state machine: guards', () => {
  // BUG-QA-003 (S4): skipUpgrade/rerollUpgrades do not check state === 'levelup'; a stray UI/gamepad activation
  // while playing burns the skip (+5 Ash) or a reroll. Flip to `it` when Game.ts is fixed.
  it.fails('skipUpgrade_whilePlaying_ignored', () => {
    const game = newGame();
    const skips = game.run.skips;
    game.skipUpgrade();
    expect(game.run.skips).toBe(skips);
  });

  it('banish_lastOffer_neverLeavesEmptyCardList', () => {
    const game = newGame();
    game.run.banishes = 50;
    game.run.addXp(game.run.xpToNext);
    tick(game);
    for (let i = 0; i < 40; i++) game.banishUpgrade(0);
    expect(internals(game).pendingChoices.length).toBeGreaterThan(0);
    game.chooseUpgrade(0);
    expect(game.state).toBe('playing');
  });
});
