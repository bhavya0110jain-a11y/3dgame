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

/** Periodic value noise (period in lattice cells) evaluated at u,v in [0,1) of the tile. */
function pnoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let fx = x - xi;
  let fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = ihash(x0, y0, seed);
  const b = ihash(x1, y0, seed);
  const c = ihash(x0, y1, seed);
  const d = ihash(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function pfbm(u: number, v: number, period: number, seed: number, oct: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  for (let i = 0; i < oct; i++) {
    sum += amp * pnoise(u, v, p, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

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

  /** Regenerates the field for a biome/seed (~60-90 ms, once per run). */
  generate(seed: number): void {
    const s = (seed * 7919) | 0;
    const N = MASK_SIZE;
    const d = this.data;
    for (let j = 0; j < N; j++) {
      const v = j / N;
      for (let i = 0; i < N; i++) {
        const u = i / N;
        // domain warp so paths meander
        const wu = u + (pnoise(u, v, 4, s + 5) - 0.5) * 0.08;
        const wv = v + (pnoise(u, v, 4, s + 9) - 0.5) * 0.08;
        const patch = pfbm(u, v, 4, s + 1, 4);
        const path = pfbm(wu, wv, 2, s + 2, 3);
        const wet = pfbm(wu, wv, 5, s + 3, 4);
        const det = pfbm(u, v, 16, s + 4, 2);
        const k = (j * N + i) * 4;
        d[k] = Math.round(Math.min(1, Math.max(0, (patch - 0.5) * 1.8 + 0.5)) * 255);
        d[k + 1] = Math.round(Math.min(1, Math.max(0, (path - 0.5) * 2.2 + 0.5)) * 255);
        d[k + 2] = Math.round(Math.min(1, Math.max(0, (wet - 0.5) * 2.0 + 0.5)) * 255);
        d[k + 3] = Math.round(det * 255);
      }
    }
    this.texture.needsUpdate = true;
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
