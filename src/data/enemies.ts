export type EnemyShape = 'shade' | 'crawler' | 'wisp' | 'brute' | 'stalker' | 'spitter' | 'bog' | 'knight' | 'stag' | 'mire' | 'king';
export type EnemyBehavior = 'chase' | 'swarm' | 'dash' | 'ranged' | 'boss';

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
  /** Ranged: seconds between shots. Dash: seconds between dashes. */
  attackInterval?: number;
  projectileSpeed?: number;
  projectileDamage?: number;
}

export const ENEMIES: Record<string, EnemyDef> = {
  shade: {
    id: 'shade', name: 'Shade', hp: 8, speed: 2.6, damage: 6, xp: 1, radius: 0.45, scale: 1,
    color: 0x2a2440, eyeColor: 0xb06cff, shape: 'shade', behavior: 'chase', knockbackResist: 0,
  },
  crawler: {
    id: 'crawler', name: 'Crawler', hp: 14, speed: 3.3, damage: 7, xp: 2, radius: 0.5, scale: 1,
    color: 0x2c1f1a, eyeColor: 0xff4a3c, shape: 'crawler', behavior: 'swarm', knockbackResist: 0.1,
  },
  wisp: {
    id: 'wisp', name: 'Hollow Wisp', hp: 5, speed: 4.6, damage: 4, xp: 1, radius: 0.35, scale: 0.9,
    color: 0x1a2a3a, eyeColor: 0x5ce1ff, shape: 'wisp', behavior: 'swarm', knockbackResist: 0,
  },
  brute: {
    id: 'brute', name: 'Gloom Brute', hp: 90, speed: 2.0, damage: 16, xp: 8, radius: 0.95, scale: 1.7,
    color: 0x251c2c, eyeColor: 0xff7a2a, shape: 'brute', behavior: 'chase', knockbackResist: 0.7,
  },
  stalker: {
    id: 'stalker', name: 'Stalker', hp: 30, speed: 2.4, damage: 12, xp: 4, radius: 0.55, scale: 1.1,
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
  boss_hollow_stag: {
    id: 'boss_hollow_stag', name: 'The Hollow Stag', hp: 6000, speed: 2.8, damage: 30, xp: 200, radius: 2.0, scale: 3.2,
    color: 0x1e1a28, eyeColor: 0xd06cff, shape: 'stag', behavior: 'boss', knockbackResist: 1, boss: true,
    attackInterval: 5, projectileSpeed: 8, projectileDamage: 14,
  },
  boss_mire_mother: {
    id: 'boss_mire_mother', name: 'The Mire Mother', hp: 9000, speed: 2.2, damage: 34, xp: 250, radius: 2.4, scale: 3.4,
    color: 0x15241f, eyeColor: 0x4affc8, shape: 'mire', behavior: 'boss', knockbackResist: 1, boss: true,
    attackInterval: 4.5, projectileSpeed: 7, projectileDamage: 16,
  },
  boss_ashen_king: {
    id: 'boss_ashen_king', name: 'The Ashen King', hp: 13000, speed: 2.6, damage: 40, xp: 300, radius: 2.0, scale: 3.0,
    color: 0x2b2420, eyeColor: 0xff4a1a, shape: 'king', behavior: 'boss', knockbackResist: 1, boss: true,
    attackInterval: 4, projectileSpeed: 9, projectileDamage: 18,
  },
};
