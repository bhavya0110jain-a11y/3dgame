import { describe, expect, it } from 'vitest';
import { BLOOM_CALM, BLOOM_LOADED, bloomK } from '../../src/render/post/PostPipeline';

/** Art review s3 P1 #1b: bloom follows the FX brightness governor (gain 1 = calm … 0.3 = saturated). */
describe('bloom governor', () => {
  it('bloomK_calmGain_isOne', () => {
    expect(bloomK(1)).toBe(1);
    expect(bloomK(Number.NaN)).toBe(1);
  });
  it('bloomK_floorGainOrBelow_isZero', () => {
    expect(bloomK(0.3)).toBe(0);
    expect(bloomK(0.1)).toBe(0);
  });
  it('bloomK_midGain_isLinear', () => {
    expect(bloomK(0.65)).toBeCloseTo(0.5, 6);
  });
  it('endpoints_matchReviewFormula', () => {
    // strength = 0.35 + 0.27k, threshold = 1.15 - 0.23k
    expect(BLOOM_LOADED.strength).toBeCloseTo(0.35, 6);
    expect(BLOOM_CALM.strength - BLOOM_LOADED.strength).toBeCloseTo(0.27, 6);
    expect(BLOOM_LOADED.threshold).toBeCloseTo(1.15, 6);
    expect(BLOOM_LOADED.threshold - BLOOM_CALM.threshold).toBeCloseTo(0.23, 6);
  });
});
