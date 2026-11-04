import { FLIGHT } from '../data/tuning';
import { clamp, damp, approach, DEG } from '../core/math';
import type { Mods } from './Mods';

/** Per-frame control intent (already smoothed / normalised by the input layer). */
export interface FlightInput {
  /** -1 (left) .. 1 (right). */
  steerX: number;
  /** -1 (nose down) .. 1 (climb). */
  steerY: number;
  dive: boolean;
}

/**
 * The kite flight model — pure, allocation-free, unit-tested (tests/flight.test.ts).
 *
 * Coordinates: +Z is the flight corridor ("distance"), +Y up, sea at y = 0. A chase camera looking down +Z sees
 * -X on its right, so "right" (positive steerX / bank / yaw) moves the kite toward -X.
 * Model: the kite has a heading (yaw), pitch and bank. Bank follows steerX and yaws the kite; pitch follows steerY
 * (or the dive pitch while diving). Speed follows an energy model: gravity along the path (climbing costs speed,
 * diving gains it), relaxation toward cruise, dive thrust and temporary ring boosts. LIFT is the life resource:
 * it drains every second (more while climbing, more the further you fly); while empty the kite cannot climb and
 * sinks toward the sea. External wind (updrafts, gusts) adds a decaying velocity.
 */
export class KiteFlight {
  x = 0;
  y: number = FLIGHT.startAltitude;
  z = 0;
  /** Heading (rad), 0 = +Z, positive turns right (toward -X). */
  yaw = 0;
  /** Pitch (rad), positive = nose up. */
  pitch = 0;
  /** Bank (rad), positive = right wing down (turning right). */
  bank = 0;
  /** Airspeed along heading (m/s), excluding wind. */
  speed: number = FLIGHT.cruiseSpeed;
  /** Temporary extra speed from rings (m/s), decays. */
  boost = 0;
  lift = 100;
  maxLift = 100;
  diving = false;
  /** External wind velocity (m/s). */
  windX = 0;
  windY = 0;
  /** Velocity of the last step (m/s) — read by camera / collision sweep. */
  vx = 0;
  vy = 0;
  vz = 0;
  /** Previous position (start of the last step) for swept ring / plane tests. */
  px = 0;
  py: number = FLIGHT.startAltitude;
  pz = 0;
  /** Distance flown along +Z (m) for drain ramp. */
  get distance(): number {
    return Math.max(0, this.z);
  }

  constructor(public mods: Mods) {
    this.reset();
  }

  reset(): void {
    this.x = 0;
    this.y = FLIGHT.startAltitude;
    this.z = 0;
    this.px = 0;
    this.py = this.y;
    this.pz = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.bank = 0;
    this.speed = FLIGHT.cruiseSpeed * this.mods.speedMul;
    this.boost = 0;
    this.maxLift = 100 * this.mods.liftCapMul;
    this.lift = this.maxLift;
    this.diving = false;
    this.windX = 0;
    this.windY = 0;
    this.vx = this.vy = 0;
    this.vz = this.speed;
  }

  /** Lift fraction 0..1. */
  get liftFrac(): number {
    return this.maxLift > 0 ? this.lift / this.maxLift : 0;
  }

  /** Total speed including boost (m/s). */
  get airspeed(): number {
    return this.speed + this.boost;
  }

  /** Adds lift (clamped). */
  addLift(v: number): void {
    this.lift = clamp(this.lift + v, 0, this.maxLift);
  }

  /** Current lift drain per second (excluding climbing). */
  baseDrain(): number {
    return (FLIGHT.liftDrain + FLIGHT.liftDrainPerKm * (this.distance / 1000)) * this.mods.drainMul;
  }

  /** Advances the model by dt seconds. */
  step(dt: number, input: FlightInput): void {
    const m = this.mods;
    this.px = this.x;
    this.py = this.y;
    this.pz = this.z;
    this.diving = input.dive;

    // --- bank & heading
    const maxBank = FLIGHT.maxBank * DEG;
    const sx = clamp(input.steerX, -1, 1);
    const targetBank = sx * maxBank;
    this.bank += (targetBank - this.bank) * damp(FLIGHT.bankRate, dt);
    let yawRate = (this.bank / maxBank) * FLIGHT.turnRate * m.turnMul;
    // corridor walls: the wind turns the kite back toward the corridor
    const half = FLIGHT.corridorHalfWidth;
    if (this.x > half) yawRate += ((this.x - half) / 25) * 1.2;
    else if (this.x < -half) yawRate -= ((-half - this.x) / 25) * 1.2;
    this.yaw += yawRate * dt;
    const maxYaw = FLIGHT.maxHeading * DEG;
    if (this.yaw > maxYaw) this.yaw += (maxYaw - this.yaw) * damp(6, dt);
    else if (this.yaw < -maxYaw) this.yaw += (-maxYaw - this.yaw) * damp(6, dt);

    // --- pitch
    let targetPitch = this.diving ? FLIGHT.divePitch * DEG : clamp(input.steerY, -1, 1) * FLIGHT.maxPitch * DEG;
    // ceiling: climbing fades out near the top of the sky
    if (targetPitch > 0) {
      const c = clamp((FLIGHT.ceiling - this.y) / (FLIGHT.ceiling - FLIGHT.ceilingStart), 0, 1);
      targetPitch *= c;
      if (this.y > FLIGHT.ceiling) targetPitch = -6 * DEG;
    }
    const empty = this.lift <= 0;
    if (empty) targetPitch = Math.min(targetPitch, FLIGHT.emptyPitchCap * DEG);
    // pulling up out of a dive is the "precise" part: faster slew when the nose is below target
    const rate = FLIGHT.pitchRate * m.pullUpMul * (targetPitch > this.pitch ? 1.25 : 1);
    this.pitch = approach(this.pitch, targetPitch, rate * dt);

    // --- speed (energy model)
    const cruise = FLIGHT.cruiseSpeed * m.speedMul;
    const sinP = Math.sin(this.pitch);
    let acc = -FLIGHT.pathGravity * sinP + (cruise - this.speed) * FLIGHT.cruiseRelax;
    if (this.diving) acc += FLIGHT.diveAccel * m.diveMul;
    this.speed = clamp(this.speed + acc * dt, FLIGHT.minSpeed, FLIGHT.maxSpeed);
    this.boost *= Math.exp(-FLIGHT.boostDecay * dt);

    // --- lift drain
    const climb = Math.max(0, sinP) / Math.sin(FLIGHT.maxPitch * DEG);
    this.lift = Math.max(0, this.lift - (this.baseDrain() + climb * FLIGHT.climbDrain * m.drainMul) * dt);

    // --- integrate
    const v = this.speed + this.boost;
    const cp = Math.cos(this.pitch);
    const wd = Math.exp(-FLIGHT.windDecay * dt);
    this.windX *= wd;
    this.windY *= wd;
    this.vx = -Math.sin(this.yaw) * cp * v + this.windX;
    this.vy = sinP * v + this.windY - (empty ? FLIGHT.emptySink : 0);
    this.vz = Math.cos(this.yaw) * cp * v;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
  }
}
