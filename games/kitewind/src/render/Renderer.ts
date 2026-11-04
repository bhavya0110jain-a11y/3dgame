import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { QualityTier } from '../core/Save';

/** Display-space finishing pass: grade, vignette, speed lines, near-miss flash, low-lift desaturation. */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 16 / 9 },
    uSpeed: { value: 0 },
    uVignette: { value: 0.32 },
    uWarm: { value: new THREE.Vector3(1.03, 1.0, 0.96) },
    uLowLift: { value: 0 },
    uFlash: { value: 0 },
    uSat: { value: 1.08 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAspect, uSpeed, uVignette, uLowLift, uFlash, uSat;
    uniform vec3 uWarm;
    varying vec2 vUv;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      c.x *= uAspect;
      float r = length(c);
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      // speed lines: radial streaks toward the edges
      if (uSpeed > 0.01) {
        float ang = atan(c.y, c.x);
        float id = floor(ang * 38.0);
        float h = hash(id);
        float move = fract(h * 7.0 + uTime * (1.4 + h * 1.6));
        float streak = smoothstep(0.92, 1.0, h) * smoothstep(0.32, 0.75, r) * smoothstep(0.0, 0.25, move) * (1.0 - move);
        float lane = 1.0 - abs(fract(ang * 38.0) - 0.5) * 2.0;
        col += vec3(1.0, 0.97, 0.92) * streak * pow(lane, 6.0) * uSpeed * 0.55;
      }
      col *= uWarm;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat - uLowLift * 0.45);
      // low lift: cool, pulsing edges
      float vig = smoothstep(0.35, 1.05, r);
      col = mix(col, col * vec3(0.55, 0.62, 0.95), vig * uLowLift * (0.7 + 0.3 * sin(uTime * 7.0)));
      col *= 1.0 - vig * uVignette;
      col += vec3(1.0, 0.95, 0.85) * uFlash * 0.35 * (1.0 - r);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

interface Tier {
  dpr: number;
  bloom: boolean;
  bloomRes: number;
  fxaa: boolean;
}
const TIERS: Record<QualityTier, Tier> = {
  high: { dpr: 1.5, bloom: true, bloomRes: 0.5, fxaa: true },
  medium: { dpr: 1.15, bloom: true, bloomRes: 0.35, fxaa: true },
  low: { dpr: 0.85, bloom: false, bloomRes: 0.25, fxaa: false },
};

/**
 * WebGL renderer + post stack: RenderPass → UnrealBloom (HDR, emissives/sun/rings bloom) → OutputPass
 * (ACES filmic + sRGB) → Finish (grade, vignette, speed lines) → FXAA.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly finish: ShaderPass;
  private fxaa: ShaderPass;
  private tier: Tier = TIERS.high;
  /** Base vertical FOV (deg); the camera rig adds kicks on top. */
  baseFov = 62;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
    const r = this.renderer;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.fog = new THREE.Fog(0xf4b48f, 60, 520);
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 16 / 9, 0.3, 2400);
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.55, 0.98);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q: QualityTier): void {
    this.tier = TIERS[q] ?? TIERS.high;
    this.bloom.enabled = this.tier.bloom;
    this.fxaa.enabled = this.tier.fxaa;
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.tier.dpr);
    this.camera.aspect = w / h;
    this.baseFov = w < h ? 78 : 62;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w * dpr * this.tier.bloomRes, h * dpr * this.tier.bloomRes);
    (this.fxaa.material.uniforms.resolution.value as THREE.Vector2).set(1 / (w * dpr), 1 / (h * dpr));
    this.finish.uniforms.uAspect.value = w / h;
  }

  render(): void {
    this.composer.render();
  }
}
