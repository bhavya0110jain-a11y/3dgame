import * as THREE from 'three';
import { renderView, VIEW_TALL } from './Quality';

const smooth = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Gameplay framing at zoom 1: camera sits BACK m behind (+Z) and HEIGHT m above the focus (~52° pitch). */
const HEIGHT = 18.5;
const BACK = 14.5;
/** Direction the menu hero shot looks (towards the low moon over the -Z horizon, see Sky.moonDir). */
const HERO_FWD = new THREE.Vector3(-0.3, 0, -1).normalize();
/** Zoom at an empty field: ~10% closer than the base framing so the bearer reads >= ~45 px tall at 720p. */
const ZOOM_CALM = 0.9;
/** Zoom at full crowd pressure. */
const ZOOM_CROWD = 1.3;
/** A boss closer than this (m) pulls the framing (art review s2 #13): the look-at is biased towards it and the
 *  camera zooms out, so a tall boss clears the boss bar at the top of the screen. */
const BOSS_FRAME_R = 14;
/** Share of the bearer→boss offset added to the look-at (capped 5.5 m). Review asked 25%; ~40% was needed for the
 *  Hollow Stag's antlers to clear the boss bar at 720p. */
const BOSS_BIAS = 0.4;
/** Extra zoom-out while a boss is within BOSS_FRAME_R. */
const BOSS_ZOOM = 0.12;
/** Duration (s) of the menu → run swoop. */
const SWOOP_S = 1.35;

/**
 * Camera feel (driven from Game.updateCamera):
 *  - gameplay: critically-damped follow with velocity look-ahead (smoothed separately so direction changes
 *    don't jerk the frame), zoom that eases out with crowd size / boss presence, boss-aware framing that drifts
 *    towards the boss, trauma-based shake (amplitude = trauma², smooth multi-sine noise, a touch of roll)
 *  - menu: low-angle hero shot of the bearer on the left third, silhouetted against the moon, slow sway
 *  - menu → run: smootherstep 1.35 s crane swoop from the hero shot up into the gameplay angle
 * Allocation-free per frame.
 */
export class CameraRig {
  /** Smoothed point the camera looks at (ground level). Also the moon-shadow centre. */
  readonly focus = new THREE.Vector3();
  /** Current zoom multiplier (1 = default framing, ZOOM_CALM on an empty field). */
  zoom = ZOOM_CALM;
  private lead = new THREE.Vector3();
  private look = new THREE.Vector3();
  private desiredPos = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();
  private fromPos = new THREE.Vector3();
  private fromLook = new THREE.Vector3();
  private blend = 1;
  private mode: 'menu' | 'follow' = 'menu';
  private shakeT = 0;
  private menuT = 0;
  private corner = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Snap the gameplay camera onto (x, z) without smoothing (e.g. after a teleport). */
  snap(x: number, z: number): void {
    this.mode = 'follow'; // BUG-QA-021: a snap also cancels a pending menu→run swoop
    this.focus.set(x, 0, z);
    this.lead.set(0, 0, 0);
    this.blend = 1;
  }

  menu(dt: number, x: number, z: number): void {
    const cam = this.camera;
    if (this.mode !== 'menu') {
      this.mode = 'menu';
      this.menuT = 0;
    }
    this.menuT += dt;
    const t = this.menuT;
    // gentle sway (±7°) + breathing dolly; never a full orbit, so the moon stays framed behind the bearer
    const yaw = Math.sin(t * 0.11) * 0.12;
    // portrait: the menu stack fills the lower third, so pull back and centre the bearer (x ≈ 50%, y ≈ 58%)
    const portrait = cam.aspect < 1;
    const dist = (6.1 + Math.sin(t * 0.17) * 0.25) * (portrait ? 1.3 : 1);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const fx = HERO_FWD.x * cy - HERO_FWD.z * sy;
    const fz = HERO_FWD.x * sy + HERO_FWD.z * cy;
    const rx = -fz;
    const rz = fx;
    cam.position.set(x - fx * dist + rx * 0.5, 1.5 + Math.sin(t * 0.23) * 0.06, z - fz * dist + rz * 0.5);
    // look past the bearer, offset right → bearer sits on the left third, sky + moon fill the upper frame
    if (portrait) this.look.set(x + fx * 4 - rx * 0.45, 1.3, z + fz * 4 - rz * 0.45);
    else this.look.set(x + fx * 4 + rx * 3.1, 2.25, z + fz * 4 + rz * 3.1);
    cam.lookAt(this.look);
    this.focus.set(x, 0, z);
    this.zoom = ZOOM_CALM;
    this.updateView();
  }

  /** Publishes the camera's ground footprint (renderView) for world culling. Allocation-free. */
  updateView(): void {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const v = renderView;
    const o = cam.position;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < 4; i++) {
      const p = this.corner.set(i & 1 ? 1 : -1, i & 2 ? 1 : -1, 0.5).unproject(cam).sub(o);
      // a corner ray that does not dive steeply enough reaches the far fog / horizon: no finite footprint
      if (p.y > -0.05 * p.length() || o.y <= VIEW_TALL) {
        v.valid = false;
        return;
      }
      for (let k = 0; k < 2; k++) {
        const t = ((k ? VIEW_TALL : 0) - o.y) / p.y;
        const x = o.x + p.x * t;
        const z = o.z + p.z * t;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    v.valid = true;
    v.minX = minX;
    v.maxX = maxX;
    v.minZ = minZ;
    v.maxZ = maxZ;
  }

  /**
   * @param crowd  0..1 pressure (enemy count / boss) → zoom out up to ~30%
   * @param trauma 0..1 shake trauma (Game.shakeAmt)
   * @param bossX/bossZ boss position, or NaN when none
   */
  follow(dt: number, x: number, z: number, vx: number, vz: number, crowd: number, trauma: number, bossX: number, bossZ: number): void {
    const cam = this.camera;
    if (this.mode !== 'follow') {
      this.mode = 'follow';
      this.fromPos.copy(cam.position);
      this.fromLook.copy(this.look);
      this.blend = 0;
      this.focus.set(x, 0, z);
      this.lead.set(0, 0, 0);
    }
    // look-ahead: ~0.32 s of travel, capped, eased in slowly
    let lx = vx * 0.32;
    let lz = vz * 0.32;
    const ll = Math.hypot(lx, lz);
    if (ll > 2.4) {
      lx *= 2.4 / ll;
      lz *= 2.4 / ll;
    }
    const kl = smooth(2.6, dt);
    this.lead.x += (lx - this.lead.x) * kl;
    this.lead.z += (lz - this.lead.z) * kl;
    let tx = x + this.lead.x;
    let tz = z + this.lead.z;
    let bossW = 0;
    if (Number.isFinite(bossX)) {
      // boss within ~14 m: bias the look-at towards it (capped 5.5 m) so boss and bearer share the frame and the
      // boss bar does not sit on its head; fades out between 14 and 20 m
      const dx = bossX - x;
      const dz = bossZ - z;
      const d = Math.hypot(dx, dz);
      const u = clamp((d - BOSS_FRAME_R) / 6, 0, 1);
      bossW = 1 - u * u * (3 - 2 * u);
      let bx = dx * BOSS_BIAS * bossW;
      let bz = dz * BOSS_BIAS * bossW;
      const bl = Math.hypot(bx, bz);
      if (bl > 5.5) {
        bx *= 5.5 / bl;
        bz *= 5.5 / bl;
      }
      tx += bx;
      tz += bz;
    }
    const kf = smooth(7, dt);
    this.focus.x += (tx - this.focus.x) * kf;
    this.focus.z += (tz - this.focus.z) * kf;
    const targetZoom = (ZOOM_CALM + clamp(crowd, 0, 1) * (ZOOM_CROWD - ZOOM_CALM)) * (1 + BOSS_ZOOM * bossW);
    this.zoom += (targetZoom - this.zoom) * smooth(targetZoom > this.zoom ? 0.9 : 0.5, dt);

    const z0 = this.zoom;
    this.desiredPos.set(this.focus.x, HEIGHT * z0, this.focus.z + BACK * z0);
    this.desiredLook.set(this.focus.x, 0, this.focus.z - 0.6);

    // shake: trauma² amplitude, smooth multi-frequency noise (no white-noise jitter)
    this.shakeT += dt;
    const a = trauma * trauma;
    if (a > 1e-4) {
      const t = this.shakeT;
      const n1 = Math.sin(t * 37.1) * 0.6 + Math.sin(t * 61.7 + 1.3) * 0.4;
      const n2 = Math.sin(t * 41.3 + 2.1) * 0.6 + Math.sin(t * 57.9 + 0.4) * 0.4;
      const n3 = Math.sin(t * 29.3 + 4.2) * 0.7 + Math.sin(t * 71.1) * 0.3;
      this.desiredPos.x += n1 * a * 0.55;
      this.desiredPos.y += n2 * a * 0.35;
      this.desiredLook.x += n1 * a * 0.25;
      this.desiredLook.z += n3 * a * 0.25;
    }

    if (this.blend < 1) {
      // swoop: smootherstep ease (zero velocity AND acceleration at both ends), a gentle crane arc so the camera
      // lifts over the glade instead of sliding through it, and the gaze tips down slightly ahead of the body
      // so the bearer never leaves the frame mid-move. dt is clamped so a load hitch cannot skip the move.
      const b = (this.blend = Math.min(1, this.blend + Math.min(dt, 1 / 30) / SWOOP_S));
      const e = b * b * b * (b * (b * 6 - 15) + 10);
      const eLook = 1 - (1 - e) * (1 - e);
      cam.position.copy(this.fromPos).lerp(this.desiredPos, e);
      cam.position.y += Math.sin(Math.PI * e) * 2.2;
      this.look.copy(this.fromLook).lerp(this.desiredLook, eLook);
    } else {
      cam.position.copy(this.desiredPos);
      this.look.copy(this.desiredLook);
    }
    cam.lookAt(this.look);
    if (a > 1e-4) cam.rotateZ(Math.sin(this.shakeT * 23.7 + 0.8) * a * 0.03);
    this.updateView();
  }
}
