import { describe, expect, it } from 'vitest';
import { xpForLevel, baseStats } from '../../src/game/Stats';
import { RunState } from '../../src/game/RunState';

describe('xpForLevel', () => {
  it('xpForLevel_levels1to200_strictlyPositiveIntegersAndNonDecreasing', () => {
    let prev = 0;
    for (let l = 1; l <= 200; l++) {
      const v = xpForLevel(l);
      expect(Number.isInteger(v), `L${l}`).toBe(true);
      expect(v, `L${l}`).toBeGreaterThan(0);
      expect(v, `L${l} >= L${l - 1}`).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('xpForLevel_formulaSeamAt20_noBigJumpOrDip', () => {
    for (const l of [18, 19, 20, 21]) {
      const ratio = xpForLevel(l + 1) / xpForLevel(l);
      expect(ratio, `L${l}→${l + 1}`).toBeGreaterThanOrEqual(1);
      expect(ratio, `L${l}→${l + 1}`).toBeLessThan(1.15);
    }
  });

  it('xpForLevel_level100_finiteAndBounded', () => {
    // endless runs reach level 100+; must not overflow into Infinity/NaN or absurd numbers
    expect(Number.isFinite(xpForLevel(100))).toBe(true);
    expect(xpForLevel(100)).toBeLessThan(1e6);
  });
});

describe('RunState.addXp', () => {
  it('addXp_belowThreshold_noLevelUp', () => {
    const run = new RunState();
    run.addXp(xpForLevel(1) - 1);
    expect(run.level).toBe(1);
    expect(run.pendingLevelUps).toBe(0);
    expect(run.xp).toBe(xpForLevel(1) - 1);
  });

  it('addXp_exactThreshold_levelsOnceWithZeroCarry', () => {
    const run = new RunState();
    run.addXp(xpForLevel(1));
    expect(run.level).toBe(2);
    expect(run.pendingLevelUps).toBe(1);
    expect(run.xp).toBe(0);
    expect(run.xpToNext).toBe(xpForLevel(2));
  });

  it('addXp_hugeGain_queuesEveryLevelAndKeepsRemainder', () => {
    // Arrange: XP for exactly levels 1..10 plus 3 left over
    const run = new RunState();
    let need = 0;
    for (let l = 1; l <= 10; l++) need += xpForLevel(l);
    // Act
    run.addXp(need + 3);
    // Assert
    expect(run.level).toBe(11);
    expect(run.pendingLevelUps).toBe(10);
    expect(run.xp).toBeCloseTo(3, 6);
    expect(run.xp).toBeLessThan(run.xpToNext);
  });

  it('addXp_growthMultiplier_scalesGain', () => {
    const run = new RunState();
    run.stats.growth = 2;
    run.addXp(xpForLevel(1) / 2);
    expect(run.level).toBe(2);
  });

  it('addXp_manySmallGains_equivalentToOneLargeGain', () => {
    const a = new RunState();
    const b = new RunState();
    for (let i = 0; i < 1000; i++) a.addXp(1);
    b.addXp(1000);
    expect(a.level).toBe(b.level);
    expect(a.pendingLevelUps).toBe(b.pendingLevelUps);
    expect(a.xp).toBeCloseTo(b.xp, 6);
  });

  it('addXp_pendingNotConsumed_accumulatesAcrossCalls', () => {
    const run = new RunState();
    run.addXp(xpForLevel(1));
    run.addXp(xpForLevel(2));
    expect(run.pendingLevelUps).toBe(2);
  });
});

describe('RunState misc', () => {
  it('newRunState_defaults_matchBaseStatsAndSlotLimits', () => {
    const run = new RunState();
    expect(run.stats).toEqual(baseStats());
    expect(run.maxWeapons).toBe(6);
    expect(run.maxPassives).toBe(6);
    expect(run.weapons).toHaveLength(0);
  });

  it('damageSummary_multipleSources_sortedDescendingSharesSumToOne', () => {
    const run = new RunState();
    run.addDamage('a', 10);
    run.addDamage('b', 30);
    run.addDamage('a', 5);
    const s = run.damageSummary();
    expect(s.map((x) => x.source)).toEqual(['b', 'a']);
    expect(s[1].damage).toBe(15);
    expect(s.reduce((t, x) => t + x.share, 0)).toBeCloseTo(1, 6);
  });

  it('damageSummary_noDamage_emptyWithoutDivideByZero', () => {
    expect(new RunState().damageSummary()).toEqual([]);
  });
});
