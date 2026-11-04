import * as THREE from 'three';
import type { BiomeDef } from '../data/biomes';
import { CameraRig } from './CameraRig';
import { Lighting } from './Lighting';
import { rimUniforms } from './materials';
import { PostPipeline, type PostQuality } from './post/PostPipeline';
import { tintMultiplier } from './post/GradeShader';
import { renderQuality, type Quality } from './Quality';

export type { Quality } from './Quality';

interface TierSpec {
  /** Max device pixel ratio. */
  dpr: number;
  moonShadow: number;
  lanternShadow: number;
  post: PostQuality;
}

/**
 * Quality tiers. Budget targets (mid laptop iGPU/low dGPU, 1080p, 300+ enemies):
 *   high   – DPR ≤ 1.75, 2048 PCF-soft moon shadows, lantern cube shadows (near props only), full-res N8AO,
 *            bloom, SMAA, CA; World: full grass, full prop density, every solid prop casts
 *   medium – DPR ≤ 1.25, 1024 moon shadows, half-res N8AO, bloom, FXAA, CA; World: ~70% grass, 90% props,
 *            only tall props cast
 *   low    – DPR 1, no shadows, no AO, no bloom, FXAA (grade/vignette stay: one cheap fullscreen pass);
 *            World: ~40% (wider) grass blades, 75% props
 * World-side scaling lives in World.setQuality, driven through renderQuality (src/render/Quality.ts).
 */
const TIERS: Record<Quality, TierSpec> = {
  high: { dpr: 1.75, moonShadow: 2048, lanternShadow: 512, post: { ao: 'full', bloom: true, aa: 'smaa', ca: true } },
  medium: { dpr: 1.25, moonShadow: 1024, lanternShadow: 0, post: { ao: 'half', bloom: true, aa: 'fxaa', ca: true } },
  low: { dpr: 1, moonShadow: 0, lanternShadow: 0, post: { ao: 'off', bloom: false, aa: 'fxaa', ca: false } },
};
const ORDER: Quality[] = ['low', 'medium', 'high'];
/** Dynamic-resolution steps tried (within a tier) before dropping a tier. */
const RES_STEPS = [1, 0.85, 0.72];

/**
 * Owns the WebGL renderer, scene, camera, light rig (Lighting) and post stack (PostPipeline).
 * Public API used elsewhere: renderer, scene, camera, damagePulse, setQuality(q), resize(), render(time, dt),
 * applyBiome(biome), lighting.
 *
 * Automatic quality fallback (see trackFrameTime): frame time is averaged over 2 s windows. Two slow windows in a
 * row (avg > 20 ms) step the internal resolution down (1 → 0.85 → 0.72), then the effective tier (high → medium
 * → low). After a long run of smooth windows (avg < 17.4 ms) it tries one step back up, never above the tier chosen
 * in Settings; a level that had to be abandoned after such an upgrade becomes a ceiling for the session, so it
 * can never flap. The first second after any change (shader compiles, render-target reallocation) is ignored.
 * Disabled under automation (navigator.webdriver) so smoke screenshots show the real tier.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly lighting: Lighting;
  /** Camera feel (follow / zoom / shake / menu hero shot), driven by Game.updateCamera. */
  readonly rig: CameraRig;
  readonly post: PostPipeline;
  damagePulse = 0;
  /**
   * FX brightness-governor source for bloom (FxManager exposes `brightness`: 1 = calm … ~0.3 = saturated). Game
   * sets it (`renderer.bloomSource = fx`); until it does, render() feature-detects the running game's fx.
   */
  bloomSource: { readonly brightness?: number } | null = null;
  /** Set false to pin the chosen tier (no dynamic resolution / tier fallback). */
  autoQuality = !(typeof navigator !== 'undefined' && navigator.webdriver);

  private quality: Quality = 'high';
  private effective: Quality = 'high';
  private resStep = 0;
  // adaptive quality (see trackFrameTime)
  private lastNow = 0;
  private winTime = 0;
  private winFrames = 0;
  private settle = 1;
  private slowWins = 0;
  private fastWins = 0;
  private upgradeWins = 5;
  /** Highest (tier, resStep) level allowed after a failed upgrade, as a level index; Infinity = none. */
  private ceiling = Infinity;
  private upgraded = false;

  constructor(canvas: HTMLCanvasElement) {
    // Throws when WebGL2 is unavailable: main.ts' boot() catch shows the "lantern would not light" fallback.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, TIERS.high.dpr));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // allow the browser to restore the context
      console.warn('[render] WebGL context lost');
    });

    this.scene.background = new THREE.Color(0x05060a);
    this.scene.fog = new THREE.FogExp2(0x05060a, 0.028);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 220);
    this.camera.position.set(0, 20, 14);
    this.camera.lookAt(0, 0, 0);
    this.rig = new CameraRig(this.camera);

    this.lighting = new Lighting(this.scene);
    this.post = new PostPipeline(r, this.scene, this.camera);

    window.addEventListener('resize', () => this.resize());
    this.applyTier();
  }

  /** User-selected tier (Settings). Resets the automatic fallback. */
  setQuality(q: Quality): void {
    if (!(q in TIERS)) q = 'high'; // BUG-QA-015
    this.quality = q;
    this.effective = q;
    this.resStep = 0;
    this.slowWins = 0;
    this.fastWins = 0;
    this.upgradeWins = 5;
    this.ceiling = Infinity;
    this.upgraded = false;
    this.applyTier();
  }

  /** The tier currently rendered (may be below the chosen one after automatic fallback). */
  get effectiveQuality(): Quality {
    return this.effective;
  }

  /** Night-specific light rig, exposure and colour grade. Call after World.setBiome. */
  applyBiome(b: BiomeDef): void {
    this.lighting.applyBiome(b);
    this.renderer.toneMappingExposure = b.renderExposure ?? 1.15;
    const u = this.post.grade.uniforms;
    tintMultiplier(b.renderGradeShadow ?? 0x2a2f6e, u.uShadowTint.value);
    tintMultiplier(b.renderGradeHighlight ?? 0xffd9a0, u.uHighlightTint.value);
    u.uSaturation.value = b.renderSaturation ?? 1.12;
    // vignette falls off into the night's own deep tone rather than black
    const fog = new THREE.Color(b.fog);
    u.uVignetteColor.value.set(fog.r * 0.35, fog.g * 0.35, fog.b * 0.45);
    rimUniforms.uRimTint.value.setHex(b.moon);
  }

  private applyTier(): void {
    const t = TIERS[this.effective];
    this.lighting.setQuality({ moonShadow: t.moonShadow, lanternShadow: t.lanternShadow });
    this.renderer.shadowMap.enabled = t.moonShadow > 0 || t.lanternShadow > 0;
    this.post.setQuality(t.post);
    renderQuality.tier = this.effective;
    renderQuality.lanternShadows = t.lanternShadow > 0;
    renderQuality.version++;
    this.settle = 1;
    this.winTime = 0;
    this.winFrames = 0;
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    // Keep a similar visible area on portrait screens.
    this.camera.fov = w < h ? 62 : 45;
    this.camera.updateProjectionMatrix();
    const dpr = Math.min(window.devicePixelRatio, TIERS[this.effective].dpr) * RES_STEPS[this.resStep];
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, dpr);
  }

  render(time: number, dt: number): void {
    this.damagePulse = Math.max(0, this.damagePulse - dt * 2.5);
    const u = this.post.grade.uniforms;
    // BUG-QA-014: reduced flashing dims the full-screen damage pulse
    u.uDamage.value = this.damagePulse * (document.documentElement.classList.contains('a11y-noflash') ? 0.35 : 1);
    u.uTime.value = time % 100;
    const src = this.bloomSource ?? (typeof window !== 'undefined' ? (window as { __game?: { fx?: { brightness?: number } } }).__game?.fx : undefined);
    this.post.setBloomGovernor(src?.brightness ?? 1);
    this.post.render(dt);
    this.trackFrameTime();
  }

  // ------------------------------------------------------------------ automatic quality fallback
  /** Level index: tier * RES_STEPS.length + (RES_STEPS.length - 1 - resStep); higher = prettier. */
  private level(q: Quality = this.effective, r = this.resStep): number {
    return ORDER.indexOf(q) * RES_STEPS.length + (RES_STEPS.length - 1 - r);
  }

  private trackFrameTime(): void {
    const now = performance.now();
    const ft = now - this.lastNow;
    this.lastNow = now;
    if (!this.autoQuality || ft <= 0 || ft > 100 || document.hidden) return; // ignore stalls / tab switches
    const s = ft / 1000;
    if (this.settle > 0) {
      this.settle -= s;
      return;
    }
    this.winTime += ft;
    this.winFrames++;
    if (this.winTime < 2000) return;
    const avg = this.winTime / this.winFrames;
    this.winTime = 0;
    this.winFrames = 0;
    if (avg > 20) {
      this.fastWins = 0;
      if (++this.slowWins >= 2) this.stepDown();
    } else if (avg < 17.4) {
      // not dropping frames (a 60 Hz display never reports faster than ~16.7 ms, so this is the only usable bar)
      this.slowWins = 0;
      if (++this.fastWins >= this.upgradeWins) this.stepUp();
    } else {
      this.slowWins = 0;
      this.fastWins = 0;
    }
  }

  private stepDown(): void {
    this.slowWins = 0;
    this.fastWins = 0;
    // an upgrade that could not hold: that level is off-limits for the rest of the session (no flapping)
    if (this.upgraded) this.ceiling = Math.min(this.ceiling, this.level() - 1);
    this.upgraded = false;
    if (this.resStep < RES_STEPS.length - 1) this.resStep++;
    else if (this.effective !== 'low') {
      this.effective = ORDER[ORDER.indexOf(this.effective) - 1];
      this.resStep = 0;
    } else return;
    this.upgradeWins = Math.min(60, this.upgradeWins * 2);
    console.info(`[render] auto quality → ${this.effective} @ ${RES_STEPS[this.resStep]}x`);
    this.applyTier();
  }

  private stepUp(): void {
    this.fastWins = 0;
    let q = this.effective;
    let r = this.resStep;
    if (r > 0) r--;
    else if (q !== this.quality) {
      q = ORDER[ORDER.indexOf(q) + 1];
      r = RES_STEPS.length - 1;
    } else return;
    if (this.level(q, r) > this.ceiling) return;
    this.effective = q;
    this.resStep = r;
    this.upgraded = true;
    console.info(`[render] auto quality ↑ ${this.effective} @ ${RES_STEPS[this.resStep]}x`);
    this.applyTier();
  }
}
