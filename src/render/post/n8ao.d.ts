// Minimal typings for n8ao 1.9.x (the package ships plain JS). Only what the render pipeline uses.
declare module 'n8ao' {
  import type * as THREE from 'three';
  import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    denoiseIterations: number;
    renderMode: number;
    color: THREE.Color;
    gammaCorrection: boolean;
    logarithmicDepthBuffer: boolean;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    autoRenderBeauty: boolean;
    colorMultiply: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
    stencil: boolean;
    biasOffset: number;
    biasMultiplier: number;
    aoTones: number;
  }

  export class N8AOPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    autoDetectTransparency: boolean;
    beautyRenderTarget: THREE.WebGLRenderTarget;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setDisplayMode(mode: 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO'): void;
    setSize(width: number, height: number): void;
  }
}
