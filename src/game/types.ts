import type * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { Rng } from '../core/Rng';
import type { Input } from '../core/Input';
import type { SaveData } from '../core/Save';
import type { Player } from '../entities/Player';
import type { EnemyManager } from '../entities/Enemies';
import type { ProjectileManager } from '../entities/Projectiles';
import type { PickupManager } from '../entities/Pickups';
import type { FxManager } from '../render/Fx';
import type { AudioManager } from '../audio/Audio';
import type { World } from '../world/World';
import type { RunState } from './RunState';

/** Everything a gameplay system may touch. Passed explicitly — no globals. */
export interface GameContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  events: EventBus;
  rng: Rng;
  input: Input;
  save: SaveData;
  audio: AudioManager;
  world: World;
  player: Player;
  enemies: EnemyManager;
  projectiles: ProjectileManager;
  pickups: PickupManager;
  fx: FxManager;
  run: RunState;
  /** Requests a camera shake (0..1 intensity). */
  shake(intensity: number): void;
}

export interface WeaponInstance {
  readonly def: WeaponDef;
  level: number;
  update(dt: number, ctx: GameContext): void;
  /** Called after level is incremented. */
  onLevelUp?(ctx: GameContext): void;
  dispose(ctx: GameContext): void;
}

export interface WeaponDef {
  id: string;
  name: string;
  /** Short flavor + mechanic description shown on level-up cards. */
  description: string;
  /** Per-level upgrade text; index 0 = level 2 text. */
  levelText: string[];
  maxLevel: number;
  icon: string; // key into ui/icons
  color: number;
  /** Passive id that, at max level together with this weapon, allows evolution. */
  evolvesWith?: string;
  evolvesInto?: string;
  /** Hidden from random pool (e.g. evolutions). */
  hidden?: boolean;
  /** Requires unlock id in save.unlocked; undefined = always available. */
  unlock?: string;
  create(ctx: GameContext): WeaponInstance;
}

export interface PassiveDef {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  icon: string;
  apply(stats: import('./Stats').PlayerStats): void;
  unlock?: string;
}
