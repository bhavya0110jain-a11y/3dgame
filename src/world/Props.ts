import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BiomeDef, BiomeProp, PropKind } from '../data/biomes';
import { getModel } from '../render/Assets';
import type { GroundMask } from './GroundMask';
import { patchWorldMaterial } from './WorldShading';

export const CHUNK = 24;
export const VIEW_CHUNKS = 2; // radius in chunks around the player
const GRID = 4; // collider grid cell (m)
const SPAWN_CLEAR_SOLID = 10.5; // menu glade / run start stays open
const SPAWN_CLEAR_DECOR = 2.5;

export interface Collider {
  x: number;
  z: number;
  r: number;
}

interface KindInfo {
  /** Collision circles in model space [x, z, r] (three.js axes). */
  solid?: [number, number, number][];
  wind?: number;
  windStart?: number;
  dither?: boolean;
  shadow?: boolean;
  /** Additive light pool on the ground: [local x, local z, radius, intensity, warm? 1 : 0]. */
  pool?: [number, number, number, number, number];
  /** Sink into the ground (m) so rounded bottoms do not float. */
  sink?: number;
}

const KIND_INFO: Record<PropKind, KindInfo> = {
  pine: { solid: [[0, 0, 0.5]], wind: 0.09, windStart: 1.0, dither: true, shadow: true },
  oak: { solid: [[0, 0, 0.55]], wind: 0.08, windStart: 1.8, dither: true, shadow: true },
  deadtree: { solid: [[0, 0, 0.38]], wind: 0.03, windStart: 1.5, dither: true, shadow: true },
  rock: { solid: [[0, 0, 0.85], [0.85, -0.35, 0.38]], shadow: true, sink: 0.05 },
  grave: { solid: [[0, 0, 0.42]], shadow: true },
  pillar: { solid: [[0, 0, 0.62]], dither: true, shadow: true },
  mushroom: { pool: [0, 0, 1.4, 0.2, 0], wind: 0.02, windStart: 0.1 },
  reed: { wind: 0.35, windStart: 0.1 },
  bush: { wind: 0.05, windStart: 0.2, shadow: true, sink: 0.05 },
  flower: { wind: 0.25, windStart: 0.05 },
  stump: { solid: [[0, 0, 0.5]], shadow: true, pool: [0.45, 0.1, 0.7, 0.12, 0] },
  log: { solid: [[-0.9, 0, 0.36], [0, 0, 0.36], [0.9, 0, 0.36]], shadow: true, sink: 0.04 },
  lantern_post: { solid: [[0, 0, 0.24]], dither: true, shadow: true, pool: [0.58, 0, 3.4, 0.6, 1] },
  ruin_wall: {
    solid: [[-1.45, 0, 0.32], [-0.95, 0, 0.32], [-0.45, 0, 0.32], [0.05, 0, 0.32], [0.55, 0, 0.32], [1.05, 0, 0.32], [1.5, 0, 0.3]],
    dither: true,
    shadow: true,
  },
  crystal: { solid: [[0, 0, 0.55]], shadow: true, pool: [0, 0, 2.4, 0.35, 0] },
  lily: { pool: [0, 0, 1.1, 0.1, 0] },
};

function hash2(x: number, z: number, s: number): number {
  let h = (x * 374761393 + z * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Procedural stand-ins used only when a GLB is missing. */
function fallbackGeometry(kind: PropKind, color: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (kind) {
    case 'pine':
      g = mergeGeometries([
        new THREE.CylinderGeometry(0.15, 0.22, 1.2, 8).translate(0, 0.6, 0),
        new THREE.ConeGeometry(1.3, 2.2, 10).translate(0, 2.0, 0),
        new THREE.ConeGeometry(0.9, 1.8, 10).translate(0, 3.1, 0),
      ].map((x) => x.toNonIndexed()));
      break;
    case 'oak':
    case 'bush':
      g = new THREE.IcosahedronGeometry(kind === 'oak' ? 1.6 : 0.6, 2).translate(0, kind === 'oak' ? 3 : 0.5, 0);
      break;
    case 'pillar':
    case 'lantern_post':
      g = new THREE.CylinderGeometry(0.35, 0.4, 2.6, 10).translate(0, 1.3, 0);
      break;
    case 'ruin_wall':
      g = new THREE.BoxGeometry(3.2, 1.6, 0.5).translate(0, 0.8, 0);
      break;
    case 'reed':
    case 'flower':
      g = new THREE.ConeGeometry(0.2, 1.0, 5).translate(0, 0.5, 0);
      break;
    default:
      g = new THREE.DodecahedronGeometry(0.6, 1).scale(1, 0.7, 1).translate(0, 0.35, 0);
  }
  g = g.index ? g.toNonIndexed() : g;
  g.computeVertexNormals();
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

interface PropSlot {
  def: BiomeProp;
  info: KindInfo;
  body: THREE.InstancedMesh;
  glow: THREE.InstancedMesh | null;
  count: number;
  tint: THREE.Color;
  glowColor: THREE.Color;
}

const poolVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vCol;
  void main() {
    vUv = uv * 2.0 - 1.0;
    vCol = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vCol = instanceColor;
    #endif
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const poolFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vCol;
  void main() {
    float r = length(vUv);
    float a = 1.0 - smoothstep(0.0, 1.0, r);
    a = a * a;
    gl_FragColor = vec4(vCol * a * (0.92 + 0.08 * sin(uTime * 2.3 + vCol.r * 10.0)), 1.0);
  }
`;

/** Instanced, chunk-streamed environment props + their collision circles. */
export class Props {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  private slots: PropSlot[] = [];
  private pools: THREE.InstancedMesh;
  private poolMat: THREE.ShaderMaterial;
  private poolCount = 0;
  private grid = new Map<number, number[]>();
  private gridFree: number[][] = [];
  private totalWeight = 1;
  // scratch (no allocations while placing)
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private mask: GroundMask) {
    this.poolMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: poolVertex,
      fragmentShader: poolFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const pg = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(pg, this.poolMat, 600);
    this.pools.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(600 * 3), 3);
    this.pools.count = 0;
    this.pools.frustumCulled = false;
    this.pools.renderOrder = 2;
    this.group.add(this.pools);
  }

  setBiome(biome: BiomeDef): void {
    for (const s of this.slots) {
      for (const mesh of [s.body, s.glow]) {
        if (!mesh) continue;
        this.group.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
      }
    }
    this.slots = [];
    this.totalWeight = biome.props.reduce((a, p) => a + p.weight, 0) || 1;
    const area = (VIEW_CHUNKS * 2 + 1) ** 2;
    for (const def of biome.props) {
      const info = KIND_INFO[def.kind];
      const cap = Math.ceil(area * biome.propDensity * (def.weight / this.totalWeight) * (1 + (def.cluster ?? 0)) * 1.3) + 8;
      const model = getModel(def.kind);
      const bodyGeo = model?.body ?? (model?.glow ? null : fallbackGeometry(def.kind, def.color));
      const bodyMat = patchWorldMaterial(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }),
        { wind: info.wind ?? 0, windStart: info.windStart, dither: info.dither },
      );
      const body = new THREE.InstancedMesh(bodyGeo ?? new THREE.BufferGeometry(), bodyMat, cap);
      body.castShadow = !!info.shadow;
      body.receiveShadow = true;
      let glow: THREE.InstancedMesh | null = null;
      if (model?.glow) {
        const glowMat = patchWorldMaterial(new THREE.MeshBasicMaterial({ vertexColors: true }), {
          wind: info.wind ?? 0,
          windStart: info.windStart,
          dither: info.dither,
          gloom: 0.2,
        });
        glow = new THREE.InstancedMesh(model.glow, glowMat, cap);
      }
      for (const mesh of [body, glow]) {
        if (!mesh) continue;
        mesh.count = 0;
        mesh.frustumCulled = false;
        // allocate instanceColor up front so the shader variant is stable
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
        this.group.add(mesh);
      }
      this.slots.push({
        def,
        info,
        body,
        glow,
        count: 0,
        tint: new THREE.Color(def.tint ?? 0xffffff),
        glowColor: new THREE.Color(def.glow ?? 0xffffff),
      });
    }
  }

  setTime(t: number): void {
    this.poolMat.uniforms.uTime.value = t;
  }

  rebuild(cx: number, cz: number, seed: number, waterLevel: number, density: number): void {
    for (const s of this.slots) s.count = 0;
    this.poolCount = 0;
    this.colliders.length = 0;
    for (const arr of this.grid.values()) {
      arr.length = 0;
      this.gridFree.push(arr);
    }
    this.grid.clear();
    if (!this.slots.length) return;
    for (let dx = -VIEW_CHUNKS; dx <= VIEW_CHUNKS; dx++) {
      for (let dz = -VIEW_CHUNKS; dz <= VIEW_CHUNKS; dz++) {
        const kx = cx + dx;
        const kz = cz + dz;
        for (let i = 0; i < density; i++) {
          const b = seed + i * 13;
          const x = (kx + hash2(kx, kz, b)) * CHUNK;
          const z = (kz + hash2(kx, kz, b + 1)) * CHUNK;
          let w = hash2(kx, kz, b + 2) * this.totalWeight;
          let idx = 0;
          for (; idx < this.slots.length - 1; idx++) {
            w -= this.slots[idx].def.weight;
            if (w <= 0) break;
          }
          const slot = this.slots[idx];
          const r4 = hash2(kx, kz, b + 3);
          const r5 = hash2(kx, kz, b + 4);
          if (!this.place(slot, x, z, r4, r5, waterLevel)) continue;
          const extra = slot.def.cluster ?? 0;
          for (let k = 0; k < extra; k++) {
            const a = hash2(kx, kz, b + 5 + k * 3) * Math.PI * 2;
            const d = 0.8 + hash2(kx, kz, b + 6 + k * 3) * 1.6;
            this.place(slot, x + Math.cos(a) * d, z + Math.sin(a) * d, hash2(kx, kz, b + 7 + k * 3), r5 * 0.7, waterLevel);
          }
        }
      }
    }
    for (const s of this.slots) {
      s.body.count = s.count;
      s.body.instanceMatrix.needsUpdate = true;
      if (s.body.instanceColor) s.body.instanceColor.needsUpdate = true;
      if (s.glow) {
        s.glow.count = s.count;
        s.glow.instanceMatrix.needsUpdate = true;
        if (s.glow.instanceColor) s.glow.instanceColor.needsUpdate = true;
      }
    }
    this.pools.count = this.poolCount;
    this.pools.instanceMatrix.needsUpdate = true;
    if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true;
  }

  private accepts(def: BiomeProp, info: KindInfo, x: number, z: number, waterLevel: number): boolean {
    const dist = Math.hypot(x, z);
    if (dist < (info.solid ? SPAWN_CLEAR_SOLID : SPAWN_CLEAR_DECOR)) return false;
    const mask = this.mask;
    const place = def.place ?? 'dry';
    const wet = waterLevel < 1 ? mask.wet(x, z) : 0;
    if (place === 'wet') return wet > waterLevel + 0.03;
    if (place === 'shore') return wet > waterLevel - 0.09 && wet < waterLevel + 0.005;
    if (wet > waterLevel - 0.03) return false;
    const path = mask.path(x, z);
    if (place === 'roadside') {
      if (path > 0.05) return false;
      // must be within ~1.5 m of a path: probe around
      return mask.path(x + 1.5, z) > 0.5 || mask.path(x - 1.5, z) > 0.5 || mask.path(x, z + 1.5) > 0.5 || mask.path(x, z - 1.5) > 0.5;
    }
    if (place === 'dry' && path > 0.25) return false;
    if (def.grove && mask.sample(x, z, 0) < 0.42) return false;
    return true;
  }

  private place(slot: PropSlot, x: number, z: number, r4: number, r5: number, waterLevel: number): boolean {
    if (slot.count >= slot.body.instanceMatrix.count) return false;
    const { def, info } = slot;
    if (!this.accepts(def, info, x, z, waterLevel)) return false;
    const [smin, smax] = def.scale ?? [0.8, 1.25];
    const sc = smin + (smax - smin) * r4;
    const yaw = r5 * Math.PI * 2;
    // keep solid props from overlapping each other
    if (info.solid) {
      let rad = 0;
      for (const c of info.solid) rad = Math.max(rad, Math.hypot(c[0], c[1]) + c[2]);
      if (this.overlaps(x, z, rad * sc * 0.8)) return false;
    }
    this.p.set(x, -(info.sink ?? 0) * sc, z);
    this.q.setFromAxisAngle(this.up, yaw);
    this.s.set(sc, sc * (0.9 + r5 * 0.2), sc);
    this.m.compose(this.p, this.q, this.s);
    const i = slot.count++;
    slot.body.setMatrixAt(i, this.m);
    const v = 0.88 + r4 * 0.24;
    this.c.copy(slot.tint).multiplyScalar(v);
    this.c.r *= 0.96 + r5 * 0.08;
    this.c.b *= 1.04 - r5 * 0.08;
    slot.body.setColorAt(i, this.c);
    if (slot.glow) {
      slot.glow.setMatrixAt(i, this.m);
      this.c.copy(slot.glowColor).multiplyScalar(0.85 + r5 * 0.3);
      slot.glow.setColorAt(i, this.c);
    }
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    if (info.solid) {
      for (const [lx, lz, lr] of info.solid) {
        const wx = x + (lx * cos + lz * sin) * sc;
        const wz = z + (-lx * sin + lz * cos) * sc;
        this.addCollider(wx, wz, lr * sc);
      }
    }
    if (info.pool && this.poolCount < this.pools.instanceMatrix.count) {
      const [lx, lz, pr, inten, warm] = info.pool;
      this.p.set(x + (lx * cos + lz * sin) * sc, 0.12, z + (-lx * sin + lz * cos) * sc);
      this.q.identity();
      this.s.set(pr * sc, 1, pr * sc);
      this.m.compose(this.p, this.q, this.s);
      this.pools.setMatrixAt(this.poolCount, this.m);
      if (warm) this.c.setHex(0xffa850);
      else this.c.copy(slot.glowColor);
      this.c.multiplyScalar(inten);
      this.pools.setColorAt(this.poolCount, this.c);
      this.poolCount++;
    }
    return true;
  }

  private key(gx: number, gz: number): number {
    return (gx + 32768) * 65536 + (gz + 32768);
  }

  private addCollider(x: number, z: number, r: number): void {
    const idx = this.colliders.length;
    this.colliders.push({ x, z, r });
    const k = this.key(Math.floor(x / GRID), Math.floor(z / GRID));
    let arr = this.grid.get(k);
    if (!arr) {
      arr = this.gridFree.pop() ?? [];
      this.grid.set(k, arr);
    }
    arr.push(idx);
  }

  private overlaps(x: number, z: number, r: number): boolean {
    const gx = Math.floor(x / GRID);
    const gz = Math.floor(z / GRID);
    for (let ix = gx - 1; ix <= gx + 1; ix++) {
      for (let iz = gz - 1; iz <= gz + 1; iz++) {
        const arr = this.grid.get(this.key(ix, iz));
        if (!arr) continue;
        for (const ci of arr) {
          const c = this.colliders[ci];
          const min = r + c.r;
          const dx = x - c.x;
          const dz = z - c.z;
          if (dx * dx + dz * dz < min * min) return true;
        }
      }
    }
    return false;
  }

  /** Pushes a circle out of solid props (in place). Grid lookup: O(1) per call. */
  resolveCollision(p: { x: number; z: number }, radius: number): void {
    const gx = Math.floor(p.x / GRID);
    const gz = Math.floor(p.z / GRID);
    for (let ix = gx - 1; ix <= gx + 1; ix++) {
      for (let iz = gz - 1; iz <= gz + 1; iz++) {
        const arr = this.grid.get(this.key(ix, iz));
        if (!arr) continue;
        for (let j = 0; j < arr.length; j++) {
          const c = this.colliders[arr[j]];
          const dx = p.x - c.x;
          const dz = p.z - c.z;
          const min = radius + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            p.x = c.x + (dx / d) * min;
            p.z = c.z + (dz / d) * min;
          }
        }
      }
    }
  }
}
