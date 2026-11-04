import * as THREE from 'three';
import { BIOMES, type BiomeDef } from '../data/biomes';
import { WORLD } from '../data/tuning';
import { smoothstep, DEG } from '../core/math';

/**
 * Blended visual environment at the kite's distance: every colour/float of BiomeDef cross-faded over
 * WORLD.biomeBlend metres around each boundary. All objects are preallocated; update() never allocates.
 * Views read `env` each frame (sky, ocean, islands, clouds, lights, post).
 */
export class Environment {
  readonly zenith = new THREE.Color();
  readonly horizon = new THREE.Color();
  readonly haze = new THREE.Color();
  readonly sun = new THREE.Color();
  readonly sunDir = new THREE.Vector3(0, 0.2, 1);
  sunSize = 0.5;
  /** 0..1: dips to 0 mid-transition when the sun/moon changes side, so it sets and rises instead of swinging. */
  sunFade = 1;
  stars = 0;
  aurora = 0;
  cirrus = 0;
  readonly fog = new THREE.Color();
  fogNear = 60;
  fogFar = 500;
  readonly oceanDeep = new THREE.Color();
  readonly oceanShallow = new THREE.Color();
  readonly glint = new THREE.Color();
  readonly sunLight = new THREE.Color();
  sunIntensity = 2;
  readonly skyHemi = new THREE.Color();
  readonly groundHemi = new THREE.Color();
  hemiIntensity = 1;
  readonly rim = new THREE.Color();
  readonly palette: THREE.Color[] = Array.from({ length: 8 }, () => new THREE.Color());
  readonly cloudLit = new THREE.Color();
  readonly cloudShade = new THREE.Color();
  cloudOpacity = 0.9;
  readonly ring = new THREE.Color();
  lanterns = 0;
  rain = 0;
  motes = 0;
  flashes = 0;
  exposure = 1;
  bloom = 0.6;
  /** Index of the dominant biome. */
  index = 0;
  private ca = new THREE.Color();
  private cb = new THREE.Color();
  private elev = 0;
  private azim = 0;

  /** Blends the environment for distance d. */
  update(d: number): void {
    const L = WORLD.biomeLength;
    const half = WORLD.biomeBlend / 2;
    const i = Math.max(0, Math.floor(d / L));
    const ia = Math.min(BIOMES.length - 1, i);
    const local = d - i * L;
    let a = BIOMES[ia];
    let b = a;
    let t = 0;
    if (local > L - half && ia < BIOMES.length - 1) {
      b = BIOMES[ia + 1];
      t = smoothstep(L - half, L + half, local);
    } else if (local < half && i > 0 && i <= BIOMES.length - 1) {
      a = BIOMES[ia - 1];
      b = BIOMES[ia];
      t = smoothstep(-half, half, local);
    }
    this.index = t > 0.5 ? BIOMES.indexOf(b) : BIOMES.indexOf(a);
    this.blend(a, b, t);
  }

  private col(out: THREE.Color, x: number, y: number, t: number): void {
    this.ca.setHex(x);
    this.cb.setHex(y);
    out.copy(this.ca).lerp(this.cb, t);
  }

  private bt = 0;
  private f(x: number, y: number): number {
    return x + (y - x) * this.bt;
  }

  private blend(a: BiomeDef, b: BiomeDef, t: number): void {
    this.bt = t;
    this.col(this.zenith, a.sky.zenith, b.sky.zenith, t);
    this.col(this.horizon, a.sky.horizon, b.sky.horizon, t);
    this.col(this.haze, a.sky.haze, b.sky.haze, t);
    this.col(this.sun, a.sky.sun, b.sky.sun, t);
    // a big azimuth change would swing the sun across the sky: instead the old sun sinks below the horizon and the
    // new one rises in its place (disc + light dip around the midpoint)
    const swap = Math.abs(a.sky.sunAzimuth - b.sky.sunAzimuth) > 20 && t > 0 && t < 1;
    if (swap) {
      const near = t < 0.5 ? a : b;
      const k = Math.abs(t * 2 - 1);
      this.elev = (near.sky.sunElevation * k - 6 * (1 - k)) * DEG;
      this.azim = near.sky.sunAzimuth * DEG;
      this.sunFade = smoothstep(0.0, 0.6, k);
    } else {
      this.elev = this.f(a.sky.sunElevation, b.sky.sunElevation) * DEG;
      this.azim = this.f(a.sky.sunAzimuth, b.sky.sunAzimuth) * DEG;
      this.sunFade = 1;
    }
    this.sunDir.set(Math.sin(this.azim) * Math.cos(this.elev), Math.sin(this.elev), Math.cos(this.azim) * Math.cos(this.elev));
    this.sunSize = this.f(a.sky.sunSize, b.sky.sunSize);
    this.stars = this.f(a.sky.stars, b.sky.stars);
    this.aurora = this.f(a.sky.aurora, b.sky.aurora);
    this.cirrus = this.f(a.sky.cirrus, b.sky.cirrus);
    this.col(this.fog, a.fog.color, b.fog.color, t);
    this.fogNear = this.f(a.fog.near, b.fog.near);
    this.fogFar = this.f(a.fog.far, b.fog.far);
    this.col(this.oceanDeep, a.ocean.deep, b.ocean.deep, t);
    this.col(this.oceanShallow, a.ocean.shallow, b.ocean.shallow, t);
    this.col(this.glint, a.ocean.glint, b.ocean.glint, t);
    this.col(this.sunLight, a.light.sun, b.light.sun, t);
    this.sunIntensity = this.f(a.light.sunIntensity, b.light.sunIntensity) * (0.55 + 0.45 * this.sunFade);
    this.col(this.skyHemi, a.light.skyHemi, b.light.skyHemi, t);
    this.col(this.groundHemi, a.light.groundHemi, b.light.groundHemi, t);
    this.hemiIntensity = this.f(a.light.hemiIntensity, b.light.hemiIntensity);
    this.col(this.rim, a.light.rim, b.light.rim, t);
    for (let k = 0; k < 8; k++) this.col(this.palette[k], a.palette[k], b.palette[k], t);
    this.col(this.cloudLit, a.cloud.lit, b.cloud.lit, t);
    this.col(this.cloudShade, a.cloud.shade, b.cloud.shade, t);
    this.cloudOpacity = this.f(a.cloud.opacity, b.cloud.opacity);
    this.col(this.ring, a.ring, b.ring, t);
    this.lanterns = this.f(a.lanterns, b.lanterns);
    this.rain = this.f(a.rain, b.rain);
    this.motes = this.f(a.motes, b.motes);
    this.flashes = this.f(a.flashes, b.flashes);
    this.exposure = this.f(a.exposure, b.exposure);
    this.bloom = this.f(a.bloom, b.bloom);
  }
}
