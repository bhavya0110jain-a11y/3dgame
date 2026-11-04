import * as THREE from 'three';
import type { BiomeAmbient } from '../data/biomes';
import { worldUniforms } from './WorldShading';

/**
 * GPU-animated ambient motes around the player: fireflies, rising spores, tumbling leaves, embers, ash.
 * Positions are a pure function of (seed, time) evaluated in the vertex shader and wrapped around the
 * player like the grass, so there is zero per-frame CPU work. One Points draw call per system.
 */
const AREA = 46;
const MAX = 160;
const KIND = { firefly: 0, spore: 1, leaf: 2, ember: 3, ash: 4 } as const;

const vertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform vec3 uPlayer;
  uniform float uTime;
  uniform vec2 uWind;
  uniform float uKind;
  uniform float uCount;
  uniform float uPixel;
  varying float vAlpha;
  varying float vSpin;
  void main() {
    float id = aSeed.w;
    vSpin = 0.0;
    if (id >= uCount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; return; }
    float t = uTime;
    float ph = aSeed.z * 6.2831;
    vec2 base = aSeed.xy;
    vec3 p;
    float size;
    float a = 1.0;
    if (uKind < 0.5) {            // firefly: lazy wander + blink
      base += vec2(sin(t * 0.21 + ph) * 2.2 + sin(t * 0.57 + ph * 3.0) * 0.6, cos(t * 0.17 + ph * 1.3) * 2.2);
      p = vec3(0.0, 0.5 + aSeed.z * 1.8 + sin(t * 0.9 + ph) * 0.35, 0.0);
      a = smoothstep(-0.2, 0.9, sin(t * (0.9 + aSeed.z) + ph * 7.0));
      size = 0.22;
    } else if (uKind < 1.5) {     // spore: slow rise + drift
      float H = 5.0;
      float y = mod(t * (0.18 + 0.12 * aSeed.z) + ph * 3.0, H);
      base += vec2(sin(t * 0.4 + ph) * 0.8, cos(t * 0.33 + ph) * 0.8) + uWind * y * 0.4;
      p = vec3(0.0, y, 0.0);
      a = smoothstep(0.0, 0.8, y) * (1.0 - smoothstep(H * 0.7, H, y)) * 0.35;
      size = 0.03;
    } else if (uKind < 2.5) {     // leaf: fall with flutter
      float H = 7.0;
      float y = H - mod(t * (0.45 + 0.3 * aSeed.z) + ph * 5.0, H);
      base += vec2(sin(t * 1.3 + ph) * 0.7, cos(t * 1.1 + ph * 2.0) * 0.5) + uWind * (H - y) * 0.6;
      p = vec3(0.0, y, 0.0);
      a = smoothstep(0.0, 0.6, y) * smoothstep(H, H * 0.85, y);
      size = 0.2;
      vSpin = t * (1.5 + aSeed.z * 2.0) + ph;
    } else if (uKind < 3.5) {     // ember: rise, sway, cool down
      float H = 6.0;
      float y = mod(t * (0.6 + 0.6 * aSeed.z) + ph * 4.0, H);
      base += vec2(sin(t * 1.7 + ph * 2.0) * 0.35, cos(t * 1.3 + ph) * 0.35) + uWind * y * 0.5;
      p = vec3(0.0, y, 0.0);
      a = (1.0 - smoothstep(H * 0.3, H, y)) * (0.6 + 0.4 * sin(t * 13.0 + ph * 9.0));
      size = 0.09;
    } else {                      // ash: slow fall
      float H = 7.0;
      float y = H - mod(t * (0.25 + 0.15 * aSeed.z) + ph * 5.0, H);
      base += vec2(sin(t * 0.7 + ph) * 0.6, cos(t * 0.6 + ph) * 0.6) + uWind * (H - y) * 0.5;
      p = vec3(0.0, y, 0.0);
      a = smoothstep(0.0, 0.5, y) * smoothstep(H, H * 0.8, y) * 0.8;
      size = 0.11;
      vSpin = t * 0.8 + ph;
    }
    vec2 rel = mod(base - uPlayer.xz + ${(AREA / 2).toFixed(1)}, ${AREA.toFixed(1)}) - ${(AREA / 2).toFixed(1)};
    p.xz = uPlayer.xz + rel;
    float edge = max(abs(rel.x), abs(rel.y)) / ${(AREA / 2).toFixed(1)};
    a *= 1.0 - smoothstep(0.75, 1.0, edge);
    vAlpha = a;
    // motes right in front of the lens read as dirt on it (spore bokeh, art review s2 #7): fade within ~4 m
    a *= smoothstep(2.5, 4.5, length(p - cameraPosition));
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * uPixel / -mv.z, 1.0, 48.0);
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uKind;
  varying float vAlpha;
  varying float vSpin;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float a;
    vec3 col = uColor;
    if (uKind > 1.5 && uKind < 2.5 || uKind > 3.5) {
      // leaf / ash flake: rotated ellipse, lit-looking (no glow)
      float cs = cos(vSpin), sn = sin(vSpin);
      vec2 q = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
      q.y *= uKind > 3.5 ? 1.3 : 2.4;
      a = smoothstep(0.5, 0.38, length(q));
      col *= 0.65 + 0.35 * abs(sin(vSpin * 1.7));
      gl_FragColor = vec4(col, a * vAlpha * 0.9);
    } else {
      float d = length(c);
      float core = smoothstep(0.18, 0.0, d);
      float halo = smoothstep(0.5, 0.0, d);
      a = halo * halo * 0.7 + core;
      gl_FragColor = vec4(col * (1.0 + core * 2.5), a * vAlpha);
    }
  }
`;

export class Ambient {
  readonly group = new THREE.Group();
  private systems: { points: THREE.Points; mat: THREE.ShaderMaterial }[] = [];

  constructor() {
    for (let s = 0; s < 2; s++) {
      const g = new THREE.BufferGeometry();
      const seeds = new Float32Array(MAX * 4);
      let x = 777 + s * 999;
      const rnd = () => {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        return x / 4294967296;
      };
      for (let i = 0; i < MAX; i++) {
        seeds[i * 4] = rnd() * AREA;
        seeds[i * 4 + 1] = rnd() * AREA;
        seeds[i * 4 + 2] = rnd();
        seeds[i * 4 + 3] = i;
      }
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uPlayer: worldUniforms.uPlayer,
          uTime: worldUniforms.uTime,
          uWind: worldUniforms.uWind,
          uKind: { value: 0 },
          uCount: { value: 0 },
          uPixel: { value: 600 },
          uColor: { value: new THREE.Color() },
        },
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const points = new THREE.Points(g, mat);
      points.frustumCulled = false;
      points.renderOrder = 5;
      this.systems.push({ points, mat });
      this.group.add(points);
    }
  }

  setBiome(list: BiomeAmbient[]): void {
    this.systems.forEach((s, i) => {
      const def = list[i];
      s.points.visible = !!def;
      if (!def) return;
      const u = s.mat.uniforms;
      u.uKind.value = KIND[def.kind];
      u.uCount.value = Math.min(MAX, def.count);
      const c = u.uColor.value as THREE.Color;
      c.setHex(def.color);
      const glow = def.kind === 'firefly' || def.kind === 'ember' || def.kind === 'spore';
      if (glow) c.multiplyScalar(def.kind === 'spore' ? 1.2 : 2.2);
      s.mat.blending = glow ? THREE.AdditiveBlending : THREE.NormalBlending;
      s.mat.needsUpdate = true;
    });
  }

  /** Keeps point sizes in world units for the current canvas height. */
  update(): void {
    const px = (window.innerHeight * Math.min(window.devicePixelRatio || 1, 2)) / (2 * Math.tan((22.5 * Math.PI) / 180));
    for (const s of this.systems) s.mat.uniforms.uPixel.value = px;
  }
}
