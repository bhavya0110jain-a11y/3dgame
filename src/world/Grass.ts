import * as THREE from 'three';
import type { BiomeDef } from '../data/biomes';
import { patchWorldMaterial } from './WorldShading';

/**
 * Infinite wind-swept grass + bioluminescent field flowers around the player.
 * One draw call each: blades live in a GRASS_S x GRASS_S torus that the vertex shader wraps around the
 * player, so nothing is ever rebuilt on the CPU. Density follows the shared ground mask (no grass on
 * paths, in water or on flagstones), blades part around the lantern-bearer and fade out at the patch edge.
 */
const GRASS_S = 56;
const BLADES = 36000;
const FLOWERS = 1400;

const FIELD_PARS = /* glsl */ `
  attribute vec4 aBlade;
  uniform float uGrassH;
  uniform float uDensity;
  uniform float uGMode;
  uniform float uWaterLevel;
  uniform vec3 uFlowerA; uniform vec3 uFlowerB; uniform vec3 uFlowerC;
  varying float vGrassT;
  varying vec3 vGrassCol;
  varying float vGrassPatch;
  varying float vHead;
`;

function fieldVertex(flower: boolean): string {
  return /* glsl */ `
  vec2 rel = mod(aBlade.xy - uPlayer.xz + ${(GRASS_S / 2).toFixed(1)}, ${GRASS_S.toFixed(1)}) - ${(GRASS_S / 2).toFixed(1)};
  vec2 root = uPlayer.xz + rel;
  vec4 gm = groundMask(root);
  float r1 = aBlade.z;
  float r2 = aBlade.w;
  // clumps: mid-frequency noise makes tufts, meadows and thin patches instead of a uniform carpet
  float clump = wNoise(root * 0.45 + 17.0) * 0.65 + wNoise(root * 1.7) * 0.35;
  float h = uGrassH * (0.45 + 0.9 * r1 * r1) * (0.55 + 0.7 * gm.r) * (0.35 + 0.95 * smoothstep(0.25, 0.7, clump));
  h *= step(fract(r2 * 7.31), uDensity);
  float pth = pathMask(gm);
  h *= 1.0 - smoothstep(0.15, 0.7, pth) * 0.9;
  h *= 1.0 - smoothstep(uWaterLevel - 0.06, uWaterLevel - 0.01, wetness(gm, root));
  if (uGMode > 1.5) {
    float plaza = smoothstep(0.5, 0.58, gm.b + (1.0 - smoothstep(7.0, 16.0, length(root))) * 0.5);
    h *= 1.0 - plaza * 0.85;
  }
  float edge = max(abs(rel.x), abs(rel.y)) / ${(GRASS_S / 2).toFixed(1)};
  h *= 1.0 - smoothstep(0.78, 1.0, edge);
  vec2 toP = root - uPlayer.xz;
  float dp = length(toP);
  float push = 1.0 - smoothstep(0.35, 1.9, dp);
  float ang = r2 * 81.68;
  vec2 face = vec2(cos(ang), sin(ang));
  vec2 side = vec2(-face.y, face.x);
  float t = position.y;
  float bendAmt = t * t;
  float w = sin(uTime * 1.5 + root.x * 0.3 + root.y * 0.22) * 0.55
          + sin(uTime * 2.9 + root.x * 0.9 - root.y * 0.7) * 0.18
          + (wNoise(root * 0.06 + vec2(uTime * 0.22, uTime * 0.1)) - 0.35) * 0.9;
  vec2 bend = face * (0.3 + 0.4 * r1) * h + uWind * w * h * 0.55 + (toP / max(dp, 1e-3)) * push * h * 1.1;
  ${flower
    ? `float width = (position.z > 0.5 ? 0.06 + 0.035 * r1 : 0.025) * step(0.001, h);
       float hh = h * (position.z > 0.5 ? 1.0 : t);
       vec3 gpos = vec3(root.x + side.x * position.x * width + face.x * position.y * width * position.z,
                        position.z > 0.5 ? h + position.y * 0.012 : hh * (1.0 - push * 0.3),
                        root.y + side.y * position.x * width + face.y * position.y * width * position.z);
       float bt = position.z > 0.5 ? 1.0 : t;
       gpos.xz += bend * bt * bt;
       float pick = fract(r1 * 17.3);
       vec3 fc = pick < 0.34 ? uFlowerA : (pick < 0.67 ? uFlowerB : uFlowerC);
       vHead = position.z;
       vGrassCol = position.z > 0.5 ? fc : vec3(1.0);
       vGrassT = bt;`
    : `float width = 0.11 * (0.7 + 0.6 * r1) * step(0.001, h);
       vec3 gpos = vec3(root.x + side.x * position.x * width, t * h * (1.0 - push * 0.3), root.y + side.y * position.x * width);
       gpos.xz += bend * bendAmt;
       vGrassCol = vec3(0.8 + 0.4 * fract(r1 * 13.7)) * (0.85 + 0.3 * clump);
       vHead = 0.0;
       vGrassT = t;`}
  vGrassPatch = gm.r * 0.6 + clump * 0.4 + (fract(r2 * 3.7) - 0.5) * 0.3;
  objectNormal = normalize(vec3(face.x * 0.3, 1.0, face.y * 0.3));
`;
}

const FIELD_COLOR = /* glsl */ `
  vec3 gTipC = mix(uGrassTip, uGrassTip2, smoothstep(0.35, 0.8, vGrassPatch));
  vec3 bladeC = mix(uGrassRoot, gTipC, smoothstep(0.0, 1.0, vGrassT));
  diffuseColor.rgb = mix(bladeC * vGrassCol.r, vGrassCol, step(0.5, vHead));
`;

function bladeGeometry(): THREE.BufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const pos = [-0.5, 0, 0, 0.5, 0, 0, -0.34, 0.5, 0, 0.34, 0.5, 0, 0, 1, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 4]);
  return g;
}

/** Thin stem (z=0) + 5-point star head (z=1; x/y = head-plane coordinates). */
function flowerGeometry(): THREE.BufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const pos: number[] = [-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0];
  const idx: number[] = [0, 1, 2];
  const c = pos.length / 3;
  pos.push(0, 0, 1);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 0.45;
    pos.push(Math.cos(a) * r, Math.sin(a) * r, 1);
  }
  for (let i = 0; i < 10; i++) idx.push(c, c + 1 + i, c + 1 + ((i + 1) % 10));
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

function seedAttribute(g: THREE.InstancedBufferGeometry, count: number, seed: number): void {
  const a = new Float32Array(count * 4);
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // jittered grid → even coverage without clumps
  const n = Math.ceil(Math.sqrt(count));
  const cell = GRASS_S / n;
  for (let i = 0; i < count; i++) {
    const gx = i % n;
    const gz = Math.floor(i / n);
    a[i * 4] = (gx + rnd()) * cell;
    a[i * 4 + 1] = (gz + rnd()) * cell;
    a[i * 4 + 2] = rnd();
    a[i * 4 + 3] = rnd();
  }
  g.setAttribute('aBlade', new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = count;
}

export class Grass {
  readonly group = new THREE.Group();
  private uniforms = {
    uGrassH: { value: 0.55 },
    uDensity: { value: 1 },
    uGMode: { value: 0 },
    uWaterLevel: { value: 1 },
    uGrassRoot: { value: new THREE.Color() },
    uGrassTip: { value: new THREE.Color() },
    uGrassTip2: { value: new THREE.Color() },
    uFlowerA: { value: new THREE.Color() },
    uFlowerB: { value: new THREE.Color() },
    uFlowerC: { value: new THREE.Color() },
  };
  private flowerUniforms = { ...this.uniforms, uGrassH: { value: 0.4 }, uDensity: { value: 1 } };

  constructor() {
    const blades = new THREE.Mesh(bladeGeometry(), this.makeMaterial(false));
    seedAttribute(blades.geometry as THREE.InstancedBufferGeometry, BLADES, 1234);
    const flowers = new THREE.Mesh(flowerGeometry(), this.makeMaterial(true));
    seedAttribute(flowers.geometry as THREE.InstancedBufferGeometry, FLOWERS, 98765);
    for (const m of [blades, flowers]) {
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = false;
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }
  }

  private makeMaterial(flower: boolean): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    const uni = flower ? this.flowerUniforms : this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uni);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FIELD_PARS}`)
        .replace('#include <beginnormal_vertex>', `vec3 objectNormal;\n${fieldVertex(flower)}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = gpos;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform vec3 uGrassRoot; uniform vec3 uGrassTip; uniform vec3 uGrassTip2;\nvarying float vGrassT; varying vec3 vGrassCol; varying float vGrassPatch; varying float vHead;',
        )
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FIELD_COLOR}`)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           totalEmissiveRadiance += vHead > 0.5 ? vGrassCol * 0.28 : uGrassTip * vGrassT * vGrassT * 0.03;`,
        );
    };
    mat.customProgramCacheKey = () => (flower ? 'll-flowers' : 'll-grass');
    return patchWorldMaterial(mat, { gloom: flower ? 0.45 : 1 });
  }

  setBiome(b: BiomeDef): void {
    const g = b.grass;
    const u = this.uniforms;
    u.uGrassH.value = g.height;
    u.uDensity.value = g.density;
    u.uGMode.value = b.ground.mode;
    u.uWaterLevel.value = b.ground.waterLevel;
    u.uGrassRoot.value.setHex(g.root);
    u.uGrassTip.value.setHex(g.tip);
    u.uGrassTip2.value.setHex(g.tip).lerp(new THREE.Color(0xfff0a0), 0.35);
    u.uFlowerA.value.setHex(g.flowers[0] ?? 0xffffff);
    u.uFlowerB.value.setHex(g.flowers[1] ?? g.flowers[0] ?? 0xffffff);
    u.uFlowerC.value.setHex(g.flowers[2] ?? g.flowers[0] ?? 0xffffff);
    this.flowerUniforms.uGrassH.value = g.height * 0.85;
    this.flowerUniforms.uDensity.value = g.flowerDensity;
  }
}
