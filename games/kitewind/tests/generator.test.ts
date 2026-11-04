import { describe, it, expect } from 'vitest';
import { Rng, dailySeed, hash2 } from '../src/core/Rng';
import { Generator } from '../src/world/Generator';
import { Run } from '../src/game/Run';
import { baseMods } from '../src/game/Mods';
import { autopilot } from '../src/game/Autopilot';
import { WORLD } from '../src/data/tuning';

describe('Rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('differs between seeds and stays in [0,1)', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      const x = a.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      if (x === b.next()) same++;
    }
    expect(same).toBeLessThan(3);
  });
  it('hash2 and daily seeds are stable', () => {
    expect(hash2(7, 3)).toBe(hash2(7, 3));
    expect(hash2(7, 3)).not.toBe(hash2(7, 4));
    const d = new Date(2026, 10, 4);
    expect(dailySeed(d)).toBe(dailySeed(new Date(2026, 10, 4, 18)));
    expect(dailySeed(d)).not.toBe(dailySeed(new Date(2026, 10, 5)));
  });
});

describe('Generator', () => {
  it('produces identical chunks for the same seed regardless of generation order', () => {
    const a = new Generator(1234);
    const b = new Generator(1234);
    const order = [9, 3, 15, 0];
    const fromB = new Map(order.map((i) => [i, b.chunk(i)]));
    for (const i of [0, 3, 9, 15]) expect(a.chunk(i)).toEqual(fromB.get(i));
  });
  it('different seeds give different worlds', () => {
    const a = new Generator(1).chunk(5);
    const b = new Generator(2).chunk(5);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
  it('places shrines on schedule and no hazards in the safe opening', () => {
    const g = new Generator(99);
    let shrines = 0;
    for (let i = 0; i < 30; i++) {
      const c = g.chunk(i);
      shrines += c.shrines.length;
      if (c.z0 + WORLD.chunkLength <= WORLD.safeStart) {
        expect(c.spires.length + c.thunderclouds.length + c.flocks.length + c.gusts.length).toBe(0);
      }
    }
    expect(shrines).toBe(Math.floor((3000 - WORLD.shrineFirst) / WORLD.shrineEvery) + 1);
  });
  it('switches biome every biomeLength metres', () => {
    const g = new Generator(5);
    expect(g.chunk(0).biome).toBe(0);
    expect(g.chunk(WORLD.biomeLength / WORLD.chunkLength).biome).toBe(1);
    expect(g.chunk(200).biome).toBe(3);
  });
});

describe('Run (headless)', () => {
  it('an autopilot following the line flies a long way, chaining rings', () => {
    // the autopilot does not dodge hazards: shield charms let it measure that the line itself is flyable
    const m = baseMods();
    m.shields = 50;
    const run = new Run(777, m);
    const inp = { steerX: 0, steerY: 0, dive: false };
    for (let i = 0; i < 60 * 60 && !run.ended; i++) {
      if (run.pendingBoon) run.pickBoon(run.rollBoons()[0]);
      run.step(1 / 60, autopilot(run, inp));
    }
    expect(run.distance).toBeGreaterThan(900);
    expect(run.scoring.rings).toBeGreaterThan(10);
    expect(run.scoring.bestCombo).toBeGreaterThan(3);
  });
  it('flying straight into the sea ends the run', () => {
    const run = new Run(1, baseMods());
    for (let i = 0; i < 60 * 20 && !run.ended; i++) run.step(1 / 60, { steerX: 0, steerY: -1, dive: true });
    expect(run.ended).toBe('sea');
  });
  it('a shield charm absorbs the first crash', () => {
    const m = baseMods();
    m.shields = 1;
    const run = new Run(1, m);
    for (let i = 0; i < 60 * 3 && !run.ended; i++) run.step(1 / 60, { steerX: 0, steerY: -1, dive: true });
    expect(run.shields).toBe(0);
    expect(run.ended).toBeNull();
  });
  it('rolls three distinct boons and applies a pick', () => {
    const run = new Run(3, baseMods());
    const ids = run.rollBoons();
    expect(new Set(ids).size).toBe(3);
    run.pendingBoon = true;
    run.pickBoon('wide_rings');
    expect(run.pendingBoon).toBe(false);
    expect(run.mods.ringRadiusMul).toBeCloseTo(1.3);
  });
});
