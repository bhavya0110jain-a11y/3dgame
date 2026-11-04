import { EventBus } from '../core/EventBus';
import { Rng, hash2 } from '../core/Rng';
import { clamp, distSqPointSegment, DEG } from '../core/math';
import { BOONS, boonById } from '../data/boons';
import { BIOMES, biomeIndexAt } from '../data/biomes';
import { FLIGHT, SCORING, WORLD, UPDRAFT, HAZARD } from '../data/tuning';
import { WorldSim } from '../world/WorldSim';
import type { Chunk, Island } from '../world/types';
import { KiteFlight, type FlightInput } from './Flight';
import { applyBoon, type Mods } from './Mods';
import { Scoring } from './Scoring';

export type CrashCause = 'sea' | 'island' | 'spire' | 'lightning' | 'thundercloud' | 'flock' | 'arch';

/** Human-readable crash causes for the results screen. */
export const CAUSE_TEXT: Record<string, string> = {
  sea: 'Kissed the sea',
  island: 'Clipped an island',
  spire: 'Struck a storm spire',
  lightning: 'Caught in the lightning',
  thundercloud: 'Swallowed by a thundercloud',
  flock: 'Tangled in a flock',
  arch: 'Scraped the stone arch',
  quit: 'Called back to shore',
};

/**
 * One run of the game, headless: flight + world streaming + interactions + scoring. No three.js / DOM, so the
 * whole run can be simulated in unit tests and fast-forwarded by the smoke probe (window.__game.run.step).
 */
export class Run {
  readonly flight: KiteFlight;
  readonly scoring: Scoring;
  readonly world: WorldSim;
  readonly events: EventBus;
  /** Sim time (s). */
  time = 0;
  shields: number;
  readonly boons: string[] = [];
  /** Set when the kite flew through a shrine: the Game opens the boon picker and calls pickBoon(). */
  pendingBoon = false;
  /** Crash cause once the run is over. */
  ended: string | null = null;
  invuln = 0;
  biomeIndex = 0;
  secondWindUsed = 0;
  maxAltitude = 0;
  diveTime = 0;
  shrinesTaken = 0;
  /** True while inside an updraft column (FX). */
  inUpdraft = false;
  /** Seconds since the last whisker (FX). */
  sinceWhisker = 99;
  /** Proximity to the nearest hazard surface (m) this step (camera shake / audio). */
  nearest = 99;
  private lowLiftWarned = false;
  private boonRng: Rng;

  constructor(public readonly seed: number, public readonly mods: Mods, events?: EventBus, public readonly daily = false) {
    this.events = events ?? new EventBus();
    this.flight = new KiteFlight(mods);
    this.scoring = new Scoring(mods);
    this.world = new WorldSim(seed);
    this.shields = mods.shields;
    this.boonRng = new Rng(hash2(seed, 0xb0057));
    this.world.update(0);
  }

  get distance(): number {
    return this.flight.distance;
  }

  /** Advances the run by dt (s). No-op once ended or while a boon pick is pending. */
  step(dt: number, input: FlightInput): void {
    if (this.ended || this.pendingBoon) return;
    const f = this.flight;
    const wasDiving = f.diving;
    f.step(dt, input);
    if (f.diving && !wasDiving) this.events.emit('dive:start', {});
    else if (!f.diving && wasDiving) this.events.emit('dive:end', {});
    if (f.diving) this.diveTime += dt;
    this.time += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.sinceWhisker += dt;
    this.maxAltitude = Math.max(this.maxAltitude, f.y);
    this.world.update(f.z);

    const lost = this.scoring.update(dt, this.distance);
    if (lost > 0) this.events.emit('combo:lost', { combo: lost });

    // biome
    const bi = biomeIndexAt(f.z, WORLD.biomeLength);
    if (bi !== this.biomeIndex) {
      this.biomeIndex = bi;
      this.events.emit('biome:changed', { id: BIOMES[bi].id, name: BIOMES[bi].name, index: bi });
    }

    this.nearest = 99;
    this.inUpdraft = false;
    const chunks = this.world.active;
    for (let ci = 0; ci < chunks.length; ci++) {
      const c = chunks[ci];
      if (c.z0 > f.z + 140 || c.z0 + WORLD.chunkLength < f.z - 60) continue;
      this.animate(c);
      if (c.z0 > f.z + WORLD.chunkLength * 0.6 || c.z0 + WORLD.chunkLength < f.z - 40) continue;
      this.interact(c, dt);
      if (this.ended || this.pendingBoon) return;
    }

    // lift
    if (f.lift <= 0 && this.secondWindUsed < this.mods.secondWind) {
      this.secondWindUsed++;
      f.addLift(f.maxLift * 0.5);
      this.events.emit('secondwind', {});
    }
    if (f.liftFrac < 0.2) {
      if (!this.lowLiftWarned) {
        this.lowLiftWarned = true;
        this.events.emit('lift:low', {});
      }
    } else if (f.liftFrac > 0.3) this.lowLiftWarned = false;

    // sea
    if (f.y < WORLD.seaLevel + 0.4) this.hit('sea', 0, 1, 0);
  }

  /** Time-driven motion of moving hazards (deterministic by sim time). */
  private animate(c: Chunk): void {
    const t = this.time;
    for (const tc of c.thunderclouds) tc.x = tc.cx + tc.amp * Math.sin(t * 0.32 + tc.phase);
    for (const fl of c.flocks) {
      fl.x = fl.cx + fl.amp * Math.sin(t * 0.42 + fl.phase);
      fl.y = fl.cy + 2.5 * Math.sin(t * 1.1 + fl.phase * 2);
    }
    const P = HAZARD.lightningPeriod;
    for (const l of c.lightning) {
      const u = (((t + l.phase) % P) + P) % P;
      const strikeAt = P - HAZARD.lightningStrike;
      const warnAt = strikeAt - HAZARD.lightningWarn;
      const prev = l.state;
      if (u >= strikeAt) {
        l.state = 2;
        l.t = (u - strikeAt) / HAZARD.lightningStrike;
      } else if (u >= warnAt) {
        l.state = 1;
        l.t = (u - warnAt) / HAZARD.lightningWarn;
      } else {
        l.state = 0;
        l.t = 0;
      }
      if (l.state === 2 && prev !== 2) this.events.emit('lightning:strike', { x: (l.ax + l.bx) / 2, y: (l.ay + l.by) / 2, z: (l.az + l.bz) / 2 });
    }
  }

  private interact(c: Chunk, dt: number): void {
    const f = this.flight;
    const m = this.mods;
    const x = f.x, y = f.y, z = f.z;
    const pz = f.pz;

    // ---- rings
    for (const r of c.rings) {
      if (r.passed || r.missed) continue;
      const R = r.radius * m.ringRadiusMul;
      if (pz < r.z && z >= r.z) {
        const t = (r.z - pz) / Math.max(1e-6, z - pz);
        const cx = f.px + (x - f.px) * t;
        const cy = f.py + (y - f.py) * t;
        const d = Math.hypot(cx - r.x, cy - r.y);
        if (d <= R) {
          r.passed = true;
          r.pop = 1;
          const { points, perfect } = this.scoring.ring(d / R);
          f.addLift((perfect ? SCORING.perfectLift : SCORING.ringLift) + m.ringLiftAdd);
          f.boost = Math.min(18, f.boost + SCORING.ringBoost * m.ringBoostMul * (perfect ? 1.4 : 1));
          this.events.emit('ring:passed', { combo: this.scoring.combo, perfect, x: r.x, y: r.y, z: r.z, points });
        } else {
          r.missed = true;
          this.events.emit('ring:missed', {});
        }
      } else if (m.ringPull > 0 && r.z > z && r.z - z < 28) {
        const dx = r.x - x, dy = r.y - y;
        const d = Math.hypot(dx, dy);
        if (d < R * 2.4 && d > 0.05) {
          const k = m.ringPull * dt * 2.2;
          f.windX += (dx / d) * k * Math.min(1, d);
          f.windY += (dy / d) * k * Math.min(1, d);
        }
      }
    }

    // ---- shrines
    for (const s of c.shrines) {
      if (s.taken || s.missed) continue;
      if (pz < s.z && z >= s.z) {
        if (Math.hypot(x - s.x, y - s.y) <= s.radius + 1) {
          s.taken = true;
          this.shrinesTaken++;
          this.pendingBoon = true;
          f.addLift(f.maxLift * 0.25);
          this.events.emit('shrine:reached', {});
        } else s.missed = true;
      }
    }

    // ---- glimmers (magnet + collect)
    const mag = m.magnet;
    for (const g of c.glimmers) {
      if (g.taken) continue;
      const dx = x - g.x, dy = y - g.y, dz = z - g.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1.6 * 1.6) {
        g.taken = true;
        this.scoring.glimmer();
        f.addLift(SCORING.glimmerLift);
        this.events.emit('glimmer:collected', { x: g.x, y: g.y, z: g.z, combo: this.scoring.combo });
      } else if (d2 < mag * mag) {
        const d = Math.sqrt(d2);
        const k = Math.min(1, (45 * dt) / d);
        g.x += dx * k;
        g.y += dy * k;
        g.z += dz * k;
      }
    }

    // ---- updrafts
    for (const u of c.updrafts) {
      const inside = Math.hypot(x - u.x, z - u.z) < u.radius && y < u.height;
      if (inside) {
        if (!u.inside) this.events.emit('updraft:enter', {});
        this.inUpdraft = true;
        const um = m.updraftMul;
        f.windY += (UPDRAFT.lift * um - f.windY) * Math.min(1, dt * 4);
        f.addLift(UPDRAFT.liftRestore * um * dt);
        f.speed = Math.min(FLIGHT.maxSpeed, f.speed + UPDRAFT.speedGain * dt);
      }
      u.inside = inside;
    }

    // ---- gusts
    for (const g of c.gusts) {
      if (g.state === 0) {
        if (z > g.z - g.halfL - f.airspeed * HAZARD.gustWarn - 6) {
          g.state = 1;
          g.timer = 0;
          this.events.emit('gust:warn', {});
        }
        continue;
      }
      if (g.state === 3) continue;
      g.timer += dt;
      if (g.state === 1 && g.timer >= HAZARD.gustWarn) g.state = 2;
      if (g.state === 2 && g.timer >= HAZARD.gustWarn + HAZARD.gustActive) g.state = 3;
      if (g.state === 2 && Math.abs(x - g.x) < g.halfW && Math.abs(y - g.y) < g.halfH && Math.abs(z - g.z) < g.halfL + 12) {
        f.windX += (g.dir * HAZARD.gustPush - f.windX) * Math.min(1, dt * 5);
        f.windY -= 4 * dt;
        f.lift = Math.max(0, f.lift - 5 * dt);
      }
    }

    if (this.invuln > 0) return;
    const R = FLIGHT.radius;
    const wr = SCORING.whiskerDist * m.whiskerRangeMul;

    for (const isl of c.islands) {
      if (Math.abs(isl.z - z) > isl.radius + 6) continue;
      this.contact(islandClearance(isl, x, y, z) - R, isl, 'island', wr, isl.x, isl.y - isl.depth * 0.3, isl.z);
      if (this.ended) return;
    }
    for (const s of c.spires) {
      if (Math.abs(s.z - z) > 10) continue;
      const h = Math.hypot(x - s.x, z - s.z);
      let d: number;
      if (y <= s.height) d = h - s.radius * (1 - 0.55 * clamp(y / s.height, 0, 1));
      else d = Math.hypot(y - s.height, Math.max(0, h - s.radius * 0.45));
      this.contact(d - R, s, 'spire', wr, s.x, y, s.z);
      if (this.ended) return;
    }
    for (const l of c.lightning) {
      if (l.state !== 2) {
        if (l.whisker === 1) this.contact(99, l, 'lightning', wr, x, y, z); // survived the strike up close
        continue;
      }
      const d = Math.sqrt(distSqPointSegment(x, y, z, l.ax, l.ay, l.az, l.bx, l.by, l.bz)) - HAZARD.lightningRadius;
      this.contact(d - R, l, 'lightning', wr, x, y, z);
      if (this.ended) return;
    }
    for (const t of c.thunderclouds) {
      const d = Math.hypot(x - t.x, y - t.y, z - t.z) - t.radius * 0.78;
      this.contact(d - R, t, 'thundercloud', wr, t.x, t.y, t.z);
      if (this.ended) return;
    }
    for (const fl of c.flocks) {
      const d = Math.hypot(x - fl.x, y - fl.y, z - fl.z) - HAZARD.flockRadius;
      this.contact(d - R, fl, 'flock', wr, fl.x, fl.y, fl.z);
      if (this.ended) return;
    }
    for (const a of c.arches) {
      const dx = x - a.x, dy = y - a.y, dz = z - a.z;
      if (Math.abs(dz) > 12) continue;
      const rad = Math.hypot(dx, dy);
      if (!a.threaded && pz < a.z && z >= a.z && dy > 0 && rad < a.radius - a.tube) {
        a.threaded = true;
        const points = this.scoring.arch();
        this.events.emit('arch:threaded', { points });
      }
      if (dy < -1) continue;
      const d = Math.hypot(rad - a.radius, dz) - a.tube;
      this.contact(d - R, a, 'arch', wr, a.x, a.y + a.radius, a.z);
      if (this.ended) return;
    }
  }

  /** Clearance bookkeeping for one hazard: crash below 0, whisker when the kite leaves the near-miss band. */
  private contact(d: number, obj: { whisker: number }, cause: CrashCause, band: number, hx: number, hy: number, hz: number): void {
    if (d < this.nearest) this.nearest = d;
    if (d < 0) {
      obj.whisker = 2;
      this.hit(cause, this.flight.x - hx, this.flight.y - hy, this.flight.z - hz);
    } else if (d < band) {
      if (obj.whisker === 0) obj.whisker = 1;
    } else if (obj.whisker === 1) {
      obj.whisker = 2;
      this.sinceWhisker = 0;
      const points = this.scoring.whisker();
      const f = this.flight;
      this.events.emit('whisker', { x: f.x, y: f.y, z: f.z, points });
    }
  }

  /** A collision: a shield charm absorbs it (bounce + brief invulnerability), else the run ends. */
  private hit(cause: CrashCause, nx: number, ny: number, nz: number): void {
    if (this.invuln > 0) return;
    const f = this.flight;
    if (this.shields > 0) {
      this.shields--;
      this.invuln = 1.6;
      if (cause === 'sea') {
        f.y = Math.max(f.y, 1.5);
        f.pitch = 18 * DEG;
        f.windY = 16;
        f.addLift(25);
      } else {
        const len = Math.hypot(nx, ny, nz) || 1;
        f.windX += (nx / len) * 16;
        f.windY += (ny / len) * 10 + 4;
      }
      this.events.emit('shield:hit', { cause });
      return;
    }
    this.ended = cause;
    this.events.emit('crash', { cause, x: f.x, y: f.y, z: f.z });
  }

  /** Three distinct boon ids for the pending shrine (respects max stacks; deterministic per seed). */
  rollBoons(): string[] {
    const out: string[] = [];
    const pool = BOONS.filter((b) => this.boons.filter((x) => x === b.id).length < b.maxStacks);
    for (let i = 0; i < 3 && pool.length; i++) {
      const b = this.boonRng.weighted(pool, (d) => d.weight);
      out.push(b.id);
      pool.splice(pool.indexOf(b), 1);
    }
    return out;
  }

  /** Applies the chosen boon and resumes the run. */
  pickBoon(id: string): void {
    const def = boonById(id);
    if (def) {
      this.boons.push(id);
      applyBoon(this.mods, id);
      if (id === 'shield') this.shields++;
      this.events.emit('boon:picked', { id, name: def.name });
    }
    this.pendingBoon = false;
  }

  /** Ends the run voluntarily (pause menu). */
  quit(): void {
    if (!this.ended) this.ended = 'quit';
  }
}

/** Signed distance (approx.) from a point to an island's collision volume (inverted cone + clutter cylinder). */
export function islandClearance(i: Island, x: number, y: number, z: number): number {
  const dx = x - i.x, dz = z - i.z;
  const h = Math.sqrt(dx * dx + dz * dz);
  const top = i.y;
  const tip = i.y - i.depth;
  if (y >= top) {
    if (y <= top + 0.8) return h - i.radius;
    const cr = i.radius * 0.8;
    if (y <= top + i.clutter) return h - cr;
    const dy = y - (top + i.clutter);
    const dh = Math.max(0, h - cr);
    return Math.sqrt(dy * dy + dh * dh);
  }
  if (y < tip) {
    const dy = tip - y;
    return Math.sqrt(dy * dy + h * h);
  }
  const r = (i.radius * (y - tip)) / i.depth;
  return ((h - r) * i.depth) / Math.sqrt(i.depth * i.depth + i.radius * i.radius);
}
