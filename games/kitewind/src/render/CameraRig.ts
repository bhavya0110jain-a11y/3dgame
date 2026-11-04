import * as THREE from 'three';
import { clamp, damp } from '../core/math';

/** Chase-camera feel constants (kept together so a feel pass never touches the logic below). */
export const CAM = {
  /** Distance behind the kite at cruise / extra at top speed (m). */
  dist: 7.2,
  distSpeed: 2.6,
  /** Height above the kite (m), lower while diving so the sea rushes up. */
  height: 3.0,
  diveHeight: -0.9,
  /** Position follow rate (1/s): lower = laggier, floatier. */
  follow: 6.5,
  lookFollow: 9,
  /** How far ahead the camera looks (m) and how much it leans into turns (m per rad of bank). */
  lookAhead: 14,
  turnLean: 3.2,
  /** Roll as a fraction of the kite bank, and its rate (1/s). */
  roll: 0.38,
  rollRate: 4.5,
  /** FOV kick at full speed / while diving (deg); slow-mo zoom (deg, negative = tighter). */
  fovSpeed: 13,
  fovDive: 7,
  fovSlowmo: -9,
  /** FOV punch spring (stiffness, damping). */
  punchK: 90,
  punchD: 11,
  /** Shake decay (trauma/s), amplitude (m) and roll amplitude (rad) at trauma 1. */
  shakeDecay: 1.6,
  shakeAmp: 0.42,
  shakeRoll: 0.05,
  /** High-speed buffeting amplitude (m) at full speed. */
  buffet: 0.05,
} as const;

/**
 * Third-person chase camera: sits behind and above the kite along its heading, looks ahead and leans into turns,
 * rolls with the bank, kicks FOV with speed / dive (plus spring "punches" on rings), zooms in during whisker
 * slow-mo, and shakes with trauma² smooth noise. `snap()` jumps to the target (smoke tests).
 */
export class CameraRig {
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  /** Smoothed camera / look-at offsets relative to the kite: following in the kite's moving frame means fast
   * flight never drags the camera far behind — lag only comes from turning, pitching and the explicit speed pull-back. */
  private off = new THREE.Vector3();
  private lookOff = new THREE.Vector3();
  private kite = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tPos = new THREE.Vector3();
  private tLook = new THREE.Vector3();
  private roll = 0;
  private fov = 62;
  private punchV = 0;
  private punchX = 0;
  private t = 0;
  private height: number = CAM.height;
  /** Trauma 0..~1.5; shake amplitude is trauma². Set with Math.max(shake, x). */
  shake = 0;
  /** 0..1 whisker slow-mo amount (set by the game each frame). */
  slowmo = 0;
  /** True while the crashed kite tumbles: the camera stops chasing and drifts back. */
  dying = false;
  /** Menu orbit mode (attract screen). */
  orbit = false;
  private orbitT = 0;
  private wasDying = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Adds an FOV impulse (deg/s) — e.g. a ring pass. */
  punch(v: number): void {
    this.punchV += v;
  }

  /** Target framing for a kite at (x,y,z) with heading yaw (right = -X), pitch, bank. */
  private target(x: number, y: number, z: number, yaw: number, pitch: number, bank: number, dist: number, height: number): void {
    const fx = -Math.sin(yaw), fz = Math.cos(yaw);
    // right vector (screen-right is -X when looking down +Z)
    const rx = -fz, rz = fx;
    this.tPos.set(x - fx * dist, y + height - Math.sin(pitch) * dist * 0.4, z - fz * dist);
    if (this.tPos.y < 1.2) this.tPos.y = 1.2;
    const lean = bank * CAM.turnLean;
    this.tLook.set(x + fx * CAM.lookAhead + rx * lean, y + 0.4 + Math.sin(pitch) * 5, z + fz * CAM.lookAhead + rz * lean);
    this.kite.set(x, y, z);
  }

  update(dt: number, x: number, y: number, z: number, yaw: number, pitch: number, bank: number, speedK: number, dive: boolean, baseFov: number, shakeOn: boolean): void {
    this.t += dt;
    if (this.orbit) {
      // hero framing for the menu: kite on the right third (screen-right = -X), slow sway
      this.orbitT += dt * 0.2;
      const a = this.orbitT;
      const fx = -Math.sin(yaw), fz = Math.cos(yaw);
      this.tPos.set(x - fx * 5.2 + 1.2 + Math.sin(a) * 0.8, y + 1.5 + Math.sin(a * 0.7) * 0.4, z - fz * 5.2);
      this.tLook.set(x + 2.6, y + 0.9, z + 7);
    } else if (this.dying) {
      // stop chasing: pull back and up from where the camera was, keep looking at the wreck
      if (!this.wasDying) {
        this.tmp.subVectors(this.pos, this.look).setY(0).normalize();
        this.tPos.copy(this.pos).addScaledVector(this.tmp, 7);
        this.tPos.y = Math.max(this.pos.y + 4, y + 5);
      }
      this.tLook.set(x, y, z);
    } else {
      this.height += ((dive ? CAM.height + CAM.diveHeight : CAM.height) - this.height) * damp(2.5, dt);
      const sm = this.slowmo;
      const dist = (CAM.dist + speedK * CAM.distSpeed) * (1 - sm * 0.18);
      this.target(x, y, z, yaw, pitch, bank, dist, this.height);
    }
    this.wasDying = this.dying;
    if (this.dying) {
      this.pos.lerp(this.tPos, damp(1.5, dt));
      this.look.lerp(this.tLook, damp(3, dt));
    } else {
      // smooth the offsets in the kite frame, then re-anchor on the kite's current position
      this.kite.set(x, y, z);
      this.off.lerp(this.tmp.subVectors(this.tPos, this.kite), damp(this.orbit ? 4 : CAM.follow, dt));
      this.lookOff.lerp(this.tmp.subVectors(this.tLook, this.kite), damp(CAM.lookFollow, dt));
      this.pos.addVectors(this.kite, this.off);
      if (this.pos.y < 1.2) this.pos.y = 1.2;
      this.look.addVectors(this.kite, this.lookOff);
    }
    this.roll += ((this.dying ? 0 : bank * CAM.roll) - this.roll) * damp(CAM.rollRate, dt);
    // FOV: speed + dive + slow-mo zoom, with a spring punch on top
    const tf = baseFov + speedK * CAM.fovSpeed + (dive ? CAM.fovDive : 0) + this.slowmo * CAM.fovSlowmo;
    this.fov += (tf - this.fov) * damp(4, dt);
    const sdt = Math.min(dt, 1 / 30);
    this.punchV += (-CAM.punchK * this.punchX - CAM.punchD * this.punchV) * sdt;
    this.punchX += this.punchV * sdt;
    this.apply(dt, shakeOn, speedK, dive);
  }

  snap(): void {
    this.pos.copy(this.tPos);
    this.look.copy(this.tLook);
    this.off.subVectors(this.tPos, this.kite);
    this.lookOff.subVectors(this.tLook, this.kite);
  }

  /** Smooth pseudo-noise in -1..1 (sum of incommensurate sines; allocation-free). */
  private n(t: number, s: number): number {
    return (Math.sin(t * 1.0 + s) * 0.5 + Math.sin(t * 2.31 + s * 1.7) * 0.3 + Math.sin(t * 4.97 + s * 2.9) * 0.2);
  }

  private apply(dt: number, shakeOn: boolean, speedK: number, dive: boolean): void {
    const c = this.camera;
    c.position.copy(this.pos);
    this.shake = Math.max(0, this.shake - dt * CAM.shakeDecay);
    let rollShake = 0;
    if (shakeOn) {
      const tr = Math.min(1.5, this.shake);
      const s = tr * tr * CAM.shakeAmp;
      const b = this.orbit || this.dying ? 0 : (speedK * speedK + (dive ? 0.4 : 0)) * CAM.buffet;
      const ts = this.t * 22;
      c.position.x += this.n(ts, 0) * s + this.n(this.t * 9, 3) * b;
      c.position.y += this.n(ts, 11) * s + this.n(this.t * 11, 7) * b;
      rollShake = this.n(ts * 0.8, 23) * tr * tr * CAM.shakeRoll;
    }
    c.lookAt(this.look);
    c.rotateZ(this.orbit ? 0 : -this.roll + rollShake);
    const fov = clamp(this.fov + this.punchX, 30, 110);
    if (Math.abs(c.fov - fov) > 0.01) {
      c.fov = fov;
      c.updateProjectionMatrix();
    }
  }
}
