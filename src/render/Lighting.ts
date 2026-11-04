import * as THREE from 'three';
import type { BiomeDef } from '../data/biomes';

/**
 * Lantern shadow gate. The bearer's PointLight renders 6 cube faces; letting the horde, the bearer, grass and every
 * streamed prop into those faces cost ~4 M triangles/frame at 350 enemies. (three r170's WebGLShadowMap tests
 * object layers against the MAIN camera, so layers cannot separate the two shadow maps.) Instead every Mesh gets
 * an onBeforeShadow/onAfterShadow pair that skips the draw (drawRange.count = -1 → renderBufferDirect returns
 * before issuing it) unless the mesh belongs to the pass:
 *   lantern cube faces  → only meshes with `userData.lanternCaster === true` (World's near-prop proxies)
 *   moon / other lights → everything that casts shadows EXCEPT lantern casters
 * Meshes that install their own onBeforeShadow simply opt out of the gate (they cast into both).
 */
const gate = {
  cam: null as THREE.Camera | null,
  geo: null as THREE.BufferGeometry | null,
  count: 0,
};

function installShadowGate(): void {
  const proto = THREE.Mesh.prototype as THREE.Mesh;
  if ((proto as unknown as { __llGate?: boolean }).__llGate) return;
  (proto as unknown as { __llGate?: boolean }).__llGate = true;
  proto.onBeforeShadow = function (this: THREE.Object3D, _r, object, _c, shadowCamera, geometry) {
    const lanternPass = shadowCamera === gate.cam;
    if (lanternPass === (object.userData.lanternCaster === true)) return;
    gate.geo = geometry;
    gate.count = geometry.drawRange.count;
    geometry.drawRange.count = -1;
  };
  proto.onAfterShadow = function (this: THREE.Object3D, _r, _o, _c, _s, geometry) {
    if (gate.geo !== geometry) return;
    geometry.drawRange.count = gate.count;
    gate.geo = null;
  };
}

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
 *  - lantern: optional cube shadows on the bearer's PointLight (high tier only), restricted by the shadow gate to
 *    World's near-prop proxies, so the cost is a few dozen props x 6 faces, independent of the horde
 * Owned by Renderer; Game calls renderer.applyBiome(...) and lighting.follow(...) each frame.
 */
export class Lighting {
  readonly moon: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** Unit vector from the focus point towards the moon light. */
  readonly keyDir = new THREE.Vector3();
  private lantern: THREE.PointLight | null = null;
  private quality: LightingQuality = { moonShadow: 2048, lanternShadow: 512 };
  private extent = 24;
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

  /** Registers the bearer's lantern light (cube shadows on high). Only `userData.lanternCaster` meshes cast into it
   *  (see the shadow gate), so the bearer (`_owner`, kept for API compatibility) never throws a wedge of its own
   *  shadow over the field and the horde never enters the 6 cube faces. */
  attachLantern(light: THREE.PointLight, _owner?: THREE.Object3D): void {
    this.lantern = light;
    const sh = light.shadow;
    sh.bias = -0.003;
    sh.normalBias = 0.04;
    sh.camera.near = 0.25;
    installShadowGate();
    gate.cam = sh.camera;
    sh.radius = 3;
    this.applyQuality();
  }

  /** True when the lantern currently renders cube shadows (World only maintains its proxies then). */
  get lanternShadows(): boolean {
    return !!this.lantern && this.lantern.castShadow;
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
