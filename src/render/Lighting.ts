import * as THREE from 'three';
import type { BiomeDef } from '../data/biomes';

/** Distance material that writes nothing: given to the bearer's meshes as `customDistanceMaterial` so the
 *  lantern (a point light hanging at their side) never throws a giant wedge of the bearer's own shadow over the
 *  battlefield. They still cast normal moon shadows. */
const NO_LANTERN_SHADOW = new THREE.MeshDistanceMaterial();
NO_LANTERN_SHADOW.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'void main() {\n\tdiscard;');
};
NO_LANTERN_SHADOW.customProgramCacheKey = () => 'll-no-lantern-shadow';

export interface LightingQuality {
  /** Moon shadow map size; 0 disables moon shadows. */
  moonShadow: number;
  /** Lantern (point light) cube shadow map size; 0 disables. */
  lanternShadow: number;
}

/** Elevation of the key light. The sky's moon sits almost on the horizon (for the menu hero shot); a light
 *  that low would smear 20 m shadows across the arena, so the key keeps the moon's azimuth-ish side but a
 *  readable, storybook-high angle. */
const KEY_ELEVATION = THREE.MathUtils.degToRad(54);
/** Key comes from back-left (as seen by the gameplay camera): rims the tops/left of silhouettes, throws
 *  shadows down-right towards the viewer so shapes read. */
const KEY_AZIMUTH = new THREE.Vector2(-0.72, -0.69).normalize();

/**
 * Light rig for the moonlit storybook look:
 *  - moon: DirectionalLight key with soft PCF shadows; its shadow frustum is tight around the camera's focus and
 *    texel-snapped so shadows stay crisp near the action and never shimmer while the camera glides
 *  - hemi: sky/ground fill tuned per biome (BiomeDef.renderAmbient* hints, else derived from the moon)
 *  - lantern: optional cube shadows on the bearer's PointLight (high tier only)
 * Owned by Renderer; Game calls renderer.applyBiome(...) and lighting.follow(...) each frame.
 */
export class Lighting {
  readonly moon: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** Unit vector from the focus point towards the moon light. */
  readonly keyDir = new THREE.Vector3();
  private lantern: THREE.PointLight | null = null;
  private lanternOwner: THREE.Object3D | null = null;
  private quality: LightingQuality = { moonShadow: 2048, lanternShadow: 512 };
  private extent = 24;
  private frame = 0;
  // texel-snapping basis (light space)
  private readonly bx = new THREE.Vector3();
  private readonly by = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private moonBase = 1.6;

  constructor(scene: THREE.Scene) {
    this.keyDir.set(KEY_AZIMUTH.x * Math.cos(KEY_ELEVATION), Math.sin(KEY_ELEVATION), KEY_AZIMUTH.y * Math.cos(KEY_ELEVATION)).normalize();
    this.bx.crossVectors(this.keyDir, THREE.Object3D.DEFAULT_UP).normalize();
    this.by.crossVectors(this.bx, this.keyDir).normalize();

    this.moon = new THREE.DirectionalLight(0x9fb8ff, 1.6);
    this.moon.name = 'moon-key';
    const sh = this.moon.shadow;
    sh.bias = -0.0004;
    sh.normalBias = 0.035;
    sh.camera.near = 1;
    sh.camera.far = 140;
    scene.add(this.moon, this.moon.target);

    this.hemi = new THREE.HemisphereLight(0x5f7fd0, 0x1d3a2e, 1.0);
    this.hemi.name = 'night-fill';
    scene.add(this.hemi);

    this.setExtent(this.extent);
    this.follow(0, 0);
  }

  /** Night-specific key + fill. Also used by Renderer.applyBiome (which adds exposure + grade). */
  applyBiome(b: BiomeDef): void {
    this.moon.color.setHex(b.moon);
    this.moonBase = b.moonIntensity;
    this.moon.intensity = b.moonIntensity;
    const sky = b.renderAmbientSky ?? b.moon;
    const ground = b.renderAmbientGround ?? 0x141820;
    this.hemi.color.setHex(sky);
    this.hemi.groundColor.setHex(ground);
    this.hemi.intensity = b.renderAmbientIntensity ?? b.moonIntensity * 0.6;
  }

  /** Lets gameplay dim/brighten the moon briefly (e.g. boss arrival); 1 = biome default. */
  setMoonScale(s: number): void {
    this.moon.intensity = this.moonBase * s;
  }

  /** Registers the bearer's lantern light (cube shadows on high) and the bearer root (excluded from them). */
  attachLantern(light: THREE.PointLight, owner: THREE.Object3D): void {
    this.lantern = light;
    this.lanternOwner = owner;
    const sh = light.shadow;
    sh.bias = -0.003;
    sh.normalBias = 0.04;
    sh.camera.near = 0.25;
    sh.radius = 3;
    this.tagOwner();
    this.applyQuality();
  }

  setQuality(q: LightingQuality): void {
    this.quality = q;
    this.applyQuality();
  }

  /** Half-size (m) of the moon shadow frustum. Game grows it as the camera zooms out. */
  setExtent(e: number): void {
    const ext = Math.round(e * 2) / 2;
    if (ext === this.extent && this.moon.shadow.camera.right === ext) return;
    this.extent = ext;
    const c = this.moon.shadow.camera;
    c.left = -ext;
    c.right = ext;
    c.top = ext;
    c.bottom = -ext;
    c.updateProjectionMatrix();
  }

  /** Centres the moon shadow frustum on (x, z) (the camera focus), snapped to whole shadow texels. */
  follow(x: number, z: number): void {
    const size = this.quality.moonShadow || 1024;
    const texel = (this.extent * 2) / size;
    const f = this.tmp.set(x, 0, z);
    const a = Math.round(f.dot(this.bx) / texel) * texel;
    const b = Math.round(f.dot(this.by) / texel) * texel;
    const c = f.dot(this.keyDir);
    f.copy(this.bx).multiplyScalar(a).addScaledVector(this.by, b).addScaledVector(this.keyDir, c);
    this.moon.target.position.copy(f);
    this.moon.position.copy(f).addScaledVector(this.keyDir, 60);
    this.moon.target.updateMatrixWorld();
    // the bearer rig may be rebuilt (GLB swap / character change): keep its layer tag current, cheaply
    if ((++this.frame & 63) === 0) this.tagOwner();
  }

  private tagOwner(): void {
    if (!this.lanternOwner) return;
    this.lanternOwner.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).customDistanceMaterial = NO_LANTERN_SHADOW;
    });
  }

  private applyQuality(): void {
    const q = this.quality;
    const moonOn = q.moonShadow > 0;
    this.moon.castShadow = moonOn;
    if (moonOn && this.moon.shadow.mapSize.x !== q.moonShadow) {
      this.moon.shadow.mapSize.set(q.moonShadow, q.moonShadow);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    }
    if (this.lantern) {
      const on = q.lanternShadow > 0;
      this.lantern.castShadow = on;
      if (on && this.lantern.shadow.mapSize.x !== q.lanternShadow) {
        this.lantern.shadow.mapSize.set(q.lanternShadow, q.lanternShadow);
        this.lantern.shadow.map?.dispose();
        this.lantern.shadow.map = null;
      }
    }
  }
}
