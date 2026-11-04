import { Rng, hash2 } from '../core/Rng';
import { clamp } from '../core/math';
import { BIOMES, biomeIndexAt, type BiomeDef } from '../data/biomes';
import { WORLD, FLIGHT } from '../data/tuning';
import { ISLAND_SHAPES, HOUSE_VARIANTS, WILD_VARIANTS } from './islandShapes';
import type { Chunk, Island } from './types';

/**
 * Deterministic procedural world. A chunk is a pure function of (seed, chunk index): the same seed always
 * yields the same sky (tests/generator.test.ts). Content follows a smooth "guide line" — a seeded sum of sines
 * in x(z) and y(z) — so rings and glimmers teach good lines and islands/hazards are placed relative to it.
 */
export class Generator {
  private rng = new Rng(1);
  private p: number[] = [];

  constructor(public readonly seed: number) {
    const r = new Rng(hash2(seed, 0x51ed));
    for (let i = 0; i < 8; i++) this.p.push(r.range(0, Math.PI * 2));
  }

  /** Guide-line lateral position at distance z. */
  guideX(z: number): number {
    const p = this.p;
    const a = clamp(z / 1200, 0.3, 1);
    return a * (44 * Math.sin(z * 0.0042 + p[0]) + 22 * Math.sin(z * 0.011 + p[1]) + 7 * Math.sin(z * 0.029 + p[2]));
  }

  /** Guide-line altitude at distance z. */
  guideY(z: number): number {
    const p = this.p;
    const y = 40 + 15 * Math.sin(z * 0.0051 + p[3]) + 9 * Math.sin(z * 0.017 + p[4]) + 3 * Math.sin(z * 0.043 + p[5]);
    // the first stretch stays near the start altitude so the opening is calm
    const k = clamp(z / 300, 0, 1);
    return clamp(FLIGHT.startAltitude + (y - FLIGHT.startAltitude) * k, 16, 92);
  }

  /** Difficulty 0.. grows with distance (≈1 at 3 km, ≈2 at 7.5 km). */
  static difficulty(distance: number): number {
    return Math.max(0, distance - WORLD.safeStart) / 3000 + Math.max(0, distance - 4500) / 6000;
  }

  /** Builds chunk `index` (covers z in [index*L, (index+1)*L)). */
  chunk(index: number): Chunk {
    const L = WORLD.chunkLength;
    const z0 = index * L;
    const biomeIdx = biomeIndexAt(z0 + L * 0.5, WORLD.biomeLength);
    const biome = BIOMES[biomeIdx];
    const rng = this.rng.reseed(hash2(this.seed, index + 1000));
    const c: Chunk = {
      index, z0, biome: biomeIdx, islands: [], rings: [], glimmers: [], updrafts: [], spires: [], lightning: [],
      thunderclouds: [], gusts: [], flocks: [], arches: [], shrines: [], clouds: [], lanterns: [],
    };
    if (index < 0) return c;
    const diff = Generator.difficulty(z0);

    // ---- wind shrine (boon pick)
    let shrineZ = -1;
    for (let s = WORLD.shrineFirst; s < z0 + L; s += WORLD.shrineEvery) {
      if (s >= z0) shrineZ = s;
    }
    if (shrineZ >= 0) {
      c.shrines.push({ x: this.guideX(shrineZ), y: this.guideY(shrineZ), z: shrineZ, radius: 7.5, taken: false, missed: false });
    }
    const nearShrine = (z: number): boolean => shrineZ >= 0 && Math.abs(z - shrineZ) < 45;
    const blocked = (z: number): boolean => {
      for (const a of c.arches) if (Math.abs(a.z - z) < 14) return true;
      for (const s of c.spires) if (Math.abs(s.z - z) < 12) return true;
      return false;
    };

    // ---- hazards
    const hz = biome.hazards;
    if (z0 >= WORLD.safeStart && !nearShrine(z0 + L / 2)) {
      const expected = biome.hazardDensity * (0.7 + diff * 0.9);
      let count = Math.floor(expected) + (rng.chance(expected - Math.floor(expected)) ? 1 : 0);
      count = Math.min(count, 4);
      const kinds: Array<keyof BiomeDef['hazards']> = ['gust', 'spire', 'thundercloud', 'flock', 'arch'];
      const usedZ: number[] = [];
      for (let h = 0; h < count; h++) {
        const kind = rng.weighted(kinds, (k) => hz[k]);
        let z = z0 + rng.range(15, 85);
        for (const u of usedZ) if (Math.abs(u - z) < 22) z = z0 + ((z - z0 + 37) % 70) + 15;
        usedZ.push(z);
        this.hazard(c, kind, z, rng, diff);
      }
    }

    // ---- rings along the guide (patterns teach lines)
    const ringR = 3.9 - 0.5 * clamp(diff / 2, 0, 1);
    const hasRings = index === 0 ? false : rng.chance(index < 3 ? 1 : 0.8);
    if (hasRings) {
      const pattern = rng.int(0, 4);
      const n = rng.int(4, 6);
      const spacing = rng.range(15, 21);
      const start = z0 + rng.range(6, 16);
      const side = rng.chance(0.5) ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const z = start + i * spacing;
        if (z >= z0 + L || nearShrine(z) || blocked(z)) continue;
        let x = this.guideX(z);
        let y = this.guideY(z);
        const t = i / Math.max(1, n - 1);
        switch (pattern) {
          case 1: x += side * Math.sin(t * Math.PI * 2) * 9; break; // slalom
          case 2: y += (t - 0.5) * 16; break; // climb
          case 3: y += Math.sin(t * Math.PI) * -14; break; // dive dip
          case 4: x += side * (t - 0.5) * 22; break; // diagonal sweep
        }
        y = clamp(y, 10, 100);
        c.rings.push({ x, y, z, radius: ringR, passed: false, missed: false, pop: 0 });
        // a sparkle line leading through each ring
        for (let g = 1; g <= 2; g++) {
          const gz = z - g * (spacing / 3);
          if (gz < z0) continue;
          c.glimmers.push({ x: x + (this.guideX(gz) - this.guideX(z)) * 0.5, y, z: gz, taken: false, phase: rng.next() * 6.28 });
        }
      }
    } else {
      // ring-less chunk: a long glimmer arc
      const n = rng.int(8, 14);
      const amp = rng.range(4, 12) * (rng.chance(0.5) ? 1 : -1);
      const ampY = rng.range(-8, 10);
      const start = z0 + rng.range(10, 30);
      for (let i = 0; i < n; i++) {
        const z = start + i * 4.5;
        if (z >= z0 + L) break;
        const t = i / (n - 1);
        c.glimmers.push({
          x: this.guideX(z) + Math.sin(t * Math.PI) * amp,
          y: clamp(this.guideY(z) + Math.sin(t * Math.PI) * ampY, 8, 100),
          z, taken: false, phase: rng.next() * 6.28,
        });
      }
    }

    // ---- updrafts (lift refills)
    if (index > 1 && rng.chance(hasRings ? 0.22 : 0.6)) {
      const z = z0 + rng.range(20, 80);
      if (!nearShrine(z)) c.updrafts.push({ x: this.guideX(z) + rng.range(-14, 14), z, radius: 7, height: 95, inside: false });
    }

    // ---- islands (placed with clearance from the guide line)
    const islandCount = Math.round(rng.range(3, 6) * biome.islandDensity);
    for (let i = 0; i < islandCount; i++) this.island(c, rng, biome, z0 + rng.range(0, L), false);

    // ---- clouds: low "sea of clouds" banks, side banks and high wisps
    const banks = rng.int(3, 5);
    for (let b = 0; b < banks; b++) {
      const z = z0 + rng.range(0, L);
      const side = rng.chance(0.5) ? 1 : -1;
      const low = rng.chance(0.55);
      const gx = this.guideX(z);
      const gy = this.guideY(z);
      const cx = low ? gx + rng.range(-120, 120) : gx + side * rng.range(45, 200);
      const cy = low ? rng.range(2, Math.max(4, gy - 22)) : rng.range(gy - 10, gy + 50);
      const n = rng.int(5, 11);
      const size = rng.range(9, 20);
      for (let p = 0; p < n; p++) {
        c.clouds.push({
          x: cx + rng.range(-1.6, 1.6) * size,
          y: cy + rng.range(-0.25, 0.5) * size,
          z: z + rng.range(-1.2, 1.2) * size,
          size: size * rng.range(0.6, 1.2),
          shade: rng.next(),
        });
      }
    }

    // ---- rising paper lanterns (Lantern Dusk)
    const lanternCount = Math.round(biome.lanterns * rng.range(6, 12));
    for (let i = 0; i < lanternCount; i++) {
      const z = z0 + rng.range(0, L);
      c.lanterns.push({ x: this.guideX(z) + rng.range(-90, 90), y: rng.range(0, 110), z, speed: rng.range(1.2, 2.6), phase: rng.next() * 6.28 });
    }
    return c;
  }

  private hazard(c: Chunk, kind: string, z: number, rng: Rng, diff: number): void {
    const gx = this.guideX(z);
    const gy = this.guideY(z);
    switch (kind) {
      case 'gust': {
        const halfH = rng.range(10, 14);
        c.gusts.push({ x: gx, y: gy + rng.range(-4, 4), z, halfW: 34, halfH, halfL: 16, dir: rng.chance(0.5) ? 1 : -1, timer: -1, state: 0 });
        break;
      }
      case 'spire': {
        // a pair of storm spires; lightning arcs between them across the line
        const gap = rng.range(13, 20);
        const off = rng.range(-5, 5);
        const h = gy + rng.range(14, 34);
        const ax = gx + off - gap, bx = gx + off + gap;
        c.spires.push({ x: ax, z, radius: rng.range(2.2, 3.2), height: h, whisker: 0 });
        c.spires.push({ x: bx, z: z + rng.range(-4, 4), radius: rng.range(2.2, 3.2), height: h * rng.range(0.85, 1.1), whisker: 0 });
        const arcY = gy + rng.range(-5, 5);
        c.lightning.push({ ax, ay: arcY, az: z, bx, by: arcY + rng.range(-3, 3), bz: c.spires[c.spires.length - 1].z, phase: rng.range(0, 3.4), state: 0, t: 0, whisker: 0 });
        if (diff > 0.8 && rng.chance(0.5)) {
          c.lightning.push({ ax, ay: arcY + 11, az: z, bx, by: arcY + 11, bz: c.spires[c.spires.length - 1].z, phase: rng.range(0, 3.4), state: 0, t: 0, whisker: 0 });
        }
        break;
      }
      case 'thundercloud': {
        c.thunderclouds.push({ cx: gx + rng.range(-10, 10), y: gy + rng.range(-6, 6), z, radius: rng.range(6, 8.5), amp: rng.range(12, 26), phase: rng.next() * 6.28, x: gx, whisker: 0 });
        break;
      }
      case 'flock': {
        const n = rng.int(7, 12);
        c.flocks.push({ cx: gx, cy: gy + rng.range(-3, 5), z, amp: rng.range(18, 34), phase: rng.next() * 6.28, count: n, x: gx, y: gy, whisker: 0 });
        break;
      }
      case 'arch': {
        // two islands joined by a stone arch; threading it is the high-score shortcut
        const R = rng.range(10.5, 14);
        const baseY = gy - rng.range(2, 5);
        const ax = gx + rng.range(-6, 6);
        c.arches.push({ x: ax, y: baseY, z, radius: R, tube: R * 0.14, threaded: false, whisker: 0 });
        for (const s of [-1, 1]) {
          const ir = rng.range(6.5, 8.5);
          const isl = this.makeIsland(ax + s * (R + ir * 0.6), baseY - 0.5, z + rng.range(-2, 2), ir, rng, 0);
          isl.variant = 2;
          isl.clutter = ir * 0.12;
          isl.depth = ir * 1.2;
          c.islands.push(isl);
        }
        // a perfect ring and a glimmer line through the arch
        c.rings.push({ x: ax, y: baseY + R * 0.42, z, radius: 3, passed: false, missed: false, pop: 0 });
        for (let g = -3; g <= 3; g++) if (g !== 0) c.glimmers.push({ x: ax, y: baseY + R * 0.42, z: z + g * 4, taken: false, phase: g });
        break;
      }
    }
  }

  private makeIsland(x: number, y: number, z: number, radius: number, rng: Rng, housesP: number): Island {
    const variant = rng.chance(housesP) ? rng.pick(HOUSE_VARIANTS) : rng.pick(WILD_VARIANTS);
    const shape = ISLAND_SHAPES[variant];
    return { x, y, z, radius, depth: radius * shape.depth, clutter: radius * shape.clutter, variant, rotY: rng.range(0, Math.PI * 2), whisker: 0 };
  }

  private island(c: Chunk, rng: Rng, biome: BiomeDef, z: number, _force: boolean): void {
    const gx = this.guideX(z);
    const gy = this.guideY(z);
    for (let attempt = 0; attempt < 6; attempt++) {
      const big = rng.chance(0.35);
      const radius = big ? rng.range(18, 34) : rng.range(6, 15);
      const mode = rng.next();
      let x: number;
      let y: number;
      if (mode < 0.55) {
        // beside the line
        const side = rng.chance(0.5) ? 1 : -1;
        x = gx + side * (radius + rng.range(16, 140));
        y = rng.range(Math.max(6, gy - 30), gy + 22);
      } else if (mode < 0.8) {
        // beneath the line (fly over it)
        x = gx + rng.range(-30, 30);
        y = gy - rng.range(24, 36) - radius * 0.34;
      } else {
        // floating overhead (fly under it)
        x = gx + rng.range(-25, 25);
        y = gy + 18 + radius * 2.3 + rng.range(4, 24);
      }
      if (y < 4) y = 4 + rng.range(0, 6);
      const isl = this.makeIsland(x, y, z, radius, rng, biome.houses);
      if (!this.clearOfLine(isl) || this.overlaps(c, isl)) continue;
      c.islands.push(isl);
      return;
    }
  }

  /** True if the island keeps a safe gap from the guide line (and its rings) around its z extent. */
  private clearOfLine(isl: Island): boolean {
    for (let dz = -isl.radius; dz <= isl.radius; dz += Math.max(3, isl.radius / 3)) {
      const z = isl.z + dz;
      const gx = this.guideX(z);
      const gy = this.guideY(z);
      const h = Math.abs(gx - isl.x);
      if (h > isl.radius + 18) continue;
      if (isl.y + isl.clutter < gy - 22) continue; // below
      if (isl.y - isl.depth > gy + 16) continue; // above
      return false;
    }
    return true;
  }

  private overlaps(c: Chunk, isl: Island): boolean {
    for (const o of c.islands) {
      const d = Math.hypot(o.x - isl.x, o.z - isl.z);
      if (d < o.radius + isl.radius + 4 && Math.abs(o.y - isl.y) < Math.max(o.depth, isl.depth) + 8) return true;
    }
    return false;
  }
}
