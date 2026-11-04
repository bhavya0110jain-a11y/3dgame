/**
 * Plain-data world entities produced by the generator (src/world/Generator.ts) and consumed by the
 * sim (src/game/Run.ts) and the views (src/world/*View.ts, src/entities/*View.ts). No three.js here.
 */
export interface Island {
  x: number; y: number; z: number;
  /** Top radius (m). */
  radius: number;
  /** Rock depth below the top (m). */
  depth: number;
  /** Height of trees/houses above the top surface (m). */
  clutter: number;
  variant: number;
  rotY: number;
  whisker: number;
}
export interface Ring { x: number; y: number; z: number; radius: number; passed: boolean; missed: boolean; pop: number }
export interface Glimmer { x: number; y: number; z: number; taken: boolean; phase: number }
export interface Updraft { x: number; z: number; radius: number; height: number; inside: boolean }
export interface Spire { x: number; z: number; radius: number; height: number; whisker: number }
export interface Lightning {
  ax: number; ay: number; az: number; bx: number; by: number; bz: number;
  phase: number;
  /** 0 idle, 1 warning, 2 striking — written by the sim each step. */
  state: number;
  /** 0..1 progress within the current state. */
  t: number;
  whisker: number;
}
export interface Thundercloud { cx: number; y: number; z: number; radius: number; amp: number; phase: number; x: number; whisker: number }
export interface Gust {
  x: number; y: number; z: number; halfW: number; halfH: number; halfL: number; dir: number;
  /** -1 dormant, then seconds since warning started. */
  timer: number;
  /** 0 dormant, 1 warning, 2 active, 3 spent. */
  state: number;
}
export interface Flock { cx: number; cy: number; z: number; amp: number; phase: number; count: number; x: number; y: number; whisker: number }
export interface Arch { x: number; y: number; z: number; radius: number; tube: number; threaded: boolean; whisker: number }
export interface Shrine { x: number; y: number; z: number; radius: number; taken: boolean; missed: boolean }
export interface CloudPuff { x: number; y: number; z: number; size: number; shade: number }
export interface Lantern { x: number; y: number; z: number; speed: number; phase: number }

export interface Chunk {
  index: number;
  z0: number;
  biome: number;
  islands: Island[];
  rings: Ring[];
  glimmers: Glimmer[];
  updrafts: Updraft[];
  spires: Spire[];
  lightning: Lightning[];
  thunderclouds: Thundercloud[];
  gusts: Gust[];
  flocks: Flock[];
  arches: Arch[];
  shrines: Shrine[];
  clouds: CloudPuff[];
  lanterns: Lantern[];
}
