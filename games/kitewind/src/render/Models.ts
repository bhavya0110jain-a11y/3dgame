import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makePaletteMaterial, makeWaterfallMaterial, patchRim } from './materials';

/**
 * Art pipeline entry point. `public/models/manifest.json` maps model ids to GLB files:
 *
 *   { "models": { "island_0": "island_0.glb", "kite_swallow": "kite_swallow.glb", ... } }
 *
 * Every id has a procedural fallback, so a missing manifest, id or file (or a failed load) is never an error.
 * Conventions for GLBs (Blender: +Y up, export glTF with +Y up — the default):
 *   island_0..island_5  radius 1 (top surface at y = 0, rock hanging down to y = -depth from src/world/islandShapes.ts)
 *   spire               base radius 1 at y = 0, tip at y = 1 (scaled non-uniformly to radius/height)
 *   arch                half-torus in the XY plane, radius 1, tube ≈ 0.14, legs at x = ±1, y = 0
 *   shrine              gate ring radius 1 facing +Z (scaled to the shrine radius)
 *   bird                ~1 m wingspan, flying toward +Z (static; the flock view flaps it with a vertex shader)
 *   kite_<id>           nose toward +Z, wingspan ~1.6 m, sail in the XZ plane, centre at the origin
 *   lantern             paper sky-lantern ~0.6 m tall, base at y = 0
 * Materials are used as authored (MeshStandardMaterial from glTF) unless their name is one of the contract names
 * written by tools/blender/build_models.py, which are swapped for the game's shared stylised materials:
 *   PAL        COLOR_0 = (shade / 1.25, palette slot / 7, 0) -> makePaletteMaterial (biome recolour + rim light)
 *   WATERFALL  COLOR_0 = (u, v, fall flag)                  -> makeWaterfallMaterial (animated)
 *   KPAPER     COLOR_0 = linear albedo                       -> lit paper with rim light + back-lit glow
 *   KGLOW/LGLOW COLOR_0 = linear colour / 2                  -> unlit HDR glow (blooms)
 */
export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export class Models {
  private parts = new Map<string, ModelPart[]>();
  readonly loaded: string[] = [];
  readonly failed: string[] = [];

  /** Loads the manifest and every listed GLB. Never throws. */
  async load(base: string): Promise<void> {
    let manifest: { models?: Record<string, string> } = {};
    try {
      const res = await fetch(`${base}models/manifest.json`, { cache: 'no-cache' });
      if (res.ok) manifest = await res.json();
    } catch {
      return;
    }
    const loader = new GLTFLoader();
    const entries = Object.entries(manifest.models ?? {});
    await Promise.all(
      entries.map(async ([id, file]) => {
        try {
          const gltf = await loader.loadAsync(`${base}models/${file}`);
          const parts: ModelPart[] = [];
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            const g = m.geometry.clone();
            g.applyMatrix4(m.matrixWorld);
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            parts.push(adaptPart(g, mats[0]));
          });
          if (parts.length) {
            this.parts.set(id, parts);
            this.loaded.push(id);
          }
        } catch (err) {
          this.failed.push(id);
          console.warn(`[models] ${id} (${file}) failed to load, using procedural fallback`, err);
        }
      }),
    );
  }

  /** Parts of a loaded model, or null (caller uses its procedural fallback). */
  get(id: string): ModelPart[] | null {
    return this.parts.get(id) ?? null;
  }

  /** Loaded parts or the fallback built by `make`. */
  getOr(id: string, make: () => ModelPart[]): ModelPart[] {
    return this.parts.get(id) ?? make();
  }
}

let palMat: THREE.MeshStandardMaterial | null = null;
let waterMat: THREE.ShaderMaterial | null = null;
let paperMat: THREE.MeshStandardMaterial | null = null;
const glowMats = new Map<string, THREE.MeshBasicMaterial>();

/** Rewrites COLOR_0 to a float attribute scaled by k (glTF normalized ushort colours are clamped to 0..1). */
function floatColors(g: THREE.BufferGeometry, k: number): THREE.BufferAttribute | null {
  const c = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!c) return null;
  const out = new Float32Array(c.count * 3);
  for (let i = 0; i < c.count; i++) {
    out[i * 3] = c.getX(i) * k;
    out[i * 3 + 1] = c.getY(i) * k;
    out[i * 3 + 2] = c.getZ(i) * k;
  }
  const a = new THREE.BufferAttribute(out, 3);
  g.setAttribute('color', a);
  return a;
}

/** Applies the material contract (see the header) to one loaded mesh part. */
function adaptPart(g: THREE.BufferGeometry, mat: THREE.Material): ModelPart {
  const name = (mat.name || '').replace(/\.\d+$/, '');
  if (name === 'PAL') {
    const c = floatColors(g, 1);
    if (c) {
      const part = new Float32Array(c.count);
      const arr = c.array as Float32Array;
      for (let i = 0; i < c.count; i++) {
        part[i] = Math.round(arr[i * 3 + 1] * 7);
        const s = arr[i * 3] * 1.25;
        arr[i * 3] = arr[i * 3 + 1] = arr[i * 3 + 2] = s;
      }
      g.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
    }
    if (!palMat) {
      palMat = makePaletteMaterial();
      palMat.side = THREE.DoubleSide;
    }
    return { geometry: g, material: palMat };
  }
  if (name === 'WATERFALL') {
    floatColors(g, 1);
    waterMat ??= makeWaterfallMaterial();
    return { geometry: g, material: waterMat };
  }
  if (name === 'KPAPER') {
    floatColors(g, 1);
    if (!paperMat) {
      paperMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.72, metalness: 0, flatShading: true });
      // paper: warm rim + light glowing through the sail
      patchRim(paperMat, 1.5, (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.16;',
        );
      });
    }
    return { geometry: g, material: paperMat };
  }
  if (name === 'KGLOW' || name === 'LGLOW') {
    floatColors(g, 2);
    let gm = glowMats.get(name);
    if (!gm) {
      gm = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color().setScalar(name === 'LGLOW' ? 2.2 : 2.6), side: THREE.DoubleSide });
      glowMats.set(name, gm);
    }
    return { geometry: g, material: gm };
  }
  return { geometry: g, material: mat };
}

/** One logical instanced model made of N sub-meshes that share instance matrices. */
export class InstancedModel {
  readonly meshes: THREE.InstancedMesh[];
  count = 0;

  constructor(parts: ModelPart[], readonly capacity: number, parent: THREE.Object3D) {
    this.meshes = parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, capacity);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      parent.add(m);
      return m;
    });
  }

  /** Writes instance i (ignored past capacity). */
  set(i: number, m: THREE.Matrix4): void {
    if (i >= this.capacity) return;
    for (const mesh of this.meshes) mesh.setMatrixAt(i, m);
  }

  setColor(i: number, c: THREE.Color): void {
    if (i >= this.capacity) return;
    for (const mesh of this.meshes) mesh.setColorAt(i, c);
  }

  /** Publishes `n` instances. */
  commit(n: number): void {
    this.count = Math.min(n, this.capacity);
    for (const mesh of this.meshes) {
      mesh.count = this.count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  set visible(v: boolean) {
    for (const mesh of this.meshes) mesh.visible = v;
  }
}
