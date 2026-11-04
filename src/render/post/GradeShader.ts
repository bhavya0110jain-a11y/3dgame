import * as THREE from 'three';

/**
 * Display-referred "moonlit storybook" grade + lens pass. Runs AFTER OutputPass (tone mapping + sRGB), so all
 * values are 0..1 sRGB and the controls behave like a colourist's wheels:
 *  - lift / gamma / gain (ASC-CDL style) + a gentle S-curve contrast
 *  - saturation (luma-preserving) with a little vibrance so already-saturated glows don't clip
 *  - split tone: cool blue/violet shadows, warm amber highlights (luminance preserving)
 *  - radial chromatic aberration (subtle, edges only)
 *  - vignette that falls off into a tinted night colour instead of black
 *  - damage pulse (red rim) and fine animated film grain (also dithers away banding in the dark gradients)
 */
export const GradeShader = {
  name: 'LLGradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uLift: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
    uGamma: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    uGain: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    uContrast: { value: 0.12 },
    uSaturation: { value: 1.12 },
    uVibrance: { value: 0.18 },
    uShadowTint: { value: new THREE.Vector3(0.75, 0.85, 1.4) },
    uHighlightTint: { value: new THREE.Vector3(1.2, 1.0, 0.8) },
    uSplit: { value: 0.4 },
    uVignette: { value: 0.42 },
    uVignetteColor: { value: new THREE.Vector3(0.03, 0.02, 0.08) },
    uDamage: { value: 0 },
    uCA: { value: 0.0011 },
    uGrain: { value: 0.022 },
    uTime: { value: 0 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uLift;
    uniform vec3 uGamma;
    uniform vec3 uGain;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uVibrance;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform float uSplit;
    uniform float uVignette;
    uniform vec3 uVignetteColor;
    uniform float uDamage;
    uniform float uCA;
    uniform float uGrain;
    uniform float uTime;
    uniform float uAspect;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

    void main() {
      vec2 d = vUv - 0.5;
      vec2 da = vec2(d.x * uAspect, d.y);
      float r2 = dot(da, da);

      // --- lens: radial chromatic aberration (zero at the centre, grows towards the corners)
      vec3 c;
      #if CA_ENABLED
        vec2 off = d * r2 * uCA * 4.0;
        c.r = texture2D(tDiffuse, vUv - off).r;
        c.g = texture2D(tDiffuse, vUv).g;
        c.b = texture2D(tDiffuse, vUv + off).b;
      #else
        c = texture2D(tDiffuse, vUv).rgb;
      #endif

      // --- lift / gamma / gain
      c = max(vec3(0.0), c * uGain + uLift * (1.0 - c));
      c = pow(c, 1.0 / max(uGamma, vec3(0.05)));

      // --- gentle S-curve contrast around mid-grey
      vec3 s = c * c * (3.0 - 2.0 * c);
      c = mix(c, s, uContrast);

      // --- saturation + vibrance (boost dull colours more than already-saturated ones)
      float l = luma(c);
      float mx = max(c.r, max(c.g, c.b));
      float mn = min(c.r, min(c.g, c.b));
      float sat = (mx - mn) / max(mx, 1e-4);
      float satAmt = uSaturation + uVibrance * (1.0 - sat);
      c = max(vec3(0.0), mix(vec3(l), c, satAmt));

      // --- split tone (luminance preserving): cool moonlit shadows, warm lantern highlights
      l = luma(c);
      float sw = 1.0 - smoothstep(0.0, 0.42, l);
      float hw = smoothstep(0.38, 0.95, l);
      c *= mix(vec3(1.0), uShadowTint, sw * uSplit);
      c *= mix(vec3(1.0), uHighlightTint, hw * uSplit);

      // --- vignette into a tinted night colour (never pure black)
      float v = smoothstep(0.25, 1.05, sqrt(r2) * 1.12);
      c = mix(c, uVignetteColor + c * 0.35, v * uVignette);

      // --- damage pulse: hot red rim
      float edge = smoothstep(0.35, 0.95, sqrt(r2) * 1.25);
      c = mix(c, vec3(0.75, 0.04, 0.03), edge * uDamage * 0.65);

      // --- grain / dither (luma-weighted: strongest in the mid-darks where banding shows)
      float g = ign(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5;
      c += g * uGrain * (0.55 + 0.45 * (1.0 - l));

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
  defines: { CA_ENABLED: 1 },
};

/** sRGB hex -> 0..1 display-space vector (the grade runs in display space, so no linearisation). */
export function hexToDisplay(hex: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

/** Turns a tint colour into a luminance-normalised multiplier (e.g. dark navy -> (0.6, 0.7, 1.7)), clamped so
 *  extreme hues can't blow a channel out. */
export function tintMultiplier(hex: number, out: THREE.Vector3): THREE.Vector3 {
  hexToDisplay(hex, out);
  const l = Math.max(1e-3, out.x * 0.2126 + out.y * 0.7152 + out.z * 0.0722);
  out.divideScalar(l);
  out.set(Math.min(2.2, out.x), Math.min(2.2, out.y), Math.min(2.2, out.z));
  return out;
}
