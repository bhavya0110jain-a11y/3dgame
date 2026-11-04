import { describe, expect, it } from 'vitest';
import { Director, PHASES, RUN_LENGTH, hpScale, damageScale } from '../../src/game/Director';
import { ENEMIES } from '../../src/data/enemies';
import { BIOMES, getBiome } from '../../src/data/biomes';
import { RunState } from '../../src/game/RunState';
import { Rng } from '../../src/core/Rng';
import type { GameContext } from '../../src/game/types';

interface SpawnRec { t: number; id: string; x: number; z: number; elite: boolean; boss: boolean }

/**
 * Minimal context for the Director: a fake EnemyManager that records spawns. Enemies "die" after `lifetime`
 * seconds so activeCount behaves like a player who is killing things at a steady rate.
 */
function harness(biomeId: string, lifetime = 6, seed = 1) {
  const run = new RunState();
  const spawns: SpawnRec[] = [];
  const alive: number[] = []; // death times
  const events: string[] = [];
  const enemies = {
    hpMul: 1, damageMul: 1, speedMul: 1, activeCount: 0, boss: null as unknown,
    spawn(id: string, x: number, z: number, opts: { elite?: boolean; hpMul?: number } = {}) {
      const def = ENEMIES[id];
      if (!def) return null;
      spawns.push({ t: run.elapsed, id, x, z, elite: !!opts.elite, boss: !!def.boss });
      alive.push(run.elapsed + (def.boss ? 1e9 : lifetime));
      this.activeCount = alive.length;
      return {} as unknown;
    },
  };
  const ctx = {
    run, rng: new Rng(seed), enemies,
    world: { biome: getBiome(biomeId) },
    player: { x: 0, z: 0, vx: 0, vz: 0 },
    fx: { text() {} },
    events: { emit: (type: string) => events.push(type) },
    shake() {},
  } as unknown as GameContext;
  const director = new Director();
  director.reset();
  const step = (until: number, dt = 0.1) => {
    while (run.elapsed < until) {
      run.elapsed += dt;
      for (let i = alive.length - 1; i >= 0; i--) if (alive[i] <= run.elapsed) alive.splice(i, 1);
      enemies.activeCount = alive.length;
      director.update(dt, ctx);
    }
  };
  return { run, spawns, events, enemies, director, ctx, step };
}

describe('Director phase table', () => {
  it('phases_untilTimes_strictlyIncreasingAndEndAtRunLength', () => {
    for (let i = 1; i < PHASES.length; i++) expect(PHASES[i].until).toBeGreaterThan(PHASES[i - 1].until);
    expect(PHASES[PHASES.length - 1].until).toBe(RUN_LENGTH);
  });

  it('phases_rateAndMaxAlive_nonDecreasing', () => {
    for (let i = 1; i < PHASES.length; i++) {
      expect(PHASES[i].rate, `phase ${i} rate`).toBeGreaterThanOrEqual(PHASES[i - 1].rate);
      expect(PHASES[i].maxAlive, `phase ${i} maxAlive`).toBeGreaterThanOrEqual(PHASES[i - 1].maxAlive);
    }
  });

  it('phases_maxAlive_withinPerformanceBudget', () => {
    // 60 fps budget is specified for 300+ enemies; the cap leaves headroom for swarms/rushes on top.
    for (const p of PHASES) expect(p.maxAlive).toBeLessThanOrEqual(400);
  });

  it('phases_weightIds_allExistAndAreNotBosses', () => {
    for (const p of PHASES) for (const id in p.weights) {
      expect(ENEMIES[id], id).toBeDefined();
      expect(ENEMIES[id].boss, id).toBeFalsy();
      expect(p.weights[id]).toBeGreaterThan(0);
    }
  });

  it('phases_everyBiome_everyPhaseHasAtLeastOneAllowedEnemy', () => {
    for (const b of BIOMES) {
      const allowed = new Set(b.enemyPool);
      for (const d of Object.values(ENEMIES)) if (d.biomes?.includes(b.id)) allowed.add(d.id);
      for (const p of PHASES) {
        const ok = Object.keys(p.weights).some((id) => allowed.has(id));
        expect(ok, `${b.id} phase until ${p.until}`).toBe(true);
      }
    }
  });

  it('scaling_hpAndDamage_monotonicAndFiniteThroughEndless', () => {
    for (let m = 0; m < 60; m += 0.5) {
      expect(hpScale(m + 0.5)).toBeGreaterThan(hpScale(m));
      expect(damageScale(m + 0.5)).toBeGreaterThan(damageScale(m));
      expect(Number.isFinite(hpScale(m))).toBe(true);
    }
    expect(hpScale(0)).toBe(1);
    expect(damageScale(0)).toBe(1);
  });
});

describe('Director simulated 15-minute run', () => {
  for (const biome of BIOMES) {
    it(`fullRun_${biome.id}_spawnsOnlyAllowedEnemiesAndOneBoss`, () => {
      // Arrange
      const h = harness(biome.id);
      const allowed = h.director.allowedIds(h.ctx);
      // Act
      h.step(RUN_LENGTH + 60);
      // Assert
      const bosses = h.spawns.filter((s) => s.boss);
      expect(bosses).toHaveLength(1);
      expect(bosses[0].id).toBe(biome.bossId);
      expect(bosses[0].t).toBeGreaterThanOrEqual(RUN_LENGTH);
      expect(bosses[0].t).toBeLessThan(RUN_LENGTH + 0.2);
      expect(h.events.filter((e) => e === 'boss:spawned')).toHaveLength(1);
      for (const s of h.spawns) if (!s.boss) expect(allowed.has(s.id), `${biome.id}: ${s.id} @${s.t.toFixed(0)}s`).toBe(true);
    });
  }

  it('fullRun_spawnRatePerMinute_rampsUpOverTheRun', () => {
    // Long lifetime so the alive cap binds: models a player who cannot keep up.
    const h = harness('biome_pines', 4);
    h.step(RUN_LENGTH - 1);
    const perMin = new Array(15).fill(0);
    for (const s of h.spawns) perMin[Math.min(14, Math.floor(s.t / 60))]++;
    // early minutes are calmer than late minutes; allow event spikes (swarm/rush) in between
    const early = perMin[0] + perMin[1] + perMin[2];
    const late = perMin[12] + perMin[13] + perMin[14];
    expect(late).toBeGreaterThan(early * 2.5);
    // no dead minute: something always spawns
    for (let m = 0; m < 15; m++) expect(perMin[m], `minute ${m}`).toBeGreaterThan(60);
  });

  it('fullRun_aliveCount_regularSpawnsRespectPhaseCap', () => {
    // Immortal enemies: the only things allowed above maxAlive are scripted events (swarm, rush, elite).
    const h = harness('biome_pines', 1e9);
    const overCap: string[] = [];
    let prevLen = 0;
    while (h.run.elapsed < RUN_LENGTH - 1) {
      const before = h.enemies.activeCount;
      h.step(h.run.elapsed + 0.1);
      // the Director picks the phase from elapsed AFTER it advanced
      const phase = PHASES.find((p) => h.run.elapsed < p.until)!;
      const added = h.spawns.slice(prevLen);
      prevLen = h.spawns.length;
      const scripted = added.length > 4 || added.some((s) => s.elite);
      if (!scripted && before >= phase.maxAlive && added.length > 0) overCap.push(`${h.run.elapsed.toFixed(1)}s`);
    }
    expect(overCap).toEqual([]);
  });

  it('fullRun_elites_firstAt75sThenEvery100s', () => {
    const h = harness('biome_pines');
    h.step(600);
    const times = h.spawns.filter((s) => s.elite).map((s) => Math.round(s.t));
    expect(times.slice(0, 4)).toEqual([75, 175, 275, 375]);
  });

  it('fullRun_spawnPositions_ringOutsideCameraView', () => {
    const h = harness('biome_pines');
    h.step(300);
    const edge = h.spawns.filter((s) => !s.boss);
    // regular edge spawns are 20-26 units out; swarms 16, rushes ~22±2.5
    for (const s of edge) {
      const d = Math.hypot(s.x, s.z);
      expect(d, `${s.id} @${s.t.toFixed(1)}`).toBeGreaterThan(15.5);
      expect(d).toBeLessThan(26.5 + 3.6);
    }
  });

  it('reset_afterBoss_allowsBossAgainNextRun', () => {
    const h = harness('biome_pines');
    h.step(RUN_LENGTH + 1);
    expect(h.director.bossSpawned).toBe(true);
    h.director.reset();
    expect(h.director.bossSpawned).toBe(false);
  });

  it('update_scalingMultipliers_setFromElapsedAndBiomeDifficulty', () => {
    const h = harness('biome_ruins');
    h.step(600);
    const diff = getBiome('biome_ruins').difficulty;
    expect(h.enemies.hpMul).toBeCloseTo(diff * hpScale(h.run.elapsed / 60), 4);
    expect(h.enemies.damageMul).toBeCloseTo(diff * damageScale(h.run.elapsed / 60), 4);
    expect(h.enemies.speedMul).toBeLessThanOrEqual(1.25);
  });
});
