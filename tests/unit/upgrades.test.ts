import { describe, expect, it } from 'vitest';
import { RunState } from '../../src/game/RunState';
import { WEAPONS, getWeapon } from '../../src/data/weapons';
import { PASSIVES } from '../../src/data/passives';
import { defaultSave } from '../../src/core/Save';
import { Rng } from '../../src/core/Rng';
import { rollChoices, rollChest, applyChoice, type UpgradeChoice } from '../../src/game/Upgrades';
import type { GameContext, WeaponDef, WeaponInstance } from '../../src/game/types';

function fakeWeapon(def: WeaponDef, level: number): WeaponInstance {
  return { def, level, update() {}, dispose() {} };
}

function makeCtx(run: RunState, seed = 7, unlockAll = false): GameContext {
  const save = defaultSave();
  if (unlockAll) {
    for (const w of WEAPONS) if (w.unlock) save.unlocked.push(w.unlock);
    for (const p of PASSIVES) if (p.unlock) save.unlocked.push(p.unlock);
  }
  const events = { emit() {}, on() { return () => {}; } };
  return { run, save, rng: new Rng(seed), events, player: { lightValue: 100, heal() {} } } as unknown as GameContext;
}

const BASE = WEAPONS.filter((w) => !w.hidden);

/** Random but valid mid-run build: some weapons at random levels, some relics at random ranks. */
function randomBuild(rng: Rng, opts: { weapons?: number; passives?: number } = {}): RunState {
  const run = new RunState();
  const nW = opts.weapons ?? rng.int(0, run.maxWeapons);
  const nP = opts.passives ?? rng.int(0, run.maxPassives);
  const ws = [...BASE].sort(() => rng.next() - 0.5).slice(0, nW);
  for (const d of ws) run.weapons.push(fakeWeapon(d, rng.int(1, d.maxLevel)));
  const ps = [...PASSIVES].sort(() => rng.next() - 0.5).slice(0, nP);
  for (const p of ps) run.passives.set(p.id, rng.int(1, p.maxLevel));
  run.elapsed = rng.range(0, 900);
  return run;
}

function assertValidOffer(run: RunState, choices: UpgradeChoice[], label: string): void {
  const ids = choices.map((c) => c.id);
  expect(new Set(ids).size, `${label}: duplicate ids ${ids.join(',')}`).toBe(ids.length);
  for (const c of choices) {
    if (c.kind === 'weapon-up') {
      const w = run.weapons.find((x) => x.def.id === c.id);
      expect(w, `${label}: upgrade for unowned ${c.id}`).toBeDefined();
      expect(w!.level, `${label}: ${c.id} already max`).toBeLessThan(w!.def.maxLevel);
      expect(c.level).toBe(w!.level + 1);
    } else if (c.kind === 'weapon-new') {
      expect(run.weapons.length, `${label}: new weapon offered with full slots`).toBeLessThan(run.maxWeapons);
      expect(run.weapons.some((w) => w.def.id === c.id), `${label}: new ${c.id} already owned`).toBe(false);
      const def = getWeapon(c.id)!;
      expect(def.hidden, `${label}: hidden weapon ${c.id} offered`).toBeFalsy();
      expect(run.weapons.some((w) => w.def.id === def.evolvesInto), `${label}: base of owned evolution ${c.id}`).toBe(false);
    } else if (c.kind === 'passive') {
      const p = PASSIVES.find((x) => x.id === c.id)!;
      const lvl = run.passives.get(c.id) ?? 0;
      expect(lvl, `${label}: relic ${c.id} already max`).toBeLessThan(p.maxLevel);
      if (lvl === 0) expect(run.passives.size, `${label}: new relic offered with full slots`).toBeLessThan(run.maxPassives);
      expect(c.level).toBe(lvl + 1);
    } else {
      expect(['heal', 'ash'], `${label}: unexpected kind ${c.kind}`).toContain(c.kind);
    }
  }
}

describe('rollChoices invariants (property test)', () => {
  it('rollChoices_500RandomBuilds_neverMaxedDuplicateOrOverSlotLimit', () => {
    const rng = new Rng(31337);
    for (let i = 0; i < 500; i++) {
      // Arrange
      const run = randomBuild(rng);
      const ctx = makeCtx(run, i, i % 2 === 0);
      // Act
      const n = 3 + (i % 3);
      const choices = rollChoices(ctx, n);
      // Assert
      expect(choices.length).toBeGreaterThan(0);
      expect(choices.length).toBeLessThanOrEqual(n);
      assertValidOffer(run, choices, `build ${i}`);
    }
  });

  it('rollChoices_fullWeaponSlots_neverOffersNewWeapon', () => {
    const rng = new Rng(4);
    for (let i = 0; i < 200; i++) {
      const run = randomBuild(rng, { weapons: 6 });
      for (const c of rollChoices(makeCtx(run, i, true), 4)) expect(c.kind).not.toBe('weapon-new');
    }
  });

  it('rollChoices_fullRelicSlots_onlyUpgradesOwnedRelics', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 200; i++) {
      const run = randomBuild(rng, { passives: 6 });
      for (const c of rollChoices(makeCtx(run, i, true), 4)) {
        if (c.kind === 'passive') expect(run.passives.has(c.id)).toBe(true);
      }
    }
  });

  it('rollChoices_ownsEvolvedWeapon_neverOffersItsBaseAgain', () => {
    const base = BASE.find((w) => w.evolvesInto)!;
    const run = new RunState();
    run.weapons.push(fakeWeapon(getWeapon(base.evolvesInto!)!, 1));
    const ctx = makeCtx(run);
    for (let i = 0; i < 300; i++) expect(rollChoices(ctx, 4).map((c) => c.id)).not.toContain(base.id);
  });

  it('rollChoices_everythingMaxedAndSlotsFull_fallsBackToHealAndAsh', () => {
    // Arrange: 6 maxed weapons and 6 maxed relics → empty pool
    const run = new RunState();
    for (const d of BASE.slice(0, 6)) run.weapons.push(fakeWeapon(d, d.maxLevel));
    for (const p of PASSIVES.slice(0, 6)) run.passives.set(p.id, p.maxLevel);
    // Act
    const choices = rollChoices(makeCtx(run), 3);
    // Assert
    expect(choices.map((c) => c.kind).sort()).toEqual(['ash', 'heal']);
  });

  it('rollChoices_requestMoreThanPool_returnsWholePoolOnce', () => {
    const run = new RunState();
    for (const d of BASE.slice(0, 6)) run.weapons.push(fakeWeapon(d, d.maxLevel));
    for (const p of PASSIVES.slice(0, 5)) run.passives.set(p.id, p.maxLevel);
    run.passives.set(PASSIVES[5].id, 1); // one relic still upgradable
    const choices = rollChoices(makeCtx(run), 4);
    expect(choices.map((c) => c.id)).toEqual([PASSIVES[5].id]);
  });

  it('rollChoices_sameSeedSameBuild_deterministic', () => {
    const mk = () => {
      const run = randomBuild(new Rng(9));
      return rollChoices(makeCtx(run, 123), 4).map((c) => c.id);
    };
    expect(mk()).toEqual(mk());
  });

  it('upgradeIds_weaponsAndRelics_disjointNamespaces', () => {
    // banish uses one id set for both kinds; a shared id would banish two things at once
    const weaponIds = new Set(WEAPONS.map((w) => w.id));
    for (const p of PASSIVES) expect(weaponIds.has(p.id), p.id).toBe(false);
  });
});

describe('rollChest invariants', () => {
  it('rollChest_300RandomBuilds_neverPushesPastMaxLevel', () => {
    const rng = new Rng(77);
    for (let i = 0; i < 300; i++) {
      // Arrange
      const run = randomBuild(rng, { weapons: rng.int(1, 6), passives: rng.int(0, 6) });
      run.stats.luck = rng.range(1, 3); // more luck → more items per chest
      const ctx = makeCtx(run, i);
      // Act: apply the whole chest like Game.openChest does
      const items = rollChest(ctx);
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(4);
      for (const c of items) applyChoice(ctx, c);
      // Assert
      for (const w of run.weapons) expect(w.level, w.def.id).toBeLessThanOrEqual(w.def.maxLevel);
      for (const [id, lv] of run.passives) expect(lv, id).toBeLessThanOrEqual(PASSIVES.find((p) => p.id === id)!.maxLevel);
      for (const c of items) expect(c.kind).not.toBe('weapon-new');
    }
  });

  it('rollChest_nothingUpgradable_givesAsh', () => {
    const run = new RunState();
    for (const d of BASE.slice(0, 2)) run.weapons.push(fakeWeapon(d, d.maxLevel));
    const items = rollChest(makeCtx(run));
    expect(items.map((c) => c.kind)).toEqual(['ash']);
  });
});

describe('applyChoice guards', () => {
  it('applyChoice_newWeaponWithFullSlots_noOp', () => {
    const run = new RunState();
    for (const d of BASE.slice(0, 6)) run.weapons.push(fakeWeapon(d, 1));
    const extra = BASE[6];
    applyChoice(makeCtx(run), { kind: 'weapon-new', id: extra.id, name: '', description: '', icon: '', level: 1 });
    expect(run.weapons).toHaveLength(6);
  });

  it('applyChoice_staleUpgradeForMaxedWeapon_doesNotExceedMax', () => {
    const d = BASE[0];
    const run = new RunState();
    run.weapons.push(fakeWeapon(d, d.maxLevel));
    applyChoice(makeCtx(run), { kind: 'weapon-up', id: d.id, name: '', description: '', icon: '', level: d.maxLevel + 1 });
    expect(run.weapons[0].level).toBe(d.maxLevel);
  });

  it('applyChoice_staleRelicUpgradeAtMax_doesNotExceedMax', () => {
    const p = PASSIVES[0];
    const run = new RunState();
    run.passives.set(p.id, p.maxLevel);
    const before = { ...run.stats };
    applyChoice(makeCtx(run), { kind: 'passive', id: p.id, name: '', description: '', icon: '', level: p.maxLevel + 1 });
    expect(run.passives.get(p.id)).toBe(p.maxLevel);
    expect(run.stats).toEqual(before);
  });

  it('applyChoice_ashFallback_adds25Ash', () => {
    const run = new RunState();
    applyChoice(makeCtx(run), { kind: 'ash', id: 'ash', name: '', description: '', icon: '', level: 0 });
    expect(run.ashEarned).toBe(25);
  });
});
