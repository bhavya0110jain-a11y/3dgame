import { describe, it, expect } from 'vitest';
import { Scoring } from '../src/game/Scoring';
import { baseMods } from '../src/game/Mods';
import { SCORING } from '../src/data/tuning';

describe('Scoring', () => {
  it('awards distance points per metre', () => {
    const s = new Scoring(baseMods());
    s.update(0.1, 250);
    expect(s.score).toBe(250 * SCORING.perMetre);
  });

  it('chains rings into a growing multiplier and doubles perfect passes', () => {
    const s = new Scoring(baseMods());
    const a = s.ring(0.9);
    expect(a.perfect).toBe(false);
    expect(a.points).toBe(Math.round(SCORING.ringPoints * (1 + SCORING.comboStep)));
    const b = s.ring(0.1);
    expect(b.perfect).toBe(true);
    expect(b.points).toBe(Math.round(SCORING.ringPoints * (1 + 2 * SCORING.comboStep) * SCORING.perfectMul));
    expect(s.combo).toBe(2);
    expect(s.perfects).toBe(1);
  });

  it('caps the multiplier', () => {
    const s = new Scoring(baseMods());
    for (let i = 0; i < 200; i++) s.ring(0.5);
    expect(s.multiplier).toBe(SCORING.maxMultiplier);
  });

  it('breaks the combo after the window and reports the lost chain', () => {
    const s = new Scoring(baseMods());
    s.ring(0.5);
    s.ring(0.5);
    expect(s.update(SCORING.comboWindow - 0.1, 0)).toBe(0);
    expect(s.update(0.2, 0)).toBe(2);
    expect(s.combo).toBe(0);
    expect(s.bestCombo).toBe(2);
  });

  it('long-combo boon extends the window', () => {
    const m = baseMods();
    m.comboWindowAdd = 2;
    const s = new Scoring(m);
    s.ring(0.5);
    expect(s.update(SCORING.comboWindow + 1, 0)).toBe(0);
  });

  it('glimmers respect the glimmer multiplier and earned() adds the distance bonus', () => {
    const m = baseMods();
    m.glimmerMul = 2;
    const s = new Scoring(m);
    s.glimmer();
    s.glimmer();
    expect(s.glimmers).toBe(4);
    expect(s.earned(1000)).toBe(4 + 10 * SCORING.glimmersPer100m);
  });

  it('whiskers keep an active combo alive', () => {
    const s = new Scoring(baseMods());
    s.ring(0.5);
    s.update(SCORING.comboWindow - 0.2, 0);
    s.whisker();
    expect(s.update(0.5, 0)).toBe(0);
    expect(s.combo).toBe(1);
  });
});
