import * as THREE from 'three';
import { shared } from '../render/materials';
import type { Models } from '../render/Models';
import type { Environment } from '../world/Environment';
import type { WorldSim } from '../world/WorldSim';

const memVert = /* glsl */ `
varying vec2 vP;
varying vec3 vCol;
void main() {
  vP = position.xy;
  vCol = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const memFrag = /* glsl */ `
uniform float uTime;
varying vec2 vP;
varying vec3 vCol;
void main() {
  float r = length(vP);
  float a = smoothstep(0.6, 1.0, r) * 0.13;
  a += smoothstep(0.03, 0.0, abs(r - 0.32)) * 0.22; // perfect-centre marker
  a += (sin(r * 18.0 - uTime * 6.0) * 0.5 + 0.5) * 0.05 * (1.0 - r);
  gl_FragColor = vec4(vCol * a, a);
}`;

const glimVert = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vTw;
void main() {
  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float s = length(instanceMatrix[0].xyz);
  float ph = dot(c, vec3(0.37, 0.11, 0.53));
  c.y += sin(uTime * 2.4 + ph) * 0.25;
  vTw = 0.75 + 0.25 * sin(uTime * 7.0 + ph * 3.0);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float a = uTime * 1.5 + ph;
  vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
  vUv = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * p.x + up * p.y) * s, 1.0);
}`;
const glimFrag = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vTw;
void main() {
  vec2 p = abs(vUv);
  float core = exp(-dot(vUv, vUv) * 22.0);
  float star = exp(-p.x * 14.0) * exp(-p.y * 2.6) + exp(-p.y * 14.0) * exp(-p.x * 2.6);
  float halo = exp(-dot(vUv, vUv) * 4.0) * 0.25;
  float a = (core * 1.6 + star * 0.8 + halo) * vTw;
  gl_FragColor = vec4(uColor * a, a);
}`;

/** Wind rings (+ centre membrane), wind shrines and glimmer sparks. */
export class RingsView {
  readonly group = new THREE.Group();
  private rings: THREE.InstancedMesh;
  private membranes: THREE.InstancedMesh;
  private glimmers: THREE.InstancedMesh;
  private shrines: THREE.Group[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private glimMat: THREE.ShaderMaterial;
  /** Ring radius multiplier (Wide Rings boon) — set by the Game each frame. */
  radiusMul = 1;

  constructor(scene: THREE.Scene, models: Models) {
    scene.add(this.group);
    this.rings = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.075, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), 96);
    this.membranes = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.ShaderMaterial({ vertexShader: memVert, fragmentShader: memFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime: shared.uTime } }),
      96,
    );
    for (const im of [this.rings, this.membranes]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, this.c.set(1, 1, 1));
      im.frustumCulled = false;
      im.count = 0;
      this.group.add(im);
    }
    this.glimMat = new THREE.ShaderMaterial({
      vertexShader: glimVert,
      fragmentShader: glimFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color(2.2, 1.5, 0.5) } },
    });
    this.glimmers = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), this.glimMat, 600);
    this.glimmers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glimmers.frustumCulled = false;
    this.glimmers.count = 0;
    this.group.add(this.glimmers);
    for (let i = 0; i < 2; i++) this.shrines.push(this.buildShrine(models));
  }

  private buildShrine(models: Models): THREE.Group {
    const g = new THREE.Group();
    const parts = models.get('shrine');
    if (parts) {
      for (const p of parts) g.add(new THREE.Mesh(p.geometry, p.material));
    } else {
      const gold = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.1, 0.9) });
      g.add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 8, 64), gold));
      const inner = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.015, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 2.4, 2.6) }));
      g.add(inner);
      const stone = new THREE.MeshStandardMaterial({ color: 0x8a7f86, flatShading: true, roughness: 0.9 });
      const paper = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 1.2), side: THREE.DoubleSide });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const st = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.38), paper);
        st.position.set(Math.cos(a) * 1, Math.sin(a) * 1 - 0.2, 0);
        g.add(st);
        const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.6) }));
        orb.position.set(Math.cos(a + 0.4) * 1.18, Math.sin(a + 0.4) * 1.18, 0);
        g.add(orb);
      }
      for (const sx of [-1, 1]) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), stone);
        rock.position.set(sx * 1.25, -0.85, 0);
        g.add(rock);
      }
    }
    g.visible = false;
    this.group.add(g);
    return g;
  }

  update(world: WorldSim, env: Environment, dt: number, time: number): void {
    let ri = 0, gi = 0, si = 0;
    const rc = env.ring;
    for (const c of world.active) {
      for (const r of c.rings) {
        if (r.missed && r.pop <= 0) continue;
        if (r.passed && r.pop <= 0) continue;
        let scale = r.radius * this.radiusMul;
        let bright = 1.45;
        if (r.passed) {
          r.pop = Math.max(0, r.pop - dt * 2.2);
          scale *= 1 + (1 - r.pop) * 0.8;
          bright = 2.6 * r.pop;
        } else if (r.missed) {
          r.pop = 0;
          continue;
        }
        const pulse = 1 + 0.04 * Math.sin(time * 4 + r.z * 0.1);
        this.m.compose(this.p.set(r.x, r.y, r.z), this.q.identity(), this.s.set(scale * pulse, scale * pulse, scale));
        this.rings.setMatrixAt(ri, this.m);
        this.membranes.setMatrixAt(ri, this.m);
        this.c.copy(rc).multiplyScalar(bright);
        this.rings.setColorAt(ri, this.c);
        this.c.copy(rc).multiplyScalar(r.passed ? r.pop : 1);
        this.membranes.setColorAt(ri, this.c);
        if (++ri >= 96) break;
      }
      for (const g of c.glimmers) {
        if (g.taken || gi >= 600) continue;
        this.m.compose(this.p.set(g.x, g.y, g.z), this.q.identity(), this.s.set(0.85, 0.85, 0.85));
        this.glimmers.setMatrixAt(gi++, this.m);
      }
      for (const s of c.shrines) {
        if (s.taken || si >= this.shrines.length) continue;
        const sh = this.shrines[si++];
        sh.visible = true;
        sh.position.set(s.x, s.y, s.z);
        sh.scale.setScalar(s.radius);
        sh.rotation.z = time * 0.25;
      }
    }
    for (let k = si; k < this.shrines.length; k++) this.shrines[k].visible = false;
    for (let k = 0; k < 2; k++) {
      const im = k === 0 ? this.rings : this.membranes;
      im.count = ri;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.glimmers.count = gi;
    this.glimmers.instanceMatrix.needsUpdate = true;
  }
}
