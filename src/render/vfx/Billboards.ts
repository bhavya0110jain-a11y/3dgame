import * as THREE from 'three';
import { ATLAS_GLSL, getAtlas } from './atlas';

/**
 * Immediate-mode instanced billboards (one draw call per instance of this class): owners call begin(),
 * add()/column() for everything visible this frame, then end(). Instance data persists until the next begin(),
 * so things keep drawing while the simulation is paused.
 *
 *   add():    camera-facing atlas sprite (glows, glints, halos), optional rotation
 *   column(): cylindrical (Y-axis) billboard light shaft — procedural profile with upward-scrolling streaks
 *             (level-up pillar, pickup beacons, boss death pillar)
 *
 * Premultiplied blending with per-instance additive amount, like ParticleSystem.
 */
const tmpC = new THREE.Color();

export class Billboards {
  private geo: THREE.InstancedBufferGeometry;
  private aPos: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aPar: THREE.InstancedBufferAttribute;
  private n = 0;
  readonly mesh: THREE.Mesh;
  readonly uniforms = { uAtlas: { value: null as THREE.Texture | null }, uTime: { value: 0 } };

  constructor(scene: THREE.Scene, private capacity = 1024, renderOrder = 21) {
    this.uniforms.uAtlas.value = getAtlas();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aPos = mk();
    this.aCol = mk();
    this.aPar = mk();
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iPar', this.aPar);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 iPos;
        attribute vec4 iCol;
        attribute vec4 iPar;
        varying vec2 vUv;
        varying vec2 vQ;
        varying vec4 vCol;
        varying float vAdd;
        varying float vMode;
        ${ATLAS_GLSL}
        void main() {
          vec2 corner = position.xy;
          vCol = iCol;
          vAdd = iPar.w;
          vQ = corner + 0.5;
          if (iPar.x < -0.5) {
            vMode = 1.0;
            vUv = vQ;
            vec3 toCam = cameraPosition - iPos.xyz;
            vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
            vec3 p = iPos.xyz + right * corner.x * iPos.w + vec3(0.0, (corner.y + 0.5) * iPar.z, 0.0);
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
            return;
          }
          vMode = 0.0;
          vUv = atlasUv(iPar.x, vQ);
          float r = iPar.y;
          vec2 c = vec2(corner.x * cos(r) - corner.y * sin(r), corner.x * sin(r) + corner.y * cos(r)) * iPos.w;
          if (iPar.z > 0.5) {
            gl_Position = projectionMatrix * viewMatrix * vec4(iPos.x + c.x, iPos.y, iPos.z + c.y, 1.0);
            return;
          }
          vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
          mv.xy += c;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        uniform float uTime;
        varying vec2 vUv;
        varying vec2 vQ;
        varying vec4 vCol;
        varying float vAdd;
        varying float vMode;
        void main() {
          float a;
          vec3 tint = vec3(1.0);
          if (vMode > 0.5) {
            float across = vQ.x * 2.0 - 1.0;
            float prof = exp(-across * across * 5.0);
            float core = exp(-across * across * 40.0);
            float y = vQ.y;
            float vfade = pow(1.0 - y, 1.6) * smoothstep(0.0, 0.06, y);
            float streak = 0.7 + 0.3 * sin(y * 26.0 - uTime * 7.0 + across * 4.0) * sin(y * 9.0 - uTime * 3.1);
            a = (prof * streak + core * 0.8) * vfade;
          } else {
            vec4 t = texture2D(uAtlas, vUv);
            a = t.a;
            tint = t.rgb;
          }
          a *= vCol.a;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vCol.rgb * tint * a, a * (1.0 - vAdd));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  begin(time: number): void {
    this.n = 0;
    this.uniforms.uTime.value = time;
  }

  /** Camera-facing atlas sprite. Colour sRGB hex × intensity; additive 1 = glow, 0 = alpha. */
  add(x: number, y: number, z: number, size: number, frame: number, color: number, intensity: number, alpha = 1, rot = 0, additive = 1): void {
    if (this.n >= this.capacity) return;
    const j = this.n++ * 4;
    tmpC.setHex(color);
    const P = this.aPos.array as Float32Array, C = this.aCol.array as Float32Array, Q = this.aPar.array as Float32Array;
    P[j] = x; P[j + 1] = y; P[j + 2] = z; P[j + 3] = size;
    C[j] = tmpC.r * intensity; C[j + 1] = tmpC.g * intensity; C[j + 2] = tmpC.b * intensity; C[j + 3] = alpha;
    Q[j] = frame; Q[j + 1] = rot; Q[j + 2] = 0; Q[j + 3] = additive;
  }

  /** Atlas sprite lying flat on the ground plane at height y (rings, sigils under pickups). */
  ground(x: number, y: number, z: number, size: number, frame: number, color: number, intensity: number, alpha = 1, rot = 0): void {
    if (this.n >= this.capacity) return;
    this.add(x, y, z, size, frame, color, intensity, alpha, rot, 1);
    (this.aPar.array as Float32Array)[(this.n - 1) * 4 + 2] = 1;
  }

  /** Vertical light shaft standing on (x, y, z). */
  column(x: number, y: number, z: number, width: number, height: number, color: number, intensity: number, alpha = 1): void {
    if (this.n >= this.capacity) return;
    const j = this.n++ * 4;
    tmpC.setHex(color);
    const P = this.aPos.array as Float32Array, C = this.aCol.array as Float32Array, Q = this.aPar.array as Float32Array;
    P[j] = x; P[j + 1] = y; P[j + 2] = z; P[j + 3] = width;
    C[j] = tmpC.r * intensity; C[j + 1] = tmpC.g * intensity; C[j + 2] = tmpC.b * intensity; C[j + 3] = alpha;
    Q[j] = -1; Q[j + 1] = 0; Q[j + 2] = height; Q[j + 3] = 1;
  }

  end(): void {
    this.geo.instanceCount = this.n;
    if (this.n === 0) return;
    const k = this.n * 4;
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, k); this.aPos.needsUpdate = true;
    this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, k); this.aCol.needsUpdate = true;
    this.aPar.clearUpdateRanges(); this.aPar.addUpdateRange(0, k); this.aPar.needsUpdate = true;
  }
}
