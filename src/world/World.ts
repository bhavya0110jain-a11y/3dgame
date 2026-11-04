import * as THREE from 'three';
import type { BiomeDef } from '../data/biomes';
import { Ambient } from './Ambient';
import { Grass } from './Grass';
import { Ground } from './Ground';
import { GroundMask } from './GroundMask';
import { CHUNK, Props, type Collider, type PropQuality } from './Props';
import { renderQuality, type Quality } from '../render/Quality';
import { Sky } from './Sky';
import { worldUniforms } from './WorldShading';

/**
 * The night around the lantern-bearer: lit procedural ground, wind-swept grass + field flowers,
 * chunk-streamed instanced props (GLB, with colliders), ambient motes, sky dome + distant skyline,
 * and the Light-vs-Gloom recolouring shared by every world material (see WorldShading.ts).
 *
 * Public API (used by Game / Player / Director / Enemies):
 *   group, biome, colliders, setBiome(biome, seed), setLight(px, pz, radius, time), update(px, pz),
 *   resolveCollision(p, radius), setQuality(tier)
 *
 * Quality: World follows the tier the Renderer is drawing (renderQuality, polled in update(); call setQuality
 * directly to force one). Grass blade count, decor density and shadow casting scale per tier (WORLD_TIERS);
 * solid props / colliders are identical on every tier.
 */
interface WorldTier {
  /** Fraction of the grass blade budget drawn (blades widen to compensate). */
  grass: number;
  props: PropQuality;
}
const WORLD_TIERS: Record<Quality, WorldTier> = {
  high: { grass: 1, props: { decor: 1, shadows: 'all', lantern: true } },
  medium: { grass: 0.7, props: { decor: 0.9, shadows: 'tall', lantern: false } },
  low: { grass: 0.4, props: { decor: 0.75, shadows: 'none', lantern: false } },
};
export class World {
  readonly group = new THREE.Group();
  private ground: Ground;
  private grass: Grass;
  private sky: Sky;
  private ambient: Ambient;
  private props: Props;
  private mask = new GroundMask();
  private lastChunk = { x: 9999, z: 9999 };
  biome!: BiomeDef;
  private seed = 1;
  private quality: Quality | null = null;
  private qualityVersion = -1;

  /** Collision circles for solid props (x, z, r). */
  get colliders(): Collider[] {
    return this.props.colliders;
  }

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
    worldUniforms.uMask.value = this.mask.texture;
    this.ground = new Ground();
    this.grass = new Grass();
    this.sky = new Sky();
    this.ambient = new Ambient();
    this.props = new Props(this.mask);
    this.group.add(this.sky.group, this.ground.mesh, this.grass.group, this.props.group, this.ambient.group);
  }

  setBiome(biome: BiomeDef, seed: number): void {
    this.biome = biome;
    this.seed = seed;
    this.mask.generate(seed);
    this.ground.setBiome(biome);
    this.grass.setBiome(biome);
    this.sky.setBiome(biome);
    this.ambient.setBiome(biome.ambient);
    this.props.setBiome(biome);
    worldUniforms.uGloom.value.setHex(biome.gloom);
    worldUniforms.uGloomStrength.value = biome.gloomStrength;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setHex(biome.fog);
    fog.density = biome.fogDensity;
    if (this.scene.background instanceof THREE.Color) this.scene.background.setHex(biome.fog);
    this.lastChunk = { x: 9999, z: 9999 };
  }

  setLight(px: number, pz: number, radius: number, time: number): void {
    worldUniforms.uPlayer.value.set(px, 0, pz);
    worldUniforms.uLightR.value = radius;
    worldUniforms.uTime.value = time;
    worldUniforms.uWind.value.set(0.8 + 0.25 * Math.sin(time * 0.11), 0.45 + 0.2 * Math.sin(time * 0.07 + 1.3));
    this.props.setTime(time);
    this.ambient.update();
  }

  /** Rescales grass, decor density and prop shadow casting for a render tier (cheap when unchanged). */
  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    const t = WORLD_TIERS[q];
    this.grass.setQuality(t.grass);
    const lantern = t.props.lantern && renderQuality.lanternShadows;
    if (this.props.setQuality({ ...t.props, lantern })) this.lastChunk = { x: 9999, z: 9999 };
  }

  update(px: number, pz: number): void {
    if (renderQuality.version !== this.qualityVersion) {
      this.qualityVersion = renderQuality.version;
      this.quality = null;
      this.setQuality(renderQuality.tier);
    }
    this.ground.mesh.position.set(Math.round(px / 50) * 50, 0, Math.round(pz / 50) * 50);
    this.sky.update(px, pz, worldUniforms.uTime.value);
    const cx = Math.floor(px / CHUNK);
    const cz = Math.floor(pz / CHUNK);
    if (cx !== this.lastChunk.x || cz !== this.lastChunk.z) {
      this.lastChunk.x = cx;
      this.lastChunk.z = cz;
      this.props.rebuild(cx, cz, this.seed, this.biome.ground.waterLevel, this.biome.propDensity);
    }
    this.props.updateView(px, pz);
  }

  /** Pushes a circle out of solid props. Returns adjusted position in-place. */
  resolveCollision(p: { x: number; z: number }, radius: number): void {
    this.props.resolveCollision(p, radius);
  }
}
