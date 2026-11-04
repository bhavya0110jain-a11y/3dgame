import * as THREE from 'three';
import { MASK_GLSL } from './GroundMask';

/**
 * Shared uniforms + shader patches for every world material (ground, grass, props).
 *
 * "Light vs Gloom": inside the lantern radius colours stay warm & saturated; beyond it a violet Gloom
 * creeps in (desaturate + cool + violet haze, with animated wispy edges). The world stays readable —
 * the Gloom recolours, it never blacks out. Uniform values are driven by World.setLight().
 *
 * Other systems may opt in with `patchWorldMaterial(mat)` (e.g. to make enemies sink into the Gloom too).
 */
export const worldUniforms = {
  uPlayer: { value: new THREE.Vector3() },
  uLightR: { value: 10 },
  uTime: { value: 0 },
  uGloom: { value: new THREE.Color(0x4a2a9a) },
  uGloomStrength: { value: 0.6 },
  uMask: { value: null as THREE.Texture | null },
  uWind: { value: new THREE.Vector2(0.8, 0.45) },
};

export const GLOOM_PARS = /* glsl */ `
  uniform vec3 uPlayer;
  uniform float uLightR;
  uniform float uTime;
  uniform vec3 uGloom;
  uniform float uGloomStrength;
  uniform sampler2D uMask;
  uniform vec2 uWind;
  float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float wNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  ${MASK_GLSL}
  /** 0 inside the lantern pool .. 1 deep in the Gloom (wispy animated edge). */
  float gloomFactor(vec3 wp) {
    float d = length(wp.xz - uPlayer.xz);
    float wob = (wNoise(wp.xz * 0.16 + vec2(uTime * 0.07, -uTime * 0.05)) - 0.5) * 3.2
              + (wNoise(wp.xz * 0.55 - vec2(uTime * 0.13, uTime * 0.09)) - 0.5) * 1.2;
    return smoothstep(uLightR * 0.8, uLightR * 1.45 + 4.0, d + wob);
  }
  vec3 applyGloom(vec3 col, vec3 wp, float scale) {
    float d = length(wp.xz - uPlayer.xz);
    float gf = gloomFactor(wp);
    float g = gf * uGloomStrength * scale;
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 cool = mix(vec3(lum), col, 0.45) * vec3(0.5, 0.52, 0.9);
    col = mix(col, cool, g);
    // the Gloom itself: a violet haze that thickens away from the light, with brighter wisps at its edge
    float wisp = wNoise(wp.xz * 0.35 + vec2(uTime * 0.11, uTime * 0.07)) * wNoise(wp.xz * 0.9 - uTime * 0.08);
    float edge = gf * (1.0 - smoothstep(uLightR * 1.1, uLightR * 2.2 + 5.0, d));
    col += uGloom * (g * 0.07 + edge * wisp * 0.22 * uGloomStrength) * scale;
    // warm, saturated lantern pool
    float inside = 1.0 - smoothstep(uLightR * 0.2, uLightR * 0.95, d);
    float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, max(vec3(0.0), mix(vec3(l2), col, 1.25)) * vec3(1.06, 1.0, 0.9), inside * scale);
    return col;
  }
  float ditherIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

export interface WorldPatchOptions {
  /** Wind sway amplitude (m at 4 m height); 0 = static. */
  wind?: number;
  /** Height (m) where sway starts. */
  windStart?: number;
  /** Dither out fragments that occlude the player from the camera (tall props). */
  dither?: boolean;
  /** Gloom influence (glow parts use a small value so bioluminescence still reads in the dark). */
  gloom?: number;
}

/** Vertex snippet: model-space sway for (instanced) props. Expects `transformed` and optional instanceMatrix. */
const WIND_VERTEX = /* glsl */ `
  {
    vec3 iOrg = vec3(0.0);
    #ifdef USE_INSTANCING
      iOrg = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #endif
    iOrg = (modelMatrix * vec4(iOrg, 1.0)).xyz;
    float hgt = max(0.0, transformed.y - WIND_START);
    float ph = iOrg.x * 0.21 + iOrg.z * 0.17;
    float gust = 0.6 + 0.4 * sin(uTime * 0.35 + iOrg.x * 0.03);
    float sway = (sin(uTime * 1.3 + ph) * 0.7 + sin(uTime * 2.7 + ph * 1.7) * 0.3) * gust;
    vec3 wOff = vec3(uWind.x, 0.0, uWind.y) * sway * WIND_AMP * hgt * hgt * 0.0625;
    #ifdef USE_INSTANCING
      mat3 im = mat3(instanceMatrix);
      wOff = (transpose(im) * wOff) / max(1e-4, dot(im[0], im[0]));
    #endif
    transformed += wOff;
  }
`;

const WORLD_POS_VERTEX = /* glsl */ `
  {
    vec4 gwp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      gwp = instanceMatrix * gwp;
    #endif
    vGWorld = (modelMatrix * gwp).xyz;
  }
`;

const DITHER_FRAGMENT = /* glsl */ `
  {
    vec3 a = uPlayer + vec3(0.0, 1.0, 0.0);
    vec3 ab = cameraPosition - a;
    float t = clamp(dot(vGWorld - a, ab) / dot(ab, ab), 0.0, 1.0);
    float dist = length(vGWorld - (a + ab * t));
    float fade = (1.0 - smoothstep(1.6, 3.4, dist)) * smoothstep(0.02, 0.08, t) * smoothstep(0.7, 1.6, vGWorld.y);
    if (fade * 0.8 > ditherIGN(gl_FragCoord.xy)) discard;
  }
`;

/** Injects world-position varying, Gloom, optional wind sway and occlusion dither into a built-in material. */
export function patchWorldMaterial<T extends THREE.Material>(mat: T, opts: WorldPatchOptions = {}): T {
  const wind = opts.wind ?? 0;
  const gloom = opts.gloom ?? 1;
  const dither = !!opts.dither;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, worldUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLOOM_PARS}\nvarying vec3 vGWorld;`)
      .replace(
        '#include <project_vertex>',
        (wind > 0
          ? `#define WIND_AMP ${wind.toFixed(3)}\n#define WIND_START ${(opts.windStart ?? 0.3).toFixed(3)}\n${WIND_VERTEX}`
          : '') + `#include <project_vertex>\n${WORLD_POS_VERTEX}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLOOM_PARS}\nvarying vec3 vGWorld;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${dither ? DITHER_FRAGMENT : ''}`)
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight = applyGloom(outgoingLight, vGWorld, ${gloom.toFixed(3)});\n#include <opaque_fragment>`,
      );
  };
  const key = `world:${wind}:${gloom}:${dither}`;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + key;
  return mat;
}
