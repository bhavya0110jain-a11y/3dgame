import * as THREE from 'three';

/**
 * Shared stylized-PBR helpers ("moonlit storybook"). Each helper patches a built-in lit material through
 * onBeforeCompile, CHAINING any patch already installed (so they compose with WorldShading, enemy FX, the
 * bearer's soft-light patch, ...), and extends customProgramCacheKey so variants compile once and are shared.
 *
 *   applyRim(mat, color?, strength?, power?)      fresnel rim light (characters pop against the night)
 *   applyToonRamp(mat, softness?, wrap?)          soft two-tone diffuse ramp on direct lights (painterly bands)
 *   applyStylized(mat, opts)                      both, one call
 *   rimUniforms.uRimTint                           global rim tint, set per night by Renderer.applyBiome
 *
 * Costs: a handful of ALU ops per fragment; no textures, no extra passes. Safe for InstancedMesh.
 */

/** Global rim tint multiplied into every applyRim() material (moonlight colour of the current night). */
export const rimUniforms = {
  uRimTint: { value: new THREE.Color(1, 1, 1) },
};

type Patchable = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial | THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;
type CompileFn = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

function chain(mat: THREE.Material, key: string, patch: CompileFn): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  // The default key is the onBeforeCompile source text; capture it now, before we wrap the function, or every
  // chained material would report the wrapper's (identical) source and unrelated patches would share programs.
  const baseKey = prevKey === THREE.Material.prototype.customProgramCacheKey ? prev.toString() : null;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    patch(shader, renderer);
  };
  mat.customProgramCacheKey = () => `${baseKey ?? prevKey.call(mat)}|${key}`;
  mat.needsUpdate = true;
}

/**
 * Fresnel rim light, added as emissive so it survives the darkest Gloom: pow(1 - N·V, power) * color * strength,
 * biased towards upward-facing normals (reads as moonlight catching the top edge of the silhouette).
 * Returns the material for chaining. color / strength / power are per-material uniforms (all rim materials share
 * one program per base material type), adjustable later with setRim().
 */
export function applyRim<T extends Patchable>(mat: T, color: THREE.ColorRepresentation = 0x9fb8ff, strength = 0.6, power = 2.6): T {
  const c = new THREE.Color(color);
  const uColor = { value: c };
  const uStrength = { value: strength };
  const uPower = { value: power };
  mat.userData.rim = { color: uColor, strength: uStrength, power: uPower };
  chain(mat, `rim`, (sh) => {
    sh.uniforms.uRimColor = uColor;
    sh.uniforms.uRimStrength = uStrength;
    sh.uniforms.uRimPower = uPower;
    sh.uniforms.uRimTint = rimUniforms.uRimTint;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;\nuniform vec3 uRimTint;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 rimV = normalize(vViewPosition);
          float rimF = pow(1.0 - saturate(dot(normal, rimV)), uRimPower);
          // world-up in view space: favour silhouettes' top edges (moon from above)
          vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float rimUp = 0.55 + 0.45 * saturate(dot(normal, upV) + 0.35);
          totalEmissiveRadiance += uRimColor * uRimTint * (rimF * rimUp * uRimStrength);
        }`,
      );
  });
  return mat;
}

/** Updates a rim installed by applyRim (cheap: uniforms only). */
export function setRim(mat: THREE.Material, color?: THREE.ColorRepresentation, strength?: number): void {
  const r = mat.userData.rim as { color: { value: THREE.Color }; strength: { value: number } } | undefined;
  if (!r) return;
  if (color !== undefined) r.color.value.set(color);
  if (strength !== undefined) r.strength.value = strength;
}

/**
 * Soft toon ramp on direct lights (moon + lantern) for MeshStandard/Physical: N·L is remapped through a wrapped
 * smoothstep so forms resolve into a lit side and a shadow side with a soft painted terminator instead of a
 * long photographic falloff. Ambient/hemisphere light and shadows are untouched (shadow maps still darken).
 *  softness: width of the terminator band (0.05 hard cel .. 0.5 nearly PBR)
 *  wrap:     how far light wraps past the terminator (0 none .. 0.5 very soft "subsurface-ish")
 */
export function applyToonRamp<T extends THREE.MeshStandardMaterial>(mat: T, softness = 0.22, wrap = 0.18): T {
  const lo = (0.5 - wrap * 0.5 - softness * 0.5).toFixed(3);
  const hi = (0.5 - wrap * 0.5 + softness * 0.5).toFixed(3);
  chain(mat, `toon${lo}_${hi}`, (sh) => {
    const chunk = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
      `float dotNL = smoothstep( ${lo}, ${hi}, dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );`,
    );
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', chunk);
  });
  return mat;
}

export interface StylizedOptions {
  rimColor?: THREE.ColorRepresentation;
  rimStrength?: number;
  rimPower?: number;
  /** Set false to keep plain PBR diffuse. Default true. */
  toon?: boolean;
  toonSoftness?: number;
  toonWrap?: number;
}

/** Rim + toon ramp in one call (the standard character treatment). */
export function applyStylized<T extends THREE.MeshStandardMaterial>(mat: T, opts: StylizedOptions = {}): T {
  if (opts.toon !== false) applyToonRamp(mat, opts.toonSoftness, opts.toonWrap);
  applyRim(mat, opts.rimColor, opts.rimStrength, opts.rimPower);
  return mat;
}

/** Applies applyStylized to every lit standard material under `root` (each material once). */
export function stylizeObject(root: THREE.Object3D, opts: StylizedOptions = {}): void {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (seen.has(mat) || mat.userData.rim) continue;
      seen.add(mat);
      if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) applyStylized(mat as THREE.MeshStandardMaterial, opts);
    }
  });
}
