import * as THREE from 'three';
import { Rng } from '../core/Rng';

const vert = /* glsl */ `
attribute vec2 corner;      // x: 0 head .. 1 tail, y: -1 / 1 side
attribute vec3 aA;
attribute vec3 aB;
attribute float aAlpha;
uniform float uWidth;
varying vec2 vC;
varying float vA;
void main() {
  vec4 a = modelViewMatrix * vec4(aA, 1.0);
  vec4 b = modelViewMatrix * vec4(aB, 1.0);
  vec4 p = mix(a, b, corner.x);
  vec3 side = normalize(cross(b.xyz - a.xyz, p.xyz) + vec3(1e-5, 0.0, 0.0));
  p.xyz += side * corner.y * uWidth * (1.0 - corner.x * 0.7);
  vC = corner;
  vA = aAlpha;
  gl_Position = projectionMatrix * p;
}`;
const frag = /* glsl */ `
uniform vec3 uColor;
varying vec2 vC;
varying float vA;
void main() {
  float across = 1.0 - abs(vC.y);
  float along = (1.0 - vC.x) * smoothstep(0.0, 0.08, vC.x + 0.02);
  float a = across * across * along * vA;
  gl_FragColor = vec4(uColor * a, a);
}`;

/** Feel constants for the 3-D wind streaks. */
export const STREAKS = {
  count: 110,
  /** Spawn band ahead of the kite (m). */
  aheadMin: 25,
  aheadMax: 75,
  /** Radial band around the flight path (m): never right in front of the camera. */
  rMin: 2.6,
  rMax: 15,
  /** Streak length = speed × this (s) — a motion-blur exposure. */
  exposure: 0.085,
  width: 0.035,
} as const;

/**
 * World-space wind streaks: thin camera-facing quads that hang still in the air and smear past the kite along its
 * velocity, so speed reads in 3-D (complements the screen-space lines in the finish pass). One instanced draw,
 * allocation-free per frame. Intensity 0 hides everything (draw count 0).
 */
export class SpeedLines {
  private mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private p: Float32Array;
  private seed: Float32Array;
  private aA: Float32Array;
  private aB: Float32Array;
  private al: Float32Array;
  private rng = new Rng(4242);
  private inited = false;
  readonly uniforms = { uColor: { value: new THREE.Color(1.0, 0.95, 0.86) }, uWidth: { value: STREAKS.width } };

  constructor(scene: THREE.Scene) {
    const N = STREAKS.count;
    this.p = new Float32Array(N * 3);
    this.seed = new Float32Array(N);
    this.aA = new Float32Array(N * 3);
    this.aB = new Float32Array(N * 3);
    this.al = new Float32Array(N);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    g.setAttribute('aA', new THREE.InstancedBufferAttribute(this.aA, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aB', new THREE.InstancedBufferAttribute(this.aB, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.geo = g;
    const m = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  private spawn(i: number, x: number, y: number, z: number, fx: number, fy: number, fz: number, near: boolean): void {
    const r = this.rng;
    const ahead = near ? r.range(-4, STREAKS.aheadMax) : r.range(STREAKS.aheadMin, STREAKS.aheadMax);
    const ang = r.next() * Math.PI * 2;
    const rad = STREAKS.rMin + Math.sqrt(r.next()) * (STREAKS.rMax - STREAKS.rMin);
    // perpendicular basis to the flight direction (fx,fy,fz)
    let ux = fz, uy = 0, uz = -fx;
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul; uz /= ul;
    const vx = fy * uz - fz * uy, vy = fz * ux - fx * uz, vz = fx * uy - fy * ux;
    const ca = Math.cos(ang) * rad, sa = Math.sin(ang) * rad * 0.7;
    this.p[i * 3] = x + fx * ahead + ux * ca + vx * sa;
    this.p[i * 3 + 1] = y + fy * ahead + uy * ca + vy * sa;
    this.p[i * 3 + 2] = z + fz * ahead + uz * ca + vz * sa;
    this.seed[i] = r.next();
  }

  /** Kite position + velocity (m/s); intensity 0..1 (speed / dive). */
  update(x: number, y: number, z: number, vx: number, vy: number, vz: number, intensity: number): void {
    const N = STREAKS.count;
    const sp = Math.hypot(vx, vy, vz);
    if (intensity < 0.02 || sp < 1) {
      this.geo.instanceCount = 0;
      this.inited = false;
      return;
    }
    const fx = vx / sp, fy = vy / sp, fz = vz / sp;
    if (!this.inited) {
      for (let i = 0; i < N; i++) this.spawn(i, x, y, z, fx, fy, fz, true);
      this.inited = true;
    }
    const L = sp * STREAKS.exposure;
    const active = Math.min(N, Math.ceil(N * Math.min(1, 0.25 + intensity)));
    for (let i = 0; i < N; i++) {
      const px = this.p[i * 3], py = this.p[i * 3 + 1], pz = this.p[i * 3 + 2];
      const along = (px - x) * fx + (py - y) * fy + (pz - z) * fz;
      if (along < -6 || along > STREAKS.aheadMax + 20) {
        this.spawn(i, x, y, z, fx, fy, fz, false);
        continue;
      }
      this.aA[i * 3] = px;
      this.aA[i * 3 + 1] = py;
      this.aA[i * 3 + 2] = pz;
      this.aB[i * 3] = px - fx * L;
      this.aB[i * 3 + 1] = py - fy * L;
      this.aB[i * 3 + 2] = pz - fz * L;
      // fade in far ahead, out as it passes the camera
      const fade = Math.min(1, (STREAKS.aheadMax + 10 - along) / 25) * Math.min(1, (along + 6) / 8);
      this.al[i] = i < active ? Math.max(0, fade) * intensity * (0.35 + this.seed[i] * 0.65) : 0;
    }
    this.geo.instanceCount = N;
    (this.geo.attributes.aA as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.attributes.aB as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}
