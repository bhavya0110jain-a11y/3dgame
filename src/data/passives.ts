import type { PassiveDef } from '../game/types';

export const PASSIVES: PassiveDef[] = [
  { id: 'wick', name: 'Long Wick', icon: 'wick', maxLevel: 5, description: '+20 max light. Your light reaches further.', apply: (s) => (s.maxLight += 20) },
  { id: 'oil', name: 'Lamp Oil', icon: 'oil', maxLevel: 5, description: '+0.4 light regenerated per second.', apply: (s) => (s.lightRegen += 0.4) },
  { id: 'boots', name: 'Pilgrim Boots', icon: 'boots', maxLevel: 5, description: '+10% movement speed.', apply: (s) => (s.moveSpeed *= 1.1) },
  { id: 'flint', name: 'Flint', icon: 'flint', maxLevel: 5, description: '+10% damage.', apply: (s) => (s.might += 0.1) },
  { id: 'bellows', name: 'Bellows', icon: 'bellows', maxLevel: 5, description: '+10% area.', apply: (s) => (s.area += 0.1) },
  { id: 'clockwork', name: 'Clockwork', icon: 'clock', maxLevel: 5, description: '-8% weapon cooldowns.', apply: (s) => (s.cooldown *= 0.92) },
  { id: 'lodestone', name: 'Lodestone', icon: 'magnet', maxLevel: 5, description: '+30% pickup radius.', apply: (s) => (s.magnet *= 1.3) },
  { id: 'tallow', name: 'Tallow Ward', icon: 'armor', maxLevel: 5, description: '+1 armor. Reduces damage taken.', apply: (s) => (s.armor += 1) },
  { id: 'quill', name: 'Swift Quill', icon: 'quill', maxLevel: 5, description: '+10% projectile speed, +10% duration.', apply: (s) => { s.projectileSpeed += 0.1; s.duration += 0.1; } },
  { id: 'twin', name: 'Twin Flame', icon: 'twin', maxLevel: 2, description: '+1 projectile / orbiter for all weapons.', apply: (s) => (s.amount += 1) },
  { id: 'clover', name: 'Ashen Clover', icon: 'luck', maxLevel: 5, description: '+10% luck and +3% critical chance.', apply: (s) => { s.luck += 0.1; s.critChance += 0.03; } },
  { id: 'tome', name: 'Keeper\'s Tome', icon: 'tome', maxLevel: 5, description: '+8% experience gained.', apply: (s) => (s.growth += 0.08) },
];
