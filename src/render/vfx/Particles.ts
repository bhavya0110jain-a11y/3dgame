import * as THREE from 'three';
import { ATLAS_GLSL, ATLAS_GRID, getAtlas } from './atlas';

/**
 * CPU-simulated, GPU-instanced billboard particles.
 *
 *  - ONE draw call for every particle (sparks, glows, smoke, flames, ground splashes): instanced quads,
 *    premultiplied-alpha blending (src=ONE, dst=ONE_MINUS_SRC_ALPHA). Each particle has an `additive` amount:
 *    1 → pure additive glow (alpha out = 0), 0 → normal alpha-blended smoke that darkens what's behind it.
 *  - Size over life (s0 → s1, ease-out), colour over life (c0 → c1), alpha envelope (quick fade-in, fade-out).
 *  - Velocity stretching: sparks are elongated along their screen-space velocity (length = size + speed*stretch).
 *  - Ground-aligned flag: the quad lies flat on XZ (light splashes, scorch, decals).
 *  - Unscaled flag: ticks on real time, so the level-up column keeps animating while the game is paused.
 *  - Storage is structure-of-arrays in one Float32Array (stride F); spawn/update/render allocate nothing.
 *    Dead particles are swap-removed, so the live set is always the dense prefix [0, count).
 */

// field offsets in the SoA stride
const X = 0, Y = 1, Z = 2, VX = 3, VY = 4, VZ = 5, AGE = 6, LIFE = 7, S0 = 8, S1 = 9;
const R0 = 10, G0 = 11, B0 = 12, R1 = 13, G1 = 14, B1 = 15, INT = 16, GRAV = 17, DRAG = 18, FRAME = 19;
const ROT = 20, ROTV = 21, STRETCH = 22, ADD = 23, FLAGS = 24, FADEIN = 25;
const F = 26;

export const PF_GROUND = 1;
export const PF_UNSCALED = 2;
export const PF_BOUNCE = 4;
/** Fade alpha with a slower ease (smoke): alpha = (1-t)^0.6 instead of (1-t)^1.4 */
export const PF_SOFTFADE = 8;
/** Flicker intensity (flames, magic) */
export const PF_FLICKER = 16;

const tmpColor = new THREE.Color();

export class ParticleSystem {
  readonly capacity: number;
  count = 0;
  private d: Float32Array;
  private mesh: THREE.Mesh;
  private aPos: THREE.InstancedBufferAttribute; // xyz + size
  private aVel: THREE.InstancedBufferAttribute; // view-independent velocity xyz + stretch
  private aCol: THREE.InstancedBufferAttribute; // rgb (linear, premultiplied by intensity) + alpha
  private aPar: THREE.InstancedBufferAttribute; // frame, rotation, additive, ground
  private geo: THREE.InstancedBufferGeometry;
  private attrs: THREE.InstancedBufferAttribute[];
  private seed = 1;
  /** Brightness governor for additive particles (FxManager lowers it when the screen is crowded with light). */
  gain = 1;

  constructor(scene: THREE.Scene, capacity = 4000) {
    this.capacity = capacity;
    this.d = new Float32Array(capacity * F);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = mk(4);
    this.aVel = mk(4);
    this.aCol = mk(4);
    this.aPar = mk(4);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iPar', this.aPar);
    geo.instanceCount = 0;
    this.geo = geo;
    this.attrs = [this.aPos, this.aVel, this.aCol, this.aPar];

    const mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: getAtlas() } },
      vertexShader: /* glsl */ `
        attribute vec4 iPos;
        attribute vec4 iVel;
        attribute vec4 iCol;
        attribute vec4 iPar;
        varying vec2 vUv;
        varying vec4 vCol;
        varying float vAdd;
        ${ATLAS_GLSL}
        void main() {
          vec2 corner = position.xy;
          float size = iPos.w;
          float rot = iPar.y;
          vec2 cr = vec2(cos(rot), sin(rot));
          vUv = atlasUv(iPar.x, corner + 0.5);
          vCol = iCol;
          vAdd = iPar.z;
          if (iPar.w > 0.5) {
            // flat on the ground plane
            vec2 c = vec2(corner.x * cr.x - corner.y * cr.y, corner.x * cr.y + corner.y * cr.x) * size;
            gl_Position = projectionMatrix * viewMatrix * vec4(iPos.x + c.x, iPos.y, iPos.z + c.y, 1.0);
            return;
          }
          vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
          vec2 c;
          if (iVel.w > 0.0) {
            vec2 v2 = (viewMatrix * vec4(iVel.xyz, 0.0)).xy;
            float len = length(v2);
            vec2 dir = len > 1e-4 ? v2 / len : vec2(1.0, 0.0);
            vec2 perp = vec2(-dir.y, dir.x);
            float L = size + len * iVel.w;
            // streak frame's head is +x: put the head at the particle, tail trailing behind
            c = dir * (corner.x * L - L * 0.5 + size * 0.5) + perp * corner.y * size;
          } else {
            c = vec2(corner.x * cr.x - corner.y * cr.y, corner.x * cr.y + corner.y * cr.x) * size;
          }
          mv.xy += c;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying vec2 vUv;
        varying vec4 vCol;
        varying float vAdd;
        void main() {
          vec4 t = texture2D(uAtlas, vUv);
          float a = t.a * vCol.a;
          if (a < 0.003) discard;
          vec3 rgb = vCol.rgb * t.rgb * a;
          gl_FragColor = vec4(rgb, a * (1.0 - vAdd));
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'vfx-particles';
    scene.add(this.mesh);
  }

  /** 0 = empty, 1 = full. Emitters scale their rate by (1 - pressure) so heavy fights degrade gracefully. */
  get pressure(): number {
    return this.count / this.capacity;
  }

  /** Cheap deterministic-enough RNG (no Math.random overhead in tight emit loops). */
  rand(): number {
    let t = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Spawn one particle. Colours are sRGB hex (converted to linear). `intensity` multiplies colour (>1 blooms).
   * Returns false when the budget is exhausted.
   */
  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, s0: number, s1: number,
    c0: number, c1: number, intensity: number,
    frame: number, additive = 1, gravity = 0, drag = 0, stretch = 0,
    flags = 0, rot = 0, rotv = 0, delay = 0, fadeIn = 0.08,
  ): boolean {
    if (this.count >= this.capacity) return false;
    const o = this.count++ * F;
    const d = this.d;
    d[o + X] = x; d[o + Y] = y; d[o + Z] = z;
    d[o + VX] = vx; d[o + VY] = vy; d[o + VZ] = vz;
    d[o + AGE] = -delay; d[o + LIFE] = life;
    d[o + S0] = s0; d[o + S1] = s1;
    tmpColor.setHex(c0);
    d[o + R0] = tmpColor.r; d[o + G0] = tmpColor.g; d[o + B0] = tmpColor.b;
    if (c1 !== c0) tmpColor.setHex(c1);
    d[o + R1] = tmpColor.r; d[o + G1] = tmpColor.g; d[o + B1] = tmpColor.b;
    d[o + INT] = intensity; d[o + GRAV] = gravity; d[o + DRAG] = drag;
    d[o + FRAME] = frame; d[o + ROT] = rot; d[o + ROTV] = rotv;
    d[o + STRETCH] = stretch; d[o + ADD] = additive; d[o + FLAGS] = flags; d[o + FADEIN] = fadeIn;
    return true;
  }

  clear(): void {
    this.count = 0;
    this.geo.instanceCount = 0;
  }

  update(dt: number, realDt: number): void {
    const d = this.d;
    const P = this.aPos.array as Float32Array;
    const V = this.aVel.array as Float32Array;
    const C = this.aCol.array as Float32Array;
    const Q = this.aPar.array as Float32Array;
    let i = 0;
    while (i < this.count) {
      const o = i * F;
      const flags = d[o + FLAGS];
      const step = flags & PF_UNSCALED ? realDt : dt;
      let age = d[o + AGE] + step;
      const life = d[o + LIFE];
      if (age >= life) {
        // swap-remove with the last live particle
        const last = --this.count;
        if (i !== last) d.copyWithin(o, last * F, last * F + F);
        continue;
      }
      d[o + AGE] = age;
      const j = i * 4;
      if (age < 0) {
        // delayed spawn: keep the slot, draw nothing
        P[j + 3] = 0;
        C[j + 3] = 0;
        Q[j] = 0;
        Q[j + 3] = 0;
        V[j + 3] = 0;
        i++;
        continue;
      }
      if (step > 0) {
        let vx = d[o + VX], vy = d[o + VY], vz = d[o + VZ];
        vy += d[o + GRAV] * step;
        const drag = d[o + DRAG];
        if (drag > 0) {
          const k = Math.max(0, 1 - drag * step);
          vx *= k; vy *= k; vz *= k;
        }
        let px = d[o + X] + vx * step;
        let py = d[o + Y] + vy * step;
        const pz = d[o + Z] + vz * step;
        if (flags & PF_BOUNCE && py < 0.05) {
          py = 0.05;
          vy = -vy * 0.35;
          vx *= 0.6; vz *= 0.6;
        }
        d[o + X] = px; d[o + Y] = py; d[o + Z] = pz;
        d[o + VX] = vx; d[o + VY] = vy; d[o + VZ] = vz;
        d[o + ROT] += d[o + ROTV] * step;
      }
      const t = age / life;
      const e = 1 - (1 - t) * (1 - t); // ease-out for size
      const size = d[o + S0] + (d[o + S1] - d[o + S0]) * e;
      const fi = d[o + FADEIN];
      let alpha = fi > 0 && t < fi ? t / fi : 1;
      alpha *= flags & PF_SOFTFADE ? Math.pow(1 - t, 0.6) : Math.pow(1 - t, 1.4);
      let inten = d[o + INT] * (d[o + ADD] > 0.5 ? this.gain : 1);
      if (flags & PF_FLICKER) inten *= 0.75 + 0.5 * this.rand();
      P[j] = d[o + X]; P[j + 1] = d[o + Y]; P[j + 2] = d[o + Z]; P[j + 3] = size;
      V[j] = d[o + VX]; V[j + 1] = d[o + VY]; V[j + 2] = d[o + VZ]; V[j + 3] = d[o + STRETCH];
      C[j] = (d[o + R0] + (d[o + R1] - d[o + R0]) * t) * inten;
      C[j + 1] = (d[o + G0] + (d[o + G1] - d[o + G0]) * t) * inten;
      C[j + 2] = (d[o + B0] + (d[o + B1] - d[o + B0]) * t) * inten;
      C[j + 3] = alpha;
      Q[j] = d[o + FRAME]; Q[j + 1] = d[o + ROT]; Q[j + 2] = d[o + ADD]; Q[j + 3] = flags & PF_GROUND ? 1 : 0;
      i++;
    }
    const n = this.count;
    this.geo.instanceCount = n;
    if (n > 0) {
      for (const a of this.attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * 4);
        a.needsUpdate = true;
      }
    }
  }
}

export { ATLAS_GRID };
