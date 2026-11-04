import * as THREE from 'three';

/**
 * Uniforms shared by every stylised material (one object, referenced by all shaders): time, the blended
 * island palette, warm rim light, lightning flash. Environment colours are written in place each frame.
 */
export const shared = {
  uTime: { value: 0 },
  uPalette: { value: Array.from({ length: 8 }, () => new THREE.Color(1, 1, 1)) },
  uRim: { value: new THREE.Color(0xffc890) },
  uRimStrength: { value: 0.55 },
  uFlash: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 0.2, 1) },
};

/**
 * Adds a warm fresnel rim light (the "golden hour" edge glow) to a lit material.
 * Rim strength is scaled by `rim` per material.
 */
export function patchRim(mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial, rim = 1, extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = shared.uRim;
    shader.uniforms.uRimStrength = shared.uRimStrength;
    shader.uniforms.uFlash = shared.uFlash;
    shader.uniforms.uSunDirW = shared.uSunDir;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uRim;\nuniform float uRimStrength;\nuniform float uFlash;\nuniform vec3 uSunDirW;`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float rimF = pow(1.0 - ndv, 3.0);
          // brighter on the sun side of the silhouette
          vec3 sunV = normalize((viewMatrix * vec4(uSunDirW, 0.0)).xyz);
          float sunSide = 0.45 + 0.55 * clamp(dot(normal, sunV) * 0.5 + 0.6, 0.0, 1.0);
          totalEmissiveRadiance += uRim * rimF * uRimStrength * ${rim.toFixed(3)} * sunSide;
          totalEmissiveRadiance += diffuseColor.rgb * uFlash * 0.6;
        }`,
      );
    extra?.(shader);
  };
  mat.customProgramCacheKey = () => `rim${rim}${extra ? 'x' : ''}${mat.type}`;
}

/**
 * Flat-shaded palette material for procedural props (islands, spires, arches, houses):
 * geometry carries `aPart` (palette slot 0..7) and a per-vertex shade in `color`. Slot 7 (glow) is emissive.
 */
export function makePaletteMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0 });
  patchRim(mat, 1, (shader) => {
    shader.uniforms.uPalette = shared.uPalette;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nvarying float vPart;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = aPart;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uPalette[8];\nvarying float vPart;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        int part = int(vPart + 0.5);
        vec3 pal = uPalette[0];
        if (part == 1) pal = uPalette[1]; else if (part == 2) pal = uPalette[2]; else if (part == 3) pal = uPalette[3];
        else if (part == 4) pal = uPalette[4]; else if (part == 5) pal = uPalette[5]; else if (part == 6) pal = uPalette[6];
        else if (part == 7) pal = uPalette[7];
        diffuseColor.rgb *= pal;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (part == 7) totalEmissiveRadiance += uPalette[7] * 2.2;`,
      );
  });
  return mat;
}

const waterfallVert = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 color;
varying vec3 vFlow;
varying vec3 vWorld;
void main() {
  vFlow = color;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const waterfallFrag = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uRim;
uniform vec3 uWater;
varying vec3 vFlow;
varying vec3 vWorld;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float u = vFlow.x, v = vFlow.y, fall = vFlow.z;
  float across = 1.0 - pow(abs(u - 0.5) * 2.0, 3.0);
  // streaks scroll down the fall; slower ripples along the river
  float lane = floor(u * 9.0);
  float speed = mix(0.25, 1.6 + h1(lane) * 0.8, fall);
  float s = fract(v * mix(10.0, 7.0, fall) - uTime * speed + h1(lane) * 3.0);
  float streak = smoothstep(0.0, 0.25, s) * (1.0 - smoothstep(0.35, 1.0, s));
  vec3 deep = uWater * 0.55;
  vec3 foam = vec3(1.0, 0.98, 0.95);
  float foamK = mix(0.25, 0.55, fall) + streak * 0.45 + smoothstep(0.75, 1.0, v) * 0.5 * fall;
  vec3 col = mix(deep, foam * 0.85, clamp(foamK, 0.0, 1.0)) + uRim * 0.12 * fall;
  // falls thin out and dissolve into mist near the bottom
  float a = across * mix(0.85, 0.35 + streak * 0.35, fall) * (1.0 - smoothstep(0.55, 1.0, v) * fall);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * Animated stream + waterfall used by GLB islands (material "WATERFALL"): COLOR_0 = (u across, v along, fall flag).
 * Instancing-aware; scrolling foam streaks, fading into mist at the bottom; scene fog applies.
 */
export function makeWaterfallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: waterfallVert,
    fragmentShader: waterfallFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uWater: { value: new THREE.Color(0x8fd8f0) } }]), uTime: shared.uTime, uRim: shared.uRim },
  });
}
