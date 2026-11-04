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
    this.composer = new EffectComposer(renderer);

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
      c.transparencyAware = false; // particles/ghosts are additive & depthWrite:false; skip 2 extra scene renders
      ao.autoDetectTransparency = false; // ...and the per-frame scene traversal that would re-enable it
      ao.setQualityMode('Medium');
      this.ao = ao;
      this.composer.addPass(ao);
    } catch (err) {
      console.warn('[render] N8AO unavailable, continuing without AO', err);
    }

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.62, 0.55, 0.92);
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

  render(dt: number): void {
    this.composer.render(dt);
  }
}
