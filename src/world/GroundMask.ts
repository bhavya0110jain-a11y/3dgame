import * as THREE from 'three';

/**
 * Tileable ground "mask" field shared by the GPU (ground / grass shaders sample it as a texture) and the CPU
 * (prop placement samples the same bytes bilinearly), so paths, pools and groves line up exactly.
 *
 * Channels (0..1):  R = patch / grove noise · G = path field (path where |G-0.5| is small)
 *                   B = wetness (pools where B > waterLevel) · A = fine detail noise
 */
export const MASK_SIZE = 512;
/** World metres covered by one texture tile. */
export const MASK_WORLD = 128;

function ihash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Periodic value-noise lattice (period x period hashed corner values), precomputed once per (period, seed) so the
 * per-pixel noise is 4 table reads + a bilinear smoothstep instead of 4 integer hashes. Values are bit-identical to
 * hashing on the fly (same ihash), so CPU prop placement and the GPU mask still agree.
 */
class Lattice {
  readonly t: Float32Array;
  constructor(readonly p: number, seed: number) {
    this.t = new Float32Array(p * p);
    for (let y = 0; y < p; y++) for (let x = 0; x < p; x++) this.t[y * p + x] = ihash(x, y, seed);
  }
}

/** Periodic value noise at u,v in tile space (any real; wrapped). */
function lnoise(L: Lattice, u: number, v: number): number {
  const p = L.p;
  const x = u * p;
  const y = v * p;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  let x0 = xi % p;
  if (x0 < 0) x0 += p;
  let y0 = yi % p;
  if (y0 < 0) y0 += p;
  const x1 = x0 + 1 === p ? 0 : x0 + 1;
  const y1 = y0 + 1 === p ? 0 : y0 + 1;
  const t = L.t;
  const a = t[y0 * p + x0];
  const b = t[y0 * p + x1];
  const c = t[y1 * p + x0];
  const d = t[y1 * p + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** fBm over precomputed octaves (period doubles, seed + i*31 per octave, amplitude halves). */
class Fbm {
  private oct: Lattice[] = [];
  private norm = 0;
  constructor(period: number, seed: number, octaves: number) {
    let amp = 0.5;
    for (let i = 0; i < octaves; i++) {
      this.oct.push(new Lattice(period << i, seed + i * 31));
      this.norm += amp;
      amp *= 0.5;
    }
  }
  at(u: number, v: number): number {
    let sum = 0;
    let amp = 0.5;
    for (let i = 0; i < this.oct.length; i++) {
      sum += amp * lnoise(this.oct[i], u, v);
      amp *= 0.5;
    }
    return sum / this.norm;
  }
}

/** Fields kept per seed (each 1 MiB): the menu glade (seed 1) + the last couple of runs never regenerate. */
const CACHE_MAX = 3;

export class GroundMask {
  readonly data = new Uint8Array(MASK_SIZE * MASK_SIZE * 4);
  readonly texture: THREE.DataTexture;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, MASK_SIZE, MASK_SIZE, THREE.RGBAFormat);
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    // sampled with texelFetch + manual bilinear in GLSL (see MASK_GLSL)
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
  }

  private cache = new Map<number, Uint8Array>();
  private current = NaN;

  /**
   * Regenerates the field for a seed. Precomputed noise lattices keep this to roughly a quarter of the old
   * hash-per-sample cost; results are cached per seed (LRU, CACHE_MAX), so the menu glade and biome re-entry are
   * a 1 MiB memcpy. Same seed → same bytes, always.
   */
  generate(seed: number): void {
    if (seed === this.current) return;
    const hit = this.cache.get(seed);
    if (hit) {
      this.data.set(hit);
      this.cache.delete(seed); // refresh LRU order
      this.cache.set(seed, hit);
    } else {
      this.build(seed);
      if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as number);
      this.cache.set(seed, this.data.slice());
    }
    this.current = seed;
    this.texture.needsUpdate = true;
  }

  private build(seed: number): void {
    const s = (seed * 7919) | 0;
    const N = MASK_SIZE;
    const d = this.data;
    const warpU = new Lattice(4, s + 5);
    const warpV = new Lattice(4, s + 9);
    const patchF = new Fbm(4, s + 1, 4);
    const pathF = new Fbm(2, s + 2, 3);
    const wetF = new Fbm(5, s + 3, 4);
    const detF = new Fbm(16, s + 4, 2);
    for (let j = 0; j < N; j++) {
      const v = j / N;
      for (let i = 0; i < N; i++) {
        const u = i / N;
        // domain warp so paths meander
        const wu = u + (lnoise(warpU, u, v) - 0.5) * 0.08;
        const wv = v + (lnoise(warpV, u, v) - 0.5) * 0.08;
        const patch = patchF.at(u, v);
        const path = pathF.at(wu, wv);
        const wet = wetF.at(wu, wv);
        const det = detF.at(u, v);
        const k = (j * N + i) * 4;
        d[k] = Math.round(Math.min(1, Math.max(0, (patch - 0.5) * 1.8 + 0.5)) * 255);
        d[k + 1] = Math.round(Math.min(1, Math.max(0, (path - 0.5) * 2.2 + 0.5)) * 255);
        d[k + 2] = Math.round(Math.min(1, Math.max(0, (wet - 0.5) * 2.0 + 0.5)) * 255);
        d[k + 3] = Math.round(det * 255);
      }
    }
  }

  /** Bilinear sample of one channel (0..3) at world x,z — matches the GPU's LinearFilter at mip 0. */
  sample(x: number, z: number, ch: number): number {
    const N = MASK_SIZE;
    const fx = (x / MASK_WORLD) * N - 0.5;
    const fz = (z / MASK_WORLD) * N - 0.5;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const x0 = ((ix % N) + N) % N;
    const z0 = ((iz % N) + N) % N;
    const x1 = (x0 + 1) % N;
    const z1 = (z0 + 1) % N;
    const d = this.data;
    const a = d[(z0 * N + x0) * 4 + ch];
    const b = d[(z0 * N + x1) * 4 + ch];
    const c = d[(z1 * N + x0) * 4 + ch];
    const e = d[(z1 * N + x1) * 4 + ch];
    return (a + (b - a) * tx + (c - a) * tz + (a - b - c + e) * tx * tz) / 255;
  }

  /** Path strength 0..1 (same formula as GLSL `pathMask`). */
  path(x: number, z: number): number {
    const g = this.sample(x, z, 1);
    const t = Math.min(1, Math.max(0, (Math.abs(g - 0.5) - 0.02) / 0.035));
    return 1 - t * t * (3 - 2 * t);
  }

  /** Wetness with the spawn-glade dried out (same formula as GLSL `wetness`). */
  wet(x: number, z: number): number {
    const r = Math.hypot(x, z);
    const t = Math.min(1, Math.max(0, (r - 6) / 7));
    return this.sample(x, z, 2) - (1 - t * t * (3 - 2 * t)) * 0.35;
  }
}

/** GLSL twins of GroundMask.path / wet (needs `uniform sampler2D uMask;`). */
export const MASK_GLSL = /* glsl */ `
  // manual bilinear (texelFetch) so the CPU sampler and every GPU/driver agree exactly
  vec4 groundMask(vec2 p) {
    vec2 st = p * ${(MASK_SIZE / MASK_WORLD).toFixed(6)} - 0.5;
    vec2 i = floor(st);
    vec2 f = st - i;
    ivec2 a = ivec2(mod(i, ${MASK_SIZE.toFixed(1)}));
    ivec2 b = ivec2(mod(i + 1.0, ${MASK_SIZE.toFixed(1)}));
    vec4 t00 = texelFetch(uMask, a, 0);
    vec4 t10 = texelFetch(uMask, ivec2(b.x, a.y), 0);
    vec4 t01 = texelFetch(uMask, ivec2(a.x, b.y), 0);
    vec4 t11 = texelFetch(uMask, b, 0);
    return mix(mix(t00, t10, f.x), mix(t01, t11, f.x), f.y);
  }
  float pathMask(vec4 m) { return 1.0 - smoothstep(0.02, 0.055, abs(m.g - 0.5)); }
  float wetness(vec4 m, vec2 p) { return m.b - (1.0 - smoothstep(6.0, 13.0, length(p))) * 0.35; }
`;
