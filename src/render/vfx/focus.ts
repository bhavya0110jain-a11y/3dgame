import * as THREE from 'three';

/**
 * Focus protection (art review s2 #3): every additive VFX layer dims near the bearer so she is never lost inside her
 * own light. One uniform object is shared by all VFX materials (three.js reads `.value` at draw time), so a single
 * write per frame (`setFocusPoint`) updates every layer.
 *
 *   uFocus.x, .y  player position (world x, z)
 *   uFocus.z      brightness kept right at the player (0.3)
 *   uFocus.w      unused
 *
 * Output multiplier = mix(uFocus.z, 1, smoothstep(FOCUS_INNER, FOCUS_OUTER, distance on the ground plane)).
 */
export const FOCUS_INNER = 1.2;
export const FOCUS_OUTER = 3.0;
export const FOCUS_MIN = 0.3;

export const FOCUS_UNIFORM = { value: new THREE.Vector4(1e9, 1e9, FOCUS_MIN, 0) };

/** GLSL: declares uFocus and `float focusK(vec2 worldXZ)`. */
export const FOCUS_GLSL = /* glsl */ `
  uniform vec4 uFocus;
  float focusK(vec2 wxz) {
    return mix(uFocus.z, 1.0, smoothstep(${FOCUS_INNER.toFixed(2)}, ${FOCUS_OUTER.toFixed(2)}, length(wxz - uFocus.xy)));
  }
`;

/** Moves the protected focus point (the bearer) for every VFX layer. */
export function setFocusPoint(x: number, z: number): void {
  FOCUS_UNIFORM.value.x = x;
  FOCUS_UNIFORM.value.y = z;
}

/** CPU mirror of the shader falloff (tests / CPU-side effects). */
export function focusFactor(dx: number, dz: number): number {
  const d = Math.hypot(dx, dz);
  const t = Math.min(1, Math.max(0, (d - FOCUS_INNER) / (FOCUS_OUTER - FOCUS_INNER)));
  return FOCUS_MIN + (1 - FOCUS_MIN) * t * t * (3 - 2 * t);
}
