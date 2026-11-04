import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { shared } from '../render/materials';
import type { Environment } from './Environment';

/** Smooth value noise for the atlas (CPU, build time only). */
function vnoise(rng: Rng, n: number): (x: number, y: number) => number {
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (a: number, b: number): number => g[((b % n) + n) % n * n + (((a % n) + n) % n)];
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/**
 * Builds a 2x2 atlas of soft cumulus clusters. R = density (alpha), G = up-facing light (normal.y + height),
 * B = sideways normal (0.5 = facing the camera). The shader lights them from the sun's screen-space side.
 */
function puffAtlas(size = 128): THREE.DataTexture {
  const W = size * 2;
  const data = new Uint8Array(W * W * 4);
  const rng = new Rng(31337);
  const nz = vnoise(rng, 64);
  const fbm = (x: number, y: number): number => nz(x, y) * 0.55 + nz(x * 2.1 + 7, y * 2.1 + 3) * 0.28 + nz(x * 4.3 + 1, y * 4.3 + 9) * 0.17;
  const field = new Float32Array(size * size);
  for (let cell = 0; cell < 4; cell++) {
    const blobs: [number, number, number][] = [];
    const n = 6 + cell * 2;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const hump = Math.sin(t * Math.PI);
      const x = 0.2 + t * 0.6 + rng.range(-0.04, 0.04);
      const r = 0.1 + hump * rng.range(0.07, 0.13);
      blobs.push([x, 0.3 + r * 0.8 + hump * rng.range(0.0, 0.1), r]);
    }
    for (let i = 0; i < 2 + cell; i++) blobs.push([rng.range(0.32, 0.68), rng.range(0.45, 0.62), rng.range(0.11, 0.17)]);
    for (let py = 0; py < size; py++)
      for (let px = 0; px < size; px++) {
        const u = (px + 0.5) / size, v = (py + 0.5) / size;
        let d = 0;
        for (const [x, y, r] of blobs) {
          const q = Math.hypot(u - x, (v - y) * 1.05) / r;
          if (q < 1.25) d = Math.max(d, 1 - q * q * 0.64);
        }
        // soft, slightly flattened base and noisy eroded edges
        const base = Math.min(1, Math.max(0, (v - 0.2) / 0.16));
        d = d * (0.55 + 0.45 * base) + (fbm(u * 9 + cell * 5, v * 9) - 0.5) * 0.42;
        field[py * size + px] = Math.max(0, d);
      }
    const ox = (cell % 2) * size, oy = Math.floor(cell / 2) * size;
    const F = (x: number, y: number): number => field[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))];
    for (let py = 0; py < size; py++)
      for (let px = 0; px < size; px++) {
        const f = F(px, py);
        const a = Math.min(1, Math.max(0, (f - 0.12) / 0.3));
        // pseudo normal from the density "height"
        const gx = (F(px + 2, py) - F(px - 2, py)) * 2.2;
        const gy = (F(px, py + 2) - F(px, py - 2)) * 2.2;
        const nx = -gx, ny = -gy, nzz = 0.35;
        const L = Math.hypot(nx, ny, nzz);
        const up = Math.min(1, Math.max(0, (ny / L) * 0.5 + 0.5)) * 0.65 + Math.min(1, (py / size) * 0.9) * 0.35;
        const i = ((oy + py) * W + ox + px) * 4;
        data[i] = Math.round(a * 255);
        data[i + 1] = Math.round(up * 255);
        data[i + 2] = Math.round(Math.min(1, Math.max(0, (nx / L) * 0.5 + 0.5)) * 255);
        data[i + 3] = 255;
      }
  }
  const tex = new THREE.DataTexture(data, W, W, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

let atlas: THREE.DataTexture | null = null;

const vert = /* glsl */ `
attribute vec4 aPuff; // variant, shade, darkness (thunderclouds), fog multiplier
varying vec2 vUv;
varying vec4 vPuff;
varying float vDist;
varying float vSize;
varying vec3 vView;
varying float vSunX;
uniform vec3 uSunDir;
void main() {
  vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float size = length(instanceMatrix[0].xyz);
  // face the camera but keep world-up as "up" (no flat cut-outs seen from above, no roll with the screen)
  vec3 toCam = normalize(cameraPosition - centre);
  vec3 up = normalize(vec3(0.0, 1.0, 0.0) - toCam * toCam.y);
  vec3 right = normalize(cross(up, toCam));
  vec3 wp = centre + (right * position.x * 1.6 + up * position.y) * size;
  vSunX = dot(uSunDir, -right);
  float v = aPuff.x;
  vUv = (uv + vec2(mod(v, 2.0), floor(v / 2.0))) * 0.5;
  vPuff = aPuff;
  vSize = size;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vDist = -mv.z;
  vView = normalize(wp - cameraPosition);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uLit, uShade, uSun, uSunDir, uFog;
uniform float uFogNear, uFogFar, uOpacity, uFlash, uTime;
varying vec2 vUv;
varying vec4 vPuff;
varying float vDist;
varying float vSize;
varying vec3 vView;
varying float vSunX;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.r;
  if (a < 0.01) discard;
  float side = (t.b * 2.0 - 1.0) * clamp(vSunX * 1.6, -1.0, 1.0);
  float light = clamp(t.g * 0.8 + side * 0.45 + 0.08, 0.0, 1.0) * (0.88 + vPuff.y * 0.24);
  vec3 lit = mix(uLit, uSun * 1.1, 0.25);
  vec3 col = mix(uShade * 1.15, lit, smoothstep(0.05, 0.95, light));
  // soft translucency toward the sun (thin parts glow warm), no hard outline
  float back = pow(max(dot(vView, uSunDir), 0.0), 6.0);
  col += uSun * back * (1.0 - a) * 0.35;
  // thunderclouds: dark with inner flashes
  float dark = vPuff.z;
  float fl = dark * step(0.82, fract(sin(floor(uTime * 9.0) * 12.9898 + vPuff.y * 78.233) * 43758.5453)) * 1.4;
  col = mix(col, uShade * 0.35, dark * 0.8) + vec3(0.75, 0.8, 1.0) * fl * (1.0 - a * 0.5);
  col += uFlash * 0.35;
  float f = smoothstep(uFogNear, uFogFar, vDist) * vPuff.w;
  col = mix(col, uFog, f);
  float nearFade = smoothstep(vSize * 0.25, vSize * 1.1, vDist);
  gl_FragColor = vec4(col, a * uOpacity * nearFade * (1.0 - f * 0.55));
  #include <colorspace_fragment>
}`;

/**
 * Instanced billboard cumulus puffs (one draw call). Puffs are written by the owner via setPuff() then commit().
 * Used for chunk clouds and horizon banks (WorldView) and for thunderclouds (HazardsView).
 */
export class CloudLayer {
  readonly mesh: THREE.InstancedMesh;
  private attr: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  readonly mat: THREE.ShaderMaterial;

  constructor(parent: THREE.Object3D, readonly capacity: number) {
    atlas ??= puffAtlas();
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.2, 0);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPuff', this.attr);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uAtlas: { value: atlas },
        uLit: { value: new THREE.Color() },
        uShade: { value: new THREE.Color() },
        uSun: { value: new THREE.Color() },
        uSunDir: shared.uSunDir,
        uFog: { value: new THREE.Color() },
        uFogNear: { value: 60 },
        uFogFar: { value: 500 },
        uOpacity: { value: 0.9 },
        uFlash: shared.uFlash,
        uTime: shared.uTime,
      },
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    parent.add(this.mesh);
  }

  /** Writes puff i: world position, size (m), atlas variant 0..3, shade 0..1, darkness 0..1, fog multiplier. */
  setPuff(i: number, x: number, y: number, z: number, size: number, variant: number, shade: number, dark = 0, fogMul = 1): void {
    if (i >= this.capacity) return;
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(size, size, size));
    this.mesh.setMatrixAt(i, this.m);
    const a = this.attr.array as Float32Array;
    a[i * 4] = variant;
    a[i * 4 + 1] = shade;
    a[i * 4 + 2] = dark;
    a[i * 4 + 3] = fogMul;
  }

  commit(n: number): void {
    this.mesh.count = Math.min(n, this.capacity);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.needsUpdate = true;
  }

  updateEnv(env: Environment): void {
    const u = this.mat.uniforms;
    u.uLit.value.copy(env.cloudLit);
    u.uShade.value.copy(env.cloudShade);
    u.uSun.value.copy(env.sun);
    u.uFog.value.copy(env.fog);
    u.uFogNear.value = env.fogNear;
    u.uFogFar.value = env.fogFar;
    u.uOpacity.value = env.cloudOpacity;
  }
}
