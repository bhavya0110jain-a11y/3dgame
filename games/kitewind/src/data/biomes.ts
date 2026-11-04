/**
 * Sky biomes, in flight order. Each lasts WORLD.biomeLength metres; the last one repeats forever.
 * Visual fields are blended across boundaries by src/world/BiomeBlend.ts; gameplay fields (hazards)
 * switch at the boundary in the generator.
 */
export interface BiomeDef {
  id: string;
  name: string;
  subtitle: string;
  sky: {
    zenith: number;
    horizon: number;
    /** Colour just below the horizon (haze over the far sea). */
    haze: number;
    sun: number;
    /** Sun elevation / azimuth (deg). Azimuth 0 = straight ahead (+Z). */
    sunElevation: number;
    sunAzimuth: number;
    /** Sun disc size (0..1). */
    sunSize: number;
    stars: number;
    aurora: number;
    /** Wispy procedural cloud bands in the sky dome (0..1). */
    cirrus: number;
  };
  fog: { color: number; near: number; far: number };
  ocean: { deep: number; shallow: number; glint: number };
  light: { sun: number; sunIntensity: number; skyHemi: number; groundHemi: number; hemiIntensity: number; rim: number };
  /** Island palette: rock, rockDark, grass, trunk, leaves, roof, wall, glow (lanterns/windows). */
  palette: [number, number, number, number, number, number, number, number];
  cloud: { lit: number; shade: number; opacity: number };
  ring: number;
  /** Ambient particles: rising paper lanterns, rain streaks, fireflies (0..1 densities). */
  lanterns: number;
  rain: number;
  motes: number;
  /** Random lightning flashes on the horizon (0..1). */
  flashes: number;
  exposure: number;
  bloom: number;
  /** Hazard weights and an overall density multiplier. */
  hazards: { gust: number; spire: number; thundercloud: number; flock: number; arch: number };
  hazardDensity: number;
  /** Island density multiplier and probability of houses/lanterns on islands. */
  islandDensity: number;
  houses: number;
}

export const BIOMES: readonly BiomeDef[] = [
  {
    id: 'shoals', name: 'Sunset Shoals', subtitle: 'warm winds over the golden sea',
    sky: { zenith: 0x4c63b0, horizon: 0xffb27c, haze: 0xffc59a, sun: 0xfff1cf, sunElevation: 8, sunAzimuth: -36, sunSize: 0.6, stars: 0, aurora: 0, cirrus: 0.8 },
    fog: { color: 0xe9a58c, near: 90, far: 720 },
    ocean: { deep: 0x1f3d72, shallow: 0x4d84b0, glint: 0xffe2b0 },
    light: { sun: 0xffd2a0, sunIntensity: 2.6, skyHemi: 0x9fb4ff, groundHemi: 0xf0a070, hemiIntensity: 0.9, rim: 0xffc890 },
    palette: [0xb08a78, 0x6b4c58, 0x8fc56a, 0x6e4a3a, 0x5d9e58, 0xd9614e, 0xf3e3c8, 0xffcf7a],
    cloud: { lit: 0xfff0e0, shade: 0xc9849a, opacity: 0.92 },
    ring: 0x8ff3ff,
    lanterns: 0, rain: 0, motes: 0.4, flashes: 0,
    exposure: 0.88, bloom: 0.42,
    hazards: { gust: 3, spire: 0, thundercloud: 0, flock: 2, arch: 3 },
    hazardDensity: 0.55, islandDensity: 1, houses: 0.35,
  },
  {
    id: 'dusk', name: 'Lantern Dusk', subtitle: 'a thousand wishes rising',
    sky: { zenith: 0x2a2d6e, horizon: 0xf07a6a, haze: 0xd77a86, sun: 0xffa06a, sunElevation: 3, sunAzimuth: 34, sunSize: 0.85, stars: 0.35, aurora: 0, cirrus: 0.6 },
    fog: { color: 0x9a5f84, near: 80, far: 640 },
    ocean: { deep: 0x181f4a, shallow: 0x3c4c86, glint: 0xffa47a },
    light: { sun: 0xff9a78, sunIntensity: 1.9, skyHemi: 0x6f74d8, groundHemi: 0xc0607a, hemiIntensity: 0.85, rim: 0xff8f7a },
    palette: [0x8a6a7c, 0x4a3450, 0x6d9c6a, 0x5a3a36, 0x467a5a, 0xc8483e, 0xeed6c0, 0xffb85a],
    cloud: { lit: 0xffc8b8, shade: 0x6e5a9a, opacity: 0.9 },
    ring: 0xffd27a,
    lanterns: 1, rain: 0, motes: 0.6, flashes: 0,
    exposure: 0.95, bloom: 0.55,
    hazards: { gust: 3, spire: 2, thundercloud: 1, flock: 3, arch: 3 },
    hazardDensity: 0.8, islandDensity: 1.05, houses: 0.7,
  },
  {
    id: 'aurora', name: 'Aurora Reach', subtitle: 'ribbons of light across the night',
    sky: { zenith: 0x040a22, horizon: 0x174a66, haze: 0x1d4560, sun: 0xd8e8ff, sunElevation: 22, sunAzimuth: -32, sunSize: 0.35, stars: 1, aurora: 1, cirrus: 0.2 },
    fog: { color: 0x14324a, near: 80, far: 620 },
    ocean: { deep: 0x041226, shallow: 0x0f3550, glint: 0xbfe8ff },
    light: { sun: 0xa8c8ff, sunIntensity: 1.25, skyHemi: 0x4a86b8, groundHemi: 0x2a2a4a, hemiIntensity: 0.8, rim: 0x8fe8d8 },
    palette: [0x66708e, 0x2e3050, 0x3f7f72, 0x3a3040, 0x2c6660, 0x5a6ad0, 0xc8d4e8, 0x9fffe0],
    cloud: { lit: 0xa8d8e8, shade: 0x2a3a66, opacity: 0.8 },
    ring: 0x9dffc8,
    lanterns: 0.1, rain: 0, motes: 1, flashes: 0,
    exposure: 1.05, bloom: 0.6,
    hazards: { gust: 3, spire: 3, thundercloud: 2, flock: 2, arch: 2 },
    hazardDensity: 1.05, islandDensity: 0.95, houses: 0.4,
  },
  {
    id: 'storm', name: 'Storm Crown', subtitle: 'the sky remembers its anger',
    sky: { zenith: 0x1a1c2c, horizon: 0x6e5a72, haze: 0x5a4e62, sun: 0xffc89a, sunElevation: 4, sunAzimuth: 30, sunSize: 0.5, stars: 0, aurora: 0, cirrus: 1 },
    fog: { color: 0x4a4458, near: 60, far: 560 },
    ocean: { deep: 0x0c121e, shallow: 0x283444, glint: 0xffc89a },
    light: { sun: 0xffc0a0, sunIntensity: 1.5, skyHemi: 0x7a7aa8, groundHemi: 0x3a3040, hemiIntensity: 0.9, rim: 0xc8b0ff },
    palette: [0x6a6070, 0x2e2834, 0x52784c, 0x3a2e2e, 0x3a5a44, 0x8a3a3a, 0xbab0b8, 0xffd27a],
    cloud: { lit: 0xb8b0c8, shade: 0x2c2838, opacity: 0.95 },
    ring: 0xc8b4ff,
    lanterns: 0, rain: 1, motes: 0.2, flashes: 1,
    exposure: 1.0, bloom: 0.55,
    hazards: { gust: 4, spire: 4, thundercloud: 3, flock: 2, arch: 2 },
    hazardDensity: 1.35, islandDensity: 0.9, houses: 0.25,
  },
];

/** Biome index for a distance (the last biome repeats forever). */
export function biomeIndexAt(distance: number, biomeLength: number): number {
  return Math.min(BIOMES.length - 1, Math.max(0, Math.floor(distance / biomeLength)));
}
