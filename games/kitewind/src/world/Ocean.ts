import * as THREE from 'three';
import type { Environment } from './Environment';
import { shared } from '../render/materials';

const vert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const frag = /* glsl */ `
uniform vec3 uDeep, uShallow, uGlint, uSun, uSunDir, uZenith, uHorizon, uHaze, uFog;
uniform float uFogNear, uFogFar, uTime, uSunI, uFlash;
varying vec3 vWorld;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// gradient of a sum of directional waves (analytic) + a little noise
vec2 waves(vec2 p, float t, float fade) {
  vec2 g = vec2(0.0);
  vec4 dirs[4];
  dirs[0] = vec4(normalize(vec2(1.0, 0.35)), 0.09, 0.55);
  dirs[1] = vec4(normalize(vec2(-0.6, 1.0)), 0.16, 0.35);
  dirs[2] = vec4(normalize(vec2(0.2, -1.0)), 0.37, 0.18);
  dirs[3] = vec4(normalize(vec2(-1.0, -0.3)), 0.81, 0.09);
  for (int i = 0; i < 4; i++) {
    vec2 d = dirs[i].xy; float k = dirs[i].z; float a = dirs[i].w;
    float ph = dot(p, d) * k + t * sqrt(9.8 * k);
    g += d * (a * k * cos(ph)) * (i > 1 ? fade : 1.0);
  }
  float e = 0.6;
  vec2 q = p * 0.35 + vec2(t * 0.3, -t * 0.2);
  float n0 = noise(q);
  g += vec2(noise(q + vec2(e, 0.0)) - n0, noise(q + vec2(0.0, e)) - n0) * 0.9 * fade;
  return g;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  float fade = 1.0 - smoothstep(60.0, 420.0, dist);
  vec2 g = waves(vWorld.xz, uTime, fade);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  N = normalize(mix(vec3(0.0, 1.0, 0.0), N, 0.35 + 0.65 * fade));
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  float ry = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uHaze, mix(uHorizon, uZenith, pow(ry, 0.6)), smoothstep(0.0, 0.25, ry));
  float rs = max(dot(R, uSunDir), 0.0);
  vec3 body = mix(uDeep, uShallow, 0.35 + 0.35 * N.x + 0.25 * fade);
  // light scattered into the body facing the sun
  body += uSun * 0.06 * max(dot(-V.xz, uSunDir.xz), 0.0);
  vec3 col = mix(body, sky, fres);
  // sun glint: tight specular + a broad golden path + sparkles
  col += uGlint * uSunI * (pow(rs, 900.0) * 14.0 + pow(rs, 90.0) * 0.9 + pow(rs, 12.0) * 0.12);
  float sparkle = step(0.93, noise(vWorld.xz * 1.7 + uTime * 1.3)) * pow(rs, 30.0) * fade;
  col += uGlint * sparkle * 3.0;
  col += vec3(0.7, 0.75, 1.0) * uFlash * 0.25;
  // fog toward the horizon haze
  float f = smoothstep(uFogNear, uFogFar * 1.6, dist);
  col = mix(col, mix(uFog, uHaze, 0.5), f);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Stylised ocean: analytic waves, fresnel sky reflection, sun glint path, distance fog. Follows the camera. */
export class Ocean {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      fog: false,
      uniforms: {
        uDeep: { value: new THREE.Color() },
        uShallow: { value: new THREE.Color() },
        uGlint: { value: new THREE.Color() },
        uSun: { value: new THREE.Color() },
        uSunDir: shared.uSunDir,
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uHaze: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uFogNear: { value: 60 },
        uFogFar: { value: 500 },
        uTime: shared.uTime,
        uSunI: { value: 1 },
        uFlash: shared.uFlash,
      },
    });
    const geo = new THREE.PlaneGeometry(3000, 3000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    scene.add(this.mesh);
  }

  update(env: Environment, camera: THREE.Camera): void {
    const u = this.mat.uniforms;
    u.uDeep.value.copy(env.oceanDeep);
    u.uShallow.value.copy(env.oceanShallow);
    u.uGlint.value.copy(env.glint);
    u.uSun.value.copy(env.sun);
    u.uZenith.value.copy(env.zenith);
    u.uHorizon.value.copy(env.horizon);
    u.uHaze.value.copy(env.haze);
    u.uFog.value.copy(env.fog);
    u.uFogNear.value = env.fogNear;
    u.uFogFar.value = env.fogFar;
    u.uSunI.value = Math.min(1.5, env.sunIntensity / 2);
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
  }
}
