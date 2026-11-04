/**
 * Sprint 3 (art review s2 #9/#14/#15, BUG-QA-019/020): pure helpers behind the UI announcer and weapon badges, plus
 * Tutorial.forget() which lets a stale queued hint fire again later. No DOM / Game needed.
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/EventBus';
import { defaultSave, type SaveData } from '../../src/core/Save';
import { Tutorial } from '../../src/game/Tutorial';
import { announceKind, stripEvolved, weaponGlyph, weaponTint, ANNOUNCE_TIME, ANNOUNCE_MAX_WAIT } from '../../src/ui/UI';

describe('announceKind', () => {
  it('explicitKind_isKept', () => {
    expect(announceKind('Anything', 'danger')).toBe('danger');
  });
  it('unknownOrMissingKind_isGuessedFromText', () => {
    expect(announceKind('The master of this night stirs…')).toBe('boss');
    expect(announceKind('An elite approaches…', 'nonsense')).toBe('elite');
    expect(announceKind('The dark closes in!')).toBe('danger');
    expect(announceKind('REKINDLED')).toBe('buff');
    expect(announceKind('Hello')).toBe('info');
  });
  it('timing_bannerIsShortAndWaitsLonger', () => {
    expect(ANNOUNCE_TIME).toBeGreaterThanOrEqual(1);
    expect(ANNOUNCE_TIME).toBeLessThanOrEqual(1.5);
    expect(ANNOUNCE_MAX_WAIT).toBeGreaterThan(ANNOUNCE_TIME);
  });
});

describe('weapon badge helpers', () => {
  it('stripEvolved_removesDataPrefixOnly', () => {
    expect(stripEvolved('EVOLVED · A volley of spears.')).toBe('A volley of spears.');
    expect(stripEvolved('A plain line.')).toBe('A plain line.');
  });
  it('weaponGlyph_evolutionHasOwnGlyph_baseKeepsIcon', () => {
    expect(weaponGlyph('sunspear_volley', 'bolt')).not.toBe('bolt');
    expect(weaponGlyph('ember_bolt', 'bolt')).toBe('bolt');
  });
  it('weaponTint_paleColourGetsDarkInk_darkColourGetsWhite', () => {
    expect(weaponTint(0xffffff)).toContain('--wi:#2a1650');
    expect(weaponTint(0xff5a1a)).toContain('--wi:#fff');
    expect(weaponTint(0xff5a1a)).toContain('--wc:');
  });
});

describe('Tutorial.forget (BUG-QA-020)', () => {
  it('forget_staleHint_canFireAgain', () => {
    // Arrange
    const save: SaveData = { ...defaultSave(), runs: 0 };
    save.settings.hints = true;
    const events = new EventBus();
    const ids: string[] = [];
    events.on('tutorial:hint', (h) => ids.push(h.id));
    const tut = new Tutorial(() => save, events, () => 'keyboard', () => {});
    tut.onRunStart();
    expect(tut.show('lowlight')).toBe(true);
    expect(tut.show('lowlight')).toBe(false);
    // Act
    tut.forget('lowlight');
    // Assert
    expect(save.hintsSeen).not.toContain('lowlight');
    expect(tut.show('lowlight')).toBe(true);
    expect(ids).toEqual(['lowlight', 'lowlight']);
  });
});
