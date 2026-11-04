import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameContext } from '../game/types';

/** Light radius bounds (world units). Light (health) maps linearly into this range. */
export const MIN_LIGHT_RADIUS = 3.5;
export const MAX_LIGHT_RADIUS = 13;

const GLOW_GAIN = 2.2;
const BEARER_URL = 'models/characters/bearer.glb';

/**
 * The bearer's GLB is loaded here as a full scene graph (not via Assets' flattened geometry) so its
 * separately exported parts (Head, Cape, Staff, LanternCage, FootL/R) can be animated procedurally.
 * Loading starts at module import, in parallel with Assets.loadAssets(); only fetched when the model
 * manifest lists it (no 404 noise). Missing/invalid file -> procedural fallback.
 */
let bearerScene: THREE.Group | null = null;
const bearerReady: Promise<THREE.Group | null> = (async () => {
  try {
    const res = await fetch('models/manifest.json');
    if (!res.ok) return null;
    const list = (await res.json()) as string[];
    if (!list.includes('characters/bearer')) return null;
    const gltf = await new GLTFLoader().loadAsync(BEARER_URL);
    bearerScene = gltf.scene;
    return bearerScene;
  } catch {
    return null;
  }
})();

/** Animated parts; any may be null (procedural fallback lacks feet). */
interface Rig {
  root: THREE.Group;
  head: THREE.Object3D | null;
  cape: THREE.Object3D | null;
  staff: THREE.Object3D | null;
  lanternPivot: THREE.Object3D | null;
  footL: THREE.Object3D | null;
  footR: THREE.Object3D | null;
  /** Light anchor. */
  anchor: THREE.Object3D;
  glass: THREE.Mesh;
  glassMat: THREE.MeshBasicMaterial;
  robeMats: THREE.MeshStandardMaterial[];
  capeMats: THREE.MeshStandardMaterial[];
  bodyMats: THREE.MeshStandardMaterial[];
  rest: Map<THREE.Object3D, { p: THREE.Vector3; r: THREE.Euler }>;
}

const tmpCol = new THREE.Color();
const tmpHsl = { h: 0, s: 0, l: 0 };

/** The lantern hangs ~0.5 m from the bearer: soft-compress direct light on the bearer's own materials so
 *  the hero is warmly lit instead of blown out, and partly desaturate that light so the robe keeps its dyed
 *  colour (an amber key multiplied into a violet robe reads pink, into an indigo one muddy brown). A cool
 *  moonlit fresnel rim separates the silhouette from the warm lantern-lit grass. */
function softenDirectLight(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
      // work on the incoming light (divide the albedo back out) so only the LIGHT is desaturated, never the cloth
      vec3 bAlb = max(diffuseColor.rgb, vec3(0.02));
      vec3 bL = reflectedLight.directDiffuse / bAlb;
      bL = mix(bL, vec3(dot(bL, vec3(0.3, 0.55, 0.15))) * vec3(1.08, 0.98, 0.86), 0.55);
      reflectedLight.directDiffuse = bAlb * bL / (1.0 + bL * 0.9);
      // the lantern sits ~0.5 m away: its broad specular lobe would otherwise wash the cloth grey-amber
      reflectedLight.directSpecular = reflectedLight.directSpecular * 0.5 / (1.0 + reflectedLight.directSpecular * 3.0);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
      float bRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
      totalEmissiveRadiance += diffuseColor.rgb * vec3(0.45, 0.6, 1.25) * bRim * 0.55;`,
      );
  };
  mat.customProgramCacheKey = () => 'bearer-soft-light';
}

export class Player {
  readonly group = new THREE.Group();
  readonly body: THREE.Group = new THREE.Group();
  /** Glowing lantern glass / flame mesh. */
  lantern: THREE.Mesh;
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
  private hurtFlash = 0;
  /** Last non-zero move direction — used for aiming directional weapons. */
  aimX = 0;
  aimZ = 1;
  lightColor = new THREE.Color(0xffa64d);

  private rig: Rig;
  private robeHex = 0x3b3550;
  // animation state
  private moveAmt = 0;
  private turnRate = 0;
  private lastFacing = 0;
  private prevVx = 0;
  private prevVz = 0;
  private leanX = 0;
  private leanZ = 0;
  private swingX = 0;
  private swingZ = 0;
  private swingVX = 0;
  private swingVZ = 0;
  private hurtDirX = 0;
  private hurtDirZ = 0;

  constructor(scene: THREE.Scene) {
    this.light = new THREE.PointLight(0xffa64d, 40, 14, 1.4);
    this.rig = bearerScene ? this.buildFromGlb(bearerScene) : this.buildProcedural();
    this.lantern = this.rig.glass;
    this.mountRig();
    this.setRobeColor(this.robeHex); // the GLB's authored robe colour is only a placeholder
    this.group.add(this.body);
    scene.add(this.group);
    if (!bearerScene) {
      // GLB still in flight (or missing): swap in when it arrives.
      void bearerReady.then((s) => {
        if (!s || this.rig.root.userData.glb) return;
        this.body.remove(this.rig.root);
        this.rig = this.buildFromGlb(s);
        this.lantern = this.rig.glass;
        this.mountRig();
        this.setRobeColor(this.robeHex);
      });
    }
  }

  private mountRig(): void {
    this.body.add(this.rig.root);
    // Light sits above the lantern (not inside it) so the bearer is lit, not blown out, by it.
    this.rig.root.add(this.light);
    this.rig.root.updateMatrixWorld(true);
    this.rig.anchor.getWorldPosition(this.light.position);
    this.rig.root.worldToLocal(this.light.position);
    this.light.position.y += 0.5;
    this.light.position.x += 0.1;
  }

  // ------------------------------------------------------------------ model building
  private buildFromGlb(src: THREE.Group): Rig {
    const root = new THREE.Group();
    root.userData.glb = true;
    const model = src; // single player instance: use the loaded graph directly
    root.add(model);
    const robeMats: THREE.MeshStandardMaterial[] = [];
    const capeMats: THREE.MeshStandardMaterial[] = [];
    const bodyMats: THREE.MeshStandardMaterial[] = [];
    let glass: THREE.Mesh | null = null;
    let glassMat: THREE.MeshBasicMaterial | null = null;
    const cache = new Map<THREE.Material, THREE.Material>();
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      let mat = cache.get(src);
      const name = (src.name || '').toLowerCase();
      const isGlow = name.includes('glow') || name.includes('eye') || name.includes('emit');
      if (!mat) {
        if (isGlow) {
          const c = src.emissive && src.emissive.getHex() !== 0 ? src.emissive.clone() : src.color.clone();
          const m = new THREE.MeshBasicMaterial({ color: c.multiplyScalar(GLOW_GAIN), name: src.name });
          mat = m;
          if (name.includes('lantern')) glassMat = m;
        } else {
          const m = new THREE.MeshStandardMaterial({
            name: src.name,
            color: src.color.clone(),
            vertexColors: !!mesh.geometry.attributes.color,
            roughness: Math.max(0.35, src.roughness ?? 0.7),
            metalness: Math.min(0.3, src.metalness ?? 0),
            side: name.includes('cape') ? THREE.DoubleSide : THREE.FrontSide,
          });
          softenDirectLight(m);
          mat = m;
          bodyMats.push(m);
          if (name === 'robe_cape') capeMats.push(m);
          else if (name.startsWith('robe')) robeMats.push(m);
        }
        cache.set(src, mat);
      }
      mesh.material = mat;
      const lanternPart = /lantern|staff/i.test(mesh.name) || /lantern|staff/i.test(mesh.parent?.name ?? '');
      mesh.castShadow = !isGlow && !lanternPart;
      mesh.receiveShadow = false;
      if (isGlow && /lantern/i.test(mesh.name + ' ' + (src.name || ''))) glass = mesh;
    });
    const find = (n: string) => model.getObjectByName(n) ?? null;
    let anchor = find('lantern');
    const cage = find('LanternCage');
    if (!glass) {
      glassMat = new THREE.MeshBasicMaterial({ color: 0xffc070 });
      glass = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 1), glassMat);
      (cage ?? root).add(glass);
    }
    if (!anchor) {
      anchor = new THREE.Object3D();
      anchor.position.set(0.55, 1.8, 0.4);
      root.add(anchor);
    }
    const rig: Rig = {
      root,
      head: find('Head'),
      cape: find('Cape'),
      staff: find('Staff'),
      lanternPivot: cage,
      footL: find('FootL'),
      footR: find('FootR'),
      anchor,
      glass: glass as THREE.Mesh,
      glassMat: glassMat ?? new THREE.MeshBasicMaterial(),
      robeMats,
      capeMats,
      bodyMats,
      rest: new Map(),
    };
    this.captureRest(rig);
    return rig;
  }

  /** Fallback when bearer.glb is missing: rounded procedural pilgrim with the same animatable parts. */
  private buildProcedural(): Rig {
    const root = new THREE.Group();
    const robeMat = new THREE.MeshStandardMaterial({ color: 0x6a5aa0, roughness: 0.85 });
    const capeMat = new THREE.MeshStandardMaterial({ color: 0x55487f, roughness: 0.85, side: THREE.DoubleSide });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x241a36, roughness: 1 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5030, roughness: 0.8 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xe0a850, metalness: 0.3, roughness: 0.4 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x5a3626, roughness: 0.8 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd890).multiplyScalar(GLOW_GAIN) });
    const robe = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.0, 0.07),
          new THREE.Vector2(0.36, 0.08),
          new THREE.Vector2(0.34, 0.35),
          new THREE.Vector2(0.28, 0.8),
          new THREE.Vector2(0.27, 1.15),
          new THREE.Vector2(0.17, 1.32),
          new THREE.Vector2(0.0, 1.38),
        ],
        16,
      ),
      robeMat,
    );
    root.add(robe);
    const head = new THREE.Group();
    head.position.set(0, 1.3, 0);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12).translate(0, 0.26, -0.03), robeMat);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10).scale(1, 1, 0.5).translate(0, 0.21, 0.2), faceMat);
    const eyes = new THREE.Mesh(
      mergeGeometries([
        new THREE.SphereGeometry(0.04, 8, 6).scale(1, 1.2, 0.5).translate(-0.065, 0.22, 0.29),
        new THREE.SphereGeometry(0.04, 8, 6).scale(1, 1.2, 0.5).translate(0.065, 0.22, 0.29),
      ]),
      eyeMat,
    );
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 10).rotateX(-1.1).translate(0, 0.5, -0.28), robeMat);
    head.add(hood, face, eyes, tip);
    root.add(head);
    const cape = new THREE.Group();
    cape.position.set(0, 1.3, -0.04);
    cape.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 0.46, 16, 1, true).translate(0, -0.2, 0), capeMat));
    root.add(cape);
    const staff = new THREE.Group();
    staff.position.set(0.37, 0.98, 0.2);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.0, 8).translate(0, 0.03, 0), woodMat);
    const crook = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 6, 12, Math.PI).rotateY(Math.PI / 2 + 0.7).translate(0.12, 1.03, 0.1), woodMat);
    staff.add(shaft, crook);
    root.add(staff);
    const lanternPivot = new THREE.Group();
    lanternPivot.position.set(0.61, 2.06, 0.43);
    const cageGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.05, 0.115, 0.07, 8).translate(0, -0.12, 0).toNonIndexed(),
      new THREE.CylinderGeometry(0.105, 0.08, 0.05, 8).translate(0, -0.37, 0).toNonIndexed(),
    ]);
    const glassMat = new THREE.MeshBasicMaterial({ color: 0xffc070 });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.2, 8).translate(0, -0.255, 0), glassMat);
    lanternPivot.add(new THREE.Mesh(cageGeo, brassMat), glass);
    const anchor = new THREE.Object3D();
    anchor.position.set(0, -0.255, 0);
    lanternPivot.add(anchor);
    root.add(lanternPivot);
    const footL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8).scale(1, 0.75, 1.5).translate(0, -0.035, 0.07), bootMat);
    footL.position.set(0.13, 0.1, 0.1);
    const footR = footL.clone();
    footR.position.x = -0.13;
    root.add(footL, footR);
    for (const mm of [robeMat, capeMat, faceMat, woodMat, brassMat, bootMat]) softenDirectLight(mm);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = m.material !== glassMat && m.material !== eyeMat && m.parent !== staff && m.parent !== lanternPivot;
    });
    const rig: Rig = {
      root,
      head,
      cape,
      staff,
      lanternPivot,
      footL,
      footR,
      anchor,
      glass,
      glassMat,
      robeMats: [robeMat],
      capeMats: [capeMat],
      bodyMats: [robeMat, capeMat, faceMat, woodMat, brassMat, bootMat],
      rest: new Map(),
    };
    this.captureRest(rig);
    return rig;
  }

  private captureRest(rig: Rig): void {
    for (const o of [rig.head, rig.cape, rig.staff, rig.lanternPivot, rig.footL, rig.footR]) {
      if (o) rig.rest.set(o, { p: o.position.clone(), r: o.rotation.clone() });
    }
  }

  /** Tints the robe/hood/cape. Bearer robe colours in data are dark; lift them so the hero reads at night. */
  setRobeColor(hex: number): void {
    this.robeHex = hex;
    tmpCol.setHex(hex).getHSL(tmpHsl);
    // The lantern + its bloom wash the bearer in amber: a violet robe multiplies out to pink and a dull indigo
    // to tan. Cool hues are pulled towards a deep azure-indigo and saturated hard so, once warmed, they read
    // as rich storybook blue-violet cloth; warm hues (rust, crimson) survive amber light and keep the old lift.
    let h = tmpHsl.h;
    let s: number;
    let l: number;
    if (h > 0.5 && h < 0.97) {
      if (h > 0.66) h = 0.63 + (h - 0.66) * 0.1;
      s = Math.min(0.8, tmpHsl.s * 1.8 + 0.35);
      l = Math.min(0.44, Math.max(0.34, tmpHsl.l * 1.1 + 0.12));
    } else {
      s = Math.min(0.8, tmpHsl.s * 1.8 + 0.25);
      l = Math.min(0.42, Math.max(0.28, tmpHsl.l * 1.1 + 0.1));
    }
    tmpCol.setHSL(h, s, l);
    for (const m of this.rig.robeMats) m.color.copy(tmpCol);
    for (const m of this.rig.capeMats) m.color.copy(tmpCol).multiplyScalar(0.82);
  }

  reset(maxLight: number): void {
    this.x = 0;
    this.z = 0;
    this.vx = 0;
    this.vz = 0;
    this.prevVx = 0;
    this.prevVz = 0;
    this.swingX = this.swingZ = this.swingVX = this.swingVZ = 0;
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
    // recoil away from the nearest enemy (visual only)
    const e = ctx.enemies.nearest(this.x, this.z, 4);
    if (e) {
      const dx = this.x - e.x;
      const dz = this.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      this.hurtDirX = dx / d;
      this.hurtDirZ = dz / d;
    }
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

    if (this.invuln > 0) this.invuln -= dt;
    if (!this.dead && stats.lightRegen > 0) this.heal(stats.lightRegen * dt, ctx);

    this.group.position.set(this.x, 0, this.z);
    this.animate(dt, time, speed);

    const frac = this.lightFrac(stats.maxLight);
    const radius = this.lightRadius(stats.maxLight);
    const flicker = 0.92 + 0.08 * Math.sin(time * 17) * Math.sin(time * 9.3 + 1.2);
    this.light.distance = radius * 1.35;
    this.light.intensity = (18 + 40 * frac) * flicker;
    this.light.color.copy(this.lightColor);
    const s = 0.94 + 0.08 * frac + Math.sin(time * 20) * 0.02;
    this.lantern.scale.set(s, 1, s);
    this.rig.glassMat.color
      .copy(this.lightColor)
      .multiplyScalar((0.9 + 0.9 * frac) * flicker)
      .lerp(tmpCol.setRGB(2.2, 2.0, 1.6), 0.15 * frac);

    this.group.visible = !(this.invuln > 0 && this.hurtFlash <= 0 && Math.floor(time * 20) % 2 === 0 && this.invuln > 0.4);

    ctx.world.setLight(this.x, this.z, radius, time);
  }

  /** Procedural character animation: step bounce + squash/stretch, lean into motion, cape / lantern
   *  secondary motion, staff plant, foot steps, idle breathing and a hurt recoil flash. */
  private animate(dt: number, time: number, maxSpeed: number): void {
    const rig = this.rig;
    const spd = Math.hypot(this.vx, this.vz);
    const mv = Math.min(1, spd / Math.max(0.1, maxSpeed));
    this.moveAmt += (mv - this.moveAmt) * Math.min(1, dt * 10);
    const m = this.moveAmt;
    this.bob += dt * (m > 0.05 ? 4 + spd * 1.5 : 0);
    // keep phase bounded without visible jumps (period 2π)
    if (this.bob > Math.PI * 200) this.bob -= Math.PI * 200;
    const ph = this.bob;
    const step = Math.abs(Math.sin(ph)); // 0 at foot contact, 1 mid-stride

    // facing turn rate (for banking / cape lag)
    let df = this.facing - this.lastFacing;
    while (df > Math.PI) df -= Math.PI * 2;
    while (df < -Math.PI) df += Math.PI * 2;
    this.lastFacing = this.facing;
    const tr = dt > 0 ? df / dt : 0;
    this.turnRate += (tr - this.turnRate) * Math.min(1, dt * 8);

    // velocity / acceleration in local (facing) space: forward = +Z
    const sf = Math.sin(this.facing);
    const cf = Math.cos(this.facing);
    const ax = dt > 0 ? (this.vx - this.prevVx) / dt : 0;
    const az = dt > 0 ? (this.vz - this.prevVz) / dt : 0;
    this.prevVx = this.vx;
    this.prevVz = this.vz;
    const aFwd = ax * sf + az * cf;
    const aSide = ax * cf - az * sf;

    // lean forward with speed, extra on acceleration; bank into turns
    const leanXT = m * 0.13 + THREE.MathUtils.clamp(aFwd * 0.006, -0.08, 0.1);
    const leanZT = THREE.MathUtils.clamp(-this.turnRate * 0.035 * m, -0.22, 0.22);
    this.leanX += (leanXT - this.leanX) * Math.min(1, dt * 10);
    this.leanZ += (leanZT - this.leanZ) * Math.min(1, dt * 8);

    // squash & stretch: squash at foot contact, stretch at mid-stride; idle breathing
    const breathe = Math.sin(time * 2.4) * 0.018 * (1 - m);
    const h = this.hurtFlash;
    let sy = 1 + m * (step * 0.07 - (1 - step) * 0.05) + breathe - h * 0.14;
    sy = Math.max(0.7, sy);
    const sxz = 1 / Math.sqrt(sy);
    const root = rig.root;
    root.scale.set(sxz, sy, sxz);
    root.position.y = step * 0.1 * m;
    // hurt recoil: tilt away from hit (direction converted into local space)
    const hx = this.hurtDirX * cf - this.hurtDirZ * sf;
    const hz = this.hurtDirX * sf + this.hurtDirZ * cf;
    root.rotation.x = this.leanX - hz * h * 0.35;
    root.rotation.z = this.leanZ + Math.sin(ph) * 0.045 * m + hx * h * 0.35;
    this.body.rotation.y = this.facing;

    // head: slight nod per step, breathing, look into turns
    const rest = rig.rest;
    if (rig.head) {
      const r = rest.get(rig.head)!;
      rig.head.rotation.set(
        r.r.x + Math.sin(ph * 2 + 0.6) * 0.05 * m - this.leanX * 0.4 + Math.sin(time * 2.4 + 0.5) * 0.025 * (1 - m),
        r.r.y + THREE.MathUtils.clamp(this.turnRate * 0.06, -0.35, 0.35),
        r.r.z - this.leanZ * 0.5,
      );
    }
    // cape: trails behind with speed, flutters with steps, lags turns
    if (rig.cape) {
      const r = rest.get(rig.cape)!;
      rig.cape.rotation.set(
        r.r.x + m * 0.32 + Math.sin(ph * 2) * 0.06 * m + Math.sin(time * 1.7) * 0.03 + this.leanX * 0.6,
        r.r.y - this.turnRate * 0.03,
        r.r.z + this.turnRate * 0.05 * m + Math.sin(time * 1.3) * 0.02,
      );
    }
    // staff: plants and swings with the stride
    if (rig.staff) {
      const r = rest.get(rig.staff)!;
      rig.staff.position.set(r.p.x, r.p.y + Math.max(0, Math.sin(ph)) * 0.05 * m, r.p.z + Math.sin(ph) * 0.06 * m);
      rig.staff.rotation.set(r.r.x + Math.sin(ph) * 0.14 * m - this.leanX * 0.5, r.r.y, r.r.z - Math.cos(ph) * 0.05 * m);
    }
    // lantern: damped pendulum driven by body acceleration + stride bounce
    if (rig.lanternPivot) {
      const k = 38;
      const c = 3.2;
      const fx = -aFwd * 0.03 + Math.sin(ph * 2) * 0.6 * m;
      const fz = aSide * 0.03 + this.turnRate * 0.5 * m;
      this.swingVX += (-k * this.swingX - c * this.swingVX + fx * 10) * dt;
      this.swingVZ += (-k * this.swingZ - c * this.swingVZ + fz * 10) * dt;
      this.swingX += this.swingVX * dt;
      this.swingZ += this.swingVZ * dt;
      this.swingX = THREE.MathUtils.clamp(this.swingX, -0.7, 0.7);
      this.swingZ = THREE.MathUtils.clamp(this.swingZ, -0.7, 0.7);
      const r = rest.get(rig.lanternPivot)!;
      rig.lanternPivot.rotation.set(
        r.r.x + this.swingX - (rig.staff ? rig.staff.rotation.x - rest.get(rig.staff)!.r.x : 0) + Math.sin(time * 1.6) * 0.04,
        r.r.y,
        r.r.z + this.swingZ + Math.sin(time * 1.1 + 1) * 0.03,
      );
    }
    // feet: alternate steps (lift + stride)
    const feet: [THREE.Object3D | null, number][] = [
      [rig.footL, 0],
      [rig.footR, Math.PI],
    ];
    for (const [f, off] of feet) {
      if (!f) continue;
      const r = rest.get(f)!;
      const s = Math.sin(ph + off);
      const lift = Math.max(0, Math.cos(ph + off)) * 0.09 * m;
      f.position.set(r.p.x, r.p.y + lift, r.p.z + s * 0.16 * m);
      f.rotation.set(r.r.x - s * 0.35 * m, r.r.y, r.r.z);
    }

    // hurt flash on every lit material
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 5);
    const fl = this.hurtFlash;
    for (const mat of rig.bodyMats) mat.emissive.setRGB(fl * 0.9, fl * 0.25, fl * 0.2);
  }
}
