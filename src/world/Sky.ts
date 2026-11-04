import * as THREE from 'three';
import type { BiomeDef } from '../data/biomes';

/**
 * Sky dome (gradient, twinkling stars, big stylised moon with halo + moonlit cloud wisps) and three distant
 * silhouette rings (treeline / willows / ruined towers) for depth. Both follow the camera / player and
 * ignore scene fog; the horizon colour equals the biome fog colour so the ground melts into the sky.
 * They are only visible from the low menu camera; the top-down gameplay camera never sees the horizon.
 */
const SKY_R = 150;

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position * ${SKY_R.toFixed(1)}, 1.0);
    gl_Position = p.xyww;
    gl_Position.z = p.w * 0.99999;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uMoonColor; uniform vec3 uMoonGlow;
  uniform vec3 uMoonDir; uniform float uStars; uniform float uTime;
  varying vec3 vDir;
  float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p *= 2.07; a *= 0.5; } return s; }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.22, h));
    col = mix(col, uZenith, smoothstep(0.2, 0.85, h));
    // moon
    float md = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
    float R = 0.085;
    float halo = exp(-md * 9.0) * 0.4 + exp(-md * 2.2) * 0.18;
    col += uMoonGlow * halo * (0.6 + 0.4 * smoothstep(-0.05, 0.1, h));
    float ring = exp(-pow((md - R * 2.4) * 30.0, 2.0)) * 0.12;
    col += uMoonGlow * ring;
    // stars (3D hashed cells → seamless), fewer near the horizon and the moon
    vec3 sp = d * 160.0;
    vec3 cell = floor(sp);
    float sh = h31(cell);
    vec3 spos = cell + 0.5 + (vec3(h31(cell + 1.3), h31(cell + 2.7), h31(cell + 4.1)) - 0.5) * 0.7;
    float sd = length(sp - spos);
    float star = smoothstep(0.24, 0.0, sd) * step(1.0 - 0.06 * uStars, sh);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + sh * 4.0) + sh * 60.0);
    float big = step(0.996, sh);
    col += star * tw * mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.92, 0.8), fract(sh * 13.0)) * (1.2 + big * 2.5)
           * smoothstep(0.02, 0.25, h) * smoothstep(R * 2.0, R * 4.0, md);
    // moonlit cloud wisps (bands close to the horizon)
    float az = atan(d.z, d.x);
    vec2 cp = vec2(az * 4.0 + uTime * 0.004, h * 18.0);
    float cl = fbm(cp + vec2(0.0, fbm(cp * 0.5) * 1.5));
    float band = smoothstep(0.02, 0.1, h) * (1.0 - smoothstep(0.18, 0.4, h));
    float cloud = smoothstep(0.52, 0.72, cl) * band;
    vec3 cloudCol = mix(uMid * 0.85, uMoonGlow * 0.6 + uMid * 0.4, smoothstep(0.6, 0.85, cl)) + uMoonGlow * halo * 0.8;
    col = mix(col, cloudCol, cloud * 0.75);
    // the moon disc (drawn over clouds): soft craters + bright rim + bloom-friendly HDR
    if (md < R * 1.04) {
      vec3 up = abs(uMoonDir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 mx = normalize(cross(up, uMoonDir));
      vec3 my = cross(uMoonDir, mx);
      vec2 mp = vec2(dot(d, mx), dot(d, my)) / R;
      float crat = fbm(mp * 2.5 + 3.0);
      float spots = smoothstep(0.42, 0.6, fbm(mp * 1.6 + 9.0));
      float limb = sqrt(max(0.0, 1.0 - dot(mp, mp)));
      vec3 mc = uMoonColor * (0.72 + 0.28 * limb) * (1.0 - spots * 0.3) * (0.85 + 0.3 * crat);
      mc *= 1.0 + 0.25 * smoothstep(0.2, 0.9, mp.x * 0.6 + mp.y * 0.8);
      float edge = smoothstep(R * 1.04, R * 0.98, md);
      col = mix(col, mc * 1.25, edge);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const skylineVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skylineFragment = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uHorizon; uniform vec3 uRim; uniform float uHaze; uniform float uStyle;
  uniform float uSeed; uniform float uMoonU; uniform float uTime;
  varying vec2 vUv;
  float h11(float x) { return fract(sin(x * 127.1 + uSeed * 31.7) * 43758.5453); }
  float tri(float x) { return 1.0 - abs(fract(x) * 2.0 - 1.0); }
  float silhouette(float u) {
    float N = 140.0;
    float x = u * N;
    float i = floor(x);
    float f = fract(x);
    float hgt = 0.0;
    if (uStyle < 0.5) {            // pines: overlapping triangles of varying height
      for (int k = -1; k <= 1; k++) {
        float c = i + float(k);
        float ht = 0.35 + 0.65 * h11(c);
        float w = 0.8 + 0.6 * h11(c + 5.0);
        float dx = abs(x - (c + 0.5)) / w;
        hgt = max(hgt, ht * (1.0 - dx) * step(dx, 1.0));
      }
    } else if (uStyle < 1.5) {     // willows / bog trees: rounded domes
      for (int k = -2; k <= 2; k++) {
        float c = i + float(k);
        float ht = 0.3 + 0.55 * h11(c);
        float w = 1.2 + 1.2 * h11(c + 5.0);
        float dx = (x - (c + 0.5)) / w;
        hgt = max(hgt, ht * sqrt(max(0.0, 1.0 - dx * dx)) * step(0.35, h11(c + 9.0)));
      }
      hgt = max(hgt, 0.18 + 0.05 * sin(u * 80.0));
    } else {                       // ruins: towers, walls and broken arches
      float b = floor(x / 3.0);
      float r = h11(b);
      float fx = fract(x / 3.0);
      float tower = step(0.72, r) * (0.55 + 0.45 * h11(b + 3.0)) * step(0.3, fx) * step(fx, 0.7);
      float wall = (0.18 + 0.2 * h11(b + 1.0)) * (0.8 + 0.2 * step(0.5, fract(x * 2.0)));
      float spire = tower > 0.0 ? tower + 0.18 * (1.0 - abs(fx - 0.5) * 5.0) : 0.0;
      hgt = max(wall, spire);
      hgt = max(hgt, 0.1 + 0.08 * tri(u * 13.0));
    }
    // dip around the moon so the moonrise is framed
    float du = abs(fract(u - uMoonU + 0.5) - 0.5);
    hgt *= mix(0.45, 1.0, smoothstep(0.02, 0.09, du));
    return hgt;
  }
  void main() {
    // CylinderGeometry u runs from +Z toward +X; convert to atan2(z, x) / 2π so it matches uMoonU
    float s = silhouette(fract(0.25 - vUv.x));
    if (vUv.y > s) discard;
    float rim = smoothstep(s - 0.025, s, vUv.y);
    vec3 col = mix(uColor, uHorizon, uHaze);
    col += uRim * rim * 0.08 * (1.0 - uHaze);
    col = mix(col, uHorizon * 1.15, smoothstep(0.0, s, vUv.y) * 0.15);
    // mist at the foot of each layer
    col = mix(col, uHorizon, (1.0 - smoothstep(0.0, 0.45, vUv.y)) * 0.7);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  readonly group = new THREE.Group();
  private skyMat: THREE.ShaderMaterial;
  private layers: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  /** Moon direction: low over the -Z horizon, where the menu camera looks first. */
  readonly moonDir = new THREE.Vector3(-0.32, 0.075, -1).normalize();

  constructor() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uMid: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uMoonColor: { value: new THREE.Color() },
        uMoonGlow: { value: new THREE.Color() },
        uMoonDir: { value: this.moonDir },
        uStars: { value: 1 },
        uTime: { value: 0 },
      },
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyMat);
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    dome.matrixAutoUpdate = false;
    this.group.add(dome);

    const moonU = Math.atan2(this.moonDir.z, this.moonDir.x) / (Math.PI * 2);
    const specs = [
      { r: 135, h: 26, haze: 0.62, seed: 3 },
      { r: 105, h: 20, haze: 0.4, seed: 7 },
      { r: 80, h: 13, haze: 0.18, seed: 11 },
    ];
    for (const s of specs) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uRim: { value: new THREE.Color() },
          uHaze: { value: s.haze },
          uStyle: { value: 0 },
          uSeed: { value: s.seed },
          uMoonU: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: skylineVertex,
        fragmentShader: skylineFragment,
        side: THREE.BackSide,
        fog: false,
      });
      const geo = new THREE.CylinderGeometry(s.r, s.r, s.h, 160, 1, true).translate(0, s.h / 2 - 2, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -900;
      (mat.uniforms.uMoonU as { value: number }).value = moonU < 0 ? moonU + 1 : moonU;
      this.layers.push({ mesh, mat });
      this.group.add(mesh);
    }
  }

  setBiome(b: BiomeDef): void {
    const u = this.skyMat.uniforms;
    (u.uZenith.value as THREE.Color).setHex(b.sky.zenith);
    (u.uMid.value as THREE.Color).setHex(b.sky.mid);
    (u.uHorizon.value as THREE.Color).setHex(b.sky.horizon);
    (u.uMoonColor.value as THREE.Color).setHex(b.sky.moonColor);
    (u.uMoonGlow.value as THREE.Color).setHex(b.sky.moonGlow);
    u.uStars.value = b.sky.stars;
    const style = b.sky.skyline === 'pines' ? 0 : b.sky.skyline === 'willows' ? 1 : 2;
    for (const l of this.layers) {
      const lu = l.mat.uniforms;
      (lu.uColor.value as THREE.Color).setHex(b.sky.skylineColor);
      (lu.uHorizon.value as THREE.Color).setHex(b.sky.horizon);
      (lu.uRim.value as THREE.Color).setHex(b.sky.moonGlow);
      lu.uStyle.value = style;
    }
  }

  update(px: number, pz: number, time: number): void {
    this.skyMat.uniforms.uTime.value = time;
    for (const l of this.layers) l.mesh.position.set(px, 0, pz);
  }
}
