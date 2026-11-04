/**
 * Sprint 2 Director behaviour (gameplay agent): adaptive pressure, de-stacked swarms, boss damage cap,
 * lantern flare on boss arrival, reliquary drift. Uses a fake EnemyManager like tests/unit/director.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  Director, RUN_LENGTH, PRESSURE_FROM, PRESSURE_MAX, BOSS_DAMAGE_CAP, CHEST_DRIFT_AFTER, damageScale, hpScale,
} from '../../src/game/Director';
import { ENEMIES } from '../../src/data/enemies';
import { getBiome } from '../../src/data/biomes';
import { RunState } from '../../src/game/RunState';
import { Rng } from '../../src/core/Rng';
import type { GameContext } from '../../src/game/types';

interface SpawnRec { t: number; id: string; elite: boolean; boss: boolean }

function harness(lifetime: number, seed = 3) {
  const run = new RunState();
  const spawns: SpawnRec[] = [];
  const alive: number[] = [];
  const emitted: { type: string; payload: unknown }[] = [];
  let knockbacks = 0;
  const enemies = {
    hpMul: 1, damageMul: 1, speedMul: 1, activeCount: 0, boss: null as unknown,
    knockbackAll() { knockbacks++; },
    spawn(id: string, x: number, z: number, opts: { elite?: boolean } = {}) {
      const def = ENEMIES[id];
      if (!def) return null;
      spawns.push({ t: run.elapsed, id, elite: !!opts.elite, boss: !!def.boss });
      alive.push(run.elapsed + (def.boss ? 1e9 : lifetime));
      this.activeCount = alive.length;
      return { x, z } as unknown;
    },
  };
  const player = {
    x: 0, z: 0, vx: 0, vz: 0, lightValue: 100,
    heal(a: number) { this.lightValue = Math.min(run.stats.maxLight, this.lightValue + a); },
  };
  const pickups = { list: [] as { active: boolean; kind: string; x: number; z: number }[] };
  const ctx = {
    run, rng: new Rng(seed), enemies, player, pickups,
    world: { biome: getBiome('biome_pines') },
    fx: { text() {} },
    events: { emit: (type: string, payload: unknown) => emitted.push({ type, payload }) },
    shake() {},
  } as unknown as GameContext;
  const director = new Director();
  director.reset();
  const step = (until: number, dt = 0.1) => {
    while (run.elapsed < until - 1e-9) {
      run.elapsed += dt;
      for (let i = alive.length - 1; i >= 0; i--) if (alive[i] <= run.elapsed) alive.splice(i, 1);
      enemies.activeCount = alive.length;
      director.update(dt, ctx);
    }
  };
  return { run, spawns, emitted, enemies, player, pickups, director, step, knockbacks: () => knockbacks };
}

describe('Director S2: adaptive pressure', () => {
  it('pressure_beforePressureFrom_staysAtOne', () => {
    const h = harness(0.5); // enemies die instantly: maximally starved arena
    h.step(PRESSURE_FROM - 1);
    expect(h.director.pressure).toBe(1);
  });

  it('pressure_starvedArenaAfterSixMinutes_climbsToMax', () => {
    const h = harness(0.5);
    h.step(PRESSURE_FROM + 60);
    expect(h.director.pressure).toBeCloseTo(PRESSURE_MAX, 5);
    expect(h.enemies.hpMul).toBeGreaterThan(hpScale(h.run.elapsed / 60) * 1.4);
  });

  it('pressure_starvedButHurtingBearer_staysAtOne', () => {
    const h = harness(0.5);
    h.player.lightValue = 30; // 30 % light: struggling — never pushed
    h.step(PRESSURE_FROM + 120);
    expect(h.director.pressure).toBe(1);
  });

  it('pressure_lightDropsAfterRamp_relaxes', () => {
    const h = harness(0.5);
    h.step(PRESSURE_FROM + 60);
    const high = h.director.pressure;
    h.player.lightValue = 20;
    h.step(PRESSURE_FROM + 70);
    expect(h.director.pressure).toBeLessThan(high - 1);
  });

  it('pressure_crowdedArena_staysAtOne', () => {
    const h = harness(1e9); // immortal enemies: the cap binds
    h.step(PRESSURE_FROM + 120);
    expect(h.director.pressure).toBe(1);
  });

  it('pressure_starvedArena_spawnsMoreThanUnpressured', () => {
    const fast = harness(0.5);
    fast.step(PRESSURE_FROM + 120);
    const pressured = fast.spawns.filter((s) => s.t > PRESSURE_FROM + 60 && !s.elite).length;
    const calm = fast.spawns.filter((s) => s.t > PRESSURE_FROM - 60 && s.t <= PRESSURE_FROM && !s.elite).length;
    expect(pressured).toBeGreaterThan(calm * 1.8);
  });
});

describe('Director S2: events', () => {
  it('firstSwarm_neverSplitters', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const h = harness(6, seed);
      h.step(152);
      const swarm = h.spawns.filter((s) => s.t >= 149.9 && s.t <= 150.2);
      expect(swarm.length).toBeGreaterThanOrEqual(24);
      // the swarm itself (24 of one kind) must be shades or wisps; a regular phase spawn may share the tick
      expect(swarm.some((s) => s.id === 'gloam_jelly'), `seed ${seed}`).toBe(false);
      const kinds = swarm.filter((s) => s.id === 'shade' || s.id === 'wisp').length;
      expect(kinds, `seed ${seed}`).toBeGreaterThanOrEqual(24);
    }
  });

  it('elite_spawn_emitsEliteSpawned', () => {
    const h = harness(6);
    h.step(76);
    expect(h.emitted.some((e) => e.type === 'elite:spawned')).toBe(true);
  });
});

describe('Director S2: boss', () => {
  it('bossFight_damageMul_cappedAtBossCap', () => {
    const h = harness(6);
    h.step(RUN_LENGTH + 1);
    expect(damageScale(RUN_LENGTH / 60)).toBeGreaterThan(BOSS_DAMAGE_CAP);
    expect(h.enemies.damageMul).toBeCloseTo(getBiome('biome_pines').difficulty * BOSS_DAMAGE_CAP, 5);
  });

  it('bossSpawn_flaresLanternToFullAndPushesHorde', () => {
    const h = harness(6);
    h.step(RUN_LENGTH - 1);
    h.player.lightValue = 10;
    h.step(RUN_LENGTH + 0.2);
    expect(h.player.lightValue).toBe(h.run.stats.maxLight);
    expect(h.knockbacks()).toBeGreaterThan(0);
    const flare = h.emitted.find((e) => e.type === 'lantern:flare');
    expect(flare?.payload).toEqual({ amount: h.run.stats.maxLight - 10 });
  });

  it('endless_damageMul_notCapped', () => {
    const h = harness(6);
    h.step(RUN_LENGTH + 1);
    h.run.endless = true;
    h.step(RUN_LENGTH + 2);
    expect(h.enemies.damageMul).toBeGreaterThan(getBiome('biome_pines').difficulty * BOSS_DAMAGE_CAP);
  });
});

describe('Director S2: scaling', () => {
  it('hpScale_lateGame_atLeastTripleMidGame', () => {
    expect(hpScale(15) / hpScale(8)).toBeGreaterThan(3);
  });
  it('damageScale_firstFiveMinutes_gentlerThanSprint1', () => {
    for (let m = 0.5; m <= 5; m += 0.5) expect(damageScale(m)).toBeLessThan(1 + m * 0.055);
  });
});

describe('Director S2: reliquary drift', () => {
  it('chest_lyingPastDriftDelay_movesTowardBearer', () => {
    const h = harness(6);
    const chest = { active: true, kind: 'chest', x: 10, z: 0 };
    h.pickups.list.push(chest);
    h.step(CHEST_DRIFT_AFTER - 0.5);
    expect(chest.x).toBe(10);
    h.step(CHEST_DRIFT_AFTER + 3);
    expect(chest.x).toBeLessThan(9);
    expect(chest.x).toBeGreaterThan(0);
  });

  it('ember_neverDrifts', () => {
    const h = harness(6);
    const ember = { active: true, kind: 'ember', x: 10, z: 0 };
    h.pickups.list.push(ember);
    h.step(20);
    expect(ember.x).toBe(10);
  });
});

describe('Director S2: elite pools', () => {
  it('elites_beforeFiveMinutes_neverBrutesOrKnights', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const h = harness(6, seed);
      h.step(299);
      const elites = h.spawns.filter((s) => s.elite).map((s) => s.id);
      expect(elites.length).toBeGreaterThanOrEqual(3);
      for (const id of elites) expect(['brute', 'knight'], `seed ${seed}`).not.toContain(id);
    }
  });
});
