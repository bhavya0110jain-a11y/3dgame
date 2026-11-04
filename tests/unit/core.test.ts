import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/Rng';
import { SpatialHash } from '../../src/core/SpatialHash';

describe('Rng', () => {
  it('next_sameSeed_producesIdenticalSequence', () => {
    // Arrange
    const a = new Rng(1234);
    const b = new Rng(1234);
    // Act
    const sa = Array.from({ length: 200 }, () => a.next());
    const sb = Array.from({ length: 200 }, () => b.next());
    // Assert
    expect(sa).toEqual(sb);
  });

  it('next_differentSeeds_produceDifferentSequences', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const sa = Array.from({ length: 20 }, () => a.next());
    const sb = Array.from({ length: 20 }, () => b.next());
    expect(sa).not.toEqual(sb);
  });

  it('next_knownSeed_matchesGoldenValues', () => {
    // Golden values pin the algorithm (mulberry32): changing it silently breaks seeded-run reproduction.
    const r = new Rng(42);
    const got = [r.next(), r.next(), r.next()].map((v) => v.toFixed(8));
    expect(got).toEqual(['0.60110375', '0.44829056', '0.85246579']);
  });

  it('next_manySamples_staysInUnitIntervalAndIsRoughlyUniform', () => {
    const r = new Rng(99);
    const buckets = new Array(10).fill(0);
    const N = 50_000;
    let min = 1;
    let max = 0;
    for (let i = 0; i < N; i++) {
      const v = r.next();
      if (v < min) min = v;
      if (v > max) max = v;
      buckets[Math.floor(v * 10)]++;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    for (const b of buckets) expect(Math.abs(b - N / 10) / (N / 10)).toBeLessThan(0.05);
  });

  it('int_inclusiveRange_hitsBothEndsAndNothingOutside', () => {
    const r = new Rng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(r.int(3, 6));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('range_minMax_staysInsideHalfOpenInterval', () => {
    const r = new Rng(8);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(-2, 5);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(5);
    }
  });

  it('weighted_zeroWeightItems_neverPicked', () => {
    const r = new Rng(77);
    const items = [{ id: 'a', w: 0 }, { id: 'b', w: 1 }, { id: 'c', w: 0 }, { id: 'd', w: 3 }];
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    for (let i = 0; i < 4000; i++) counts[r.weighted(items, (x) => x.w).id]++;
    expect(counts.a).toBe(0);
    expect(counts.c).toBe(0);
    // b:d ≈ 1:3
    expect(counts.d / counts.b).toBeGreaterThan(2.5);
    expect(counts.d / counts.b).toBeLessThan(3.5);
  });

  it('weighted_negativeWeights_treatedAsZero', () => {
    const r = new Rng(3);
    const items = [{ id: 'neg', w: -10 }, { id: 'pos', w: 1 }];
    for (let i = 0; i < 500; i++) expect(r.weighted(items, (x) => x.w).id).toBe('pos');
  });

  // BUG-QA-006 (S4): `this.s += 0x6d2b79f5` is never wrapped to uint32, so after ~4.9M calls the float state
  // exceeds 2^53 and stops matching mulberry32. Fix in src/core/Rng.ts: `this.s = (this.s + 0x6d2b79f5) >>> 0`
  // (identical output before the precision loss). Flip `it.fails` → `it` once fixed.
  it.fails('next_afterFiveMillionCalls_stillMatchesUint32Reference', () => {
    const ref = (seed: number) => {
      let s = seed >>> 0;
      return () => {
        let t = (s = (s + 0x6d2b79f5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const r = new Rng(7);
    const f = ref(7);
    let mismatch = -1;
    for (let i = 0; i < 5_200_000 && mismatch < 0; i++) if (r.next() !== f()) mismatch = i;
    expect(mismatch).toBe(-1);
  });

  it('pick_singleElement_returnsIt', () => {
    expect(new Rng(1).pick(['only'])).toBe('only');
  });

  it('chance_extremes_alwaysFalseAtZeroAlwaysTrueAtOne', () => {
    const r = new Rng(10);
    for (let i = 0; i < 200; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(1)).toBe(true);
    }
  });
});

type P = { id: number; x: number; z: number };

function bruteForce(items: P[], x: number, z: number, r: number): number[] {
  return items.filter((p) => (p.x - x) ** 2 + (p.z - z) ** 2 <= r * r).map((p) => p.id).sort((a, b) => a - b);
}

describe('SpatialHash', () => {
  it('query_randomPoints_returnsSupersetOfExactCircleHits', () => {
    // Arrange: points across all four quadrants (negative cells use Math.floor)
    const rng = new Rng(2024);
    const hash = new SpatialHash<P>(2.5);
    const items: P[] = Array.from({ length: 800 }, (_, id) => ({ id, x: rng.range(-60, 60), z: rng.range(-60, 60) }));
    for (const p of items) hash.insert(p);
    for (let q = 0; q < 50; q++) {
      const x = rng.range(-50, 50);
      const z = rng.range(-50, 50);
      const r = rng.range(0.5, 9);
      // Act
      const got = new Set<number>();
      hash.query(x, z, r, (p) => void got.add(p.id));
      // Assert: every item inside the circle is visited (callers do the exact distance test)
      for (const id of bruteForce(items, x, z, r)) expect(got.has(id), `query ${q} missing ${id}`).toBe(true);
      // and nothing far outside the overlapped cells is visited
      for (const id of got) {
        const p = items[id];
        expect(Math.abs(p.x - x)).toBeLessThanOrEqual(r + 2.5);
        expect(Math.abs(p.z - z)).toBeLessThanOrEqual(r + 2.5);
      }
    }
  });

  it('query_itemOnNegativeCellBoundary_found', () => {
    const hash = new SpatialHash<P>(2);
    hash.insert({ id: 1, x: -2, z: -0.0001 });
    const got: number[] = [];
    hash.query(-2.1, 0.1, 0.5, (p) => void got.push(p.id));
    expect(got).toEqual([1]);
  });

  it('query_callbackReturnsTrue_stopsEarly', () => {
    const hash = new SpatialHash<P>(2);
    for (let i = 0; i < 20; i++) hash.insert({ id: i, x: 0.5, z: 0.5 });
    let visits = 0;
    hash.query(0, 0, 1, () => ++visits === 3);
    expect(visits).toBe(3);
  });

  it('clear_afterInsert_queryFindsNothingAndCellsAreReused', () => {
    const hash = new SpatialHash<P>(2);
    for (let i = 0; i < 50; i++) hash.insert({ id: i, x: i, z: -i });
    hash.clear();
    let n = 0;
    hash.query(0, 0, 100, () => void n++);
    expect(n).toBe(0);
    // re-insert after clear (pooled arrays) must still work and must not resurrect old items
    hash.insert({ id: 99, x: 3, z: -3 });
    const got: number[] = [];
    hash.query(3, -3, 1, (p) => void got.push(p.id));
    expect(got).toEqual([99]);
  });

  it('query_largeButPlayableCoords_noCellAliasing', () => {
    // Endless runs drift far from the origin; cells must stay distinct well beyond a normal arena.
    const hash = new SpatialHash<P>(2.5);
    hash.insert({ id: 1, x: 5000, z: 5000 });
    hash.insert({ id: 2, x: -5000, z: 5000 });
    const got: number[] = [];
    hash.query(5000, 5000, 1, (p) => void got.push(p.id));
    expect(got).toEqual([1]);
  });
});
