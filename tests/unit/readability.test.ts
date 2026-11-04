/**
 * Sprint 3 readability regression tests (art review s2 #3, #4, #10 + gameplay requests): crowd-scaled hit flash,
 * hit-flash refractory, per-enemy contact cooldown, boss grace period, damage-number merge/cap, focus falloff.
 * Runs under Node with three.js objects that are constructed but never rendered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// ------------------------------------------------------------------ minimal DOM shim (canvas atlases, fx text layer)
const noop = () => {};
const anyObj: object = new Proxy(function () {} as object, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' || k === Symbol.iterator ? undefined : anyObj),
  apply: () => anyObj,
  construct: () => anyObj,
  set: () => true,
});
const gl = globalThis as Record<string, unknown>;
const el = () => ({ width: 64, height: 64, style: {} as Record<string, string>, className: '', textContent: '', getContext: () => anyObj, appendChild: noop, addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop } });
if (!gl.document) {
  gl.document = { createElement: el, body: el(), head: el(), getElementById: () => null, addEventListener: noop, documentElement: { classList: { contains: () => false } } };
}
if (!gl.window) gl.window = { addEventListener: noop, removeEventListener: noop, setTimeout, clearTimeout, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };

import { EventBus } from '../../src/core/EventBus';
import { Rng } from '../../src/core/Rng';
import { defaultSave } from '../../src/core/Save';
import { RunState } from '../../src/game/RunState';
import { EnemyManager, flashCrowdScale, CONTACT_COOLDOWN, BOSS_GRACE, FLASH_REFRACTORY } from '../../src/entities/Enemies';
import { FxManager, NUM_CAP } from '../../src/render/Fx';
import { focusFactor, FOCUS_MIN } from '../../src/render/vfx/focus';
import type { GameContext } from '../../src/game/types';

function seedMathRandom(seed: number): void {
  const r = new Rng(seed);
  vi.spyOn(Math, 'random').mockImplementation(() => r.next());
}
beforeEach(() => seedMathRandom(4321));
afterEach(() => vi.restoreAllMocks());

/** Headless context: real EnemyManager, a player stub that counts the hits it takes. */
function makeCtx() {
  const save = defaultSave();
  save.settings.damageNumbers = false;
  const hits: number[] = [];
  const player = { x: 0, z: 0, vx: 0, vz: 0, radius: 0.5, lightValue: 100, invuln: 0, dead: false, damage: (a: number) => hits.push(a), heal: noop };
  const ctx = {
    scene: new THREE.Scene(), events: new EventBus(), save, run: new RunState(), rng: new Rng(7),
    camera: new THREE.PerspectiveCamera(),
    input: { moveX: 0, moveZ: 0 },
    audio: { play: noop },
    world: { resolveCollision: noop, setLight: noop, biome: { bossId: 'boss_hollow_stag', enemyPool: ['shade'] } },
    player,
    projectiles: { spawnHostile: noop },
    pickups: { spawn: noop, list: [] },
    fx: anyObj,
    shake: noop,
  } as unknown as GameContext;
  const enemies = new EnemyManager(ctx.scene);
  (ctx as unknown as { enemies: EnemyManager }).enemies = enemies;
  return { ctx, enemies, hits };
}

function simulate(enemies: EnemyManager, ctx: GameContext, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 30); i++) enemies.update(1 / 30, ctx, i / 30);
}

describe('EnemyManager: contact damage', () => {
  it('update_enemyPressedIntoPlayerForOneSecond_hitsAtMostOncePerCooldown', () => {
    // Arrange
    const { ctx, enemies, hits } = makeCtx();
    const e = enemies.spawn('brute', 0, 0)!;
    e.speedMul = 0; // stays on top of the bearer
    // Act
    simulate(enemies, ctx, 1);
    // Assert: t = 0 and t = CONTACT_COOLDOWN (0.8 s) → 2 hits, not one per frame
    expect(hits.length).toBe(Math.floor(1 / CONTACT_COOLDOWN) + 1);
  });

  it('update_bossSpawnedOnPlayer_dealsNoContactDamageOrAttacksDuringGrace', () => {
    // Arrange
    const { ctx, enemies, hits } = makeCtx();
    const boss = enemies.spawn('boss_hollow_stag', 0, 0)!;
    // Act
    simulate(enemies, ctx, BOSS_GRACE - 0.2);
    // Assert
    expect(hits.length).toBe(0);
    expect(boss.state).toBe(0);
  });
});

describe('EnemyManager: hit flash', () => {
  it('damage_secondHitWhileStillFlashing_doesNotRetriggerFlash', () => {
    // Arrange
    const { ctx, enemies } = makeCtx();
    const e = enemies.spawn('brute', 20, 0)!;
    e.speedMul = 0;
    enemies.damage(e, 1, ctx, { canCrit: false });
    simulate(enemies, ctx, 1 / 30);
    const afterDecay = e.hitFlash;
    // Act
    enemies.damage(e, 1, ctx, { canCrit: false });
    // Assert
    expect(afterDecay).toBeGreaterThan(FLASH_REFRACTORY);
    expect(afterDecay).toBeLessThan(1);
    expect(e.hitFlash).toBe(afterDecay);
  });

  it('flashCrowdScale_fewVsManyFlashing_dimsOnlyLargeCrowds', () => {
    expect(flashCrowdScale(0)).toBe(1);
    expect(flashCrowdScale(80)).toBe(1);
    expect(flashCrowdScale(140)).toBeCloseTo(0.75, 5);
    expect(flashCrowdScale(200)).toBeCloseTo(0.5, 5);
    expect(flashCrowdScale(1000)).toBeCloseTo(0.5, 5);
  });
});

describe('Focus protection', () => {
  it('focusFactor_atBearerAndFarAway_isMinAndOne', () => {
    expect(focusFactor(0, 0)).toBeCloseTo(FOCUS_MIN, 5);
    expect(focusFactor(1, 0)).toBeCloseTo(FOCUS_MIN, 5);
    expect(focusFactor(3, 0)).toBeCloseTo(1, 5);
    expect(focusFactor(2.1, 0)).toBeGreaterThan(FOCUS_MIN);
    expect(focusFactor(2.1, 0)).toBeLessThan(1);
  });
});

describe('FxManager: damage numbers', () => {
  function makeFx() {
    const layer = el();
    return new FxManager(new THREE.Scene(), new THREE.PerspectiveCamera(), layer as unknown as HTMLElement);
  }

  it('addToNumber_hitWithinMergeWindow_addsToTheSameNumber', () => {
    // Arrange
    const fx = makeFx();
    const slot = fx.damageNumber(0, 1, 0, 40);
    const serial = fx.numberSerial(slot);
    // Act
    const merged = fx.addToNumber(slot, serial, 25, false);
    // Assert
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(merged).toBe(true);
    expect((fx as unknown as { texts: { el: { textContent: string } }[] }).texts[slot].el.textContent).toBe('65');
  });

  it('addToNumber_staleSerial_isRejected', () => {
    const fx = makeFx();
    const slot = fx.damageNumber(0, 1, 0, 40);
    expect(fx.addToNumber(slot, fx.numberSerial(slot) + 1, 5, false)).toBe(false);
  });

  it('damageNumber_capReached_dropsNonCritsButCritsReplaceOldest', () => {
    // Arrange
    const fx = makeFx();
    for (let i = 0; i < NUM_CAP; i++) expect(fx.damageNumber(i, 1, 0, 10)).toBeGreaterThanOrEqual(0);
    // Act
    const dropped = fx.damageNumber(0, 1, 0, 10);
    const crit = fx.damageNumber(0, 1, 0, 99, 'ft-crit');
    // Assert
    expect(dropped).toBe(-1);
    expect(crit).toBeGreaterThanOrEqual(0);
    expect((fx as unknown as { activeNums: number }).activeNums).toBe(NUM_CAP);
  });
});
