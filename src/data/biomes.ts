/** Every environment prop model (public/models/props/<kind>.glb, see MODEL_LIST.props in src/render/Assets.ts). */
export type PropKind =
  | 'pine' | 'deadtree' | 'rock' | 'grave' | 'pillar' | 'mushroom' | 'reed'
  | 'oak' | 'bush' | 'flower' | 'stump' | 'log' | 'lantern_post' | 'ruin_wall' | 'crystal' | 'lily';

export interface BiomeProp {
  kind: PropKind;
  /** Relative spawn weight inside the biome. */
  weight: number;
  /** Base colour for the procedural fallback mesh (only used when the GLB is missing). */
  color: number;
  /** Multiplier on the GLB's baked vertex colours (sRGB hex). Default white. */
  tint?: number;
  /** Colour of the model's glow parts (glow parts are authored white). Default white. */
  glow?: number;
  /** Uniform scale range. Default [0.8, 1.25]. */
  scale?: [number, number];
  /** Extra copies scattered around each placement (decor clumps). */
  cluster?: number;
  /** Placement rule against the ground masks. dry: no water/paths (default). wet: inside water. shore: water edge.
   *  roadside: just beside a path. any: anywhere on land. */
  place?: 'dry' | 'wet' | 'shore' | 'roadside' | 'any';
  /** Only spawn where the forest-density noise is high (groves vs clearings). */
  grove?: boolean;
}

/** Procedural ground look (src/world/Ground.ts). Colours are sRGB hex. */
export interface BiomeGround {
  /** 0 forest (moss/grass, dirt paths, clearings) · 1 marsh (mud, shallow reflective pools) · 2 ruins (ash, cracked flagstones, ember cracks). */
  mode: 0 | 1 | 2;
  base: number;
  patch: number;
  dark: number;
  path: number;
  /** Water (marsh) / flagstone (ruins) / clearing-flower tint (forest). */
  feature: number;
  /** Secondary accent: water shallows (marsh) / glowing crack embers (ruins) / needle litter (forest). */
  accent: number;
  /** Wetness threshold for pools (marsh); 1 disables water. */
  waterLevel: number;
}

export interface BiomeGrass {
  root: number;
  tip: number;
  /** Blade height (m). */
  height: number;
  /** 0..1 fraction of the blade budget actually grown. */
  density: number;
  /** Bioluminescent field-flower colours. */
  flowers: number[];
  /** 0..1 fraction of the flower budget. */
  flowerDensity: number;
}

export interface BiomeSky {
  zenith: number;
  mid: number;
  /** Horizon colour; keep equal to `fog` so the ground melts into the sky. */
  horizon: number;
  moonColor: number;
  /** Colour of the halo / moonlit cloud rims. */
  moonGlow: number;
  /** 0..1 star density. */
  stars: number;
  /** Distant silhouette layer style. */
  skyline: 'pines' | 'willows' | 'ruins';
  skylineColor: number;
}

export interface BiomeAmbient {
  kind: 'firefly' | 'spore' | 'leaf' | 'ember' | 'ash';
  color: number;
  count: number;
}

export interface BiomeDef {
  id: string;
  name: string;
  subtitle: string;
  /** Legacy two-tone ground colours (kept for UI swatches / fallbacks). */
  groundA: number;
  groundB: number;
  /**
   * RENDER CONTRACT (read by the rendering agent's light rig in src/render/):
   *  fog / fogDensity   – scene FogExp2 colour + density (World.setBiome applies them too).
   *  moon               – moonlight (key DirectionalLight) colour.
   *  moonIntensity      – suggested moonlight intensity (three r170 physical units, ~1-2.5).
   *  renderAmbientSky / renderAmbientGround / renderAmbientIntensity – suggested hemisphere fill.
   *  renderExposure     – suggested tone-mapping exposure.
   *  renderGradeShadow / renderGradeHighlight – split-tone colour-grade tints (sRGB hex).
   *  renderSaturation   – suggested grading saturation multiplier (1 = neutral).
   *  renderLantern      – suggested lantern light colour tint for this night (warm amber).
   * All render* fields are optional hints; World does not apply them itself.
   */
  fog: number;
  fogDensity: number;
  moon: number;
  moonIntensity: number;
  renderAmbientSky?: number;
  renderAmbientGround?: number;
  renderAmbientIntensity?: number;
  renderExposure?: number;
  renderGradeShadow?: number;
  renderGradeHighlight?: number;
  renderSaturation?: number;
  renderLantern?: number;
  /** Violet "Gloom" tint that creeps in beyond the lantern radius. */
  gloom: number;
  /** 0..1 how strongly the Gloom recolours the world beyond the light. */
  gloomStrength: number;
  ground: BiomeGround;
  grass: BiomeGrass;
  sky: BiomeSky;
  ambient: BiomeAmbient[];
  /** Prop placement attempts per 24 m chunk. */
  propDensity: number;
  props: BiomeProp[];
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
    groundA: 0x234a36,
    groundB: 0x3a6e46,
    fog: 0x1d2f55,
    fogDensity: 0.017,
    moon: 0x9fb8ff,
    moonIntensity: 1.6,
    renderAmbientSky: 0x5f7fd0,
    renderAmbientGround: 0x1d3a2e,
    renderAmbientIntensity: 1.1,
    renderExposure: 1.15,
    renderGradeShadow: 0x2a2f6e,
    renderGradeHighlight: 0xffd9a0,
    renderSaturation: 1.15,
    renderLantern: 0xffa64d,
    gloom: 0x4a2a9a,
    gloomStrength: 0.62,
    ground: { mode: 0, base: 0x356a48, patch: 0x5a9658, dark: 0x234a3e, path: 0xa07c5c, feature: 0x7ab868, accent: 0x7a6040, waterLevel: 1 },
    grass: { root: 0x356a48, tip: 0x4f9262, height: 0.5, density: 1, flowers: [0xffe2a0, 0x8fd0ff, 0xdcd4ff], flowerDensity: 0.3 },
    sky: { zenith: 0x070b26, mid: 0x18306a, horizon: 0x1d2f55, moonColor: 0xf3f0ff, moonGlow: 0x8aa6ff, stars: 1, skyline: 'pines', skylineColor: 0x0f1d36 },
    ambient: [
      { kind: 'firefly', color: 0xffe27a, count: 90 },
      { kind: 'leaf', color: 0x6fbf7a, count: 45 },
    ],
    propDensity: 34,
    props: [
      { kind: 'pine', weight: 8, color: 0x1d5a48, scale: [0.85, 1.35], grove: true },
      { kind: 'oak', weight: 2.5, color: 0x2f7a5a, scale: [0.8, 1.15], grove: true },
      { kind: 'rock', weight: 2.5, color: 0x5a6280, scale: [0.6, 1.3] },
      { kind: 'bush', weight: 3, color: 0x2f7a5a, glow: 0xffe2a0, scale: [0.7, 1.2] },
      { kind: 'mushroom', weight: 2.5, color: 0x6a3a7a, glow: 0x58b4e8, cluster: 2, scale: [0.75, 1.3] },
      { kind: 'flower', weight: 2, color: 0x8a5ac0, tint: 0xd2b8ff, glow: 0xffe08a, cluster: 3, place: 'any', scale: [0.9, 1.4] },
      { kind: 'stump', weight: 1.2, color: 0x5a3b35, glow: 0x7af0ff },
      { kind: 'log', weight: 1, color: 0x5a3b35 },
      { kind: 'deadtree', weight: 0.6, color: 0x4a4058 },
      { kind: 'lantern_post', weight: 0.5, color: 0x4a3428, scale: [0.95, 1.1], place: 'roadside' },
    ],
    enemyPool: ['shade', 'crawler', 'wisp', 'brute', 'stalker'],
    bossId: 'boss_hollow_stag',
    difficulty: 1,
  },
  {
    id: 'biome_marsh',
    name: 'Sunken Marsh',
    subtitle: 'The water remembers',
    groundA: 0x2e4a3a,
    groundB: 0x1a4a50,
    fog: 0x173c45,
    fogDensity: 0.02,
    moon: 0x9ff0e0,
    moonIntensity: 1.45,
    renderAmbientSky: 0x4a8ab4,
    renderAmbientGround: 0x203a2a,
    renderAmbientIntensity: 0.95,
    renderExposure: 1.15,
    renderGradeShadow: 0x1a3f55,
    renderGradeHighlight: 0xffe0a8,
    renderSaturation: 1.12,
    renderLantern: 0xffb05a,
    gloom: 0x3a2a8a,
    gloomStrength: 0.62,
    ground: { mode: 1, base: 0x3b6650, patch: 0x5f8a5a, dark: 0x2a4436, path: 0x7a6844, feature: 0x0f4256, accent: 0x2f9a96, waterLevel: 0.56 },
    grass: { root: 0x3b6650, tip: 0x56907a, height: 0.75, density: 0.8, flowers: [0x5ff0e0, 0xffe27a, 0x9ab8ff], flowerDensity: 0.25 },
    sky: { zenith: 0x06161f, mid: 0x14445a, horizon: 0x173c45, moonColor: 0xeefff8, moonGlow: 0x7fe0d0, stars: 0.75, skyline: 'willows', skylineColor: 0x0c2328 },
    ambient: [
      { kind: 'firefly', color: 0x7affd8, count: 110 },
      { kind: 'spore', color: 0xa8ffe8, count: 50 },
    ],
    propDensity: 34,
    props: [
      { kind: 'reed', weight: 7, color: 0x4a7a4a, cluster: 3, place: 'shore', scale: [0.9, 1.4] },
      { kind: 'lily', weight: 5, color: 0x3a8a5a, glow: 0xffe2a0, place: 'wet', scale: [0.8, 1.4] },
      { kind: 'deadtree', weight: 2.5, color: 0x4a4a52, tint: 0xb8c8c0, scale: [0.9, 1.4] },
      { kind: 'oak', weight: 1.5, color: 0x2f6a5a, tint: 0xb8b4bc, grove: true, scale: [0.9, 1.2] },
      { kind: 'mushroom', weight: 3, color: 0x2a7a6a, glow: 0x30d8b0, cluster: 2, scale: [0.75, 1.25] },
      { kind: 'rock', weight: 1.5, color: 0x4a5a5a, tint: 0xb0d0c8, scale: [0.6, 1.2] },
      { kind: 'log', weight: 1.5, color: 0x4a3b30, tint: 0xc8d8c0 },
      { kind: 'stump', weight: 1.2, color: 0x4a3b30, tint: 0xc8d0c0, glow: 0x45ffd0 },
      { kind: 'bush', weight: 1.5, color: 0x2f6a4a, tint: 0xb8d8a0, glow: 0xffe27a },
      { kind: 'flower', weight: 1.5, color: 0x5aa0a0, tint: 0xa8f0ff, glow: 0x5ff0e0, cluster: 2, scale: [0.9, 1.3] },
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
    groundA: 0x4a4452,
    groundB: 0x6a6070,
    fog: 0x24223e,
    fogDensity: 0.018,
    moon: 0xa8b4ff,
    moonIntensity: 1.5,
    renderAmbientSky: 0x5e64a8,
    renderAmbientGround: 0x262838,
    renderAmbientIntensity: 1.0,
    renderExposure: 1.12,
    renderGradeShadow: 0x24224a,
    renderGradeHighlight: 0xffd49a,
    renderSaturation: 1.1,
    renderLantern: 0xffb45a,
    gloom: 0x3f2a8a,
    gloomStrength: 0.66,
    ground: { mode: 2, base: 0x4c4a5c, patch: 0x5e5a6e, dark: 0x302e40, path: 0x8a8494, feature: 0x948c9c, accent: 0xff6a24, waterLevel: 1 },
    grass: { root: 0x4c4a5c, tip: 0x6e6a76, height: 0.32, density: 0.28, flowers: [0xffd49a, 0x9ab8ff, 0xe4dcff], flowerDensity: 0.25 },
    sky: { zenith: 0x0d0820, mid: 0x262a5a, horizon: 0x24223e, moonColor: 0xfff0e8, moonGlow: 0x9aa4ff, stars: 0.85, skyline: 'ruins', skylineColor: 0x1a1228 },
    ambient: [
      { kind: 'ember', color: 0xff8a3a, count: 120 },
      { kind: 'ash', color: 0xb8a8c0, count: 80 },
    ],
    propDensity: 30,
    props: [
      { kind: 'pillar', weight: 4, color: 0x8a8090, tint: 0xf0dccc, scale: [0.85, 1.3] },
      { kind: 'ruin_wall', weight: 3, color: 0x8a8090, tint: 0xf0dccc, scale: [0.85, 1.2] },
      { kind: 'grave', weight: 3, color: 0x7a7488, cluster: 1, scale: [0.85, 1.2] },
      { kind: 'rock', weight: 2, color: 0x5a5260, tint: 0xd8c8d0, scale: [0.6, 1.2] },
      { kind: 'crystal', weight: 1.6, color: 0x8a7ad0, tint: 0xc8c4e0, glow: 0x9a8aff, scale: [0.8, 1.5] },
      { kind: 'deadtree', weight: 2, color: 0x3a3040, tint: 0xa898b0, scale: [0.9, 1.4] },
      { kind: 'lantern_post', weight: 0.8, color: 0x4a3428, scale: [0.95, 1.1], place: 'roadside' },
      { kind: 'flower', weight: 1.4, color: 0xa04a3a, tint: 0xffb0a0, glow: 0xffd49a, cluster: 2 },
      { kind: 'stump', weight: 0.8, color: 0x4a3b30, tint: 0xb8a8a8, glow: 0x8fd0ff },
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
