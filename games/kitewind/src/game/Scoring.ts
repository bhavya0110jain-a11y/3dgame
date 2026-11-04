import { SCORING } from '../data/tuning';
import type { Mods } from './Mods';

/**
 * Score / combo bookkeeping — pure and unit-tested (tests/scoring.test.ts).
 * Combo: each ring passed within the combo window extends the chain; the multiplier
 * (1 + combo * step, capped) applies to every point source except distance.
 */
export class Scoring {
  score = 0;
  combo = 0;
  bestCombo = 0;
  comboTimer = 0;
  rings = 0;
  perfects = 0;
  glimmers = 0;
  whiskers = 0;
  arches = 0;
  private distScored = 0;

  constructor(public mods: Mods) {}

  reset(): void {
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.comboTimer = 0;
    this.rings = this.perfects = this.glimmers = this.whiskers = this.arches = 0;
    this.distScored = 0;
  }

  get comboWindow(): number {
    return SCORING.comboWindow + this.mods.comboWindowAdd;
  }

  /** Current multiplier from the combo chain. */
  get multiplier(): number {
    return Math.min(SCORING.maxMultiplier, 1 + this.combo * SCORING.comboStep);
  }

  /** Ticks the combo timer. Returns the combo that was lost (0 if none). */
  update(dt: number, distance: number): number {
    if (distance > this.distScored) {
      this.score += (distance - this.distScored) * SCORING.perMetre;
      this.distScored = distance;
    }
    if (this.combo > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        const lost = this.combo;
        this.combo = 0;
        this.comboTimer = 0;
        return lost;
      }
    }
    return 0;
  }

  /** A ring was passed. `centreFrac` = radial distance / ring radius (0 = dead centre). Returns points awarded. */
  ring(centreFrac: number): { points: number; perfect: boolean } {
    const perfect = centreFrac <= SCORING.perfectFrac;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboTimer = this.comboWindow;
    this.rings++;
    if (perfect) this.perfects++;
    const points = Math.round(SCORING.ringPoints * this.multiplier * (perfect ? SCORING.perfectMul : 1));
    this.score += points;
    return { points, perfect };
  }

  /** A glimmer was collected. Returns currency gained. */
  glimmer(): number {
    const g = this.mods.glimmerMul;
    this.glimmers += g;
    this.score += Math.round(SCORING.glimmerPoints * this.multiplier);
    return g;
  }

  whisker(): number {
    this.whiskers++;
    const p = Math.round(SCORING.whiskerPoints * this.multiplier * this.mods.whiskerPointsMul);
    this.score += p;
    // near-misses keep the chain alive
    if (this.combo > 0) this.comboTimer = Math.max(this.comboTimer, this.comboWindow * 0.6);
    return p;
  }

  arch(): number {
    this.arches++;
    const p = Math.round(SCORING.archPoints * this.multiplier);
    this.score += p;
    return p;
  }

  /** Glimmers (currency) earned for the run: collected + distance bonus. */
  earned(distance: number): number {
    return Math.floor(this.glimmers + (distance / 100) * SCORING.glimmersPer100m);
  }
}
