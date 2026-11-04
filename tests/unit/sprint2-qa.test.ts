/**
 * Sprint 2 QA regression tests (QA-owned): bearer model position sync, enemy death pooling + horde LOD tiers,
 * world quality tiers (grass / renderQuality polling). Everything runs under Node with three.js objects that are
 * constructed but never rendered; Math.random is seeded per test so results do not depend on run order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// ------------------------------------------------------------------ minimal DOM shim (canvas atlases, window)
const noop = () => {};
const anyObj: object = new Proxy(function () {} as object, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' || k === Symbol.iterator ? undefined : anyObj),
  apply: () => anyObj,
  construct: () => anyObj,
  set: () => true,
});
const gl = globalThis as Record<string, unknown>;
if (!gl.document) {
  const el = () => ({ width: 64, height: 64, style: {}, getContext: () => anyObj, appendChild: noop, addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop } });
  gl.document = { createElement: el, body: el(), addEventListener: noop, documentElement: { classList: { contains: () => false } } };
}
if (!gl.window) gl.window = { addEventListener: noop, removeEventListener: noop, setTimeout, clearTimeout, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };

import { EventBus } from '../../src/core/EventBus';
import { Rng } from '../../src/core/Rng';
import { defaultSave } from '../../src/core/Save';
import { RunState } from '../../src/game/RunState';
import { EnemyManager, HORDE_LOD_ON, HORDE_LOD_OFF } from '../../src/entities/Enemies';
import { DEATH_TIME, BOSS_DEATH_TIME } from '../../src/entities/enemyModels';
import { Player } from '../../src/entities/Player';
import { Grass } from '../../src/world/Grass';
import type { GameContext } from '../../src/game/types';

/** Deterministic Math.random for the duration of a test (EnemyManager / Player use it for jitter). */
function seedMathRandom(seed: number): void {
  const r = new Rng(seed);
  vi.spyOn(Math, 'random').mockImplementation(() => r.next());
}
beforeEach(() => seedMathRandom(1234));
afterEach(() => vi.restoreAllMocks());

/** Headless context: real EnemyManager, stub player/fx/world. */
function makeCtx(overrides: Partial<Record<string, unknown>> = {}) {
  const scene = new THREE.Scene();
  const events = new EventBus();
  const save = defaultSave();
  save.settings.damageNumbers = 'off';
  const run = new RunState();
  const killed: string[] = [];
  events.on('enemy:killed', ({ defId }) => killed.push(defId));
  const player = { x: 0, z: 0, vx: 0, vz: 0, radius: 0.5, lightValue: 100, invuln: 0, dead: false, damage: noop, heal: noop };
  const ctx = {
    scene, events, save, run, rng: new Rng(7),
    camera: new THREE.PerspectiveCamera(),
    input: { moveX: 0, moveZ: 0 },
    audio: { play: noop },
    world: { resolveCollision: noop, setLight: noop, biome: { bossId: 'boss_hollow_stag' } },
    player,
    projectiles: { spawnHostile: noop },
    pickups: { spawn: noop, list: [] },
    fx: anyObj,
    shake: noop,
    ...overrides,
  } as unknown as GameContext;
  const enemies = new EnemyManager(scene);
  (ctx as unknown as { enemies: EnemyManager }).enemies = enemies;
  return { ctx, enemies, killed, scene };
}

// ------------------------------------------------------------------ Player
describe('Player: bearer model follows the simulated position', () => {
  function playerCtx() {
    const run = new RunState();
    return {
      run,
      input: { moveX: 1, moveZ: 0 },
      world: { resolveCollision: noop, setLight: noop },
      events: new EventBus(),
      enemies: { nearest: () => null },
    } as unknown as GameContext;
  }

  // BUG-QA-010 (S1). P0 from world-render + release (sprint 2): eb9cca8 dropped `this.group.position.set(this.x, 0, this.z)` from
  // Player.update, so the bearer mesh and its lantern PointLight stay at the origin while the camera, enemies and
  // the light-wash shader follow player.x/z. Player.ts is not QA-owned: pinned as it.fails until the fix lands,
  // then flip to `it` (vitest reports "expected to fail but passed").
  it('update_movingRightForThreeSeconds_groupPositionMatchesPlayerXZ', () => {
    // Arrange
    const scene = new THREE.Scene();
    const p = new Player(scene);
    p.reset(100);
    const ctx = playerCtx();
    // Act
    for (let i = 0; i < 90; i++) p.update(1 / 30, ctx, i / 30);
    // Assert
    expect(p.x).toBeGreaterThan(2);
    expect(p.group.position.x).toBeCloseTo(p.x, 5);
    expect(p.group.position.z).toBeCloseTo(p.z, 5);
  });

  it('reset_afterMoving_returnsGroupToOrigin', () => {
    const p = new Player(new THREE.Scene());
    p.x = 5;
    p.z = -3;
    p.group.position.set(5, 0, -3);
    p.reset(100);
    expect([p.x, p.z, p.group.position.x, p.group.position.z]).toEqual([0, 0, 0, 0]);
  });
});

// ------------------------------------------------------------------ Enemy death pooling
describe('EnemyManager: death animation pooling', () => {
  it('kill_enemy_inactiveImmediatelyAndNotTargetable', () => {
    const { ctx, enemies, killed } = makeCtx();
    const e = enemies.spawn('shade', 3, 0)!;
    enemies.update(1 / 60, ctx, 0);
    // Act
    enemies.kill(e, ctx, 'test');
    // Assert
    expect(e.active).toBe(false);
    expect(e.dying).toBe(0);
    expect(killed).toEqual(['shade']);
    enemies.update(1 / 60, ctx, 0.02);
    expect(enemies.activeCount).toBe(0);
    expect(enemies.nearest(3, 0, 10)).toBeFalsy();
  });

  it('kill_twice_countsOneKill', () => {
    const { ctx, enemies, killed } = makeCtx();
    const e = enemies.spawn('shade', 3, 0)!;
    enemies.kill(e, ctx);
    enemies.kill(e, ctx);
    expect(killed.length).toBe(1);
    expect(ctx.run.kills).toBe(1);
  });

  it('corpse_untilDeathTimeEnds_isNotReusedBySpawn', () => {
    const { ctx, enemies } = makeCtx();
    const e = enemies.spawn('shade', 3, 0)!;
    enemies.kill(e, ctx);
    // Act: half the death animation, then spawn
    enemies.update(DEATH_TIME / 2, ctx, 0);
    const other = enemies.spawn('shade', -3, 0)!;
    // Assert: the pool handed out a different object; the corpse still animates
    expect(other).not.toBe(e);
    expect(e.dying).toBeGreaterThan(0);
    expect(e.dying).toBeLessThan(DEATH_TIME);
  });

  it('corpse_afterDeathTime_returnsToPoolAndIsReused', () => {
    const { ctx, enemies } = makeCtx();
    const e = enemies.spawn('shade', 3, 0)!;
    enemies.kill(e, ctx);
    // Act: run past the death animation (frame steps)
    for (let t = 0; t < DEATH_TIME + 0.1; t += 1 / 30) enemies.update(1 / 30, ctx, t);
    const again = enemies.spawn('crawler', 1, 1)!;
    // Assert
    expect(e.dying).toBe(-1);
    expect(again).toBe(e);
    expect(again.active).toBe(true);
    expect(again.def.id).toBe('crawler');
    expect(again.dying).toBe(-1);
    expect(again.age).toBe(0);
  });

  it('bossCorpse_keepsAnimatingForBossDeathTime', () => {
    const { ctx, enemies } = makeCtx();
    const b = enemies.spawn('boss_hollow_stag', 0, -6)!;
    enemies.kill(b, ctx);
    for (let t = 0; t < DEATH_TIME + 0.2; t += 1 / 30) enemies.update(1 / 30, ctx, t);
    // well past a regular corpse but short of the boss collapse
    expect(b.dying).toBeGreaterThan(DEATH_TIME);
    expect(b.dying).toBeLessThan(BOSS_DEATH_TIME);
    expect(enemies.boss).toBeNull();
  });

  it('clear_withCorpsesDying_emptiesDyingListAndPoolsThemOnce', () => {
    const { ctx, enemies } = makeCtx();
    const a = enemies.spawn('shade', 3, 0)!;
    const b = enemies.spawn('shade', 4, 0)!;
    enemies.kill(a, ctx);
    enemies.update(1 / 60, ctx, 0); // a moves to the dying list
    enemies.kill(b, ctx); // b still sits in list (killed this frame)
    // Act
    enemies.clear();
    // Assert: both pooled exactly once — two spawns get two distinct objects, a third is fresh
    const s1 = enemies.spawn('shade', 0, 0)!;
    const s2 = enemies.spawn('shade', 0, 0)!;
    const s3 = enemies.spawn('shade', 0, 0)!;
    expect(new Set([s1, s2, s3]).size).toBe(3);
    expect([a, b]).toContain(s1);
    expect([a, b]).toContain(s2);
    expect([a, b]).not.toContain(s3);
  });
});

// ------------------------------------------------------------------ Horde LOD / quality
describe('EnemyManager: horde LOD follows the tier', () => {
  function crowd(enemies: EnemyManager, n: number) {
    for (let i = 0; i < n; i++) enemies.spawn('shade', 10 + (i % 20), 10 + Math.floor(i / 20));
  }

  it('highTier_aboveOnThreshold_switchesToLodWithHysteresis', () => {
    const { ctx, enemies } = makeCtx();
    crowd(enemies, HORDE_LOD_ON + 5);
    enemies.update(1 / 60, ctx, 0);
    expect(enemies.usingHordeLod).toBe(true);
    // Act: drop to between OFF and ON — stays on LOD (no flicker)
    const alive = enemies.list.filter((e) => e.active);
    const toKill = HORDE_LOD_ON + 5 - (HORDE_LOD_OFF + 10);
    for (let i = 0; i < toKill; i++) { alive[i].active = false; alive[i].dying = -1; }
    enemies.update(1 / 60, ctx, 0.02);
    expect(enemies.usingHordeLod).toBe(true);
    // below OFF: back to full models
    for (let i = toKill; i < toKill + 20; i++) { alive[i].active = false; alive[i].dying = -1; }
    enemies.update(1 / 60, ctx, 0.04);
    expect(enemies.activeCount).toBeLessThan(HORDE_LOD_OFF);
    expect(enemies.usingHordeLod).toBe(false);
  });

  it('highTier_smallCrowd_usesFullModels', () => {
    const { ctx, enemies } = makeCtx();
    crowd(enemies, 20);
    enemies.update(1 / 60, ctx, 0);
    expect(enemies.usingHordeLod).toBe(false);
  });

  it('lowSettingsTier_smallCrowd_usesLod', () => {
    const { ctx, enemies } = makeCtx();
    ctx.save.settings.quality = 'low';
    crowd(enemies, 5);
    enemies.update(1 / 60, ctx, 0);
    expect(enemies.usingHordeLod).toBe(true);
  });

  it('renderQualityOverride_lowWhileSettingsHigh_usesLod', () => {
    // the hook Game should feed from renderer.effectiveQuality (automatic fallback)
    const { ctx, enemies } = makeCtx();
    ctx.save.settings.quality = 'high';
    enemies.renderQuality = 'low';
    crowd(enemies, 5);
    enemies.update(1 / 60, ctx, 0);
    expect(enemies.usingHordeLod).toBe(true);
  });
});

// ------------------------------------------------------------------ World quality tiers
describe('Grass quality tiers', () => {
  const counts = (g: Grass) => {
    const priv = g as unknown as { blades: THREE.Mesh; flowers: THREE.Mesh };
    return {
      blades: (priv.blades.geometry as THREE.InstancedBufferGeometry).instanceCount,
      flowers: (priv.flowers.geometry as THREE.InstancedBufferGeometry).instanceCount,
    };
  };

  it('setQuality_lowMediumHigh_drawsFortySeventyHundredPercentOfBlades', () => {
    const g = new Grass();
    const full = counts(g).blades;
    g.setQuality(0.7);
    const med = counts(g).blades;
    g.setQuality(0.4);
    const low = counts(g).blades;
    g.setQuality(1);
    expect(counts(g).blades).toBe(full);
    expect(med).toBe(Math.round(full * 0.7));
    expect(low).toBe(Math.round(full * 0.4));
  });

  it('setQuality_outOfRangeFraction_isClamped', () => {
    const g = new Grass();
    const full = counts(g).blades;
    g.setQuality(5);
    expect(counts(g).blades).toBe(full);
    g.setQuality(0);
    expect(counts(g).blades).toBe(Math.round(full * 0.2));
  });
});
