import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { shared } from '../render/materials';
import type { Models } from '../render/Models';
import { CloudLayer } from '../world/Clouds';
import type { Environment } from '../world/Environment';
import type { WorldSim } from '../world/WorldSim';

const MAX_BOLTS = 12;
const SEG = 18;

/** Lightning bolts, wind-gust streaks, bird flocks and thunderclouds (all per-frame, allocation-free). */
export class HazardsView {
  readonly group = new THREE.Group();
  private boltGeo: THREE.BufferGeometry;
  private boltPos: Float32Array;
  private boltCol: Float32Array;
  private bolts: THREE.Mesh;
  private streaks: THREE.InstancedMesh;
  private birds: THREE.InstancedMesh;
  private thunder: CloudLayer;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private c = new THREE.Color();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private side = new THREE.Vector3();
  private toCam = new THREE.Vector3();
  private pts: THREE.Vector3[] = Array.from({ length: SEG + 1 }, () => new THREE.Vector3());
  private streakSeed: Float32Array;
  private rng = new Rng(5);

  constructor(scene: THREE.Scene, models: Models) {
    scene.add(this.group);
    // lightning ribbons
    const verts = MAX_BOLTS * (SEG + 1) * 2;
    this.boltPos = new Float32Array(verts * 3);
    this.boltCol = new Float32Array(verts * 3);
    const idx: number[] = [];
    for (let b = 0; b < MAX_BOLTS; b++)
      for (let i = 0; i < SEG; i++) {
        const o = (b * (SEG + 1) + i) * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    this.boltGeo = new THREE.BufferGeometry();
    this.boltGeo.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.boltGeo.setAttribute('color', new THREE.BufferAttribute(this.boltCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.boltGeo.setIndex(idx);
    this.bolts = new THREE.Mesh(
      this.boltGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.bolts.frustumCulled = false;
    this.group.add(this.bolts);

    // gust streaks
    const sg = new THREE.BoxGeometry(1, 0.05, 0.05);
    this.streaks = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 8 * 32);
    this.streaks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.streaks.setColorAt(0, this.c.set(1, 1, 1));
    this.streaks.frustumCulled = false;
    this.streaks.count = 0;
    this.group.add(this.streaks);
    this.streakSeed = new Float32Array(32 * 4);
    for (let i = 0; i < 32 * 4; i++) this.streakSeed[i] = this.rng.next();

    // birds (flapping in the vertex shader)
    const birdParts = models.get('bird');
    let bg: THREE.BufferGeometry;
    if (birdParts) bg = birdParts[0].geometry;
    else {
      bg = new THREE.BufferGeometry();
      // body + two wings (nose +Z), ~1.3 m span
      const v = [0, 0, 0.45, 0.08, 0, -0.3, -0.08, 0, -0.3, 0, 0, 0.15, 0.65, 0.05, -0.12, 0, 0, -0.2, 0, 0, 0.15, 0, 0, -0.2, -0.65, 0.05, -0.12];
      bg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      bg.computeVertexNormals();
    }
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x1c1626, side: THREE.DoubleSide });
    birdMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = shared.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].y * 1.3;
          transformed.y += sin(uTime * 11.0 + ph) * abs(transformed.x) * 0.9;`,
        );
    };
    this.birds = new THREE.InstancedMesh(bg, birdMat, 160);
    this.birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.birds.frustumCulled = false;
    this.birds.count = 0;
    this.group.add(this.birds);

    this.thunder = new CloudLayer(this.group, 160);
  }

  update(world: WorldSim, env: Environment, camera: THREE.Camera, time: number): void {
    this.thunder.updateEnv(env);
    let bi = 0, si = 0, fi = 0, ti = 0;
    // re-randomise bolt shapes ~20x per second
    const flick = Math.floor(time * 20);
    for (const c of world.active) {
      for (const l of c.lightning) {
        if (l.state === 0 || bi >= MAX_BOLTS) continue;
        const strike = l.state === 2;
        const width = strike ? 0.55 * (1 - l.t * 0.5) : 0.06 + l.t * 0.06;
        const bright = strike ? 3.2 : 0.5 + l.t * 0.8 * (0.5 + 0.5 * Math.sin(time * 50));
        this.writeBolt(bi++, l.ax, l.ay, l.az, l.bx, l.by, l.bz, width, bright, strike ? 2.2 : 0.5, flick + bi * 31, camera);
      }
      for (const g of c.gusts) {
        if (g.state === 0 || g.state === 3) continue;
        const active = g.state === 2;
        const k = active ? 1 : Math.min(1, g.timer / 1.6);
        for (let i = 0; i < 32 && si < 8 * 32; i++) {
          const sd = this.streakSeed;
          const W = g.halfW * 2;
          const spd = active ? 70 : 28;
          const u = (((sd[i * 4] * W + time * spd * (0.7 + sd[i * 4 + 3] * 0.6)) % W) + W) % W;
          const x = g.x - g.dir * (g.halfW - u);
          const y = g.y + (sd[i * 4 + 1] - 0.5) * g.halfH * 2;
          const z = g.z + (sd[i * 4 + 2] - 0.5) * g.halfL * 2.4;
          const len = (active ? 9 : 5) * (0.6 + sd[i * 4 + 3]);
          this.m.compose(this.p.set(x, y, z), this.q.identity(), this.s.set(len, 1 + (active ? 1 : 0), 1));
          this.streaks.setMatrixAt(si, this.m);
          const edge = Math.sin((u / W) * Math.PI);
          const a = (active ? 0.9 : 0.35) * k * edge;
          this.streaks.setColorAt(si++, this.c.setRGB(a * 1.1, a * 1.05, a));
        }
      }
      for (const f of c.flocks) {
        const vx = Math.cos(time * 0.42 + f.phase); // sign of x velocity
        for (let i = 0; i < f.count && fi < 160; i++) {
          const ring = i % 4, row = Math.floor(i / 4);
          const ox = (ring - 1.5) * 1.2 + Math.sin(time * 1.7 + i) * 0.3;
          const oy = row * 0.8 - 0.8 + Math.sin(time * 2.3 + i * 1.7) * 0.25;
          const oz = (row % 2) * 1.1 - 0.5 + Math.cos(time * 1.3 + i) * 0.3;
          this.m.compose(
            this.p.set(f.x + oz * Math.sign(vx), f.y + oy, f.z + ox),
            this.q.setFromEuler(this.e.set(0, vx > 0 ? Math.PI / 2 : -Math.PI / 2, 0)),
            this.s.set(1.1, 1.1, 1.1),
          );
          this.birds.setMatrixAt(fi++, this.m);
        }
      }
      for (const t of c.thunderclouds) {
        for (let k = 0; k < 7 && ti < 160; k++) {
          const a = k * 0.9 + t.phase;
          const r = k === 0 ? 0 : t.radius * 0.55;
          this.thunder.setPuff(ti++, t.x + Math.cos(a) * r, t.y + Math.sin(a * 1.7) * r * 0.3 - t.radius * 0.15, t.z + Math.sin(a) * r * 0.6, t.radius * (k === 0 ? 2.2 : 1.5), k % 4, 0.3, 1, 0.8);
        }
      }
    }
    // collapse unused bolts
    this.bolts.geometry.setDrawRange(0, bi * SEG * 6);
    if (bi > 0) {
      (this.boltGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.boltGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
    this.streaks.count = si;
    this.streaks.instanceMatrix.needsUpdate = true;
    if (this.streaks.instanceColor) this.streaks.instanceColor.needsUpdate = true;
    this.birds.count = fi;
    this.birds.instanceMatrix.needsUpdate = true;
    this.thunder.commit(ti);
  }

  private writeBolt(bi: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, bright: number, jag: number, seed: number, camera: THREE.Camera): void {
    this.a.set(ax, ay, az);
    this.b.set(bx, by, bz);
    this.dir.subVectors(this.b, this.a).normalize();
    const r = this.rng.reseed(seed * 2654435761);
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const env = Math.sin(t * Math.PI);
      this.pts[i].lerpVectors(this.a, this.b, t);
      if (i > 0 && i < SEG) {
        this.pts[i].x += (r.next() - 0.5) * jag * 2 * env;
        this.pts[i].y += (r.next() - 0.5) * jag * 2 * env;
        this.pts[i].z += (r.next() - 0.5) * jag * env;
      }
    }
    for (let i = 0; i <= SEG; i++) {
      const p = this.pts[i];
      this.toCam.subVectors(camera.position, p).normalize();
      this.side.crossVectors(this.dir, this.toCam).normalize().multiplyScalar(width);
      const o = (bi * (SEG + 1) + i) * 2 * 3;
      this.boltPos[o] = p.x + this.side.x;
      this.boltPos[o + 1] = p.y + this.side.y;
      this.boltPos[o + 2] = p.z + this.side.z;
      this.boltPos[o + 3] = p.x - this.side.x;
      this.boltPos[o + 4] = p.y - this.side.y;
      this.boltPos[o + 5] = p.z - this.side.z;
      for (let k = 0; k < 2; k++) {
        this.boltCol[o + k * 3] = 0.7 * bright;
        this.boltCol[o + k * 3 + 1] = 0.75 * bright;
        this.boltCol[o + k * 3 + 2] = 1.0 * bright;
      }
    }
  }
}
