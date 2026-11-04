import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Enemy } from './Enemies';

export interface Projectile {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  damage: number;
  pierce: number; // remaining enemies it can pass through (-1 = infinite)
  life: number;
  radius: number;
  color: number;
  scale: number;
  hostile: boolean;
  source: string;
  knockback: number;
  homing: number; // turn rate (rad/s), 0 = none
  hit: Set<number>;
  trail: number; // spark chance per frame
  bounces: number;
  onHit?: (p: Projectile, e: Enemy, ctx: GameContext) => void;
  onExpire?: (p: Projectile, ctx: GameContext) => void;
}

export type ProjectileSpawn = Partial<Projectile> & Pick<Projectile, 'x' | 'z' | 'vx' | 'vz' | 'damage'>;

const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();

export class ProjectileManager {
  private list: Projectile[] = [];
  private free: Projectile[] = [];
  private mesh: THREE.InstancedMesh;
  private readonly capacity = 1500;

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.2, 1), mat, this.capacity);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  spawn(s: ProjectileSpawn): Projectile | null {
    if (this.list.length >= this.capacity) return null;
    const p = this.free.pop() ?? ({ hit: new Set<number>() } as Projectile);
    p.hit.clear();
    Object.assign(p, {
      active: true,
      y: 1.0,
      pierce: 0,
      life: 2,
      radius: 0.25,
      color: 0xffb347,
      scale: 1,
      hostile: false,
      source: 'unknown',
      knockback: 2,
      homing: 0,
      trail: 0.5,
      bounces: 0,
      onHit: undefined,
      onExpire: undefined,
      ...s,
    });
    this.list.push(p);
    return p;
  }

  spawnHostile(x: number, z: number, dx: number, dz: number, speed: number, damage: number, color: number): void {
    this.spawn({ x, z, vx: dx * speed, vz: dz * speed, damage, hostile: true, life: 4, radius: 0.3, color, scale: 1.4, source: 'enemy', trail: 0.3, y: 0.9 });
  }

  clear(): void {
    for (const p of this.list) this.free.push(p);
    this.list.length = 0;
    this.mesh.count = 0;
  }

  update(dt: number, ctx: GameContext): void {
    const enemies = ctx.enemies;
    const player = ctx.player;
    for (const p of this.list) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.onExpire?.(p, ctx);
        continue;
      }
      if (p.homing > 0 && !p.hostile) {
        const t = enemies.nearest(p.x, p.z, 10, p.hit);
        if (t) {
          const speed = Math.hypot(p.vx, p.vz);
          const cur = Math.atan2(p.vz, p.vx);
          const want = Math.atan2(t.z - p.z, t.x - p.x);
          let d = want - cur;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          const turn = Math.sign(d) * Math.min(Math.abs(d), p.homing * dt);
          const a = cur + turn;
          p.vx = Math.cos(a) * speed;
          p.vz = Math.sin(a) * speed;
        }
      }
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      if (Math.random() < p.trail) ctx.fx.spark(p.x, p.y, p.z, -p.vx * 0.1, 0.3, -p.vz * 0.1, p.color, 0.3, 0.25 * p.scale);

      if (p.hostile) {
        const dx = player.x - p.x;
        const dz = player.z - p.z;
        if (dx * dx + dz * dz < (p.radius + player.radius) ** 2) {
          player.damage(p.damage, ctx);
          p.active = false;
          ctx.fx.burst(p.x, p.y, p.z, p.color, 8, 3, 0.3);
        }
        continue;
      }

      enemies.forEachInRadius(p.x, p.z, p.radius, (e) => {
        if (!p.active || p.hit.has(e.id)) return;
        p.hit.add(e.id);
        enemies.damage(e, p.damage, ctx, { knockback: p.knockback, fromX: p.x - p.vx, fromZ: p.z - p.vz, source: p.source });
        ctx.fx.burst(p.x, p.y, p.z, p.color, 4, 3, 0.25, 0.25);
        p.onHit?.(p, e, ctx);
        if (p.pierce === 0) {
          if (p.bounces > 0) {
            p.bounces--;
            const next = enemies.nearest(p.x, p.z, 8, p.hit);
            if (next) {
              const speed = Math.hypot(p.vx, p.vz);
              const d = Math.hypot(next.x - p.x, next.z - p.z) || 1;
              p.vx = ((next.x - p.x) / d) * speed;
              p.vz = ((next.z - p.z) / d) * speed;
              return;
            }
          }
          p.active = false;
          p.onExpire?.(p, ctx);
        } else if (p.pierce > 0) p.pierce--;
      });
    }

    // compact + write instances
    let w = 0;
    let n = 0;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      if (!p.active) {
        this.free.push(p);
        continue;
      }
      this.list[w++] = p;
      tmpM.makeScale(p.scale, p.scale, p.scale);
      tmpM.setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(n, tmpM);
      tmpC.setHex(p.color).multiplyScalar(p.hostile ? 2.2 : 3);
      this.mesh.setColorAt(n, tmpC);
      n++;
    }
    this.list.length = w;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
