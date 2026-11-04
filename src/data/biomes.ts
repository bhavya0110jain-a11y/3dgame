export interface BiomeDef {
  id: string;
  name: string;
  subtitle: string;
  groundA: number;
  groundB: number;
  fog: number;
  fogDensity: number;
  moon: number; // hemisphere light sky color
  moonIntensity: number;
  propDensity: number; // props per chunk
  props: { kind: 'pine' | 'deadtree' | 'rock' | 'grave' | 'pillar' | 'mushroom' | 'reed'; weight: number; color: number }[];
  enemyPool: string[]; // enemy ids that can appear in this biome
  bossId: string;
  unlock?: string;
  /** Difficulty multiplier applied to enemy hp/damage. */
  difficulty: number;
}

export const BIOMES: BiomeDef[] = [
  {
    id: 'biome_pines',
    name: 'Whispering Pines',
    subtitle: 'Where the last road ends',
    groundA: 0x10180f,
    groundB: 0x1b2416,
    fog: 0x060a08,
    fogDensity: 0.03,
    moon: 0x5a6b8c,
    moonIntensity: 0.35,
    propDensity: 16,
    props: [
      { kind: 'pine', weight: 6, color: 0x1d3322 },
      { kind: 'rock', weight: 2, color: 0x3a3d42 },
      { kind: 'mushroom', weight: 1, color: 0x6a3a7a },
      { kind: 'deadtree', weight: 1, color: 0x2b2420 },
    ],
    enemyPool: ['shade', 'crawler', 'wisp', 'brute', 'stalker'],
    bossId: 'boss_hollow_stag',
    difficulty: 1,
  },
  {
    id: 'biome_marsh',
    name: 'Sunken Marsh',
    subtitle: 'The water remembers',
    groundA: 0x0d1614,
    groundB: 0x13221d,
    fog: 0x07100e,
    fogDensity: 0.036,
    moon: 0x4d7a72,
    moonIntensity: 0.3,
    propDensity: 14,
    props: [
      { kind: 'reed', weight: 5, color: 0x2a3b22 },
      { kind: 'deadtree', weight: 3, color: 0x26221d },
      { kind: 'mushroom', weight: 2, color: 0x2a7a6a },
      { kind: 'rock', weight: 1, color: 0x2f3533 },
    ],
    enemyPool: ['shade', 'bog_lurker', 'wisp', 'brute', 'spitter', 'stalker'],
    bossId: 'boss_mire_mother',
    unlock: 'biome_marsh',
    difficulty: 1.35,
  },
  {
    id: 'biome_ruins',
    name: 'Ashen Ruins',
    subtitle: 'A kingdom that forgot the sun',
    groundA: 0x171312,
    groundB: 0x221b18,
    fog: 0x0b0807,
    fogDensity: 0.032,
    moon: 0x8c5a4a,
    moonIntensity: 0.3,
    propDensity: 12,
    props: [
      { kind: 'pillar', weight: 4, color: 0x4a423c },
      { kind: 'grave', weight: 3, color: 0x3c3836 },
      { kind: 'rock', weight: 2, color: 0x332d2a },
      { kind: 'deadtree', weight: 1, color: 0x221c18 },
    ],
    enemyPool: ['shade', 'crawler', 'brute', 'spitter', 'knight', 'stalker', 'wisp'],
    bossId: 'boss_ashen_king',
    unlock: 'biome_ruins',
    difficulty: 1.75,
  },
];

export function getBiome(id: string): BiomeDef {
  return BIOMES.find((b) => b.id === id) ?? BIOMES[0];
}
