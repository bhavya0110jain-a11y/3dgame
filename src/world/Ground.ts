import * as THREE from 'three';
import type { BiomeDef } from '../data/biomes';
import { patchWorldMaterial } from './WorldShading';

/**
 * Endless lit ground: MeshStandardMaterial (receives the moon shadows + lantern light) whose albedo,
 * roughness, normal and emissive are generated per pixel from the shared ground mask + noise.
 *  mode 0 forest: moss / grass patches, winding dirt paths with pebbles, needle litter.
 *  mode 1 marsh : mossy mud, shallow reflective pools with ripples, moon glints, glowing algae.
 *  mode 2 ruins : violet ash, flagstone plazas + cobbled roads, cracks with faint ember glow.
 */
const GROUND_PARS = /* glsl */ `
  uniform vec3 uGBase; uniform vec3 uGPatch; uniform vec3 uGDark; uniform vec3 uGPath;
  uniform vec3 uGFeature; uniform vec3 uGAccent; uniform float uGMode; uniform float uWaterLevel;
  vec2 tileCell(vec2 p, float size, out vec2 f) {
    float row = floor(p.y / size);
    vec2 q = vec2(p.x / size + row * 0.5, p.y / size);
    vec2 c = floor(q);
    f = fract(q);
    return c;
  }
`;

const GROUND_COLOR = /* glsl */ `
  vec2 gp = vGWorld.xz;
  vec4 gm = groundMask(gp);
  float n1 = wNoise(gp * 0.7);
  float n2 = wNoise(gp * 2.3);
  float n3 = wNoise(gp * 7.0);
  float gWater = 0.0;
  vec3 gEmit = vec3(0.0);
  vec3 gNrm = vec3(0.0);
  float gRough = 0.92;
  float gPatchN = gm.r + (n1 - 0.5) * 0.25;
  vec3 gcol = mix(uGDark, uGBase, smoothstep(0.18, 0.5, gPatchN));
  gcol = mix(gcol, uGPatch, smoothstep(0.58, 0.9, gPatchN + (n2 - 0.5) * 0.2));
  gcol *= 0.86 + 0.22 * gm.a + 0.1 * (n3 - 0.5);
  float pathRaw = 1.0 - smoothstep(0.02, 0.06, abs(gm.g - 0.5) + (n2 - 0.5) * 0.025);
  if (uGMode < 0.5) {
    // ---------------- forest
    float litter = smoothstep(0.62, 0.78, gm.a + (n2 - 0.5) * 0.3) * (1.0 - smoothstep(0.4, 0.7, gPatchN));
    gcol = mix(gcol, uGAccent, litter * 0.45);
    vec3 pathCol = uGPath * (0.85 + 0.35 * n2) * (0.9 + 0.2 * n3);
    vec2 pc = floor(gp * 2.6);
    vec2 po = fract(gp * 2.6) - 0.5 - (vec2(wHash(pc + 1.7), wHash(pc + 8.3)) - 0.5) * 0.5;
    float pebble = step(0.6, wHash(pc)) * (1.0 - smoothstep(0.1, 0.17, length(po)));
    pathCol = mix(pathCol, uGPath * 1.35 + 0.03, pebble * 0.7);
    gcol = mix(gcol, gcol * 0.7, smoothstep(0.05, 0.3, pathRaw) * (1.0 - smoothstep(0.3, 0.6, pathRaw)));
    gcol = mix(gcol, pathCol, smoothstep(0.35, 0.7, pathRaw));
    // flowery clearing tint in the spawn glade
    float glade = 1.0 - smoothstep(4.0, 11.0, length(gp));
    gcol = mix(gcol, uGFeature, glade * 0.35 * (0.6 + 0.4 * n2));
  } else if (uGMode < 1.5) {
    // ---------------- marsh
    float wet = wetness(gm, gp) + (n2 - 0.5) * 0.04 + (n3 - 0.5) * 0.015;
    float shore = smoothstep(uWaterLevel - 0.1, uWaterLevel - 0.005, wet);
    gWater = smoothstep(uWaterLevel - 0.004, uWaterLevel + 0.012, wet);
    gcol = mix(gcol, uGPath * (0.8 + 0.3 * n2), smoothstep(0.3, 0.75, pathRaw));
    gcol = mix(gcol, gcol * 0.55 + uGDark * 0.25, shore);
    float depth = smoothstep(uWaterLevel, uWaterLevel + 0.12, wet);
    vec3 water = mix(uGAccent * 0.75, uGFeature, depth);
    // ripples
    vec2 rp = gp * 1.6 + vec2(uTime * 0.35, uTime * 0.21);
    float e = 0.08;
    float r0 = wNoise(rp) + 0.5 * wNoise(rp * 2.7 - uTime * 0.4);
    float rx = wNoise(rp + vec2(e, 0.0)) + 0.5 * wNoise((rp + vec2(e, 0.0)) * 2.7 - uTime * 0.4);
    float rz = wNoise(rp + vec2(0.0, e)) + 0.5 * wNoise((rp + vec2(0.0, e)) * 2.7 - uTime * 0.4);
    gNrm = vec3(r0 - rx, 0.0, r0 - rz) * 2.2 * gWater;
    gcol = mix(gcol, water, gWater);
    gRough = mix(gRough, 0.12, gWater);
    // fake sky reflection + moon glints + bioluminescent algae at the pool edges
    float glint = pow(wNoise(gp * 3.0 + vec2(uTime * 0.5, -uTime * 0.3)) * wNoise(gp * 4.3 - uTime * 0.4), 12.0);
    gEmit += gWater * (uGAccent * (0.04 + 0.05 * (1.0 - depth)) + vec3(0.55, 0.8, 1.0) * glint * 0.22);
    vec2 ac = floor(gp * 1.6);
    vec2 ao = fract(gp * 1.6) - 0.5 - (vec2(wHash(ac + 2.3), wHash(ac + 6.1)) - 0.5) * 0.6;
    float algae = step(0.82, wHash(ac)) * (1.0 - smoothstep(0.02, 0.1, length(ao)))
                * smoothstep(0.3, 1.0, shore) * (1.0 - gWater * 0.7);
    gEmit += algae * uGAccent * (0.5 + 0.3 * sin(uTime * 2.0 + wHash(ac) * 30.0));
  } else {
    // ---------------- ruins
    float plaza = smoothstep(0.63, 0.69, gm.b + (1.0 - smoothstep(7.0, 16.0, length(gp))) * 0.5 + (n1 - 0.5) * 0.06);
    float road = smoothstep(0.3, 0.7, pathRaw);
    float ash = smoothstep(0.55, 0.85, gm.a + (n1 - 0.5) * 0.4);
    gcol = mix(gcol, mix(uGBase, vec3(0.62, 0.6, 0.66), 0.35), ash * 0.4);
    float stoneMask = max(plaza, road);
    if (stoneMask > 0.001) {
      vec2 f;
      float size = mix(1.45, 0.65, road * (1.0 - plaza));
      vec2 c = tileCell(gp + vec2(0.0, (wNoise(gp * 0.4) - 0.5) * 0.5), size, f);
      float h = wHash(c);
      // irregular stones: wobble each edge, round the corners
      vec2 q = abs(f - 0.5) * 2.0;
      float rq = pow(pow(q.x, 6.0) + pow(q.y, 6.0), 1.0 / 6.0);
      float edge = (1.0 - rq) * 0.5 + (n3 - 0.5) * 0.035 + (h - 0.5) * 0.02;
      float mortar = 1.0 - smoothstep(0.03, 0.075, edge);
      float bevel = smoothstep(0.03, 0.16, edge);
      vec3 stone = uGFeature * (0.6 + 0.35 * h) * (0.88 + 0.22 * n2) * (0.82 + 0.18 * bevel);
      stone *= 1.0 + 0.12 * (f.y - 0.5) * (1.0 - bevel);
      // broken / missing tiles let the ash through
      float missing = step(0.86, h) * (1.0 - plaza * 0.5);
      // crack lines across some tiles
      float crack = (1.0 - smoothstep(0.0, 0.025, abs(wNoise(gp * 2.2 + h * 10.0) - 0.5))) * step(0.62, h) * bevel;
      vec3 joint = mix(uGDark * 0.6, vec3(0.16, 0.24, 0.2), step(0.5, n2) * 0.6);
      vec3 tile = mix(stone, joint, max(mortar, crack * 0.8));
      tile = mix(tile, gcol, missing);
      gcol = mix(gcol, tile, stoneMask);
      // ember glow in a few cracks / joints, breathing slowly
      float ember = crack * step(0.86, h) * stoneMask * (1.0 - missing);
      gEmit += uGAccent * ember * (0.35 + 0.25 * sin(uTime * 1.7 + h * 20.0));
      gNrm = vec3(f.x - 0.5, 0.0, f.y - 0.5) * mortar * 0.6 * stoneMask;
      gRough = mix(gRough, 0.75, stoneMask);
    }
    // a few soft smouldering cinders in the ash
    vec2 cc = floor(gp * 1.3);
    vec2 co = fract(gp * 1.3) - 0.5 - (vec2(wHash(cc + 3.1), wHash(cc + 5.7)) - 0.5) * 0.6;
    float cinder = step(0.9, wHash(cc)) * (1.0 - smoothstep(0.03, 0.09, length(co))) * (1.0 - stoneMask);
    gEmit += uGAccent * cinder * (0.5 + 0.4 * sin(uTime * 2.0 + wHash(cc) * 40.0));
    gcol = mix(gcol, uGDark * 0.6, (1.0 - smoothstep(0.05, 0.16, length(co))) * step(0.9, wHash(cc)) * (1.0 - stoneMask));
  }
  diffuseColor.rgb = gcol;
`;

export class Ground {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  private uniforms = {
    uGBase: { value: new THREE.Color() },
    uGPatch: { value: new THREE.Color() },
    uGDark: { value: new THREE.Color() },
    uGPath: { value: new THREE.Color() },
    uGFeature: { value: new THREE.Color() },
    uGAccent: { value: new THREE.Color() },
    uGMode: { value: 0 },
    uWaterLevel: { value: 1 },
  };

  constructor() {
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GROUND_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${GROUND_COLOR}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
        .replace(
          '#include <normal_fragment_maps>',
          '#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(gNrm, 0.0)).xyz);',
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;');
    };
    this.material.customProgramCacheKey = () => 'll-ground';
    patchWorldMaterial(this.material, { gloom: 1 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.receiveShadow = true;
  }

  setBiome(b: BiomeDef): void {
    const u = this.uniforms;
    const g = b.ground;
    u.uGBase.value.setHex(g.base);
    u.uGPatch.value.setHex(g.patch);
    u.uGDark.value.setHex(g.dark);
    u.uGPath.value.setHex(g.path);
    u.uGFeature.value.setHex(g.feature);
    u.uGAccent.value.setHex(g.accent);
    u.uGMode.value = g.mode;
    u.uWaterLevel.value = g.waterLevel;
  }
}
