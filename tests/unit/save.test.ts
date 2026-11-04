import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSave, loadSave, writeSave } from '../../src/core/Save';

const KEY = 'last-lantern-save-v1';

/** In-memory localStorage stand-in (Node has none). Optionally throws to model private mode / quota errors. */
class MemStorage {
  data = new Map<string, string>();
  throwOn: 'get' | 'set' | null = null;
  getItem(k: string): string | null {
    if (this.throwOn === 'get') throw new Error('SecurityError');
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    if (this.throwOn === 'set') throw new Error('QuotaExceededError');
    this.data.set(k, String(v));
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

let store: MemStorage;
const g = globalThis as unknown as { localStorage?: unknown };

beforeEach(() => {
  store = new MemStorage();
  g.localStorage = store;
});
afterEach(() => {
  delete g.localStorage;
});

describe('Save: load & defaults', () => {
  it('loadSave_noStoredData_returnsDefaults', () => {
    expect(loadSave()).toEqual(defaultSave());
  });

  it('loadSave_invalidJson_returnsDefaults', () => {
    store.data.set(KEY, '{"ash": 12, oops');
    expect(loadSave()).toEqual(defaultSave());
  });

  it('loadSave_jsonNull_returnsDefaults', () => {
    store.data.set(KEY, 'null');
    expect(loadSave()).toEqual(defaultSave());
  });

  it('loadSave_storageThrows_returnsDefaults', () => {
    store.throwOn = 'get';
    expect(loadSave()).toEqual(defaultSave());
  });

  it('loadSave_oldPartialSave_mergesMissingFieldsFromDefaults', () => {
    // Arrange: a save written before settings.showFps / achievements existed
    store.data.set(KEY, JSON.stringify({ version: 1, ash: 340, runs: 7, settings: { masterVolume: 0.2 } }));
    // Act
    const s = loadSave();
    // Assert
    expect(s.ash).toBe(340);
    expect(s.runs).toBe(7);
    expect(s.settings.masterVolume).toBe(0.2);
    expect(s.settings.sfxVolume).toBe(defaultSave().settings.sfxVolume);
    expect(s.settings.quality).toBe(defaultSave().settings.quality);
    expect(s.achievements).toEqual([]);
    expect(s.unlocked).toContain('char_keeper');
  });

  it('defaultSave_calledTwice_returnsIndependentObjects', () => {
    const a = defaultSave();
    a.unlocked.push('x');
    a.settings.masterVolume = 0;
    const b = defaultSave();
    expect(b.unlocked).not.toContain('x');
    expect(b.settings.masterVolume).toBeGreaterThan(0);
  });
});

describe('Save: write', () => {
  it('writeSave_thenLoad_roundTripsAllFields', () => {
    const s = defaultSave();
    s.ash = 999;
    s.meta = { m_light: 3 };
    s.unlocked.push('w_moth');
    s.achievements.push('ach_survive_5');
    s.lifetime = { kills: 12345 };
    s.settings.quality = 'low';
    writeSave(s);
    expect(loadSave()).toEqual(s);
  });

  it('writeSave_storageThrows_doesNotThrow', () => {
    store.throwOn = 'set';
    expect(() => writeSave(defaultSave())).not.toThrow();
  });
});

/**
 * Known bugs (production/qa/bugs.md BUG-QA-005). loadSave() shallow-merges whatever JSON it finds, so a corrupt or
 * hand-edited save with wrong field TYPES passes through and crashes later (save.unlocked.includes, save.meta[id],
 * Renderer TIERS[quality]). These assert the correct behaviour and are marked `it.fails` until Save.ts validates
 * field types; when the fix lands vitest reports them as unexpectedly passing — flip them to `it`.
 */
describe('Save: corrupt field types (known bug BUG-QA-005)', () => {
  it.fails('loadSave_unlockedNull_fallsBackToDefaultUnlocks', () => {
    store.data.set(KEY, JSON.stringify({ version: 1, unlocked: null, meta: null }));
    const s = loadSave();
    expect(Array.isArray(s.unlocked)).toBe(true);
    expect(s.meta).toBeTypeOf('object');
    expect(s.meta).not.toBeNull();
  });

  it.fails('loadSave_unknownQualityTier_fallsBackToDefaultTier', () => {
    store.data.set(KEY, JSON.stringify({ version: 1, settings: { quality: 'ultra' } }));
    expect(['low', 'medium', 'high']).toContain(loadSave().settings.quality);
  });

  it.fails('loadSave_nonNumericAsh_fallsBackToZero', () => {
    store.data.set(KEY, JSON.stringify({ version: 1, ash: 'lots', bestTime: null }));
    const s = loadSave();
    expect(Number.isFinite(s.ash)).toBe(true);
    expect(Number.isFinite(s.bestTime)).toBe(true);
  });
});
