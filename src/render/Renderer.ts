import * as THREE from 'three';
import type { BiomeDef } from '../data/biomes';
import { CameraRig } from './CameraRig';
import { Lighting } from './Lighting';
import { rimUniforms } from './materials';
import { PostPipeline, type PostQuality } from './post/PostPipeline';
import { tintMultiplier } from './post/GradeShader';

export type Quality = 'low' | 'medium' | 'high';

interface TierSpec {
  /** Max device pixel ratio. */
  dpr: number;
  moonShadow: number;
  lanternShadow: number;
  post: PostQuality;
}

/**
 * Quality tiers. Budget targets (mid laptop iGPU/low dGPU, 1080p, 300+ enemies):
 *   high   – DPR ≤ 1.75, 2048 PCF-soft moon shadows, lantern cube shadows, full-res N8AO, bloom, SMAA, CA
 *   medium – DPR ≤ 1.25, 1024 moon shadows, half-res N8AO, bloom, FXAA, CA
 *   low    – DPR 1, no shadows, no AO, no bloom, FXAA (grade/vignette stay: one cheap fullscreen pass)
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
 * Automatic quality fallback: frame time is tracked with an EMA; if it stays above ~20 ms for 3 s the internal
 * resolution steps down (1 → 0.85 → 0.72), then the effective tier drops (high → medium → low). If frames are
 * comfortably fast for a while it steps back up, never above the tier chosen in Settings. Disabled under
 * automation (navigator.webdriver) so smoke screenshots show the real tier.
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
  /** Set false to pin the chosen tier (no dynamic resolution / tier fallback). */
  autoQuality = !(typeof navigator !== 'undefined' && navigator.webdriver);

  private quality: Quality = 'high';
  private effective: Quality = 'high';
  private resStep = 0;
  private frameMs = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  private upgradeDelay = 10;
  private lastNow = 0;

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
    this.quality = q;
    this.effective = q;
    this.resStep = 0;
    this.slowFor = 0;
    this.fastFor = 0;
    this.upgradeDelay = 10;
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
    u.uDamage.value = this.damagePulse;
    u.uTime.value = time % 100;
    this.post.render(dt);
    this.trackFrameTime();
  }

  // ------------------------------------------------------------------ automatic quality fallback
  private trackFrameTime(): void {
    const now = performance.now();
    const ft = now - this.lastNow;
    this.lastNow = now;
    if (!this.autoQuality || ft <= 0 || ft > 100 || document.hidden) return; // ignore stalls / tab switches
    this.frameMs += (ft - this.frameMs) * 0.05;
    const s = ft / 1000;
    if (this.frameMs > 20.5) {
      this.slowFor += s;
      this.fastFor = 0;
    } else if (this.frameMs < 13.5) {
      this.fastFor += s;
      this.slowFor = Math.max(0, this.slowFor - s);
    } else {
      this.slowFor = Math.max(0, this.slowFor - s * 0.5);
      this.fastFor = 0;
    }
    if (this.slowFor > 3) this.stepDown();
    else if (this.fastFor > this.upgradeDelay) this.stepUp();
  }

  private stepDown(): void {
    this.slowFor = 0;
    this.fastFor = 0;
    this.frameMs = 16.7;
    if (this.resStep < RES_STEPS.length - 1) this.resStep++;
    else if (this.effective !== 'low') {
      this.effective = ORDER[ORDER.indexOf(this.effective) - 1];
      this.resStep = 0;
    } else return;
    // every fallback makes the next upgrade attempt more cautious (avoids oscillating)
    this.upgradeDelay = Math.min(120, this.upgradeDelay * 2);
    console.info(`[render] auto quality → ${this.effective} @ ${RES_STEPS[this.resStep]}x`);
    this.applyTier();
  }

  private stepUp(): void {
    this.fastFor = 0;
    if (this.resStep > 0) this.resStep--;
    else if (this.effective !== this.quality) {
      this.effective = ORDER[ORDER.indexOf(this.effective) + 1];
      this.resStep = RES_STEPS.length - 1;
    } else return;
    console.info(`[render] auto quality ↑ ${this.effective} @ ${RES_STEPS[this.resStep]}x`);
    this.applyTier();
  }
}
