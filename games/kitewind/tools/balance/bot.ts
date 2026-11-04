/**
 * Headless "human-like" pilot for difficulty tuning. Unlike src/game/Autopilot.ts (a perfect line follower used by
 * the attract screen) this bot has a reaction delay, aim error that wanders, keyboard-style digital steering,
 * attention lapses and imperfect hazard avoidance — tuned so the `novice` profile behaves like someone on their
 * first few runs. Used by tests/difficulty.test.ts and `npx vitest run tests/difficulty.test.ts` (prints a table).
 */
import { Rng } from '../../src/core/Rng';
import { clamp, DEG, distSqPointSegment } from '../../src/core/math';
import { FLIGHT, HAZARD } from '../../src/data/tuning';
import { kiteById } from '../../src/data/kites';
import type { FlightInput } from '../../src/game/Flight';
import { buildMods } from '../../src/game/Mods';
import { Run, islandClearance } from '../../src/game/Run';

export interface BotSkill {
  name: string;
  /** Seconds between perception updates (the bot acts on stale information in between). */
  reaction: number;
  /** Std-dev (m) of the wandering aim error around the target. */
  aimError: number;
  /** How far ahead (m) hazards are noticed. */
  sight: number;
  /** Probability a noticed hazard is actually dodged. */
  dodge: number;
  /** Extra clearance (m) the bot tries to keep from hazards when dodging. */
  margin: number;
  /** Attention lapses per second, and their duration (s). */
  lapseRate: number;
  lapseDur: number;
  /** Keyboard-style -1/0/1 steering (true) or analog (false). */
  digital: boolean;
  /** Probability of chasing the next ring at all (else just cruise the guide line). */
  ringFocus: number;
}

export const SKILLS: Record<'novice' | 'average' | 'skilled', BotSkill> = {
  novice: { name: 'novice', reaction: 0.34, aimError: 2.6, sight: 55, dodge: 0.72, margin: 3.5, lapseRate: 0.07, lapseDur: 0.9, digital: true, ringFocus: 0.8 },
  average: { name: 'average', reaction: 0.24, aimError: 1.5, sight: 75, dodge: 0.86, margin: 4.5, lapseRate: 0.035, lapseDur: 0.6, digital: true, ringFocus: 0.92 },
  skilled: { name: 'skilled', reaction: 0.15, aimError: 0.7, sight: 95, dodge: 0.96, margin: 5, lapseRate: 0.01, lapseDur: 0.4, digital: false, ringFocus: 1 },
};

interface Decision {
  dodge: boolean;
  dx: number;
  dy: number;
}

/** Stateful bot: call `input(run, dt)` each fixed step. */
export class PlayerBot {
  private rng: Rng;
  private t = 0;
  private nextLook = 0;
  private lapse = 0;
  private errX = 0;
  private errY = 0;
  private tx = 0;
  private ty = 40;
  private tz = 0;
  private wantDive = false;
  private sx = 0;
  private sy = 0;
  private decided = new WeakMap<object, Decision>();
  private chase = true;
  private chaseUntil = 0;
  readonly out: FlightInput = { steerX: 0, steerY: 0, dive: false };

  constructor(readonly skill: BotSkill, seed: number) {
    this.rng = new Rng(seed ^ 0x5eed);
  }

  private gauss(): number {
    const u = Math.max(1e-6, this.rng.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185 * this.rng.next());
  }

  private decide(obj: object, dx: number, dy: number): Decision {
    let d = this.decided.get(obj);
    if (!d) {
      d = { dodge: this.rng.chance(this.skill.dodge), dx, dy };
      this.decided.set(obj, d);
    }
    return d;
  }

  /** Re-reads the world (stale between calls): target ring / guide line, plus hazard dodges. */
  private perceive(run: Run): void {
    const f = run.flight;
    const s = this.skill;
    const gen = run.world.gen;
    if (this.t > this.chaseUntil) {
      this.chase = this.rng.chance(s.ringFocus);
      this.chaseUntil = this.t + 2 + this.rng.next() * 3;
    }
    let tx = gen.guideX(f.z + 34), ty = gen.guideY(f.z + 34), tz = f.z + 34;
    let best = Infinity;
    for (const c of run.world.active) {
      if (c.z0 > f.z + 120 || c.z0 + 100 < f.z) continue;
      if (this.chase)
        for (const r of c.rings) {
          if (r.passed || r.missed || r.z < f.z + 4 || r.z > f.z + 70) continue;
          if (r.z < best) { best = r.z; tx = r.x; ty = r.y; tz = r.z; }
        }
      for (const sh of c.shrines) {
        if (sh.taken || sh.missed || sh.z < f.z + 4 || sh.z > f.z + 70) continue;
        if (sh.z < best) { best = sh.z; tx = sh.x; ty = sh.y; tz = sh.z; }
      }
    }
    // wandering aim error (Ornstein-Uhlenbeck-ish)
    const k = Math.min(1, s.reaction * 1.5);
    this.errX += (-this.errX * k) + this.gauss() * s.aimError * Math.sqrt(k);
    this.errY += (-this.errY * k) + this.gauss() * s.aimError * 0.6 * Math.sqrt(k);
    tx += this.errX;
    ty += this.errY;

    // hazards: if the straight line to the target passes too close, shift the target away (if this one is dodged)
    const m = s.margin;
    let shiftX = 0, shiftY = 0;
    const lineAt = (hz: number): [number, number] => {
      const u = clamp((hz - f.z) / Math.max(4, tz - f.z), 0, 1.5);
      return [f.x + (tx - f.x) * u, f.y + (ty - f.y) * u];
    };
    const consider = (obj: object, hx: number, hy: number, hz: number, rad: number, vertical = false): void => {
      if (hz < f.z + 3 || hz > f.z + s.sight) return;
      const [lx, ly] = lineAt(hz);
      const ddx = lx - hx, ddy = ly - hy;
      const dist = vertical ? Math.abs(ddy) : Math.hypot(ddx, ddy);
      const need = rad + FLIGHT.radius + m;
      if (dist >= need) return;
      const d = this.decide(obj, ddx, ddy);
      if (!d.dodge) return;
      if (vertical) shiftY += Math.sign(d.dy || 1) * (need - dist);
      else {
        const len = Math.hypot(d.dx, d.dy) || 1;
        shiftX += (d.dx / len) * (need - dist) * 1.1;
        shiftY += (d.dy / len) * (need - dist) * 0.5;
      }
    };
    for (const c of run.world.active) {
      if (c.z0 > f.z + s.sight + 10 || c.z0 + 100 < f.z) continue;
      for (const isl of c.islands) {
        if (isl.z < f.z + 3 || isl.z > f.z + s.sight) continue;
        const [lx, ly] = lineAt(isl.z);
        const cl = islandClearance(isl, lx, ly, isl.z);
        if (cl < FLIGHT.radius + m) {
          const d = this.decide(isl, lx - isl.x, 0);
          if (d.dodge) {
            // go over if near the top, else around
            if (ly > isl.y - 2) shiftY += FLIGHT.radius + m - cl + 2;
            else shiftX += Math.sign(d.dx || 1) * (FLIGHT.radius + m - cl + 1);
          }
        }
      }
      for (const sp of c.spires) consider(sp, sp.x, ty, sp.z, sp.radius);
      for (const tc of c.thunderclouds) consider(tc, tc.x, tc.y, tc.z, tc.radius * 0.78);
      for (const fl of c.flocks) consider(fl, fl.x, fl.y, fl.z, HAZARD.flockRadius);
      for (const l of c.lightning) {
        const lz = (l.az + l.bz) / 2;
        if (lz < f.z + 3 || lz > f.z + s.sight) continue;
        const eta = (lz - f.z) / Math.max(8, f.airspeed);
        const P = HAZARD.lightningPeriod;
        const u = ((((run.time + eta + l.phase) % P) + P) % P);
        const live = u >= P - HAZARD.lightningStrike - 0.25 || l.state === 2;
        if (!live) continue;
        const [lx, ly] = lineAt(lz);
        const dd = Math.sqrt(distSqPointSegment(lx, ly, lz, l.ax, l.ay, l.az, l.bx, l.by, l.bz));
        const need = HAZARD.lightningRadius + FLIGHT.radius + m;
        if (dd < need) {
          const d = this.decide(l, 0, ly - (l.ay + l.by) / 2);
          if (d.dodge) shiftY += Math.sign(d.dy || 1) * (need - dd + 1);
        }
      }
    }
    this.tx = tx + shiftX;
    this.ty = clamp(ty + shiftY, 6, FLIGHT.ceiling - 5);
    this.tz = tz;
  }

  input(run: Run, dt: number): FlightInput {
    const s = this.skill;
    this.t += dt;
    const o = this.out;
    if (this.lapse > 0) {
      this.lapse -= dt;
      return o; // hold whatever we were doing
    }
    if (this.rng.next() < s.lapseRate * dt) {
      this.lapse = s.lapseDur * (0.5 + this.rng.next());
      return o;
    }
    if (this.t >= this.nextLook) {
      this.nextLook = this.t + s.reaction * (0.7 + this.rng.next() * 0.6);
      this.perceive(run);
    }
    const f = run.flight;
    const dz = Math.max(4, this.tz - f.z);
    const desiredYaw = Math.atan2(f.x - this.tx, dz);
    let ax = clamp((desiredYaw - f.yaw) * 3.0 - f.bank * 0.25, -1, 1);
    const desiredPitch = Math.atan2(this.ty - f.y, Math.hypot(this.tx - f.x, dz));
    let ay = clamp((desiredPitch / (FLIGHT.maxPitch * DEG)) * 1.5 + (desiredPitch - f.pitch) * 1.3, -1, 1);
    // humans also panic-climb when they see the sea coming
    if (f.y < 9 && f.vy < 0) ay = 1;
    this.wantDive = desiredPitch < -26 * DEG && f.y > 16;
    if (s.digital) {
      ax = Math.abs(ax) < 0.3 ? 0 : Math.sign(ax);
      ay = Math.abs(ay) < 0.3 ? 0 : Math.sign(ay);
      const k = 1 - Math.exp(-FLIGHT.inputSmoothing * dt);
      this.sx += (ax - this.sx) * k;
      this.sy += (ay - this.sy) * k;
      ax = this.sx;
      ay = this.sy;
    }
    o.steerX = ax;
    o.steerY = ay;
    o.dive = this.wantDive;
    return o;
  }
}

export interface BotResult {
  seed: number;
  distance: number;
  time: number;
  score: number;
  cause: string;
  rings: number;
  bestCombo: number;
  minLift: number;
  glimmers: number;
  shieldsUsed: number;
}

/** Flies one full run with the given skill (fresh save: starter kite, no upgrades). */
export function flyRun(skill: BotSkill, seed: number, maxSeconds = 600, kiteId = 'swallow', meta: Record<string, number> = {}): BotResult {
  const mods = buildMods(kiteById(kiteId), meta);
  const run = new Run(seed, mods);
  const bot = new PlayerBot(skill, seed);
  const pick = new Rng(seed ^ 0xb00);
  const dt = 1 / 60;
  let minLift = 1;
  const shields0 = run.shields;
  let shieldsGained = 0;
  for (let i = 0; i < maxSeconds * 60 && !run.ended; i++) {
    if (run.pendingBoon) {
      const offer = run.rollBoons();
      const id = offer[Math.floor(pick.next() * offer.length)];
      if (id === 'shield') shieldsGained++;
      run.pickBoon(id);
    }
    run.step(dt, bot.input(run, dt));
    if (run.flight.liftFrac < minLift) minLift = run.flight.liftFrac;
  }
  return {
    seed, distance: Math.round(run.distance), time: Math.round(run.time), score: Math.round(run.scoring.score), cause: run.ended ?? 'timeout',
    rings: run.scoring.rings, bestCombo: run.scoring.bestCombo, minLift: Math.round(minLift * 100) / 100,
    glimmers: run.scoring.glimmers, shieldsUsed: shields0 + shieldsGained - run.shields,
  };
}

/** Median helper. */
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? 0 : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
