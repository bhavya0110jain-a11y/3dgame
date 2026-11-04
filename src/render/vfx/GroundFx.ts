import * as THREE from 'three';

/**
 * Analytic ground decals, one instanced draw call: shockwave rings, light splashes, telegraphs, rune circles.
 * Shapes are computed per-pixel from distance-to-centre (not textures), so a 20 m beacon ring is exactly as crisp
 * as a 1 m hit ring and ring thickness is specified in world units.
 *
 * Modes:
 *   SHOCK      expanding wavefront: bright crisp ring + soft trailing "heat" band inside (reads as a distortion)
 *   GLOW       gaussian light pool (fake dynamic light on the ground — no real light cost)
 *   TELEGRAPH  danger zone: pulsing rim, rotating dashed inner ring, fill that sweeps outward until impact,
 *              darkens the ground (premultiplied alpha) so it reads as menacing even inside the warm lantern pool
 *   RUNE       level-up / reliquary sigil: double ring, rotating ticks and glyph arcs
 */
export const GM_SHOCK = 0;
export const GM_GLOW = 1;
export const GM_TELEGRAPH = 2;
export const GM_RUNE = 3;

export const GF_UNSCALED = 1;

const X = 0, Y = 1, Z = 2, R0 = 3, R1 = 4, AGE = 5, LIFE = 6, CR = 7, CG = 8, CB = 9, INT = 10, MODE = 11, TH = 12, FLAGS = 13, SEED = 14;
const F = 15;
const tmpC = new THREE.Color();

export class GroundFx {
  private d: Float32Array;
  private count = 0;
  private geo: THREE.InstancedBufferGeometry;
  private aA: THREE.InstancedBufferAttribute;
  private aB: THREE.InstancedBufferAttribute;
  private aC: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private time = 0;
  /** Brightness governor (FxManager lowers it when the screen is crowded with light). Telegraphs ignore it. */
  gain = 1;
  /** Telegraph end-of-fill flash multiplier (1 with reduced flashing). */
  flashEnd = 1.6;

  constructor(scene: THREE.Scene, private capacity = 160) {
    this.d = new Float32Array(capacity * F);
    const geo = new THREE.InstancedBufferGeometry();
    const m = 1.15; // quad margin around the radius for soft edges
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-m, 0, -m, m, 0, -m, m, 0, m, -m, 0, m], 3));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aA = mk();
    this.aB = mk();
    this.aC = mk();
    geo.setAttribute('iA', this.aA); // x y z radius
    geo.setAttribute('iB', this.aB); // rgb * intensity, alpha
    geo.setAttribute('iC', this.aC); // mode, relative thickness, progress, seed
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec4 iA;
        attribute vec4 iB;
        attribute vec4 iC;
        varying vec2 vUv;
        varying vec4 vB;
        varying vec4 vC;
        void main() {
          vUv = position.xz;
          vB = iB;
          vC = iC;
          vec3 p = vec3(iA.x + position.x * iA.w, iA.y, iA.z + position.z * iA.w);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying vec4 vB;
        varying vec4 vC;
        float band(float d, float c, float w) { float x = (d - c) / max(w, 0.002); return exp(-x * x * 2.0); }
        void main() {
          float d = length(vUv);
          float mode = vC.x;
          float th = vC.y;
          float p = vC.z;
          float v = 0.0;
          float dark = 0.0;
          if (mode < 0.5) {
            float ring = band(d, 1.0, th);
            float trail = smoothstep(0.62, 1.0, d) * (1.0 - smoothstep(0.98, 1.0 + th, d));
            v = ring * 1.2 + trail * trail * trail * 0.4;
          } else if (mode < 1.5) {
            v = exp(-d * d * 3.2) * (1.0 - smoothstep(0.9, 1.15, d));
          } else if (mode < 2.5) {
            float ang = atan(vUv.y, vUv.x);
            float pulse = 0.65 + 0.35 * sin(uTime * (10.0 + p * 18.0));
            float rim = band(d, 1.0, th) * pulse;
            float dash = smoothstep(0.35, 0.65, fract(ang * 1.909859 + uTime * 0.6 + vC.w));
            float dashRing = band(d, 0.86, th * 0.5) * dash * 0.55;
            float inside = 1.0 - smoothstep(0.98, 1.02, d);
            float fill = (1.0 - smoothstep(p - 0.03, p, d)) * inside;
            float front = band(d, p, 0.025) * inside;
            v = rim + dashRing + fill * (0.10 + 0.25 * d * d) + front * 0.9 + inside * 0.05;
            dark = inside * (0.22 + 0.25 * fill);
          } else {
            float ang = atan(vUv.y, vUv.x) + vC.w + uTime * 0.7;
            float r1 = band(d, 1.0, th);
            float r2 = band(d, 0.8, th * 0.6) * 0.75;
            float ticks = smoothstep(0.7, 1.0, abs(cos(ang * 12.0))) * step(0.83, d) * step(d, 0.97);
            float arcs = smoothstep(0.85, 1.0, abs(sin(ang * 3.0 - uTime * 1.4))) * band(d, 0.62, th * 0.5);
            v = r1 + r2 + ticks * 0.7 + arcs * 0.9 + exp(-d * d * 5.0) * 0.3;
          }
          float a = vB.a;
          gl_FragColor = vec4(vB.rgb * v * a, dark * a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.name = 'vfx-ground';
    scene.add(mesh);
  }

  /**
   * Add a decal. Radius eases r0 → r1 (cubic out). `thickness` is world units (rings).
   * `delay` (s) postpones it (for staged spectacles). Returns false if full.
   */
  add(mode: number, x: number, z: number, r0: number, r1: number, life: number, color: number, intensity = 1, thickness = 0.25, delay = 0, flags = 0, y = 0.06): boolean {
    if (this.count >= this.capacity) return false;
    const o = this.count++ * F;
    const d = this.d;
    tmpC.setHex(color);
    d[o + X] = x; d[o + Y] = y; d[o + Z] = z;
    d[o + R0] = r0; d[o + R1] = r1; d[o + AGE] = -delay; d[o + LIFE] = life;
    d[o + CR] = tmpC.r; d[o + CG] = tmpC.g; d[o + CB] = tmpC.b; d[o + INT] = intensity;
    d[o + MODE] = mode; d[o + TH] = thickness; d[o + FLAGS] = flags; d[o + SEED] = Math.random() * 6.28;
    return true;
  }

  clear(): void {
    this.count = 0;
    this.geo.instanceCount = 0;
  }

  update(dt: number, realDt: number): void {
    this.time += realDt;
    this.mat.uniforms.uTime.value = this.time;
    const d = this.d;
    const A = this.aA.array as Float32Array;
    const B = this.aB.array as Float32Array;
    const C = this.aC.array as Float32Array;
    let i = 0;
    while (i < this.count) {
      const o = i * F;
      const age = d[o + AGE] + (d[o + FLAGS] & GF_UNSCALED ? realDt : dt);
      const life = d[o + LIFE];
      if (age >= life) {
        const last = --this.count;
        if (i !== last) d.copyWithin(o, last * F, last * F + F);
        continue;
      }
      d[o + AGE] = age;
      const j = i * 4;
      const mode = d[o + MODE];
      const t = Math.max(0, age / life);
      let r: number;
      let alpha: number;
      if (mode === GM_TELEGRAPH) {
        r = d[o + R1];
        // fade in fast, hold, short bright flash at the end
        alpha = Math.min(1, t * 8) * (t > 0.92 ? this.flashEnd : 1);
      } else {
        const e = 1 - Math.pow(1 - t, 3);
        r = d[o + R0] + (d[o + R1] - d[o + R0]) * e;
        alpha = mode === GM_SHOCK ? Math.pow(1 - t, 1.6) : mode === GM_GLOW ? (1 - t) * (1 - t) : Math.min(1, t * 6) * (1 - t * t);
      }
      if (age < 0) alpha = 0;
      const inten = d[o + INT] * (mode === GM_TELEGRAPH ? 1 : this.gain);
      A[j] = d[o + X]; A[j + 1] = d[o + Y]; A[j + 2] = d[o + Z]; A[j + 3] = Math.max(0.01, r);
      B[j] = d[o + CR] * inten; B[j + 1] = d[o + CG] * inten; B[j + 2] = d[o + CB] * inten; B[j + 3] = alpha;
      C[j] = mode; C[j + 1] = d[o + TH] / Math.max(0.05, r); C[j + 2] = t; C[j + 3] = d[o + SEED];
      i++;
    }
    this.geo.instanceCount = this.count;
    if (this.count > 0) {
      const n = this.count * 4;
      this.aA.clearUpdateRanges(); this.aA.addUpdateRange(0, n); this.aA.needsUpdate = true;
      this.aB.clearUpdateRanges(); this.aB.addUpdateRange(0, n); this.aB.needsUpdate = true;
      this.aC.clearUpdateRanges(); this.aC.addUpdateRange(0, n); this.aC.needsUpdate = true;
    }
  }
}
