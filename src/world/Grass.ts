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
const WHITE = new THREE.Color(1, 1, 1);

const FIELD_PARS = /* glsl */ `
  attribute vec4 aBlade;
  uniform float uGrassH;
  uniform float uBladeW;
  uniform float uDensity;
  uniform float uGMode;
  uniform float uWaterLevel;
  uniform vec3 uFlowerA; uniform vec3 uFlowerB; uniform vec3 uFlowerC;
  uniform vec3 uGBase; uniform vec3 uGPatch; uniform vec3 uGDark; uniform vec3 uGFeature;
  varying vec3 vGroundCol;
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
    : `float width = 0.11 * uBladeW * (0.7 + 0.6 * r1) * step(0.001, h);
       vec3 gpos = vec3(root.x + side.x * position.x * width, t * h * (1.0 - push * 0.3), root.y + side.y * position.x * width);
       gpos.xz += bend * bendAmt;
       vGrassCol = vec3(0.8 + 0.4 * fract(r1 * 13.7)) * (0.85 + 0.3 * clump);
       vHead = 0.0;
       vGrassT = t;`}
  vGrassPatch = gm.r * 0.6 + clump * 0.4 + (fract(r2 * 3.7) - 0.5) * 0.3;
  // the ground colour under this blade (same recipe as Ground.ts GROUND_COLOR): blade roots melt into the ground,
  // so the top-down camera sees soft fur instead of a dark stroke per blade ("TV static", art review s2 #11)
  {
    float gpn = gm.r + (wNoise(root * 0.7) - 0.5) * 0.25;
    vec3 gc = mix(uGDark, uGBase, smoothstep(0.18, 0.5, gpn));
    gc = mix(gc, uGPatch, smoothstep(0.58, 0.9, gpn + (wNoise(root * 2.3) - 0.5) * 0.2));
    gc *= 0.86 + 0.22 * gm.a;
    if (uGMode < 0.5) gc = mix(gc, uGFeature, (1.0 - smoothstep(4.0, 11.0, length(root))) * 0.3);
    vGroundCol = gc;
  }
  objectNormal = normalize(vec3(face.x * 0.3, 1.0, face.y * 0.3));
`;
}

const FIELD_COLOR = /* glsl */ `
  vec3 gTipC = mix(uGrassTip, uGrassTip2, smoothstep(0.35, 0.8, vGrassPatch));
  // root = ground colour; tip ~25-30% lighter, leaning towards the night's tip tone
  vec3 gTip = mix(vGroundCol * 1.28, gTipC, 0.35);
  vec3 bladeC = mix(vGroundCol, gTip, smoothstep(0.0, 1.0, vGrassT)) * mix(1.0, vGrassCol.r, vGrassT);
  diffuseColor.rgb = mix(bladeC, vGrassCol, step(0.5, vHead));
`;

/**
 * Menu close-up (art review s2 #11): blades right in front of the lens are lit hard by the lantern and pushed to
 * gold by the pool shading, so they read as flat straw triangles competing with the CTA. After all shading, the
 * lower 60% of those blades is darkened (x0.55) and the rest is cooled towards a dimmer moon-sheen of the same
 * luminance. Gameplay never gets this close (camera ~21 m away), so only the menu shot changes.
 */
const NEAR_LENS = /* glsl */ `
  {
    float gNear = 1.0 - smoothstep(3.0, 8.5, length(vGWorld - cameraPosition));
    if (gNear > 0.0 && vHead < 0.5) {
      float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 sheen = lum * vec3(0.62, 0.78, 1.05);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, sheen, gNear * 0.55);
      gl_FragColor.rgb *= 1.0 - gNear * (0.25 + 0.45 * (1.0 - smoothstep(0.35, 0.65, vGrassT)));
    }
  }
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
  // cells in a shuffled order, so any prefix (lower quality tiers draw fewer instances) still covers the patch
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  for (let i = 0; i < count; i++) {
    const c = order[i];
    const gx = c % n;
    const gz = Math.floor(c / n);
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
    uBladeW: { value: 1 },
    uDensity: { value: 1 },
    uGMode: { value: 0 },
    uWaterLevel: { value: 1 },
    uGrassRoot: { value: new THREE.Color() },
    uGrassTip: { value: new THREE.Color() },
    uGrassTip2: { value: new THREE.Color() },
    uFlowerA: { value: new THREE.Color() },
    uFlowerB: { value: new THREE.Color() },
    uFlowerC: { value: new THREE.Color() },
    uGBase: { value: new THREE.Color() },
    uGPatch: { value: new THREE.Color() },
    uGDark: { value: new THREE.Color() },
    uGFeature: { value: new THREE.Color() },
  };
  private flowerUniforms = { ...this.uniforms, uGrassH: { value: 0.4 }, uDensity: { value: 1 } };
  private blades: THREE.Mesh;
  private tmpColor = new THREE.Color();
  private flowers: THREE.Mesh;

  constructor() {
    const blades = new THREE.Mesh(bladeGeometry(), this.makeMaterial(false));
    seedAttribute(blades.geometry as THREE.InstancedBufferGeometry, BLADES, 1234);
    const flowers = new THREE.Mesh(flowerGeometry(), this.makeMaterial(true));
    seedAttribute(flowers.geometry as THREE.InstancedBufferGeometry, FLOWERS, 98765);
    this.blades = blades;
    this.flowers = flowers;
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
          '#include <common>\nuniform vec3 uGrassRoot; uniform vec3 uGrassTip; uniform vec3 uGrassTip2;\nvarying vec3 vGroundCol; varying float vGrassT; varying vec3 vGrassCol; varying float vGrassPatch; varying float vHead;',
        )
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FIELD_COLOR}`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${NEAR_LENS}`)
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

  /**
   * Quality scaling: draw only the first `frac` of the (shuffled) blade / flower budget. Blades get wider by
   * 1/sqrt(frac) (capped) so the meadow keeps its coverage and silhouette with fewer triangles.
   */
  setQuality(frac: number): void {
    const f = Math.min(1, Math.max(0.2, frac));
    (this.blades.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.round(BLADES * f);
    (this.flowers.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.round(FLOWERS * Math.sqrt(f));
    this.uniforms.uBladeW.value = Math.min(1.6, 1 / Math.sqrt(f));
  }

  setBiome(b: BiomeDef): void {
    const g = b.grass;
    const u = this.uniforms;
    u.uGrassH.value = g.height;
    u.uDensity.value = g.density;
    u.uGMode.value = b.ground.mode;
    u.uWaterLevel.value = b.ground.waterLevel;
    u.uGrassRoot.value.setHex(g.root);
    u.uGBase.value.setHex(b.ground.base);
    u.uGPatch.value.setHex(b.ground.patch);
    u.uGDark.value.setHex(b.ground.dark);
    u.uGFeature.value.setHex(b.ground.feature);
    u.uGrassTip.value.setHex(g.tip);
    // second tip tone: a pale moonlit sheen (keeps tips brighter than the ground); a yellow lerp here read as lime
    // under the amber lantern. Warmth comes from the lantern alone (light-is-life).
    u.uGrassTip2.value.setHex(g.tip).lerp(this.tmpColor.setHex(b.sky.moonGlow).lerp(WHITE, 0.6), 0.38);
    u.uFlowerA.value.setHex(g.flowers[0] ?? 0xffffff);
    u.uFlowerB.value.setHex(g.flowers[1] ?? g.flowers[0] ?? 0xffffff);
    u.uFlowerC.value.setHex(g.flowers[2] ?? g.flowers[0] ?? 0xffffff);
    this.flowerUniforms.uGrassH.value = g.height * 0.85;
    this.flowerUniforms.uDensity.value = g.flowerDensity;
  }
}
