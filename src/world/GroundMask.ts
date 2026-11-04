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
  get octaves(): readonly Lattice[] {
    return this.oct;
  }
  get normalizer(): number {
    return this.norm;
  }
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

/**
 * Fills out[i] = lnoise(L, i / out.length, v) for a whole row at once (bit-compatible with lnoise): the lattice is
 * interpolated in y once per lattice column, leaving one lerp per texel. Used for the un-warped fields.
 */
function lrow(L: Lattice, v: number, out: Float32Array, col: Float32Array, add: number, amp: number): void {
  const p = L.p;
  const y = v * p;
  const yi = Math.floor(y);
  let fy = y - yi;
  fy = fy * fy * (3 - 2 * fy);
  let y0 = yi % p;
  if (y0 < 0) y0 += p;
  const y1 = y0 + 1 === p ? 0 : y0 + 1;
  const t = L.t;
  for (let x = 0; x < p; x++) {
    const a = t[y0 * p + x];
    col[x] = a + (t[y1 * p + x] - a) * fy;
  }
  const W = out.length;
  for (let i = 0; i < W; i++) {
    const xx = (i / W) * p;
    const xi = Math.floor(xx);
    let fx = xx - xi;
    fx = fx * fx * (3 - 2 * fx);
    const x0 = xi % p;
    const x1 = x0 + 1 === p ? 0 : x0 + 1;
    const a = col[x0];
    const r = a + (col[x1] - a) * fx;
    out[i] = add ? out[i] + r * amp : r * amp;
  }
}

/** Row version of Fbm.at (normalised sum of octaves). */
function fbmRow(F: Fbm, v: number, out: Float32Array, col: Float32Array): void {
  let amp = 0.5;
  const oct = F.octaves;
  for (let o = 0; o < oct.length; o++) {
    lrow(oct[o], v, out, col, o, amp / F.normalizer);
    amp *= 0.5;
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
  /** Half-resolution float scratch for build() (allocated once). */
  private half = new Float32Array((MASK_SIZE >> 1) * (MASK_SIZE >> 1) * 4);
  private rowTmp = new Float32Array((MASK_SIZE >> 1) * 4);
  private current = NaN;

  /**
   * Regenerates the field for a seed (half-res evaluation + upsample, see build()). Results are cached per seed
   * (LRU, CACHE_MAX), so the menu glade and biome re-entry are a 1 MiB memcpy. Same seed → same bytes, always.
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

  /**
   * The noise is evaluated on a half-resolution (256²) lattice and bilinearly upsampled 2x: every field is
   * low-frequency (finest octave = 8 half-res texels per noise cell), so the result is visually identical to a
   * full-res evaluation at a quarter of the cost (~25-35 ms → was ~120 ms on the slow CI box). The bytes stay the
   * single source of truth for both CPU placement and the GPU, so they still agree exactly.
   */
  private build(seed: number): void {
    const s = (seed * 7919) | 0;
    const N = MASK_SIZE;
    const H = N >> 1;
    const f = this.half;
    const warpU = new Lattice(4, s + 5);
    const warpV = new Lattice(4, s + 9);
    const patchF = new Fbm(4, s + 1, 4);
    const pathF = new Fbm(2, s + 2, 3);
    const wetF = new Fbm(5, s + 3, 4);
    const detF = new Fbm(16, s + 4, 2);
    const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const rWu = new Float32Array(H);
    const rWv = new Float32Array(H);
    const rPatch = new Float32Array(H);
    const rDet = new Float32Array(H);
    const col = new Float32Array(64);
    for (let j = 0; j < H; j++) {
      const v = j / H;
      lrow(warpU, v, rWu, col, 0, 1);
      lrow(warpV, v, rWv, col, 0, 1);
      fbmRow(patchF, v, rPatch, col);
      fbmRow(detF, v, rDet, col);
      for (let i = 0; i < H; i++) {
        const u = i / H;
        // domain warp so paths meander
        const wu = u + (rWu[i] - 0.5) * 0.08;
        const wv = v + (rWv[i] - 0.5) * 0.08;
        const k = (j * H + i) * 4;
        f[k] = sat((rPatch[i] - 0.5) * 1.8 + 0.5);
        f[k + 1] = sat((pathF.at(wu, wv) - 0.5) * 2.2 + 0.5);
        f[k + 2] = sat((wetF.at(wu, wv) - 0.5) * 2.0 + 0.5);
        f[k + 3] = rDet[i];
      }
    }
    // 2x bilinear upsample (periodic): full-res texel (i, j) sits at half-res (i/2, j/2). Odd rows average two
    // half-res rows first; then every row is "copy, average with the right neighbour" per channel.
    const d = this.data;
    const R = this.rowTmp;
    for (let j = 0; j < N; j++) {
      const j0 = j >> 1;
      const r0 = j0 * H * 4;
      let src = f;
      let base = r0;
      if (j & 1) {
        const r1 = ((j0 + 1) % H) * H * 4;
        for (let k = 0; k < H * 4; k++) R[k] = (f[r0 + k] + f[r1 + k]) * 0.5;
        src = R;
        base = 0;
      }
      const o = j * N * 4;
      for (let i0 = 0; i0 < H; i0++) {
        const a = base + i0 * 4;
        const b = base + (i0 + 1 === H ? 0 : i0 + 1) * 4;
        const oo = o + i0 * 8;
        for (let c = 0; c < 4; c++) {
          const va = src[a + c] * 255;
          d[oo + c] = (va + 0.5) | 0;
          d[oo + 4 + c] = ((va + src[b + c] * 255) * 0.5 + 0.5) | 0;
        }
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
