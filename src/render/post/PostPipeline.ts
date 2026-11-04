import * as THREE from 'three';
import { N8AOPass } from 'n8ao';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { GradeShader } from './GradeShader';

/** Bloom at a calm frame (governor gain 1) and at a fully loaded one (gain ≤ 0.3). */
export const BLOOM_CALM = { strength: 0.62, threshold: 0.92 };
export const BLOOM_LOADED = { strength: 0.35, threshold: 1.15 };

/** Governor gain → bloom blend factor k in [0, 1] (0 = loaded, 1 = calm). Non-finite input counts as calm. */
export function bloomK(gain: number): number {
  if (!Number.isFinite(gain)) return 1;
  return Math.min(1, Math.max(0, (gain - 0.3) / 0.7));
}

export interface PostQuality {
  /** Ambient occlusion: off, half resolution (depth-aware upsample) or full resolution. */
  ao: 'off' | 'half' | 'full';
  bloom: boolean;
  aa: 'none' | 'fxaa' | 'smaa';
  /** Lens chromatic aberration in the grade pass. */
  ca: boolean;
}

/**
 * HDR post stack (all intermediate targets are HalfFloat, linear until OutputPass):
 *
 *   N8AOPass (scene render + SSAO, replaces RenderPass)  |  RenderPass when AO is off
 *   → UnrealBloomPass (thresholded in linear HDR: only emissive glows / moon / hot lantern cores bloom)
 *   → OutputPass (tone mapping + sRGB, from renderer.toneMapping / outputColorSpace)
 *   → Grade (display-space lift/gamma/gain, saturation, split-tone, vignette, damage pulse, CA, grain)
 *   → SMAA (high) | FXAA (medium) | none (low)
 *
 * MSAA is deliberately off on the canvas (it does not survive post, and AO needs a single-sampled depth).
 */
export class PostPipeline {
  readonly composer: EffectComposer;
  readonly grade: ShaderPass;
  readonly bloom: UnrealBloomPass;
  private renderPass: RenderPass;
  private ao: N8AOPass | null = null;
  private fxaa: ShaderPass;
  private smaa: SMAAPass;
  private output: OutputPass;
  private q: PostQuality = { ao: 'full', bloom: true, aa: 'smaa', ca: true };
  private pw = 1;
  private ph = 1;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    // The scene targets carry a stencil buffer: the bearer writes stencil 1 where she is visible and her x-ray
    // silhouette only draws where she is not (Player.ts, art review s3 P1 #3). With AO on, N8AO renders the scene
    // into its own beauty target, so that one gets a depth-stencil attachment too (configuration.stencil).
    const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, sz.x), Math.max(1, sz.y), { type: THREE.HalfFloatType, stencilBuffer: true });
    this.composer = new EffectComposer(renderer, rt);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    try {
      const ao = new N8AOPass(scene, camera, w, h);
      const c = ao.configuration;
      c.gammaCorrection = false; // OutputPass does the transfer
      c.aoRadius = 1.6; // characters ~1.2-2 m: contact shadows under feet, crevices in props
      c.distanceFalloff = 0.8;
      c.intensity = 3.2;
      c.color = new THREE.Color(0x0d0a26); // tinted (blue-violet) occlusion: night shadows have colour
      c.screenSpaceRadius = false;
      c.stencil = true; // bearer x-ray silhouette (see above)
      c.transparencyAware = false; // particles/ghosts are additive & depthWrite:false; skip 2 extra scene renders
      ao.autoDetectTransparency = false; // ...and the per-frame scene traversal that would re-enable it
      ao.setQualityMode('Medium');
      this.ao = ao;
      this.composer.addPass(ao);
    } catch (err) {
      console.warn('[render] N8AO unavailable, continuing without AO', err);
    }

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), BLOOM_CALM.strength, 0.55, BLOOM_CALM.threshold);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.smaa = new SMAAPass(w, h);
    this.composer.addPass(this.smaa);
    this.apply();
  }

  get quality(): PostQuality {
    return this.q;
  }

  setQuality(q: PostQuality): void {
    this.q = { ...q };
    this.apply();
  }

  private apply(): void {
    const q = this.q;
    const aoOn = q.ao !== 'off' && this.ao !== null;
    this.renderPass.enabled = !aoOn;
    if (this.ao) {
      this.ao.enabled = aoOn;
      if (aoOn) {
        // 'full' degrades to half-res (depth-aware upsampled) above ~1080p-equivalent pixel counts: on HiDPI the
        // difference is invisible and full-res SSAO at 3-6 MP is the single most expensive pass in the stack.
        const half = q.ao === 'half' || this.pw * this.ph > 2.3e6;
        if (this.ao.configuration.halfRes !== half) this.ao.configuration.halfRes = half;
        this.ao.setQualityMode(q.ao === 'half' ? 'Low' : 'Medium');
      }
    }
    this.bloom.enabled = q.bloom;
    this.fxaa.enabled = q.aa === 'fxaa';
    this.smaa.enabled = q.aa === 'smaa';
    const ca = q.ca ? 1 : 0;
    const mat = this.grade.material;
    if (mat.defines.CA_ENABLED !== ca) {
      mat.defines.CA_ENABLED = ca;
      mat.needsUpdate = true;
    }
  }

  /** CSS-pixel size + device pixel ratio (the composer multiplies internally). */
  setSize(w: number, h: number, dpr: number): void {
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.pw = Math.max(1, Math.floor(w * dpr));
    this.ph = Math.max(1, Math.floor(h * dpr));
    (this.fxaa.material.uniforms.resolution.value as THREE.Vector2).set(1 / this.pw, 1 / this.ph);
    this.grade.uniforms.uAspect.value = w / Math.max(1, h);
    this.apply();
  }

  /**
   * Drives bloom from the FX brightness governor (1 = calm … ~0.3 = screen full of additive light), art review s3
   * P1 #1b: k = clamp((gain - 0.3) / 0.7), strength = 0.35 + 0.27k, threshold = 1.15 - 0.23k. A calm frame keeps
   * the authored 0.62 / 0.92 glow; a saturated horde frame blooms far less and only from the hottest cores.
   */
  setBloomGovernor(gain: number): void {
    const k = bloomK(gain);
    this.bloom.strength = BLOOM_LOADED.strength + (BLOOM_CALM.strength - BLOOM_LOADED.strength) * k;
    this.bloom.threshold = BLOOM_LOADED.threshold + (BLOOM_CALM.threshold - BLOOM_LOADED.threshold) * k;
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
