/**
 * Sprint 2: Save.sanitizeSave / safeQuality (fixes for BUG-QA-005 and BUG-QA-007). These check that every known field
 * is coerced to its declared type, that unknown keys survive (UI prefs live in save.settings without a schema change),
 * and that a sanitized save is idempotent (load -> write -> load gives the same data).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY, QUALITY_TIERS, defaultSave, loadSave, safeQuality, sanitizeSave, writeSave } from '../../src/core/Save';

const KEY = 'last-lantern-save-v1';
const store = new Map<string, string>();
const g = globalThis as unknown as { localStorage?: unknown };

beforeEach(() => {
  store.clear();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
});
afterEach(() => {
  delete g.localStorage;
});

describe('Save: safeQuality', () => {
  it('safeQuality_knownTiers_returnedUnchanged', () => {
    for (const q of QUALITY_TIERS) expect(safeQuality(q)).toBe(q);
  });

  it('safeQuality_unknownOrWrongType_fallsBackToDefault', () => {
    for (const q of ['ultra', '', 'HIGH', null, undefined, 3, {}, ['high']]) expect(safeQuality(q)).toBe(DEFAULT_QUALITY);
  });

  it('defaultQuality_isAKnownTier', () => {
    expect(QUALITY_TIERS).toContain(DEFAULT_QUALITY);
    expect(QUALITY_TIERS).toContain(defaultSave().settings.quality);
  });
});

describe('Save: sanitizeSave field coercion', () => {
  it('sanitizeSave_emptyObject_equalsDefaults', () => {
    const s = sanitizeSave({});
    const d = defaultSave();
    // lifetime is optional and stays absent for a fresh save
    expect({ ...s, lifetime: undefined }).toEqual({ ...d, lifetime: undefined });
  });

  it('sanitizeSave_negativeAndFractionalCounters_clampedAndFloored', () => {
    const s = sanitizeSave({ ash: -50, totalAsh: -1, bestTime: -3, bestKills: -9, runs: 2.7, victories: -1 });
    expect(s.ash).toBe(0);
    expect(s.totalAsh).toBe(0);
    expect(s.bestTime).toBe(0);
    expect(s.bestKills).toBe(0);
    expect(s.runs).toBe(2);
    expect(s.victories).toBe(0);
  });

  it('sanitizeSave_nonFiniteNumbers_fallBackToDefaults', () => {
    // JSON cannot carry NaN/Infinity, but a hand-built object (or a future migration) can
    const s = sanitizeSave({ ash: Number.NaN, totalAsh: Number.POSITIVE_INFINITY, bestTime: '12' });
    expect(s.ash).toBe(0);
    expect(s.totalAsh).toBe(0);
    expect(s.bestTime).toBe(0);
  });

  it('sanitizeSave_metaWithBadRanks_keepsOnlyFiniteNumbers', () => {
    const s = sanitizeSave({ meta: { m_might: 3, m_reroll: 'two', m_greed: null, m_x: Number.NaN } });
    expect(s.meta).toEqual({ m_might: 3 });
  });

  it('sanitizeSave_metaAsArray_becomesEmptyRecord', () => {
    expect(sanitizeSave({ meta: [1, 2, 3] }).meta).toEqual({});
  });

  it('sanitizeSave_unlockedWithJunkAndDuplicates_keepsDefaultsAndStringsOnce', () => {
    const def = defaultSave().unlocked;
    const s = sanitizeSave({ unlocked: ['extra_unlock', 'extra_unlock', 7, null, ...def] });
    expect(s.unlocked).toEqual([...def, 'extra_unlock']);
  });

  it('sanitizeSave_achievementsAndBiomesCleared_dedupedAndStringOnly', () => {
    const s = sanitizeSave({ achievements: ['a', 'a', 1], biomesCleared: 'biome_pines', hintsSeen: ['move', 'move', false] });
    expect(s.achievements).toEqual(['a']);
    expect(s.biomesCleared).toEqual([]);
    expect(s.hintsSeen).toEqual(['move']);
  });

  it('sanitizeSave_selectedCharacterNotString_fallsBackToDefault', () => {
    expect(sanitizeSave({ selectedCharacter: 42 }).selectedCharacter).toBe(defaultSave().selectedCharacter);
  });

  it('sanitizeSave_volumesOutOfRange_clampedToUnitInterval', () => {
    const s = sanitizeSave({ settings: { masterVolume: 4, musicVolume: -2, sfxVolume: 'loud' } });
    expect(s.settings.masterVolume).toBe(1);
    expect(s.settings.musicVolume).toBe(0);
    expect(s.settings.sfxVolume).toBe(defaultSave().settings.sfxVolume);
  });

  it('sanitizeSave_booleanSettingsWrongType_fallBackToDefaults', () => {
    const d = defaultSave().settings;
    const s = sanitizeSave({ settings: { screenShake: 'no', damageNumbers: 0, showFps: 1, hints: null } });
    expect(s.settings.screenShake).toBe(d.screenShake);
    expect(s.settings.damageNumbers).toBe(d.damageNumbers);
    expect(s.settings.showFps).toBe(d.showFps);
    expect(s.settings.hints).toBe(d.hints);
  });

  it('sanitizeSave_settingsNotObject_usesDefaultSettings', () => {
    expect(sanitizeSave({ settings: 'broken' }).settings).toEqual(defaultSave().settings);
    expect(sanitizeSave({ settings: [1] }).settings).toEqual(defaultSave().settings);
  });

  it('sanitizeSave_unknownUiPrefKeys_preservedInSettings', () => {
    // src/ui/prefs.ts stores reducedFlashing/uiScale/... inside save.settings without a schema change
    const s = sanitizeSave({ settings: { reducedFlashing: true, uiScale: 1.2 } }) as unknown as { settings: Record<string, unknown> };
    expect(s.settings.reducedFlashing).toBe(true);
    expect(s.settings.uiScale).toBe(1.2);
  });

  it('sanitizeSave_futureVersion_forcedToCurrentVersion', () => {
    expect(sanitizeSave({ version: 7 }).version).toBe(1);
  });

  it('sanitizeSave_lifetimeCounters_keptWhenNumeric', () => {
    expect(sanitizeSave({ lifetime: { kills: 100, bad: 'x' } }).lifetime).toEqual({ kills: 100 });
    expect(sanitizeSave({ lifetime: 'x' }).lifetime).toBeUndefined();
  });
});

describe('Save: round trip', () => {
  it('loadSave_afterWriteOfSanitizedSave_isIdempotent', () => {
    // Arrange: a corrupt save
    store.set(KEY, JSON.stringify({ version: 1, ash: 'x', unlocked: null, meta: { m_might: 2 }, settings: { quality: 'ultra', reducedFlashing: true } }));
    // Act
    const once = loadSave();
    writeSave(once);
    const twice = loadSave();
    // Assert
    expect(twice).toEqual(once);
    expect(twice.settings.quality).toBe(DEFAULT_QUALITY);
  });

  it('loadSave_topLevelArray_returnsDefaults', () => {
    store.set(KEY, '[1,2,3]');
    expect(loadSave()).toEqual(defaultSave());
  });

  it('loadSave_oldSaveWithoutHints_getsHintsOnAndEmptyHintsSeen', () => {
    store.set(KEY, JSON.stringify({ version: 1, runs: 5, settings: { quality: 'low' } }));
    const s = loadSave();
    expect(s.hintsSeen).toEqual([]);
    expect(s.settings.hints).toBe(true);
    expect(s.settings.quality).toBe('low');
  });
});

describe('sanitizeSave: damage-number mode (art review s3 #12)', () => {
  it('sanitizeSave_legacyBooleanDamageNumbers_mapsToAllOrOff', () => {
    expect(sanitizeSave({ settings: { damageNumbers: true } }).settings.damageNumbers).toBe('all');
    expect(sanitizeSave({ settings: { damageNumbers: false } }).settings.damageNumbers).toBe('off');
  });
  it('sanitizeSave_damageNumbersModeOrJunk_keptOrDefaulted', () => {
    expect(sanitizeSave({ settings: { damageNumbers: 'crits' } }).settings.damageNumbers).toBe('crits');
    expect(sanitizeSave({ settings: { damageNumbers: 'loud' } }).settings.damageNumbers).toBe('all');
    expect(defaultSave().settings.damageNumbers).toBe('all');
  });
});
