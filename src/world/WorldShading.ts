import * as THREE from 'three';
import { rimUniforms } from '../render/materials';
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
    vec3 cool = mix(vec3(lum), col, 0.4) * vec3(0.44, 0.47, 0.88);
    col = mix(col, cool, g);
    // the Gloom itself: a violet haze that thickens away from the light, with brighter wisps at its edge
    float wisp = wNoise(wp.xz * 0.35 + vec2(uTime * 0.11, uTime * 0.07)) * wNoise(wp.xz * 0.9 - uTime * 0.08);
    float edge = gf * (1.0 - smoothstep(uLightR * 1.1, uLightR * 2.2 + 5.0, d));
    col += uGloom * (g * 0.07 + edge * wisp * 0.22 * uGloomStrength) * scale;
    // warm lantern pool: amber light on green moss/grass multiplies out to yellow-lime, so inside the pool
    // part of each colour is re-expressed as gold-amber of the same brightness (green → olive-gold, reds glow)
    float inside = 1.0 - smoothstep(uLightR * 0.15, uLightR * 0.95, d);
    float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 sat = max(vec3(0.0), mix(vec3(l2), col, 1.12));
    vec3 amber = vec3(l2) * vec3(1.78, 0.8, 0.3);
    float greenish = saturate((col.g - max(col.r, col.b)) * 2.0 / max(l2, 1e-3));
    float reddish = saturate((col.r - 2.6 * col.g) / max(col.r, 1e-3) * 1.6) * (1.0 - greenish);
    vec3 warm = mix(sat, amber, 0.5 + 0.4 * max(greenish, reddish)) * vec3(1.03, 0.97, 0.88);
    col = mix(col, warm, inside * scale);
    return col;
  }
  float ditherIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  /** 4×4 ordered Bayer threshold in [0, 15/16] for integer cell coordinates. */
  float bayer2x2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float bayer4x4(vec2 a) { return bayer2x2(a * 0.5) * 0.25 + bayer2x2(a); }
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
  /**
   * Moonlit rim strength (lit materials only): a cool fresnel edge, favouring top edges, that grows OUTSIDE the
   * lantern pool, so tree crowns / stones keep a readable silhouette against the dark field instead of reading
   * as murky blobs. Tinted by the night's moon colour (rimUniforms.uRimTint). 0 = off.
   */
  rim?: number;
  /**
   * Soft-knee compression of DIRECT light above ~0.3 (lit materials only): a rock or crown a metre from the lantern
   * otherwise blows out to cream (art review s3: over-bright props next to the bearer). Moonlit values are untouched.
   * 0 = off; ~1 = strong.
   */
  soften?: number;
}

const SOFTEN_FRAGMENT = /* glsl */ `
  {
    vec3 dd = reflectedLight.directDiffuse;
    float dm = max(dd.r, max(dd.g, dd.b));
    float k = 1.0 + max(dm - 0.3, 0.0) * WORLD_SOFTEN;
    reflectedLight.directDiffuse = dd / k;
    reflectedLight.directSpecular /= k;
  }
`;

const RIM_FRAGMENT = /* glsl */ `
  {
    vec3 rimV = normalize(vViewPosition);
    float rimF = pow(1.0 - saturate(dot(normal, rimV)), 2.2);
    vec3 rimUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float rimUp = 0.35 + 0.65 * saturate(dot(normal, rimUpV) + 0.25);
    float rimOut = 0.45 + 0.75 * gloomFactor(vGWorld);
    outgoingLight += uRimTint * (rimF * rimUp * rimOut * WORLD_RIM);
  }
`;

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

/**
 * Occlusion cut-away for tall props (crowns, pillars, walls) between the camera and the bearer. A capsule around
 * the camera→bearer segment is cleared with a 4×4 ordered Bayer halftone at a 2-px cell: inside 2.8 m (scaled with
 * the camera distance, so zooming out widens it) every fragment is discarded, and the 2.8–5.5 m band ramps out as a
 * clean halftone instead of static. Low crowns fade too (height gate 0.4–1.2 m); the near-camera end and the
 * bearer's own feet are spared (t gate) so the ground-level silhouette of a trunk next to her stays.
 */
const DITHER_FRAGMENT = /* glsl */ `
  {
    vec3 a = uPlayer + vec3(0.0, 1.0, 0.0);
    vec3 ab = cameraPosition - a;
    float abl2 = dot(ab, ab);
    float t = clamp(dot(vGWorld - a, ab) / abl2, 0.0, 1.0);
    float dist = length(vGWorld - (a + ab * t));
    // 23.5 m = camera→focus distance at zoom 1 (CameraRig HEIGHT/BACK); menu close-ups shrink the capsule
    float occS = clamp(sqrt(abl2) / 23.5, 0.35, 1.6);
    float fade = (1.0 - smoothstep(2.8 * occS, 5.5 * occS, dist)) * smoothstep(0.015, 0.06, t) * smoothstep(0.4, 1.2, vGWorld.y);
    if (fade > bayer4x4(floor(gl_FragCoord.xy * 0.5)) + 0.03125) discard;
  }
`;

/** Injects world-position varying, Gloom, optional wind sway and occlusion dither into a built-in material. */
export function patchWorldMaterial<T extends THREE.Material>(mat: T, opts: WorldPatchOptions = {}): T {
  const wind = opts.wind ?? 0;
  const gloom = opts.gloom ?? 1;
  const dither = !!opts.dither;
  const rim = opts.rim ?? 0;
  const soften = opts.soften ?? 0;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, worldUniforms);
    if (rim > 0) shader.uniforms.uRimTint = rimUniforms.uRimTint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLOOM_PARS}\nvarying vec3 vGWorld;`)
      .replace(
        '#include <project_vertex>',
        (wind > 0
          ? `#define WIND_AMP ${wind.toFixed(3)}\n#define WIND_START ${(opts.windStart ?? 0.3).toFixed(3)}\n${WIND_VERTEX}`
          : '') + `#include <project_vertex>\n${WORLD_POS_VERTEX}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${GLOOM_PARS}\nvarying vec3 vGWorld;` +
          (rim > 0 ? `\nuniform vec3 uRimTint;\n#define WORLD_RIM ${rim.toFixed(3)}` : ''),
      )
      .replace(
        '#include <lights_fragment_end>',
        soften > 0 ? `#include <lights_fragment_end>\n#define WORLD_SOFTEN ${soften.toFixed(3)}\n${SOFTEN_FRAGMENT}` : '#include <lights_fragment_end>',
      )
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${dither ? DITHER_FRAGMENT : ''}`)
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight = applyGloom(outgoingLight, vGWorld, ${gloom.toFixed(3)});\n${rim > 0 ? RIM_FRAGMENT : ''}#include <opaque_fragment>`,
      );
  };
  const key = `world:${wind}:${gloom}:${dither}:${rim}:${soften}`;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + key;
  return mat;
}
