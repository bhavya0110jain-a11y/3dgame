import * as THREE from 'three';
import { Frame } from './atlas';
import type { ParticleSystem } from './Particles';
import { PF_FLICKER, PF_SOFTFADE } from './Particles';

/**
 * Animated fire pools (Brazier): one instanced draw call of ground quads with a procedural fire shader —
 * two domain-warped value-noise layers scrolled in opposite directions, a heat ramp (deep red → orange →
 * yellow → white) with a darker scorched rim — plus emitted flame licks, rising embers and a little smoke.
 * Pure visuals: the Brazier weapon keeps its own gameplay zones and just calls fx.firePool(x, z, r, life).
 */
const X = 0, Z = 1, R = 2, AGE = 3, LIFE = 4, SEED = 5, ACC = 6;
const F = 7;
const CLEAR2 = 1.5 * 1.5;

export class FirePools {
  private d: Float32Array;
  private count = 0;
  private geo: THREE.InstancedBufferGeometry;
  private aA: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private time = 0;

  constructor(scene: THREE.Scene, private capacity = 48) {
    this.d = new Float32Array(capacity * F);
    const geo = new THREE.InstancedBufferGeometry();
    const m = 1.2;
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-m, 0, -m, m, 0, -m, m, 0, m, -m, 0, m], 3));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', this.aA); // x z radius seed
    geo.setAttribute('iB', this.aB); // fade(0..1), age
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFocus: { value: new THREE.Vector2(1e9, 1e9) }, uGain: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 iA;
        attribute vec2 iB;
        varying vec2 vUv;
        varying vec4 vA;
        varying vec2 vB;
        varying vec2 vW;
        void main() {
          vUv = position.xz;
          vA = iA;
          vB = iB;
          vec3 p = vec3(iA.x + position.x * iA.z, 0.05, iA.y + position.z * iA.z);
          vW = p.xz;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec2 uFocus;
        uniform float uGain;
        varying vec2 vUv;
        varying vec4 vA;
        varying vec2 vB;
        varying vec2 vW;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vn(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) { float f = 0.0; float a = 0.5; for (int i = 0; i < 3; i++) { f += vn(p) * a; p = p * 2.07 + 1.3; a *= 0.5; } return f; }
        void main() {
          float d = length(vUv);
          float t = uTime;
          vec2 w = vUv * vA.z;                // world-scale coordinates so big pools get more licks
          float ang = atan(vUv.y, vUv.x);
          // inward-flowing, swirling flame field
          vec2 polar = vec2(ang * 1.6 + t * 0.35, d * 2.4 - t * 1.6);
          float n1 = fbm(w * 1.15 + vec2(vA.w, t * 0.9));
          float n2 = fbm(polar * vec2(2.0, 1.4) + vA.w + n1 * 1.5);
          float n = n1 * 0.45 + n2 * 0.75;
          // tongues of flame: ridged noise gives bright licks with darker gaps between them
          float ridge = 1.0 - abs(n2 * 2.0 - 1.0);
          ridge = ridge * ridge * ridge;
          float edge = 1.0 - smoothstep(0.6, 1.0, d + (n - 0.5) * 0.5);
          float heat = edge * (0.12 + n * 0.55 + ridge * 0.75) + (1.0 - smoothstep(0.0, 0.5, d)) * 0.12;
          heat *= vB.x;
          // heat ramp
          vec3 c = vec3(0.55, 0.05, 0.02) * smoothstep(0.05, 0.3, heat);
          c = mix(c, vec3(1.0, 0.32, 0.04), smoothstep(0.3, 0.55, heat));
          c = mix(c, vec3(1.0, 0.72, 0.18), smoothstep(0.55, 0.8, heat));
          c = mix(c, vec3(1.0, 0.86, 0.55), smoothstep(1.05, 1.4, heat));
          float inten = smoothstep(0.04, 0.35, heat) * (0.6 + heat * 0.75);
          // the bearer stands in a calmer pocket of embers, so the hero never dissolves into a white-hot pool
          float fd = length(vW - uFocus);
          inten *= mix(0.35, 1.0, smoothstep(0.7, 2.0, fd)) * uGain;
          // scorched, smouldering rim darkens the ground just outside the flames
          float rim = smoothstep(0.55, 0.9, d) * (1.0 - smoothstep(0.95, 1.15, d));
          float dark = rim * 0.45 * vB.x + edge * 0.25 * vB.x;
          // flicker of the whole pool
          inten *= 0.9 + 0.1 * sin(t * 23.0 + vA.w * 7.0);
          gl_FragColor = vec4(c * inten, dark);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.name = 'vfx-firepools';
    scene.add(mesh);
  }

  private aB: THREE.InstancedBufferAttribute;
  /** Player position (FxManager.setFocus): no tall flame licks or smoke within CLEAR m of it, so the hero stays visible. */
  focusX = 1e9;
  focusZ = 1e9;
  /** Brightness governor (see FxManager). Also scales down when many pools overlap. */
  gain = 1;

  add(x: number, z: number, r: number, life: number): void {
    if (this.count >= this.capacity) {
      // recycle the oldest-looking (first) pool
      this.d.copyWithin(0, F, this.count * F);
      this.count--;
    }
    const o = this.count++ * F;
    const d = this.d;
    d[o + X] = x; d[o + Z] = z; d[o + R] = r; d[o + AGE] = 0; d[o + LIFE] = life; d[o + SEED] = Math.random() * 50; d[o + ACC] = 0;
  }

  clear(): void {
    this.count = 0;
    this.geo.instanceCount = 0;
  }

  update(dt: number, ps: ParticleSystem): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    (this.mat.uniforms.uFocus.value as THREE.Vector2).set(this.focusX, this.focusZ);
    // many overlapping pools add up to white: dim each pool a little as the field fills
    this.mat.uniforms.uGain.value = this.gain / (1 + Math.max(0, this.count - 3) * 0.06);
    const d = this.d;
    const A = this.aA.array as Float32Array;
    const B = this.aB.array as Float32Array;
    const room = 1 - ps.pressure;
    let i = 0;
    while (i < this.count) {
      const o = i * F;
      const age = d[o + AGE] + dt;
      const life = d[o + LIFE];
      if (age >= life) {
        const last = --this.count;
        if (i !== last) d.copyWithin(o, last * F, last * F + F);
        continue;
      }
      d[o + AGE] = age;
      const x = d[o + X], z = d[o + Z], r = d[o + R];
      // ignite fast (0.18 s, with a slight overshoot), die down over the last 0.5 s
      const grow = Math.min(1, age / 0.18);
      const fade = Math.min(grow * (1 + 0.15 * Math.sin(grow * Math.PI)), (life - age) / 0.5, 1);
      A[i * 4] = x; A[i * 4 + 1] = z; A[i * 4 + 2] = r * (0.75 + 0.25 * grow); A[i * 4 + 3] = d[o + SEED];
      B[i * 2] = Math.max(0, fade); B[i * 2 + 1] = age;

      // emitters: flame licks + embers + wisps of smoke, rate ∝ area, throttled by particle pressure
      if (dt > 0) {
        d[o + ACC] += dt * (10 + r * r * 9) * room * fade;
        while (d[o + ACC] >= 1) {
          d[o + ACC] -= 1;
          const a = ps.rand() * Math.PI * 2;
          const rr = Math.sqrt(ps.rand()) * r * 0.8;
          const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
          let roll = ps.rand();
          const fdx = px - this.focusX, fdz = pz - this.focusZ;
          if (fdx * fdx + fdz * fdz < CLEAR2) roll = 0.62 + roll * 0.28; // only low embers around the player
          if (roll < 0.62) {
            const s = 0.55 + ps.rand() * 0.6 * (1 - rr / r);
            ps.emit(px, 0.25 + s * 0.4, pz, 0, 1.6 + ps.rand() * 1.4, 0, 0.35 + ps.rand() * 0.3, s, s * 0.3, 0xffd27a, 0xff3a0a, 1.6, Frame.FLAME, 1, 0.5, 0.5, 0, PF_FLICKER, (ps.rand() - 0.5) * 0.4, 0, 0, 0.12);
          } else if (roll < 0.9) {
            ps.emit(px, 0.3, pz, (ps.rand() - 0.5) * 1.2, 2.5 + ps.rand() * 3, (ps.rand() - 0.5) * 1.2, 0.6 + ps.rand() * 0.6, 0.12, 0.05, 0xffe08a, 0xff4a10, 4, Frame.DOT, 1, 0.8, 0.6, 0.05);
          } else {
            ps.emit(px, 0.8, pz, 0, 1.2, 0, 1.1, 0.6, 1.5, 0x3a2a2a, 0x1a1418, 1, Frame.SMOKE, 0, 0, 0.3, 0, PF_SOFTFADE, ps.rand() * 6, (ps.rand() - 0.5) * 1.5, 0, 0.25);
          }
        }
      }
      i++;
    }
    this.geo.instanceCount = this.count;
    if (this.count > 0) {
      this.aA.clearUpdateRanges(); this.aA.addUpdateRange(0, this.count * 4); this.aA.needsUpdate = true;
      this.aB.clearUpdateRanges(); this.aB.addUpdateRange(0, this.count * 2); this.aB.needsUpdate = true;
    }
  }
}
