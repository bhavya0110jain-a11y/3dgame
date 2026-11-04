import * as THREE from 'three';
import type { Environment } from './Environment';
import { shared } from '../render/materials';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
  gl_Position = p.xyww; // on the far plane
}`;

const frag = /* glsl */ `
uniform vec3 uZenith, uHorizon, uHaze, uSun, uSunDir;
uniform float uSunSize, uSunFade, uStars, uAurora, uCirrus, uTime, uFlash;
varying vec3 vDir;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float sd = dot(d, uSunDir);
  float sunUp = max(sd, 0.0);
  // base gradient
  float up = pow(clamp(h, 0.0, 1.0), 0.55);
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 1.0, up));
  // warm scattering toward the sun along the horizon
  float scatter = pow(sunUp, 4.0) * (1.0 - smoothstep(0.0, 0.55, h));
  col = mix(col, uSun * 1.1, scatter * 0.55);
  col += uSun * pow(sunUp, 18.0) * 0.35;
  // haze band at and below the horizon
  float hz = 1.0 - smoothstep(-0.02, 0.12, h);
  col = mix(col, uHaze, hz * 0.8);
  if (h < 0.0) col = mix(uHaze, uHaze * 0.7, smoothstep(0.0, -0.4, h));

  // stars
  if (uStars > 0.01 && h > 0.0) {
    vec2 g = d.xz / (h + 0.35) * 160.0;
    vec2 cell = floor(g);
    float r = hash(cell);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
    float star = step(0.985, r) * smoothstep(0.42, 0.0, length(fract(g) - 0.5)) * tw;
    col += vec3(0.9, 0.95, 1.0) * star * uStars * smoothstep(0.02, 0.25, h) * 1.4;
  }

  // aurora curtains: march a few altitude slices; the ray pattern depends only on the position along the
  // ribbon, so it lines up vertically across slices and reads as hanging curtains
  if (uAurora > 0.01 && h > 0.015) {
    float t = uTime * 0.035;
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float fi = float(i) / 11.0;
      float H = 1.0 + fi * 1.9;
      vec2 p = d.xz * (H / max(h, 0.02)) * 0.25;
      for (int k = 0; k < 2; k++) {
        float fk = float(k);
        float along = p.x * (0.5 + fk * 0.2) + fk * 7.0;
        float centre = 1.05 + fk * 0.9 + sin(along * 0.55 + t * 2.0 + fk) * 0.45 + (fbm(vec2(along * 0.3 + t, fk * 3.0)) - 0.5) * 1.1;
        float w = p.y - centre;
        float band = exp(-w * w * (9.0 - fi * 5.0));
        float rays = 0.12 + 1.2 * pow(noise(vec2(along * 9.0 + t * 6.0, fk * 11.0)), 2.2);
        vec3 c = mix(vec3(0.12, 1.0, 0.55), vec3(0.65, 0.25, 1.0), smoothstep(0.15, 0.95, fi + fk * 0.15));
        acc += c * band * rays * pow(1.0 - fi, 1.2) * 0.42;
      }
    }
    col += acc * uAurora * smoothstep(0.015, 0.2, h);
  }

  // wispy cirrus bands
  if (uCirrus > 0.01 && h > 0.0) {
    vec2 p = d.xz / (h + 0.12);
    float n = fbm(vec2(p.x * 0.35, p.y * 1.6) + vec2(uTime * 0.004, 0.0));
    float c = smoothstep(0.52, 0.85, n) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.35, 0.8, h));
    vec3 cc = mix(uHorizon * 1.15, uSun * 1.3, pow(sunUp, 3.0));
    col = mix(col, cc, c * uCirrus * 0.55);
  }

  // sun disc + corona
  float disc = smoothstep(1.0 - 0.00045 * (0.5 + uSunSize * 2.5), 1.0 - 0.00025 * (0.5 + uSunSize * 2.5), sd);
  col += uSun * uSunFade * (disc * 9.0 + pow(sunUp, 260.0) * 2.5 + pow(sunUp, 40.0) * 0.4);
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.6 + 0.4 * h);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Gradient sky dome with sun, cirrus, stars and aurora. Follows the camera; drawn first, at the far plane. */
export class Sky {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uHaze: { value: new THREE.Color() },
        uSun: { value: new THREE.Color() },
        uSunDir: shared.uSunDir,
        uSunSize: { value: 0.5 },
        uSunFade: { value: 1 },
        uStars: { value: 0 },
        uAurora: { value: 0 },
        uCirrus: { value: 0 },
        uTime: shared.uTime,
        uFlash: shared.uFlash,
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }

  update(env: Environment, camera: THREE.Camera): void {
    const u = this.mat.uniforms;
    u.uZenith.value.copy(env.zenith);
    u.uHorizon.value.copy(env.horizon);
    u.uHaze.value.copy(env.haze);
    u.uSun.value.copy(env.sun);
    u.uSunSize.value = env.sunSize;
    u.uSunFade.value = env.sunFade;
    u.uStars.value = env.stars;
    u.uAurora.value = env.aurora;
    u.uCirrus.value = env.cirrus;
    this.mesh.position.copy(camera.position);
  }
}
