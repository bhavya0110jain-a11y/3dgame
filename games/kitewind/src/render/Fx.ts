import * as THREE from 'three';
import { Rng } from '../core/Rng';

const vert = /* glsl */ `
attribute vec4 aCol; // rgb, alpha
attribute float aSize;
varying vec4 vCol;
void main() {
  vCol = aCol;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * 320.0 / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const frag = /* glsl */ `
varying vec4 vCol;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(d));
  a = a * a * vCol.a;
  gl_FragColor = vec4(vCol.rgb * a, a);
}`;

/** Expanding additive shockwave rings (ring passes, whiskers, shrines). */
const WAVES = 24;

/** Pooled additive particle bursts (ring pops, glimmer sparkles, crash shreds, shield breaks) + shockwave rings. */
export class Fx {
  private waves: THREE.InstancedMesh;
  private wLife = new Float32Array(WAVES);
  private wMax = new Float32Array(WAVES).fill(1);
  private wPos = new Float32Array(WAVES * 3);
  private wR0 = new Float32Array(WAVES);
  private wR1 = new Float32Array(WAVES);
  private wCol = new Float32Array(WAVES * 3);
  private wNext = 0;
  private wM = new THREE.Matrix4();
  private wQ = new THREE.Quaternion();
  private wS = new THREE.Vector3();
  private wP = new THREE.Vector3();
  private wC = new THREE.Color();
  private readonly N = 1600;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private base: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private next = 0;
  private points: THREE.Points;
  private rng = new Rng(77);
  private c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const N = this.N;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.col = new Float32Array(N * 4);
    this.base = new Float32Array(N * 3);
    this.size = new Float32Array(N);
    this.life = new Float32Array(N);
    this.maxLife = new Float32Array(N).fill(1);
    this.drag = new Float32Array(N);
    this.grav = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    const ring = new THREE.RingGeometry(0.95, 1, 64, 1);
    const wm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: true });
    this.waves = new THREE.InstancedMesh(ring, wm, WAVES);
    this.waves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.waves.setColorAt(0, this.wC.setRGB(0, 0, 0));
    this.waves.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.waves.frustumCulled = false;
    this.waves.count = 0;
    scene.add(this.waves);
  }

  /** Expanding ring in the XY plane (faces the flight direction) from radius r0 to r1 over `life` s. */
  shockwave(x: number, y: number, z: number, r0: number, r1: number, color: THREE.Color | number, intensity = 2, life = 0.45): void {
    const i = this.wNext;
    this.wNext = (this.wNext + 1) % WAVES;
    if (typeof color === 'number') this.wC.setHex(color);
    else this.wC.copy(color);
    this.wPos[i * 3] = x;
    this.wPos[i * 3 + 1] = y;
    this.wPos[i * 3 + 2] = z;
    this.wR0[i] = r0;
    this.wR1[i] = r1;
    this.wCol[i * 3] = this.wC.r * intensity;
    this.wCol[i * 3 + 1] = this.wC.g * intensity;
    this.wCol[i * 3 + 2] = this.wC.b * intensity;
    this.wLife[i] = this.wMax[i] = life;
  }

  private updateWaves(dt: number): void {
    let n = 0;
    for (let i = 0; i < WAVES; i++) {
      if (this.wLife[i] <= 0) continue;
      this.wLife[i] -= dt;
      const t = 1 - Math.max(0, this.wLife[i]) / this.wMax[i];
      const e = 1 - (1 - t) * (1 - t) * (1 - t); // ease-out
      const r = this.wR0[i] + (this.wR1[i] - this.wR0[i]) * e;
      this.wP.set(this.wPos[i * 3], this.wPos[i * 3 + 1], this.wPos[i * 3 + 2] + e * 10);
      this.wS.set(r, r, r);
      this.wM.compose(this.wP, this.wQ, this.wS);
      this.waves.setMatrixAt(n, this.wM);
      const a = (1 - t) * (1 - t);
      this.wC.setRGB(this.wCol[i * 3] * a, this.wCol[i * 3 + 1] * a, this.wCol[i * 3 + 2] * a);
      this.waves.setColorAt(n, this.wC);
      n++;
    }
    this.waves.count = n;
    if (n) {
      this.waves.instanceMatrix.needsUpdate = true;
      this.waves.instanceColor!.needsUpdate = true;
    }
  }

  /** Spherical burst. `color` is HDR-scaled by `intensity` (bloom). */
  burst(x: number, y: number, z: number, count: number, color: THREE.Color | number, speed: number, size: number, life: number, intensity = 2, gravity = 0, drag = 2.5): void {
    if (typeof color === 'number') this.c.setHex(color);
    else this.c.copy(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.N;
      const u = this.rng.next() * 2 - 1;
      const th = this.rng.next() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + this.rng.next() * 0.65);
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = r * Math.cos(th) * sp;
      this.vel[i * 3 + 1] = u * sp;
      this.vel[i * 3 + 2] = r * Math.sin(th) * sp;
      const k = intensity * (0.7 + this.rng.next() * 0.5);
      this.base[i * 3] = this.c.r * k;
      this.base[i * 3 + 1] = this.c.g * k;
      this.base[i * 3 + 2] = this.c.b * k;
      this.size[i] = size * (0.6 + this.rng.next() * 0.8);
      this.life[i] = this.maxLife[i] = life * (0.6 + this.rng.next() * 0.6);
      this.drag[i] = drag;
      this.grav[i] = gravity;
    }
  }

  /** Ring burst: particles thrown outward in the ring plane (XY). */
  ringBurst(x: number, y: number, z: number, radius: number, color: THREE.Color, count = 48, intensity = 2.5): void {
    this.c.copy(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.N;
      const a = (n / count) * Math.PI * 2 + this.rng.next() * 0.2;
      this.pos[i * 3] = x + Math.cos(a) * radius;
      this.pos[i * 3 + 1] = y + Math.sin(a) * radius;
      this.pos[i * 3 + 2] = z;
      const sp = 6 + this.rng.next() * 6;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = Math.sin(a) * sp;
      this.vel[i * 3 + 2] = (this.rng.next() - 0.5) * 4 + 10;
      this.base[i * 3] = this.c.r * intensity;
      this.base[i * 3 + 1] = this.c.g * intensity;
      this.base[i * 3 + 2] = this.c.b * intensity;
      this.size[i] = 0.35 + this.rng.next() * 0.3;
      this.life[i] = this.maxLife[i] = 0.5 + this.rng.next() * 0.4;
      this.drag[i] = 3;
      this.grav[i] = 0;
    }
  }

  update(dt: number): void {
    this.updateWaves(dt);
    const N = this.N;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) {
        if (this.col[i * 4 + 3] !== 0) this.col[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] -= dt;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.col[i * 4] = this.base[i * 3];
      this.col[i * 4 + 1] = this.base[i * 3 + 1];
      this.col[i * 4 + 2] = this.base[i * 3 + 2];
      this.col[i * 4 + 3] = t;
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aCol as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.wLife.fill(0);
    this.waves.count = 0;
    this.life.fill(0);
    this.col.fill(0);
  }
}
