import * as THREE from 'three';

/**
 * Immediate-mode camera-facing ribbon renderer (one draw call): every frame the owners (lightning bolts, ribbon
 * trails, beams) rebuild their polylines into one dynamic vertex/index buffer. Cross-section profile is computed
 * in the fragment shader: a coloured gaussian glow with a white-hot core, so a 4-vertex-wide strip reads as a
 * glowing tube without any texture. Additive (bloom picks up the >1 core).
 */
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpSide = new THREE.Vector3();
const tmpCol = new THREE.Color();

export class Strips {
  private pos: Float32Array;
  private col: Float32Array;
  private prof: Float32Array; // side (-1..1), core strength
  private idx: Uint32Array;
  private geo = new THREE.BufferGeometry();
  private aPos: THREE.BufferAttribute;
  private aCol: THREE.BufferAttribute;
  private aProf: THREE.BufferAttribute;
  private aIdx: THREE.BufferAttribute;
  private nv = 0;
  private ni = 0;
  readonly camPos = new THREE.Vector3();

  constructor(scene: THREE.Scene, private maxVerts = 6000) {
    this.pos = new Float32Array(maxVerts * 3);
    this.col = new Float32Array(maxVerts * 4);
    this.prof = new Float32Array(maxVerts * 2);
    this.idx = new Uint32Array(maxVerts * 3);
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aProf = new THREE.BufferAttribute(this.prof, 2).setUsage(THREE.DynamicDrawUsage);
    this.aIdx = new THREE.BufferAttribute(this.idx, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('sCol', this.aCol);
    this.geo.setAttribute('sProf', this.aProf);
    this.geo.setIndex(this.aIdx);
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec4 sCol;
        attribute vec2 sProf;
        varying vec4 vCol;
        varying vec2 vProf;
        void main() {
          vCol = sCol;
          vProf = sProf;
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec4 vCol;
        varying vec2 vProf;
        void main() {
          float s = vProf.x;
          float glow = exp(-s * s * 3.0) * (1.0 - smoothstep(0.85, 1.0, abs(s)));
          float core = exp(-s * s * 28.0) * vProf.y;
          vec3 c = vCol.rgb * glow + vec3(1.0, 0.97, 0.92) * core * (0.6 + 0.4 * length(vCol.rgb));
          gl_FragColor = vec4(c * vCol.a, 0.0);
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
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 22;
    mesh.name = 'vfx-strips';
    scene.add(mesh);
  }

  begin(camera: THREE.Camera): void {
    this.nv = 0;
    this.ni = 0;
    camera.getWorldPosition(this.camPos);
  }

  /**
   * Append a polyline (xyz triples in `pts`, `n` points). Width and alpha are linearly interpolated head(0)→tail(n-1);
   * colour is sRGB hex × intensity. `core` (0..1) is the white-hot centre strength.
   */
  strip(pts: Float32Array, n: number, w0: number, w1: number, color: number, intensity: number, a0: number, a1: number, core: number): void {
    if (n < 2 || this.nv + n * 2 > this.maxVerts) return;
    tmpCol.setHex(color);
    const r = tmpCol.r * intensity, g = tmpCol.g * intensity, b = tmpCol.b * intensity;
    const base = this.nv;
    const P = this.pos, C = this.col, Q = this.prof;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1) * 3;
      const i1 = Math.min(n - 1, i + 1) * 3;
      tmpA.set(pts[i1] - pts[i0], pts[i1 + 1] - pts[i0 + 1], pts[i1 + 2] - pts[i0 + 2]);
      const px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2];
      tmpB.set(this.camPos.x - px, this.camPos.y - py, this.camPos.z - pz);
      tmpSide.crossVectors(tmpA, tmpB);
      const l = tmpSide.length();
      if (l > 1e-6) tmpSide.multiplyScalar(1 / l);
      else tmpSide.set(1, 0, 0);
      const t = i / (n - 1);
      const w = (w0 + (w1 - w0) * t) * 0.5;
      const a = a0 + (a1 - a0) * t;
      const v = this.nv;
      P[v * 3] = px + tmpSide.x * w; P[v * 3 + 1] = py + tmpSide.y * w; P[v * 3 + 2] = pz + tmpSide.z * w;
      P[v * 3 + 3] = px - tmpSide.x * w; P[v * 3 + 4] = py - tmpSide.y * w; P[v * 3 + 5] = pz - tmpSide.z * w;
      C[v * 4] = r; C[v * 4 + 1] = g; C[v * 4 + 2] = b; C[v * 4 + 3] = a;
      C[v * 4 + 4] = r; C[v * 4 + 5] = g; C[v * 4 + 6] = b; C[v * 4 + 7] = a;
      Q[v * 2] = 1; Q[v * 2 + 1] = core;
      Q[v * 2 + 2] = -1; Q[v * 2 + 3] = core;
      this.nv += 2;
    }
    const I = this.idx;
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      I[this.ni++] = a; I[this.ni++] = a + 1; I[this.ni++] = a + 2;
      I[this.ni++] = a + 1; I[this.ni++] = a + 3; I[this.ni++] = a + 2;
    }
  }

  end(): void {
    this.geo.setDrawRange(0, this.ni);
    if (this.nv > 0) {
      this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, this.nv * 3); this.aPos.needsUpdate = true;
      this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, this.nv * 4); this.aCol.needsUpdate = true;
      this.aProf.clearUpdateRanges(); this.aProf.addUpdateRange(0, this.nv * 2); this.aProf.needsUpdate = true;
      this.aIdx.clearUpdateRanges(); this.aIdx.addUpdateRange(0, this.ni); this.aIdx.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------------------------------------ lightning
const BOLT_PTS = 28;
interface Bolt {
  active: boolean;
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  segs: number;
  width: number;
  color: number;
  age: number;
  life: number;
  regen: number;
  jitter: number;
  pts: Float32Array;
}

/** Jagged, flickering lightning bolts (pooled). Re-jagged ~30×/s so they crackle while alive. */
export class Lightning {
  private bolts: Bolt[] = [];
  constructor(private capacity = 96) {
    for (let i = 0; i < capacity; i++) {
      this.bolts.push({ active: false, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, segs: 8, width: 0.3, color: 0xffffff, age: 0, life: 0.2, regen: 0, jitter: 0.5, pts: new Float32Array(BOLT_PTS * 3) });
    }
  }

  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color: number, width = 0.32, life = 0.22, jitter = -1): Bolt | null {
    let b: Bolt | null = null;
    for (const c of this.bolts) if (!c.active) { b = c; break; }
    if (!b) return null;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    b.active = true;
    b.ax = ax; b.ay = ay; b.az = az; b.bx = bx; b.by = by; b.bz = bz;
    b.segs = Math.max(3, Math.min(BOLT_PTS - 1, Math.round(len / 0.45)));
    b.width = width;
    b.color = color;
    b.age = 0;
    b.life = life;
    b.regen = 0;
    b.jitter = jitter < 0 ? Math.min(0.9, 0.12 + len * 0.09) : jitter;
    this.jag(b);
    return b;
  }

  private jag(b: Bolt): void {
    const n = b.segs;
    const dx = b.bx - b.ax, dy = b.by - b.ay, dz = b.bz - b.az;
    // perpendicular basis: horizontal side + up
    const hl = Math.hypot(dx, dz) || 1;
    const sx = -dz / hl, sz = dx / hl;
    let off = 0;
    let offY = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const env = Math.sin(t * Math.PI); // pinned at both ends
      off = off * 0.45 + (Math.random() - 0.5) * 2 * b.jitter;
      offY = offY * 0.45 + (Math.random() - 0.5) * b.jitter;
      const o = i * 3;
      b.pts[o] = b.ax + dx * t + sx * off * env;
      b.pts[o + 1] = b.ay + dy * t + offY * env;
      b.pts[o + 2] = b.az + dz * t + sz * off * env;
    }
  }

  clear(): void {
    for (const b of this.bolts) b.active = false;
  }

  update(dt: number, strips: Strips): void {
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.age += dt;
      if (b.age >= b.life) { b.active = false; continue; }
      b.regen -= dt;
      if (b.regen <= 0) { b.regen = 0.035; this.jag(b); }
      const t = b.age / b.life;
      const flick = 0.55 + 0.45 * Math.random();
      const a = (1 - t * t) * flick;
      // wide colour glow + thin hot core in one strip
      strips.strip(b.pts, b.segs + 1, b.width * 2.2, b.width * 1.8, b.color, 0.9, a, a, 0.9);
    }
  }
}

// ------------------------------------------------------------------------------------------------ ribbon trails
const TRAIL_PTS = 22;
interface Trail {
  used: boolean;
  releasing: boolean;
  n: number;
  head: number;
  color: number;
  width: number;
  intensity: number;
  hist: Float32Array; // ring buffer
  out: Float32Array; // ordered head→tail for rendering
}

/** Pooled world-space ribbon trails (cinder halo orbs etc.). Owners push a point per frame; released trails shrink away. */
export class Ribbons {
  private trails: Trail[] = [];
  constructor(capacity = 32) {
    for (let i = 0; i < capacity; i++) {
      this.trails.push({ used: false, releasing: false, n: 0, head: 0, color: 0xffffff, width: 0.3, intensity: 1, hist: new Float32Array(TRAIL_PTS * 3), out: new Float32Array(TRAIL_PTS * 3) });
    }
  }

  alloc(color: number, width: number, intensity = 1.5): number {
    for (let i = 0; i < this.trails.length; i++) {
      const t = this.trails[i];
      if (!t.used) {
        t.used = true; t.releasing = false; t.n = 0; t.head = 0;
        t.color = color; t.width = width; t.intensity = intensity;
        return i;
      }
    }
    return -1;
  }

  push(id: number, x: number, y: number, z: number): void {
    const t = this.trails[id];
    if (!t || !t.used || t.releasing) return;
    t.head = (t.head + 1) % TRAIL_PTS;
    t.hist[t.head * 3] = x; t.hist[t.head * 3 + 1] = y; t.hist[t.head * 3 + 2] = z;
    if (t.n < TRAIL_PTS) t.n++;
  }

  /** Teleport: forget history (e.g. orb respawned). */
  reset(id: number): void {
    const t = this.trails[id];
    if (t) t.n = 0;
  }

  release(id: number): void {
    const t = this.trails[id];
    if (t && t.used) t.releasing = true;
  }

  clear(): void {
    for (const t of this.trails) { t.used = false; t.n = 0; }
  }

  update(_dt: number, strips: Strips): void {
    for (const t of this.trails) {
      if (!t.used) continue;
      if (t.releasing) {
        t.n -= 2;
        if (t.n <= 1) { t.used = false; continue; }
      }
      if (t.n < 2) continue;
      for (let i = 0; i < t.n; i++) {
        const k = ((t.head - i + TRAIL_PTS) % TRAIL_PTS) * 3;
        t.out[i * 3] = t.hist[k]; t.out[i * 3 + 1] = t.hist[k + 1]; t.out[i * 3 + 2] = t.hist[k + 2];
      }
      strips.strip(t.out, t.n, t.width, t.width * 0.15, t.color, t.intensity, 1, 0, 0.55);
    }
  }
}
