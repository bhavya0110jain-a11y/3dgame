import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { InstancedModel, type Models } from '../render/Models';
import { makePaletteMaterial, shared } from '../render/materials';
import { CloudLayer } from './Clouds';
import type { Environment } from './Environment';
import { ISLAND_SHAPES } from './islandShapes';
import { buildArch, buildIsland, buildSpire } from './props';
import type { WorldSim } from './WorldSim';

const updraftVert = /* glsl */ `
varying vec2 vUv;
varying float vFres;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vFres = abs(dot(n, normalize(cameraPosition - w.xyz)));
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const updraftFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying float vFres;
void main() {
  float s = sin(vUv.x * 6.2831 * 5.0 + vUv.y * 26.0 - uTime * 5.0) * 0.5 + 0.5;
  float s2 = sin(vUv.x * 6.2831 * 9.0 - vUv.y * 40.0 - uTime * 7.0) * 0.5 + 0.5;
  float streak = pow(s, 6.0) + pow(s2, 10.0) * 0.6;
  float fade = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  float edge = 1.0 - vFres;
  float a = (streak * 0.4 + 0.06) * fade * (0.2 + edge * 0.7) * 0.6;
  gl_FragColor = vec4(uColor * a * 1.3, a);
  #include <colorspace_fragment>
}`;

const particleVert = /* glsl */ `
uniform float uTime, uBox, uSize, uFall;
attribute vec4 aSeed;
varying float vA;
void main() {
  vec3 p = position;
  p.y -= uTime * uFall * (0.6 + aSeed.x);
  p.x += sin(uTime * 0.5 + aSeed.y * 6.28) * (1.0 - uFall * 0.05) * 1.5;
  vec3 c = cameraPosition;
  p = c + mod(p - c + uBox * 0.5, uBox) - uBox * 0.5;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float tw = 0.5 + 0.5 * sin(uTime * (2.0 + aSeed.z * 3.0) + aSeed.w * 30.0);
  vA = tw * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(p - c)));
  gl_PointSize = uSize * (0.6 + aSeed.x) * 300.0 / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const particleFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(d)) * vA * uAmount;
  gl_FragColor = vec4(uColor * a, a);
}`;

const haloVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 centre = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float size = length(instanceMatrix[0].xyz);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  gl_Position = projectionMatrix * viewMatrix * vec4(centre + (right * position.x + up * position.y) * size, 1.0);
}`;
const haloFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (exp(-r * r * 6.0) * 0.8 + exp(-r * r * 40.0) * 0.6) * (1.0 - smoothstep(0.8, 1.0, r)) * uAmount;
  gl_FragColor = vec4(uColor * a, a);
}`;

const rainVert = /* glsl */ `
uniform float uTime, uBox;
attribute float aEnd;
attribute float aSeed;
void main() {
  vec3 p = position;
  p.y -= uTime * 38.0 * (0.8 + aSeed * 0.4);
  vec3 c = cameraPosition;
  p = c + mod(p - c + uBox * 0.5, uBox) - uBox * 0.5;
  p += vec3(0.6, 2.4, 0.0) * aEnd; // streak
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const rainFrag = /* glsl */ `
uniform float uAmount;
void main() { gl_FragColor = vec4(vec3(0.75, 0.8, 0.95) * 0.35 * uAmount, 0.35 * uAmount); }`;

/**
 * Static world visuals rebuilt when the streamed chunk set changes (islands, spires, arches, updraft columns,
 * chunk clouds), plus per-frame ambience (rising lanterns, horizon cloud banks, motes, rain).
 */
export class WorldView {
  readonly group = new THREE.Group();
  private islands: InstancedModel[] = [];
  private spires: InstancedModel;
  private crystals: THREE.InstancedMesh;
  private arches: InstancedModel;
  private updrafts: THREE.InstancedMesh;
  private updraftMat: THREE.ShaderMaterial;
  readonly clouds: CloudLayer;
  private horizon: CloudLayer;
  private lanterns: InstancedModel;
  private halos: THREE.InstancedMesh;
  private haloMat: THREE.ShaderMaterial;
  private motes: THREE.Points;
  private rain: THREE.LineSegments;
  private version = -1;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private horizonPuffs: Float32Array;

  constructor(scene: THREE.Scene, models: Models) {
    scene.add(this.group);
    const pal = makePaletteMaterial();
    pal.side = THREE.DoubleSide;
    for (let v = 0; v < ISLAND_SHAPES.length; v++) {
      const parts = models.getOr(`island_${v}`, () => [{ geometry: buildIsland(v), material: pal }]);
      this.islands.push(new InstancedModel(parts, 80, this.group));
    }
    this.spires = new InstancedModel(models.getOr('spire', () => [{ geometry: buildSpire(), material: pal }]), 64, this.group);
    this.crystals = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), 64);
    this.crystals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.crystals.setColorAt(0, this.c.set(1, 1, 1));
    this.crystals.frustumCulled = false;
    this.crystals.count = 0;
    this.group.add(this.crystals);
    this.arches = new InstancedModel(models.getOr('arch', () => [{ geometry: buildArch(), material: pal }]), 24, this.group);

    const ug = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    ug.translate(0, 0.5, 0);
    this.updraftMat = new THREE.ShaderMaterial({
      vertexShader: updraftVert,
      fragmentShader: updraftFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(0xfff2d0) } },
    });
    this.updrafts = new THREE.InstancedMesh(ug, this.updraftMat, 16);
    this.updrafts.frustumCulled = false;
    this.updrafts.count = 0;
    this.group.add(this.updrafts);

    this.horizon = new CloudLayer(this.group, 48);
    this.clouds = new CloudLayer(this.group, 520);
    const rng = new Rng(2024);
    this.horizonPuffs = new Float32Array(48 * 5);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2 + rng.range(-0.05, 0.05);
      const r = rng.range(560, 760);
      this.horizonPuffs.set([Math.sin(a) * r, rng.range(-10, 40), Math.cos(a) * r, rng.range(70, 140), rng.int(0, 3)], i * 5);
    }

    // paper sky-lanterns
    const lanternParts = models.getOr('lantern', () => {
      const g = new THREE.CylinderGeometry(0.22, 0.3, 0.6, 8, 1);
      g.translate(0, 0.3, 0);
      return [{ geometry: g, material: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.1, 0.35) }) }];
    });
    this.lanterns = new InstancedModel(lanternParts, 160, this.group);
    // warm additive halo around each lantern (reads at distance, sells the glow)
    this.haloMat = new THREE.ShaderMaterial({
      vertexShader: haloVert,
      fragmentShader: haloFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(1.0, 0.55, 0.22) }, uAmount: { value: 1 } },
    });
    this.halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.haloMat, 160);
    this.halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halos.frustumCulled = false;
    this.halos.count = 0;
    this.group.add(this.halos);

    // motes (fireflies / sparkles) and rain, both wrapped around the camera in the vertex shader
    const N = 600;
    const mp = new Float32Array(N * 3);
    const ms = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      mp.set([rng.range(-60, 60), rng.range(-60, 60), rng.range(-60, 60)], i * 3);
      ms.set([rng.next(), rng.next(), rng.next(), rng.next()], i * 4);
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 4));
    this.motes = new THREE.Points(
      mg,
      new THREE.ShaderMaterial({
        vertexShader: particleVert,
        fragmentShader: particleFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: shared.uTime, uBox: { value: 120 }, uSize: { value: 0.35 }, uFall: { value: -0.4 }, uColor: { value: new THREE.Color(1.6, 1.3, 0.8) }, uAmount: { value: 0 } },
      }),
    );
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
    const R = 1400;
    const rp = new Float32Array(R * 6);
    const re = new Float32Array(R * 2);
    const rs = new Float32Array(R * 2);
    for (let i = 0; i < R; i++) {
      const x = rng.range(-50, 50), y = rng.range(-50, 50), z = rng.range(-50, 50);
      rp.set([x, y, z, x, y, z], i * 6);
      re.set([0, 1], i * 2);
      const sd = rng.next();
      rs.set([sd, sd], i * 2);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(rs, 1));
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.ShaderMaterial({ vertexShader: rainVert, fragmentShader: rainFrag, transparent: true, depthWrite: false, uniforms: { uTime: shared.uTime, uBox: { value: 100 }, uAmount: { value: 0 } } }),
    );
    this.rain.frustumCulled = false;
    this.group.add(this.rain);
  }

  /** Per-frame update. `time` = sim time used for deterministic motion of lanterns. */
  update(world: WorldSim, env: Environment, camera: THREE.Camera, time: number): void {
    if (world.version !== this.version) {
      this.version = world.version;
      this.rebuild(world);
    }
    this.clouds.updateEnv(env);
    this.horizon.updateEnv(env);
    // horizon banks ride with the camera (pure parallax-free backdrop)
    const hp = this.horizonPuffs;
    for (let i = 0; i < 48; i++) {
      const o = i * 5;
      this.horizon.setPuff(i, camera.position.x + hp[o], hp[o + 1], camera.position.z + hp[o + 2], hp[o + 3], hp[o + 4], 0.5, 0, 0.45);
    }
    this.horizon.commit(48);

    // lightning crystals: brightness from the lightning state of the matching spire pair
    let ci = 0;
    for (const c of world.active) {
      for (let k = 0; k < c.lightning.length; k++) {
        const l = c.lightning[k];
        const glow = l.state === 2 ? 4 : l.state === 1 ? 1 + l.t * 2.5 * (0.6 + 0.4 * Math.sin(time * 40)) : 0.5;
        for (let end = 0; end < 2; end++) {
          if (ci >= 64) break;
          const x = end ? l.bx : l.ax, y = end ? l.by : l.ay, z = end ? l.bz : l.az;
          this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(0, time * 1.5 + k, 0)), this.s.set(0.9, 1.4, 0.9));
          this.crystals.setMatrixAt(ci, this.m);
          this.crystals.setColorAt(ci, this.c.setRGB(0.55 * glow, 0.6 * glow, 1.0 * glow));
          ci++;
        }
      }
    }
    this.crystals.count = ci;
    this.crystals.instanceMatrix.needsUpdate = true;
    if (this.crystals.instanceColor) this.crystals.instanceColor.needsUpdate = true;

    // lanterns rise forever (wrapping), fading in with the biome
    let li = 0;
    if (env.lanterns > 0.02) {
      for (const c of world.active) {
        for (const l of c.lanterns) {
          if (li >= 160) break;
          const y = ((l.y + time * l.speed) % 130) - 5;
          const sway = Math.sin(time * 0.7 + l.phase) * 1.2;
          const s = env.lanterns * (1 + 0.15 * Math.sin(time * 3 + l.phase));
          this.m.compose(this.p.set(l.x + sway, y, l.z), this.q.setFromEuler(this.e.set(0, l.phase, Math.sin(time * 0.9 + l.phase) * 0.08)), this.s.set(s * 2.4, s * 2.4, s * 2.4));
          this.lanterns.set(li, this.m);
          const hs = s * (5.5 + 0.8 * Math.sin(time * 5 + l.phase * 3));
          this.m.compose(this.p.set(l.x + sway, y + s * 0.8, l.z), this.q.identity(), this.s.set(hs, hs, hs));
          this.halos.setMatrixAt(li, this.m);
          li++;
        }
      }
    }
    this.lanterns.commit(li);
    this.halos.count = li;
    this.halos.instanceMatrix.needsUpdate = true;
    this.haloMat.uniforms.uAmount.value = Math.min(1, env.lanterns * 1.2);

    const mm = this.motes.material as THREE.ShaderMaterial;
    mm.uniforms.uAmount.value = env.motes;
    mm.uniforms.uColor.value.copy(env.ring).multiplyScalar(1.4);
    this.motes.visible = env.motes > 0.02;
    (this.rain.material as THREE.ShaderMaterial).uniforms.uAmount.value = env.rain;
    this.rain.visible = env.rain > 0.02;
  }

  private rebuild(world: WorldSim): void {
    const counts = this.islands.map(() => 0);
    let sp = 0, ar = 0, up = 0, cl = 0;
    for (const c of world.active) {
      for (const isl of c.islands) {
        const v = isl.variant;
        this.m.compose(this.p.set(isl.x, isl.y, isl.z), this.q.setFromEuler(this.e.set(0, isl.rotY, 0)), this.s.set(isl.radius, isl.radius, isl.radius));
        this.islands[v].set(counts[v]++, this.m);
      }
      for (const s of c.spires) {
        this.m.compose(this.p.set(s.x, 0, s.z), this.q.setFromEuler(this.e.set(0, s.x * 0.37, 0)), this.s.set(s.radius, s.height, s.radius));
        this.spires.set(sp++, this.m);
      }
      for (const a of c.arches) {
        this.m.compose(this.p.set(a.x, a.y, a.z), this.q.identity(), this.s.set(a.radius, a.radius, a.radius));
        this.arches.set(ar++, this.m);
      }
      for (const u of c.updrafts) {
        if (up >= 16) break;
        this.m.compose(this.p.set(u.x, 0, u.z), this.q.identity(), this.s.set(u.radius, u.height, u.radius));
        this.updrafts.setMatrixAt(up++, this.m);
      }
      for (const p of c.clouds) {
        this.clouds.setPuff(cl++, p.x, p.y, p.z, p.size, Math.floor(p.shade * 4) % 4, p.shade);
      }
    }
    this.islands.forEach((m, i) => m.commit(counts[i]));
    this.spires.commit(sp);
    this.arches.commit(ar);
    this.updrafts.count = up;
    this.updrafts.instanceMatrix.needsUpdate = true;
    this.clouds.commit(cl);
  }
}
