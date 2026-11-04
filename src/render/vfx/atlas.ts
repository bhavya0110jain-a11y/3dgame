import * as THREE from 'three';

/**
 * Procedural VFX sprite atlas (one 512² RGBA canvas texture, 4×4 cells of 128 px), generated once at boot.
 * Every particle / pickup glow / projectile shader samples this one texture, so all billboard VFX share a
 * single texture binding. Sprites are white (or grey-shaded for smoke) with shape in alpha — tinted in shader.
 *
 * Frames (index = row * 4 + col):
 *   0 GLOW      soft gaussian glow                 8  SMOKE2    second smoke puff variant
 *   1 CORE      hot core + wide halo              9  FROST     frost puff: soft blob with crystalline glints
 *   2 STREAK    tapered horizontal spark streak   10 DOT       small hard dot (pixel spark)
 *   3 SMOKE     noisy shaded smoke puff (alpha)   11 FLARE     cross flare with glow (crit / impact)
 *   4 STAR      4-point twinkle star               12 SHARD    sharp diamond shard with highlight
 *   5 RING      thin soft ring                     13 WISP     curved soul wisp
 *   6 FLAME     flame lick (teardrop, tip up)      14 BURST    jagged starburst (impact flash)
 *   7 SPARKLE   tiny cross sparkle                 15 PETAL    rounded ember chip / ash flake
 */
export const Frame = {
  GLOW: 0,
  CORE: 1,
  STREAK: 2,
  SMOKE: 3,
  STAR: 4,
  RING: 5,
  FLAME: 6,
  SPARKLE: 7,
  SMOKE2: 8,
  FROST: 9,
  DOT: 10,
  FLARE: 11,
  SHARD: 12,
  WISP: 13,
  BURST: 14,
  FLAKE: 15,
} as const;

export const ATLAS_GRID = 4;
const CELL = 128;

let atlas: THREE.Texture | null = null;

/** Deterministic hash-based value noise for the smoke puffs (no Math.random so the atlas is stable). */
function hash(x: number, y: number, s: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s);
  const b = hash(xi + 1, yi, s);
  const c = hash(xi, yi + 1, s);
  const d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number): number {
  let f = 0;
  let amp = 0.5;
  for (let i = 0; i < 4; i++) {
    f += vnoise(x, y, s + i * 13) * amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return f;
}

type PixelFn = (u: number, v: number) => [number, number]; // (-1..1 coords) → [luminance 0..1, alpha 0..1]

function paint(img: ImageData, frame: number, fn: PixelFn): void {
  const cx = (frame % ATLAS_GRID) * CELL;
  const cy = Math.floor(frame / ATLAS_GRID) * CELL;
  const W = img.width;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const u = ((x + 0.5) / CELL) * 2 - 1;
      // canvas y grows downward; the texture is uploaded with flipY so v=+1 is the top of the sprite
      const v = 1 - ((y + 0.5) / CELL) * 2;
      const [l, a] = fn(u, v);
      const i = ((cy + y) * W + cx + x) * 4;
      const lc = Math.max(0, Math.min(1, l));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(lc * 255);
      img.data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
}

const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function smokeFn(seed: number): PixelFn {
  return (u, v) => {
    const r = Math.hypot(u, v);
    const n = fbm(u * 2.2 + 5, v * 2.2 + 3, seed);
    const edge = 1 - sstep(0.35, 0.95, r + (n - 0.5) * 0.55);
    const a = edge * (0.55 + 0.45 * n);
    // volumetric shading: lit from above, darker underside, lighter rim of the puff
    const l = 0.55 + 0.35 * v + 0.25 * (n - 0.5);
    return [l, a];
  };
}

function build(): THREE.Texture {
  const size = CELL * ATLAS_GRID;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(size, size);

  // 0 GLOW: gaussian, energy concentrated so additive stacks bloom nicely
  paint(img, Frame.GLOW, (u, v) => {
    const r2 = u * u + v * v;
    const a = Math.exp(-r2 * 5.5) * (1 - sstep(0.85, 1, Math.sqrt(r2)));
    return [1, a];
  });
  // 1 CORE: white-hot pinpoint + wide soft halo
  paint(img, Frame.CORE, (u, v) => {
    const r = Math.hypot(u, v);
    const a = Math.exp(-r * r * 40) + 0.45 * Math.exp(-r * r * 5) * (1 - sstep(0.85, 1, r));
    return [1, a];
  });
  // 2 STREAK: horizontal capsule, bright head on +x, tapering tail towards -x
  paint(img, Frame.STREAK, (u, v) => {
    const t = (u + 1) * 0.5; // 0 tail .. 1 head
    const w = 0.08 + 0.22 * Math.pow(t, 0.6);
    const across = Math.exp(-(v * v) / (w * w) * 2.2);
    const along = sstep(0.0, 0.55, t) * (1 - sstep(0.88, 1.0, t));
    return [1, across * along * (0.5 + 0.5 * t)];
  });
  // 3 SMOKE / 8 SMOKE2
  paint(img, Frame.SMOKE, smokeFn(1));
  paint(img, Frame.SMOKE2, smokeFn(7));
  // 4 STAR: 4-point twinkle (thin rays + core)
  paint(img, Frame.STAR, (u, v) => {
    const r = Math.hypot(u, v);
    const ray = Math.exp(-Math.abs(u) * 26) * (1 - sstep(0, 1, Math.abs(v))) + Math.exp(-Math.abs(v) * 26) * (1 - sstep(0, 1, Math.abs(u)));
    const diag = 0.35 * (Math.exp(-Math.abs(u - v) * 30) + Math.exp(-Math.abs(u + v) * 30)) * (1 - sstep(0, 0.6, r));
    const core = Math.exp(-r * r * 30);
    return [1, sat(ray + diag + core) * (1 - sstep(0.9, 1, r))];
  });
  // 5 RING: thin soft ring with faint inner glow
  paint(img, Frame.RING, (u, v) => {
    const r = Math.hypot(u, v);
    const ring = Math.exp(-((r - 0.8) * (r - 0.8)) * 260);
    const inner = 0.15 * sstep(0.2, 0.8, r) * (1 - sstep(0.78, 0.82, r));
    return [1, sat(ring + inner)];
  });
  // 6 FLAME: teardrop, round bottom, pointed flickering tip at +v; brighter core
  paint(img, Frame.FLAME, (u, v) => {
    const y = (v + 1) * 0.5; // 0 bottom .. 1 top
    const width = 0.62 * Math.pow(Math.max(0, 1 - y), 0.75) * sstep(-0.05, 0.25, y);
    const n = fbm(u * 3 + 2, v * 2.5, 3) - 0.5;
    const d = Math.abs(u + n * 0.25 * y) / Math.max(1e-3, width);
    const a = (1 - sstep(0.55, 1.0, d)) * (1 - sstep(0.85, 1.0, y));
    const core = (1 - sstep(0.0, 0.6, d)) * (1 - sstep(0.2, 0.7, y));
    return [0.75 + 0.25 * core, a];
  });
  // 7 SPARKLE: tiny cross
  paint(img, Frame.SPARKLE, (u, v) => {
    const r = Math.hypot(u, v);
    const cross = Math.exp(-Math.abs(u) * 14) * Math.exp(-Math.abs(v) * 2.2) + Math.exp(-Math.abs(v) * 14) * Math.exp(-Math.abs(u) * 2.2);
    return [1, sat(cross + Math.exp(-r * r * 18)) * (1 - sstep(0.85, 1, r))];
  });
  // 9 FROST: icy puff — soft blob with bright crystalline facets
  paint(img, Frame.FROST, (u, v) => {
    const r = Math.hypot(u, v);
    const n = fbm(u * 3 + 9, v * 3 + 1, 11);
    const ang = Math.atan2(v, u);
    const facets = Math.pow(Math.abs(Math.cos(ang * 3)), 8) * (1 - sstep(0.1, 0.7, r));
    const blob = (1 - sstep(0.3, 0.95, r + (n - 0.5) * 0.4)) * 0.6;
    return [0.85 + 0.15 * facets, sat(blob + facets * 0.6)];
  });
  // 10 DOT
  paint(img, Frame.DOT, (u, v) => {
    const r = Math.hypot(u, v);
    return [1, 1 - sstep(0.35, 0.6, r) + 0.3 * Math.exp(-r * r * 6) * (1 - sstep(0.8, 1, r))];
  });
  // 11 FLARE: horizontal anamorphic streak + cross + glow
  paint(img, Frame.FLARE, (u, v) => {
    const r = Math.hypot(u, v);
    const h = Math.exp(-Math.abs(v) * 40) * (1 - sstep(0.2, 1, Math.abs(u)));
    const vv = 0.7 * Math.exp(-Math.abs(u) * 40) * (1 - sstep(0.1, 0.8, Math.abs(v)));
    const glow = Math.exp(-r * r * 9) * 0.8 + Math.exp(-r * r * 60);
    return [1, sat(h + vv + glow) * (1 - sstep(0.9, 1, r))];
  });
  // 12 SHARD: diamond with a lit facet
  paint(img, Frame.SHARD, (u, v) => {
    const d = Math.abs(u) / 0.42 + Math.abs(v) / 0.95;
    const a = 1 - sstep(0.9, 1.0, d);
    const lit = u < 0 ? 1 : 0.7;
    return [lit * (0.8 + 0.2 * v), a];
  });
  // 13 WISP: curved comma-shaped soul wisp, head at bottom
  paint(img, Frame.WISP, (u, v) => {
    const y = (v + 1) * 0.5;
    const cxw = Math.sin(y * 3.6) * 0.28 * y;
    const w = 0.34 * (1 - y) + 0.04;
    const d = Math.abs(u - cxw) / w;
    const a = Math.exp(-d * d * 2) * sstep(0, 0.15, y) * (1 - sstep(0.75, 1, y));
    return [1, a];
  });
  // 14 BURST: jagged starburst (8 uneven spikes) for impact flashes
  paint(img, Frame.BURST, (u, v) => {
    const r = Math.hypot(u, v);
    const ang = Math.atan2(v, u);
    const spikes = 0.42 + 0.5 * Math.pow(Math.abs(Math.cos(ang * 4 + 0.3 * Math.sin(ang * 3))), 6) * (0.75 + 0.25 * Math.sin(ang * 7));
    const a = (1 - sstep(spikes * 0.75, spikes, r)) * (0.65 + 0.35 * (1 - r)) + Math.exp(-r * r * 12) * 0.5;
    return [1, sat(a)];
  });
  // 15 FLAKE: rounded irregular chip (ash / ember flakes)
  paint(img, Frame.FLAKE, (u, v) => {
    const ang = Math.atan2(v, u);
    const r = Math.hypot(u, v);
    const edge = 0.55 + 0.12 * Math.sin(ang * 3 + 1) + 0.08 * Math.sin(ang * 5);
    return [0.7 + 0.3 * v, 1 - sstep(edge - 0.1, edge, r)];
  });

  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace; // luminance/alpha masks, not colour
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  return tex;
}

/** Shared lazily-built atlas texture. */
export function getAtlas(): THREE.Texture {
  if (!atlas) {
    // headless (unit tests / workers): 1×1 white placeholder instead of a canvas
    atlas = typeof document === 'undefined' ? new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) : build();
    atlas.needsUpdate = true;
  }
  return atlas;
}

/** GLSL helper: uv of a sprite frame given a 0..1 quad uv. */
export const ATLAS_GLSL = /* glsl */ `
  vec2 atlasUv(float frame, vec2 uv) {
    float f = floor(frame + 0.5);
    float col = mod(f, ${ATLAS_GRID}.0);
    float row = floor(f / ${ATLAS_GRID}.0);
    // row 0 is the TOP of the canvas; with flipY the canvas top is v = 1
    vec2 cell = vec2(col, ${ATLAS_GRID - 1}.0 - row);
    // inset half a texel to stop neighbouring frames bleeding through mip levels
    vec2 inset = mix(vec2(0.012), vec2(0.988), uv);
    return (cell + inset) / ${ATLAS_GRID}.0;
  }
`;
