import { describe, expect, it } from 'vitest';
import { xpForLevel, baseStats } from '../src/game/Stats';
import { RunState } from '../src/game/RunState';
import { WEAPONS, getWeapon } from '../src/data/weapons';
import { PASSIVES } from '../src/data/passives';
import { ENEMIES } from '../src/data/enemies';
import { META_UPGRADES, CHARACTERS } from '../src/data/meta';
import { ACHIEVEMENTS } from '../src/data/achievements';
import { defaultSave } from '../src/core/Save';
import { grantAchievement, evaluateAchievements } from '../src/game/Achievements';
import { Rng } from '../src/core/Rng';
import { rollChoices, rollChest, evolutionCandidates, applyChoice } from '../src/game/Upgrades';
import type { GameContext, WeaponInstance, WeaponDef } from '../src/game/types';

function fakeWeapon(def: WeaponDef, level: number): WeaponInstance {
  return { def, level, update() {}, dispose() {} };
}

function ctxWith(run: RunState): GameContext {
  const save = defaultSave();
  const events = { emit() {}, on() { return () => {}; } };
  return {
    run, save, rng: new Rng(7), events,
    player: { lightValue: 100, heal() {} },
  } as unknown as GameContext;
}

describe('XP curve', () => {
  it('xpForLevel_earlyLevels_firstFiveLevelsCostUnder80Xp', () => {
    // Arrange / Act
    let total = 0;
    for (let l = 1; l <= 4; l++) total += xpForLevel(l);
    // Assert: ~4 level-ups inside the first minute (≈1-1.5 shade kills per second)
    expect(total).toBeLessThan(80);
  });

  it('xpForLevel_allLevels_monotonicAndContinuousAt20', () => {
    for (let l = 1; l < 60; l++) expect(xpForLevel(l + 1)).toBeGreaterThanOrEqual(xpForLevel(l));
    expect(xpForLevel(20) / xpForLevel(19)).toBeLessThan(1.15);
  });

  it('addXp_largeGain_queuesMultipleLevelUps', () => {
    const run = new RunState();
    run.addXp(200);
    expect(run.level).toBeGreaterThan(4);
    expect(run.pendingLevelUps).toBe(run.level - 1);
  });
});

describe('Weapon data', () => {
  it('evolutions_everyBaseWeapon_hasValidRelicAndHiddenEvolution', () => {
    const base = WEAPONS.filter((w) => !w.hidden);
    expect(base.length).toBeGreaterThanOrEqual(10);
    for (const w of base) {
      expect(w.evolvesWith, w.id).toBeDefined();
      expect(PASSIVES.some((p) => p.id === w.evolvesWith), `${w.id} relic`).toBe(true);
      const evo = getWeapon(w.evolvesInto!);
      expect(evo?.hidden, `${w.id} → ${w.evolvesInto}`).toBe(true);
      expect(w.levelText.length).toBe(w.maxLevel - 1);
    }
  });

  it('weaponIds_allWeapons_unique', () => {
    const ids = WEAPONS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('unlockIds_gatedContent_grantedBySomeAchievement', () => {
    const rewards = new Set(ACHIEVEMENTS.map((a) => a.reward?.unlock).filter(Boolean));
    for (const w of WEAPONS) if (w.unlock) expect(rewards.has(w.unlock), w.id).toBe(true);
    for (const p of PASSIVES) if (p.unlock) expect(rewards.has(p.unlock), p.id).toBe(true);
    for (const c of CHARACTERS) if (c.unlockAchievement) expect(ACHIEVEMENTS.some((a) => a.id === c.unlockAchievement && a.reward?.unlock === c.id)).toBe(true);
  });
});

describe('Enemy data', () => {
  it('splitters_splitInto_referencesExistingEnemy', () => {
    for (const e of Object.values(ENEMIES)) if (e.splitInto) expect(ENEMIES[e.splitInto], e.id).toBeDefined();
  });

  it('bosses_allBosses_haveThreePatternsAndEnrage', () => {
    for (const e of Object.values(ENEMIES).filter((x) => x.boss)) {
      expect(e.bossPatterns?.length, e.id).toBe(3);
      expect(e.enrageAt).toBeGreaterThan(0);
    }
  });
});

describe('Evolution & reliquary', () => {
  it('evolutionCandidates_maxWeaponWithoutRelic_returnsNothing', () => {
    const run = new RunState();
    run.weapons.push(fakeWeapon(getWeapon('ember_bolt')!, 8));
    expect(evolutionCandidates(ctxWith(run))).toHaveLength(0);
  });

  it('rollChest_maxWeaponWithRelic_evolutionIsFirstItem', () => {
    const run = new RunState();
    run.weapons.push(fakeWeapon(getWeapon('ember_bolt')!, 8));
    run.passives.set('flint', 1);
    const items = rollChest(ctxWith(run));
    expect(items[0].kind).toBe('evolution');
    expect(items[0].id).toBe('sunspear_volley');
  });

  it('applyChoice_evolution_replacesWeaponInSameSlot', () => {
    const run = new RunState();
    run.weapons.push(fakeWeapon(getWeapon('flare_nova')!, 3), fakeWeapon(getWeapon('ember_bolt')!, 8));
    run.passives.set('flint', 1);
    const ctx = ctxWith(run);
    applyChoice(ctx, rollChest(ctx)[0]);
    expect(run.weapons[1].def.id).toBe('sunspear_volley');
    expect(run.weapons).toHaveLength(2);
    expect(run.evolutions).toEqual(['sunspear_volley']);
  });

  it('rollChoices_banishedId_neverOffered', () => {
    const run = new RunState();
    run.weapons.push(fakeWeapon(getWeapon('ember_bolt')!, 1));
    run.banished.add('ember_bolt');
    run.banished.add('flint');
    const ctx = ctxWith(run);
    for (let i = 0; i < 50; i++) {
      const ids = rollChoices(ctx, 4).map((c) => c.id);
      expect(ids).not.toContain('ember_bolt');
      expect(ids).not.toContain('flint');
    }
  });

  it('rollChoices_lockedWeapon_notOfferedUntilUnlocked', () => {
    const run = new RunState();
    const ctx = ctxWith(run);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) for (const c of rollChoices(ctx, 4)) seen.add(c.id);
    expect(seen.has('moth_lantern')).toBe(false);
    ctx.save.unlocked.push('w_moth');
    for (let i = 0; i < 300; i++) for (const c of rollChoices(ctx, 4)) seen.add(c.id);
    expect(seen.has('moth_lantern')).toBe(true);
  });
});

describe('Achievements', () => {
  it('grantAchievement_withUnlockReward_pushesUnlockOnce', () => {
    const save = defaultSave();
    const def = ACHIEVEMENTS.find((a) => a.id === 'ach_survive_5')!;
    grantAchievement(save, def);
    grantAchievement(save, def);
    expect(save.achievements).toEqual(['ach_survive_5']);
    expect(save.unlocked.filter((u) => u === 'w_moth')).toHaveLength(1);
  });

  it('evaluateAchievements_fiveMinuteRun_earnsSurvivalOnlyOnce', () => {
    const run = new RunState();
    run.elapsed = 301;
    const save = defaultSave();
    const c = { run, save, life: () => 0, flags: new Set<string>(), ended: false };
    const got = evaluateAchievements(c).map((a) => a.id);
    expect(got).toContain('ach_survive_5');
    expect(got).not.toContain('ach_survive_10');
    for (const a of evaluateAchievements(c)) grantAchievement(save, a);
    expect(evaluateAchievements(c)).toHaveLength(0);
  });

  it('achievementIds_allAchievements_uniqueWithIcons', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) expect(a.icon.length).toBeGreaterThan(0);
  });
});

describe('Meta economy', () => {
  it('hearth_cheapestRank_affordableAfterOneShortRun', () => {
    const cheapest = Math.min(...META_UPGRADES.map((m) => m.cost(0)));
    expect(cheapest).toBeLessThanOrEqual(80); // a 4-5 minute first run pays ~80-110 Ash
  });

  it('hearth_qolRanks_present', () => {
    for (const id of ['m_choice', 'm_reroll', 'm_banish']) expect(META_UPGRADES.some((m) => m.id === id)).toBe(true);
    expect(baseStats().maxLight).toBe(100);
  });
});
