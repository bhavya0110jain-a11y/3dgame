import * as THREE from 'three';
import type { GameContext } from '../game/types';

export type PickupKind = 'ember' | 'oil' | 'chest' | 'beacon' | 'ash';

export interface Pickup {
  active: boolean;
  kind: PickupKind;
  x: number;
  z: number;
  value: number;
  magnetized: boolean;
  speed: number;
  phase: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** Ember color by value tier. */
function emberColor(v: number): number {
  if (v >= 50) return 0xff3a6a;
  if (v >= 10) return 0x6ab0ff;
  if (v >= 3) return 0x6aff8a;
  return 0xffb347;
}

export class PickupManager {
  readonly list: Pickup[] = [];
  private free: Pickup[] = [];
  private emberMesh: THREE.InstancedMesh;
  private oilMesh: THREE.InstancedMesh;
  private chestMesh: THREE.InstancedMesh;
  private beaconMesh: THREE.InstancedMesh;
  private ashMesh: THREE.InstancedMesh;
  private readonly cap = 1200;

  constructor(scene: THREE.Scene) {
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.emberMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.16, 0).scale(1, 1.5, 1), emberMat, this.cap);
    this.emberMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    const oilMat = new THREE.MeshStandardMaterial({ color: 0xffcf6a, emissive: 0xff8a20, emissiveIntensity: 1.4, roughness: 0.3 });
    this.oilMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.14, 0.22, 0.4, 8).translate(0, 0.2, 0),
      oilMat,
      64,
    );
    const chestMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, emissive: 0xffaa33, emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.4 });
    this.chestMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.55, 0.55).translate(0, 0.3, 0), chestMat, 16);
    const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9ad8ff).multiplyScalar(2.5) });
    this.beaconMesh = new THREE.InstancedMesh(new THREE.TorusKnotGeometry(0.18, 0.05, 32, 6), beaconMat, 16);
    const ashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd0c8ff).multiplyScalar(1.8) });
    this.ashMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.2, 0), ashMat, 128);
    for (const m of [this.emberMesh, this.oilMesh, this.chestMesh, this.beaconMesh, this.ashMesh]) {
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
    }
  }

  spawn(kind: PickupKind, x: number, z: number, value = 1): void {
    if (kind === 'ember') {
      // merge with a nearby ember if too many exist
      if (this.list.length > 600) {
        for (const p of this.list) {
          if (p.active && p.kind === 'ember' && !p.magnetized && (p.x - x) ** 2 + (p.z - z) ** 2 < 25) {
            p.value += value;
            return;
          }
        }
      }
    }
    const p = this.free.pop() ?? ({} as Pickup);
    Object.assign(p, { active: true, kind, x, z, value, magnetized: false, speed: 0, phase: Math.random() * 10 });
    this.list.push(p);
  }

  /** Pull every ember toward the player (beacon pickup). */
  magnetizeAll(): void {
    for (const p of this.list) if (p.kind === 'ember' || p.kind === 'ash') p.magnetized = true;
  }

  clear(): void {
    for (const p of this.list) this.free.push(p);
    this.list.length = 0;
  }

  update(dt: number, ctx: GameContext, time: number): void {
    const pl = ctx.player;
    const magnet = ctx.run.stats.magnet;
    for (const p of this.list) {
      if (!p.active) continue;
      p.phase += dt;
      const dx = pl.x - p.x;
      const dz = pl.z - p.z;
      const d = Math.hypot(dx, dz);
      const autoKinds = p.kind === 'ember' || p.kind === 'ash' || p.kind === 'oil' || p.kind === 'beacon';
      if (!p.magnetized && autoKinds && d < magnet) p.magnetized = true;
      if (p.magnetized) {
        p.speed = Math.min(30, p.speed + dt * 40);
        const k = Math.min(d, p.speed * dt) / (d || 1);
        p.x += dx * k;
        p.z += dz * k;
      }
      if (d < 0.7) this.collect(p, ctx);
      // despawn very distant embers by merging into a big one near the player edge
    }
    let w = 0;
    for (const p of this.list) {
      if (p.active) this.list[w++] = p;
      else this.free.push(p);
    }
    this.list.length = w;
    this.writeInstances(time);
  }

  private collect(p: Pickup, ctx: GameContext): void {
    p.active = false;
    switch (p.kind) {
      case 'ember':
        ctx.run.addXp(p.value);
        break;
      case 'oil':
        ctx.player.heal(ctx.run.stats.maxLight * 0.3, ctx);
        ctx.fx.ring(ctx.player.x, ctx.player.z, 0xffcf6a, 0.5, 3, 0.4);
        break;
      case 'chest':
        ctx.events.emit('chest:opened', {});
        break;
      case 'beacon':
        this.magnetizeAll();
        ctx.fx.ring(ctx.player.x, ctx.player.z, 0x9ad8ff, 0.5, 20, 0.8);
        break;
      case 'ash':
        ctx.run.ashEarned += p.value;
        break;
    }
    ctx.events.emit('pickup:collected', { kind: p.kind, value: p.value });
  }

  private writeInstances(time: number): void {
    let ne = 0, no = 0, nc = 0, nb = 0, na = 0;
    for (const p of this.list) {
      const bob = Math.sin(p.phase * 3) * 0.1;
      tmpQ.setFromAxisAngle(UP, p.phase * 2);
      switch (p.kind) {
        case 'ember': {
          if (ne >= this.cap) break;
          const s = p.value >= 50 ? 2.2 : p.value >= 10 ? 1.6 : p.value >= 3 ? 1.25 : 1;
          tmpP.set(p.x, 0.45 + bob, p.z);
          tmpS.setScalar(s);
          tmpM.compose(tmpP, tmpQ, tmpS);
          this.emberMesh.setMatrixAt(ne, tmpM);
          tmpC.setHex(emberColor(p.value)).multiplyScalar(2.2);
          this.emberMesh.setColorAt(ne, tmpC);
          ne++;
          break;
        }
        case 'oil':
          tmpP.set(p.x, 0.1 + bob, p.z);
          tmpS.setScalar(1.2);
          tmpM.compose(tmpP, tmpQ, tmpS);
          this.oilMesh.setMatrixAt(no++, tmpM);
          break;
        case 'chest':
          tmpP.set(p.x, 0, p.z);
          tmpQ.setFromAxisAngle(UP, Math.sin(p.phase) * 0.2);
          tmpS.setScalar(1 + Math.sin(p.phase * 4) * 0.05);
          tmpM.compose(tmpP, tmpQ, tmpS);
          this.chestMesh.setMatrixAt(nc++, tmpM);
          break;
        case 'beacon':
          tmpP.set(p.x, 0.6 + bob, p.z);
          tmpS.setScalar(1.3);
          tmpM.compose(tmpP, tmpQ, tmpS);
          this.beaconMesh.setMatrixAt(nb++, tmpM);
          break;
        case 'ash':
          tmpP.set(p.x, 0.4 + bob, p.z);
          tmpS.setScalar(1);
          tmpM.compose(tmpP, tmpQ, tmpS);
          this.ashMesh.setMatrixAt(na++, tmpM);
          break;
      }
    }
    const set = (m: THREE.InstancedMesh, n: number) => {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    set(this.emberMesh, ne);
    set(this.oilMesh, no);
    set(this.chestMesh, nc);
    set(this.beaconMesh, nb);
    set(this.ashMesh, na);
  }
}
