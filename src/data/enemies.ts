export type EnemyShape =
  | 'shade' | 'crawler' | 'wisp' | 'brute' | 'stalker' | 'spitter' | 'bog' | 'knight'
  | 'blob' | 'bloater' | 'warden'
  | 'stag' | 'mire' | 'king';
export type EnemyBehavior = 'chase' | 'swarm' | 'dash' | 'ranged' | 'splitter' | 'exploder' | 'shielded' | 'boss';

/**
 * Boss attack patterns (see Enemies.updateBoss). Every attack is telegraphed (ring / fx.telegraph) before it lands.
 *  charge    – line-up windup, then a straight charge (chains 3x when enraged)
 *  volley    – radial ring of projectiles (two staggered rings when enraged)
 *  spiral    – rotating spiral stream of projectiles
 *  eruptions – circles erupt under/around the player after a delay
 *  slam      – big self-centred shockwave; stand outside the ring
 *  rain      – scattered impact zones across the arena
 *  summon    – calls minions (enraged: more, and elites)
 */
export type BossPattern = 'charge' | 'volley' | 'spiral' | 'eruptions' | 'slam' | 'rain' | 'summon';

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  speed: number;
  damage: number; // contact damage per hit
  xp: number;
  radius: number;
  scale: number;
  color: number;
  eyeColor: number;
  shape: EnemyShape;
  behavior: EnemyBehavior;
  /** 0 = full knockback, 1 = immune */
  knockbackResist: number;
  boss?: boolean;
  /** Ranged: seconds between shots. Dash: seconds between dashes. Boss: seconds between attacks. */
  attackInterval?: number;
  projectileSpeed?: number;
  projectileDamage?: number;
  /** Extra biomes (ids) this enemy may appear in, on top of BiomeDef.enemyPool. */
  biomes?: string[];
  /** Splitter: enemy id spawned on death and how many. */
  splitInto?: string;
  splitCount?: number;
  /** Shielded: shield points absorbed before hp; regenerates after `shieldRegenDelay` s without damage. */
  shield?: number;
  /** Exploder: blast radius / damage; fuse = telegraph seconds once primed. */
  blastRadius?: number;
  blastDamage?: number;
  fuse?: number;
  /** Boss: attack patterns picked in rotation (never the same twice in a row). */
  bossPatterns?: BossPattern[];
  /** Boss: hp fraction at which it enrages (faster, nastier patterns). */
  enrageAt?: number;
  /** Boss: minion ids for 'summon'. */
  minions?: string[];
}

const ALL_NIGHTS = ['biome_pines', 'biome_marsh', 'biome_ruins'];

export const ENEMIES: Record<string, EnemyDef> = {
  shade: {
    id: 'shade', name: 'Shade', hp: 8, speed: 2.6, damage: 6, xp: 1, radius: 0.45, scale: 1,
    color: 0x2a2440, eyeColor: 0xb06cff, shape: 'shade', behavior: 'chase', knockbackResist: 0,
  },
  crawler: {
    id: 'crawler', name: 'Crawler', hp: 14, speed: 3.3, damage: 6, xp: 2, radius: 0.5, scale: 1,
    color: 0x2c1f1a, eyeColor: 0xff4a3c, shape: 'crawler', behavior: 'swarm', knockbackResist: 0.1,
  },
  wisp: {
    id: 'wisp', name: 'Hollow Wisp', hp: 5, speed: 4.6, damage: 4, xp: 1, radius: 0.35, scale: 0.9,
    color: 0x1a2a3a, eyeColor: 0x5ce1ff, shape: 'wisp', behavior: 'swarm', knockbackResist: 0,
  },
  brute: {
    id: 'brute', name: 'Gloom Brute', hp: 90, speed: 2.0, damage: 13, xp: 8, radius: 0.95, scale: 1.7,
    color: 0x251c2c, eyeColor: 0xff7a2a, shape: 'brute', behavior: 'chase', knockbackResist: 0.7,
  },
  stalker: {
    id: 'stalker', name: 'Stalker', hp: 30, speed: 2.4, damage: 10, xp: 4, radius: 0.55, scale: 1.1,
    color: 0x1c1c26, eyeColor: 0xffe14a, shape: 'stalker', behavior: 'dash', knockbackResist: 0.3, attackInterval: 3.2,
  },
  spitter: {
    id: 'spitter', name: 'Bile Spitter', hp: 26, speed: 1.9, damage: 8, xp: 4, radius: 0.6, scale: 1.1,
    color: 0x1f2a1a, eyeColor: 0x9cff4a, shape: 'spitter', behavior: 'ranged', knockbackResist: 0.2,
    attackInterval: 2.6, projectileSpeed: 7, projectileDamage: 9,
  },
  bog_lurker: {
    id: 'bog_lurker', name: 'Bog Lurker', hp: 40, speed: 2.2, damage: 11, xp: 5, radius: 0.7, scale: 1.3,
    color: 0x162420, eyeColor: 0x4affc8, shape: 'bog', behavior: 'chase', knockbackResist: 0.4,
  },
  knight: {
    id: 'knight', name: 'Ashen Knight', hp: 140, speed: 2.1, damage: 20, xp: 12, radius: 0.75, scale: 1.4,
    color: 0x2b2522, eyeColor: 0xff3a1a, shape: 'knight', behavior: 'dash', knockbackResist: 0.8, attackInterval: 4,
  },
  // --- new behaviours -------------------------------------------------------------------------
  /** Splitter: a wobbling gloom-jelly that bursts into two blobs when it dies. */
  gloam_jelly: {
    id: 'gloam_jelly', name: 'Gloam Jelly', hp: 34, speed: 2.1, damage: 9, xp: 3, radius: 0.7, scale: 1.35,
    color: 0x3a2a6a, eyeColor: 0xff8af0, shape: 'blob', behavior: 'splitter', knockbackResist: 0.25,
    splitInto: 'jellyling', splitCount: 3, biomes: ALL_NIGHTS,
  },
  jellyling: {
    id: 'jellyling', name: 'Jellyling', hp: 7, speed: 3.4, damage: 3, xp: 1, radius: 0.38, scale: 0.65,
    color: 0x3a2a6a, eyeColor: 0xff8af0, shape: 'blob', behavior: 'swarm', knockbackResist: 0,
  },
  /** Exploder: rushes in, primes (telegraphed ring), then bursts. Killing it early detonates it on its friends. */
  cinder_tick: {
    id: 'cinder_tick', name: 'Cinder Tick', hp: 18, speed: 3.9, damage: 6, xp: 3, radius: 0.5, scale: 1.05,
    color: 0x3a1a14, eyeColor: 0xffb02a, shape: 'bloater', behavior: 'exploder', knockbackResist: 0.1,
    blastRadius: 2.4, blastDamage: 18, fuse: 0.85, biomes: ALL_NIGHTS,
  },
  /** Shielded: a lantern-shield bearer; a ward absorbs damage and regrows if left alone. Focus it down. */
  hollow_warden: {
    id: 'hollow_warden', name: 'Hollow Warden', hp: 60, speed: 1.8, damage: 14, xp: 7, radius: 0.75, scale: 1.35,
    color: 0x222a3a, eyeColor: 0x7af0ff, shape: 'warden', behavior: 'shielded', knockbackResist: 0.6,
    shield: 60, biomes: ['biome_marsh', 'biome_ruins'],
  },
  // --- bosses -----------------------------------------------------------------------------------
  boss_hollow_stag: {
    id: 'boss_hollow_stag', name: 'The Hollow Stag', hp: 36000, speed: 2.8, damage: 30, xp: 200, radius: 2.0, scale: 3.2,
    color: 0x1e1a28, eyeColor: 0xd06cff, shape: 'stag', behavior: 'boss', knockbackResist: 1, boss: true,
    attackInterval: 3.4, projectileSpeed: 8, projectileDamage: 14,
    bossPatterns: ['charge', 'volley', 'eruptions'], enrageAt: 0.35, minions: ['shade', 'wisp'],
  },
  boss_mire_mother: {
    id: 'boss_mire_mother', name: 'The Mire Mother', hp: 55000, speed: 2.2, damage: 34, xp: 250, radius: 2.4, scale: 3.4,
    color: 0x15241f, eyeColor: 0x4affc8, shape: 'mire', behavior: 'boss', knockbackResist: 1, boss: true,
    attackInterval: 3.2, projectileSpeed: 7, projectileDamage: 16,
    bossPatterns: ['rain', 'slam', 'summon'], enrageAt: 0.4, minions: ['gloam_jelly', 'bog_lurker'],
  },
  boss_ashen_king: {
    id: 'boss_ashen_king', name: 'The Ashen King', hp: 80000, speed: 2.6, damage: 40, xp: 300, radius: 2.0, scale: 3.0,
    color: 0x2b2420, eyeColor: 0xff4a1a, shape: 'king', behavior: 'boss', knockbackResist: 1, boss: true,
    attackInterval: 3.0, projectileSpeed: 9, projectileDamage: 18,
    bossPatterns: ['spiral', 'charge', 'eruptions'], enrageAt: 0.4, minions: ['knight', 'cinder_tick'],
  },
};
