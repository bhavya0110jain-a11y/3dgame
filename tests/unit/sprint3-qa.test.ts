/**
 * Sprint 3 QA regression tests (production/qa/bugs.md § Sprint 3 QA pass): pooled-object resets for the new
 * per-enemy fields (BUG-QA-016 follow-up), contact cooldown vs. i-frames, the crowd rule for damage numbers,
 * hostile-projectile palette, Fx banner queue (BUG-QA-019 Fx side), damage-number bookkeeping on expiry/reset,
 * and the late damage slope. Runs under Node with three.js objects that are constructed but never rendered.
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
import { EnemyManager, CONTACT_COOLDOWN, NUMBERS_CROWD } from '../../src/entities/Enemies';
import { ProjectileManager, HOSTILE_COLOR } from '../../src/entities/Projectiles';
import { FxManager, NUM_CAP } from '../../src/render/Fx';
import { damageScale, LATE_DMG, LATE_DMG_FROM } from '../../src/game/Director';
import type { GameContext } from '../../src/game/types';

function seedMathRandom(seed: number): void {
  const r = new Rng(seed);
  vi.spyOn(Math, 'random').mockImplementation(() => r.next());
}
beforeEach(() => seedMathRandom(97));
afterEach(() => vi.restoreAllMocks());

/** Fx double that records damage-number calls and swallows everything else. */
function recordingFx() {
  const calls = { damageNumber: 0, addToNumber: 0 };
  const fx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k: string) => {
      if (k === 'damageNumber') return () => { calls.damageNumber++; return -1; };
      if (k === 'addToNumber') return () => { calls.addToNumber++; return false; };
      if (k === 'numberSerial') return () => 0;
      return anyObj;
    },
  });
  return { fx, calls };
}

function makeCtx(fx: unknown = anyObj) {
  const save = defaultSave();
  save.settings.damageNumbers = true;
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
    fx,
    shake: noop,
  } as unknown as GameContext;
  const enemies = new EnemyManager(ctx.scene);
  (ctx as unknown as { enemies: EnemyManager }).enemies = enemies;
  return { ctx, enemies, hits, player };
}

function makeFx(): FxManager {
  return new FxManager(new THREE.Scene(), new THREE.PerspectiveCamera(), el() as unknown as HTMLElement);
}

// ------------------------------------------------------------------ Enemies
describe('S3 QA: EnemyManager pooled spawn resets the sprint-3 fields', () => {
  it('spawn_reusedPoolObject_contactCooldownAndNumberHandleAreReset', () => {
    // Arrange: an enemy that has just bitten (cooldown running) and owns a damage-number handle
    const { ctx, enemies } = makeCtx();
    const a = enemies.spawn('shade', 0.2, 0)!;
    a.contactCd = CONTACT_COOLDOWN;
    a.numSlot = 5;
    a.numSerial = 42;
    a.hitFlash = 1;
    enemies.clear(); // back to the pool
    // Act
    const b = enemies.spawn('shade', 0.2, 0)!;
    // Assert: same pooled object, fresh state
    expect(b).toBe(a);
    expect(b.contactCd).toBe(0);
    expect(b.numSlot).toBe(-1);
    expect(b.numSerial).toBe(0);
    expect(b.hitFlash).toBe(0);
    void ctx;
  });
});

describe('S3 QA: contact cooldown vs. player i-frames', () => {
  it('update_playerInvulnerableOnContact_cooldownNotSpent_hitLandsWhenIframesEnd', () => {
    // Arrange: enemy pressed into an invulnerable player
    const { ctx, enemies, hits, player } = makeCtx();
    enemies.spawn('shade', 0.1, 0);
    player.invuln = 0.5;
    // Act: 0.5 s of i-frames, then they end
    for (let i = 0; i < 15; i++) enemies.update(1 / 30, ctx, i / 30);
    const during = hits.length;
    player.invuln = 0;
    enemies.update(1 / 30, ctx, 0.6);
    // Assert: nothing during i-frames, and the cooldown was not burnt on the ignored touches
    expect(during).toBe(0);
    expect(hits.length).toBe(1);
  });
});

describe('S3 QA: damage numbers in a crowd (NUMBERS_CROWD)', () => {
  it('damage_nonCritAboveCrowdLimit_noNumber_belowLimit_number', () => {
    // Arrange
    const { fx, calls } = recordingFx();
    const { ctx, enemies } = makeCtx(fx);
    (ctx.run.stats as { critChance: number }).critChance = 0;
    for (let i = 0; i < NUMBERS_CROWD + 10; i++) enemies.spawn('shade', 30 + (i % 20), 30 + Math.floor(i / 20));
    enemies.update(1 / 30, ctx, 0); // refresh activeCount
    const target = enemies.list.find((e) => e.active)!;
    // Act: a non-crit hit in a big crowd
    enemies.damage(target, 1, ctx, {});
    const crowded = calls.damageNumber + calls.addToNumber;
    // a small fight
    enemies.clear();
    const lone = enemies.spawn('shade', 30, 30)!;
    enemies.update(1 / 30, ctx, 0.1);
    enemies.damage(lone, 1, ctx, {});
    // Assert
    expect(crowded).toBe(0);
    expect(calls.damageNumber).toBe(1);
  });
});

// ------------------------------------------------------------------ Projectiles
describe('S3 QA: hostile projectile palette', () => {
  it('spawnHostile_warmAndCoolCasters_allShotsWithin8DegreesOfHostileMagenta', () => {
    // Arrange
    const pm = new ProjectileManager(new THREE.Scene());
    const target = new THREE.Color(HOSTILE_COLOR).getHSL({ h: 0, s: 0, l: 0 }).h * 360;
    const casters = [0xff8a2a, 0xffd27a, 0x7ad0ff, 0x9a8aff, 0x5aff8a, 0xff3030];
    // Act
    for (const c of casters) pm.spawnHostile(0, 0, 1, 0, 6, 5, c);
    const list = (pm as unknown as { list: { color: number; hostile: boolean }[] }).list;
    // Assert
    expect(list.length).toBe(casters.length);
    for (const p of list) {
      const h = new THREE.Color(p.color).getHSL({ h: 0, s: 0, l: 0 }).h * 360;
      expect(p.hostile).toBe(true);
      expect(Math.abs(h - target)).toBeLessThanOrEqual(8.5);
    }
  });

  it('spawn_reusedPooledHostile_friendlyShotHasNoHostileFlagOrCallbacks', () => {
    // Arrange: a hostile shot with an onHit callback, returned to the pool
    const pm = new ProjectileManager(new THREE.Scene());
    pm.spawn({ x: 0, z: 0, vx: 1, vz: 0, damage: 3, hostile: true, onHit: noop });
    pm.clear();
    // Act
    const p = pm.spawn({ x: 0, z: 0, vx: 1, vz: 0, damage: 3 })!;
    // Assert (BUG-QA-016: field-by-field defaults must still reset everything the old literal reset)
    expect(p.hostile).toBe(false);
    expect(p.onHit).toBeUndefined();
    expect(p.pierce).toBe(0);
    expect(p.vfx).toBe('auto');
  });
});

// ------------------------------------------------------------------ Fx banner + damage numbers
describe('S3 QA: Fx banner queue (BUG-QA-019, Fx side)', () => {
  const q = (fx: FxManager) => (fx as unknown as { bannerQ: string[] }).bannerQ;

  it('text_ftBigSameTextTwice_queuedOnce_differentTextQueued', () => {
    // Arrange
    const fx = makeFx();
    // Act
    fx.text(0, 3.5, 0, 'ENRAGED', 'ft-big');
    fx.text(0, 3.5, 0, 'ENRAGED', 'ft-big');
    fx.text(0, 3.5, 0, 'REKINDLED', 'ft-big');
    // Assert: one banner per distinct text, none spawned as a floating world text
    expect(q(fx)).toEqual(['ENRAGED', 'REKINDLED']);
    expect((fx as unknown as { texts: unknown[] }).texts.length).toBe(0);
  });

  it('clear_clearsQueuedBannersAndDamageNumberCount', () => {
    const fx = makeFx();
    fx.banner('A');
    fx.banner('B');
    for (let i = 0; i < 5; i++) fx.damageNumber(i, 1, 0, 10);
    // Act
    fx.clear();
    // Assert
    expect(q(fx)).toEqual([]);
    expect((fx as unknown as { activeNums: number }).activeNums).toBe(0);
  });
});

describe('S3 QA: damage-number bookkeeping', () => {
  const internals = (fx: FxManager) => fx as unknown as { activeNums: number; updateTexts(dt: number): void; damageNumbers: boolean };

  it('updateTexts_numbersExpire_capFreesUpForNewNonCrits', () => {
    // Arrange: fill the cap
    const fx = makeFx();
    for (let i = 0; i < NUM_CAP; i++) fx.damageNumber(i, 1, 0, 10);
    expect(fx.damageNumber(0, 1, 0, 10)).toBe(-1);
    // Act: let them all expire
    for (let i = 0; i < 40; i++) internals(fx).updateTexts(0.05);
    // Assert
    expect(internals(fx).activeNums).toBe(0);
    expect(fx.damageNumber(0, 1, 0, 10)).toBeGreaterThanOrEqual(0);
  });

  it('addToNumber_afterMergeWindow_rejected', () => {
    const fx = makeFx();
    const slot = fx.damageNumber(0, 1, 0, 10);
    const serial = fx.numberSerial(slot);
    internals(fx).updateTexts(0.3); // > NUM_MERGE
    expect(fx.addToNumber(slot, serial, 5, false)).toBe(false);
  });

  it('addToNumber_critOntoNonCrit_upgradesToCritStyleWithBang', () => {
    const fx = makeFx();
    const slot = fx.damageNumber(0, 1, 0, 10);
    fx.addToNumber(slot, fx.numberSerial(slot), 30, true);
    const t = (fx as unknown as { texts: { el: { textContent: string; className: string }; crit: boolean }[] }).texts[slot];
    expect(t.crit).toBe(true);
    expect(t.el.textContent).toBe('40!');
  });
});

// ------------------------------------------------------------------ Director tuning
describe('S3 QA: late damage slope', () => {
  it('damageScale_continuousAtLateStart_andUsesLateSlopeAfter', () => {
    // Arrange / Act
    const atKnee = damageScale(LATE_DMG_FROM);
    const at10 = damageScale(10);
    // Assert: no jump at 6:00; minute 10 = 1 + 10·0.04 + 4·LATE_DMG
    expect(atKnee).toBeCloseTo(1 + LATE_DMG_FROM * 0.04, 6);
    expect(at10).toBeCloseTo(1 + 0.4 + (10 - LATE_DMG_FROM) * LATE_DMG, 6);
    expect(LATE_DMG).toBeCloseTo(0.11, 6);
  });
});
