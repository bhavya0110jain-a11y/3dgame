import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameContext } from '../game/types';

/** Light radius bounds (world units). Light (health) maps linearly into this range. */
export const MIN_LIGHT_RADIUS = 3.5;
export const MAX_LIGHT_RADIUS = 13;

export class Player {
  readonly group = new THREE.Group();
  readonly body: THREE.Group = new THREE.Group();
  readonly lantern: THREE.Mesh;
  readonly light: THREE.PointLight;
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  facing = 0;
  readonly radius = 0.5;
  lightValue = 100; // current health
  invuln = 0;
  dead = false;
  private bob = 0;
  private flameMat: THREE.MeshBasicMaterial;
  private robeMat: THREE.MeshStandardMaterial;
  private hurtFlash = 0;
  /** Last non-zero move direction — used for aiming directional weapons. */
  aimX = 0;
  aimZ = 1;
  lightColor = new THREE.Color(0xffa64d);

  constructor(scene: THREE.Scene) {
    this.robeMat = new THREE.MeshStandardMaterial({ color: 0x3b3550, roughness: 0.85, flatShading: true });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x1a1622, roughness: 1, flatShading: true });
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 8).translate(0, 0.7, 0), this.robeMat);
    const hood = new THREE.Mesh(
      mergeGeometries([
        new THREE.SphereGeometry(0.34, 8, 6).translate(0, 1.5, 0).toNonIndexed(),
        new THREE.ConeGeometry(0.22, 0.5, 6).rotateX(-0.5).translate(0, 1.82, -0.18).toNonIndexed(),
      ]),
      this.robeMat,
    );
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6).translate(0, 1.47, 0.14), skinMat);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd28a });
    const eyes = new THREE.Mesh(
      mergeGeometries([
        new THREE.SphereGeometry(0.035, 5, 4).translate(-0.07, 1.5, 0.33),
        new THREE.SphereGeometry(0.035, 5, 4).translate(0.07, 1.5, 0.33),
      ]),
      eyeMat,
    );
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.9, 8, 1, true).translate(0, 1.0, -0.05), this.robeMat);
    this.body.add(robe, hood, face, eyes, cloak);

    // Staff + lantern
    const staffMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.1, 5).translate(0.55, 1.05, 0.15), staffMat);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 4, 8, Math.PI).translate(0.55, 2.1, 0.15), staffMat);
    const cageMat = new THREE.MeshStandardMaterial({ color: 0x5a4a2a, metalness: 0.6, roughness: 0.4 });
    const cage = new THREE.Mesh(
      mergeGeometries([
        new THREE.CylinderGeometry(0.16, 0.2, 0.06, 6).translate(0, 0.22, 0).toNonIndexed(),
        new THREE.CylinderGeometry(0.2, 0.16, 0.06, 6).translate(0, -0.22, 0).toNonIndexed(),
        new THREE.CylinderGeometry(0.04, 0.12, 0.12, 6).translate(0, 0.3, 0).toNonIndexed(),
      ]),
      cageMat,
    );
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffc070 });
    this.lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 1), this.flameMat);
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.38, 6),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.35 }),
    );
    const lanternGroup = new THREE.Group();
    lanternGroup.add(cage, this.lantern, glass);
    lanternGroup.position.set(0.55, 1.75, 0.15);
    this.body.add(staff, hook, lanternGroup);

    this.light = new THREE.PointLight(0xffa64d, 40, 14, 1.4);
    this.light.position.set(0.55, 2.2, 0.15);
    this.body.add(this.light);

    this.group.add(this.body);
    scene.add(this.group);
  }

  setRobeColor(hex: number): void {
    this.robeMat.color.setHex(hex);
  }

  reset(maxLight: number): void {
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.lightValue = maxLight;
    this.invuln = 0;
    this.dead = false;
    this.group.visible = true;
    this.group.position.set(0, 0, 0);
  }

  /** Normalized light (health) 0..1. */
  lightFrac(maxLight: number): number {
    return Math.max(0, Math.min(1, this.lightValue / maxLight));
  }

  lightRadius(maxLight: number): number {
    const f = this.lightFrac(maxLight);
    // Light radius grows a little with max light upgrades too.
    const bonus = Math.min(4, (maxLight - 100) / 50);
    return MIN_LIGHT_RADIUS + (MAX_LIGHT_RADIUS + bonus - MIN_LIGHT_RADIUS) * Math.sqrt(f);
  }

  damage(amount: number, ctx: GameContext): void {
    if (this.dead || this.invuln > 0) return;
    const dmg = Math.max(1, amount - ctx.run.stats.armor);
    this.lightValue -= dmg;
    ctx.run.damageTaken += dmg;
    this.invuln = 0.35;
    this.hurtFlash = 1;
    ctx.events.emit('player:damaged', { amount: dmg });
    if (this.lightValue <= 0) {
      if (ctx.run.stats.revival > 0) {
        ctx.run.stats.revival--;
        this.lightValue = ctx.run.stats.maxLight * 0.6;
        this.invuln = 2.5;
        ctx.fx.ring(this.x, this.z, 0xffd27a, 0.5, 14, 0.9);
        ctx.fx.burst(this.x, 1, this.z, 0xffd27a, 80, 9, 1);
        ctx.enemies.knockbackAll(this.x, this.z, 10, 18);
        ctx.fx.text(this.x, 3, this.z, 'REKINDLED', 'ft-big');
      } else {
        this.lightValue = 0;
        this.dead = true;
      }
    }
  }

  heal(amount: number, ctx: GameContext): void {
    const before = this.lightValue;
    this.lightValue = Math.min(ctx.run.stats.maxLight, this.lightValue + amount);
    const healed = this.lightValue - before;
    if (healed > 0.5) ctx.events.emit('player:healed', { amount: healed });
  }

  update(dt: number, ctx: GameContext, time: number): void {
    const stats = ctx.run.stats;
    const ix = ctx.input.moveX;
    const iz = ctx.input.moveZ;
    const speed = stats.moveSpeed;
    // smooth acceleration
    const accel = 1 - Math.exp(-dt * 14);
    this.vx += (ix * speed - this.vx) * accel;
    this.vz += (iz * speed - this.vz) * accel;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    ctx.world.resolveCollision(this, this.radius);

    const moving = Math.hypot(ix, iz) > 0.1;
    if (moving) {
      this.aimX = ix;
      this.aimZ = iz;
      const target = Math.atan2(ix, iz);
      let d = target - this.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.facing += d * Math.min(1, dt * 12);
    }
    this.bob += dt * (moving ? 10 : 2.5);

    if (this.invuln > 0) this.invuln -= dt;
    if (!this.dead && stats.lightRegen > 0) this.heal(stats.lightRegen * dt, ctx);

    // visuals
    this.group.position.set(this.x, 0, this.z);
    this.body.rotation.y = this.facing;
    this.body.position.y = Math.abs(Math.sin(this.bob)) * (moving ? 0.12 : 0.03);
    this.body.rotation.z = moving ? Math.sin(this.bob) * 0.05 : 0;

    const frac = this.lightFrac(stats.maxLight);
    const radius = this.lightRadius(stats.maxLight);
    const flicker = 0.92 + 0.08 * Math.sin(time * 17) * Math.sin(time * 9.3 + 1.2);
    this.light.distance = radius * 1.35;
    this.light.intensity = (18 + 40 * frac) * flicker;
    this.light.color.copy(this.lightColor);
    const s = 0.8 + 0.4 * frac + Math.sin(time * 20) * 0.05;
    this.lantern.scale.setScalar(s);
    this.flameMat.color.copy(this.lightColor).multiplyScalar(1.2 + frac);

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 5);
    this.robeMat.emissive.setRGB(this.hurtFlash * 0.8, 0, 0);
    this.group.visible = !(this.invuln > 0 && this.hurtFlash <= 0 && Math.floor(time * 20) % 2 === 0 && this.invuln > 0.4);

    ctx.world.setLight(this.x, this.z, radius, time);
  }
}
