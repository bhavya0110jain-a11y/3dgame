/**
 * Global gameplay tuning. Every number the sim uses lives here or in the other src/data tables
 * (kites, upgrades, boons, biomes) so balance passes never touch logic files.
 */
export const FLIGHT = {
  /** Base speed the kite relaxes toward (m/s). */
  cruiseSpeed: 26,
  minSpeed: 13,
  maxSpeed: 62,
  /** How quickly speed relaxes to cruise (1/s). */
  cruiseRelax: 0.32,
  /** Gravity along the flight path (m/s²) — climbing costs speed, descending gains it. */
  pathGravity: 8.8,
  /** Extra forward acceleration while diving (m/s²). */
  diveAccel: 13,
  /** Pitch the kite noses down to while diving (deg). */
  divePitch: -34,
  /** Max pitch from the climb/descend input (deg). */
  maxPitch: 24,
  /** Pitch slew rate (rad/s) — how fast the nose follows input. Raised by "dive control". */
  pitchRate: 2.1,
  /** Max visual/physical bank (deg). */
  maxBank: 52,
  /** Bank response (1/s). */
  bankRate: 6.5,
  /** Yaw rate at full bank (rad/s). */
  turnRate: 1.35,
  /** Heading limit relative to the +Z flight corridor (deg). */
  maxHeading: 62,
  /** Lateral half-width of the generated corridor; past it the wind turns the kite back (m). */
  corridorHalfWidth: 150,
  /** Lift drain per second at level flight. */
  liftDrain: 3.0,
  /** Additional drain per second per 1000 m flown (the run gets tense). */
  liftDrainPerKm: 0.6,
  /** Extra drain per second while climbing at full pitch. */
  climbDrain: 5,
  /** When lift is empty the kite cannot climb: pitch is capped to this (deg)… */
  emptyPitchCap: -7,
  /** …and it sinks this fast (m/s). */
  emptySink: 5,
  /** Soft ceiling (m): climbing fades out between ceilingStart and ceiling. */
  ceilingStart: 105,
  ceiling: 135,
  startAltitude: 42,
  /** Collision radius of the kite (m). */
  radius: 0.75,
  /** Temporary speed boost decay (1/s). */
  boostDecay: 0.9,
  /** External (wind) velocity decay (1/s). */
  windDecay: 1.6,
  /** Steering input smoothing (1/s) for digital inputs. */
  inputSmoothing: 9,
} as const;

export const SCORING = {
  /** Points per metre flown. */
  perMetre: 1,
  ringPoints: 100,
  perfectMul: 2,
  /** Fraction of the ring radius counted as a perfect centre pass. */
  perfectFrac: 0.32,
  glimmerPoints: 15,
  whiskerPoints: 250,
  archPoints: 600,
  /** Combo window (s): the chain breaks if no ring is passed for this long. */
  comboWindow: 3.6,
  /** Multiplier = 1 + combo * comboStep, capped. */
  comboStep: 0.2,
  maxMultiplier: 8,
  /** Lift restored per ring / perfect ring. */
  ringLift: 4.5,
  perfectLift: 7.5,
  /** Speed boost per ring (m/s). */
  ringBoost: 5,
  /** Lift restored per glimmer. */
  glimmerLift: 0.6,
  /** Whisker (near-miss) distance from a hazard surface (m). */
  whiskerDist: 2.4,
  /** Real-time slow-mo on whisker (s) and time scale. */
  whiskerSlowmo: 0.55,
  whiskerTimeScale: 0.3,
  /** Glimmers (currency) earned per 100 m flown at run end. */
  glimmersPer100m: 1,
} as const;

export const WORLD = {
  chunkLength: 100,
  /** Chunks kept ahead / behind the kite. */
  chunksAhead: 6,
  chunksBehind: 1,
  biomeLength: 1500,
  /** Distance over which biome visuals cross-fade (m, centred on the boundary). */
  biomeBlend: 260,
  /** Wind shrine every N metres (first one at shrineFirst). */
  shrineFirst: 650,
  shrineEvery: 900,
  /** Distance before which no hazards spawn (onboarding). */
  safeStart: 280,
  seaLevel: 0,
} as const;

export const UPDRAFT = {
  radius: 7,
  height: 95,
  /** Upward wind velocity inside (m/s). */
  lift: 11,
  /** Lift resource restored per second inside. */
  liftRestore: 16,
  speedGain: 2.5,
} as const;

export const HAZARD = {
  /** Wind gust: telegraph time (s), active time (s), push speed (m/s). */
  gustWarn: 1.6,
  gustActive: 1.4,
  gustPush: 15,
  /** Lightning between spires: cycle period, warning time, strike time (s). */
  lightningPeriod: 3.4,
  lightningWarn: 1.1,
  lightningStrike: 0.55,
  lightningRadius: 1.6,
  /** Thundercloud collision radius scale. */
  thundercloudRadius: 7,
  flockRadius: 2.6,
} as const;
