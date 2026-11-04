import { describe, it, expect } from 'vitest';
import { defaultSave, loadSave, sanitizeSave, writeSave, type KV } from '../src/core/Save';
import { applyRun, buyKite, buyUpgrade, selectKite } from '../src/game/Meta';
import { upgradeCost, UPGRADES } from '../src/data/upgrades';
import { buildMods } from '../src/game/Mods';
import { kiteById } from '../src/data/kites';

const memStore = (): KV & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('Save', () => {
  it('round-trips through storage', () => {
    const store = memStore();
    const s = defaultSave();
    s.glimmers = 321;
    s.kites.push('koi');
    s.meta.lift_capacity = 2;
    writeSave(s, store);
    const back = loadSave(store);
    expect(back.glimmers).toBe(321);
    expect(back.kites).toContain('koi');
    expect(back.meta.lift_capacity).toBe(2);
  });
  it('survives corrupt or hostile data', () => {
    const store = memStore();
    store.setItem('kitewind-save-v1', '{not json');
    expect(loadSave(store)).toEqual(defaultSave());
    const s = sanitizeSave({ glimmers: -5, kites: 'x', selectedKite: 'dragon', settings: { quality: 'ultra', sensitivity: 99 } });
    expect(s.glimmers).toBe(0);
    expect(s.kites).toEqual(['swallow']);
    expect(s.selectedKite).toBe('swallow');
    expect(s.settings.quality).toBe('high');
    expect(s.settings.sensitivity).toBe(2);
  });
  it('returns defaults when storage is unavailable', () => {
    expect(loadSave(null)).toEqual(defaultSave());
  });
});

describe('Meta', () => {
  it('buys upgrades with escalating cost', () => {
    const s = defaultSave();
    const def = UPGRADES[0];
    s.glimmers = upgradeCost(def, 0) + upgradeCost(def, 1);
    expect(buyUpgrade(s, def.id)).toBe(true);
    expect(buyUpgrade(s, def.id)).toBe(true);
    expect(s.glimmers).toBe(0);
    expect(buyUpgrade(s, def.id)).toBe(false);
    expect(s.meta[def.id]).toBe(2);
  });
  it('unlocks and selects kites', () => {
    const s = defaultSave();
    expect(selectKite(s, 'koi')).toBe(false);
    s.glimmers = kiteById('koi').cost;
    expect(buyKite(s, 'koi')).toBe(true);
    expect(selectKite(s, 'koi')).toBe(true);
    expect(s.selectedKite).toBe('koi');
    expect(buyKite(s, 'koi')).toBe(false);
  });
  it('applies run rewards, bests and achievements once', () => {
    const s = defaultSave();
    const r = applyRun(s, { distance: 1200, score: 5000, bestCombo: 12, perfects: 1, whiskers: 0, arches: 0, boons: 1, earned: 30, daily: null });
    expect(r.newBestDistance).toBe(true);
    expect(r.achievements.map((a) => a.id)).toEqual(expect.arrayContaining(['first_flight', 'dist_1000', 'combo_10']));
    expect(s.glimmers).toBe(r.totalEarned);
    const r2 = applyRun(s, { distance: 100, score: 10, bestCombo: 1, perfects: 0, whiskers: 0, arches: 0, boons: 0, earned: 1, daily: null });
    expect(r2.achievements.length).toBe(0);
    expect(r2.newBestDistance).toBe(false);
  });
  it('meta ranks feed the run mods', () => {
    const m = buildMods(kiteById('swallow'), { lift_capacity: 2, start_shield: 1 });
    expect(m.liftCapMul).toBeCloseTo(1.2);
    expect(m.shields).toBe(1);
  });
});
