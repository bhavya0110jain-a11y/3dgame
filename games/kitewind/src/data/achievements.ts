/** Achievements. Conditions are evaluated in src/game/Achievements.ts against run + lifetime stats. */
export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** Reward in glimmers. */
  reward: number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first_flight', name: 'First Flight', desc: 'Finish your first run.', reward: 10 },
  { id: 'dist_1000', name: 'Over the Shoals', desc: 'Fly 1000 m in one run.', reward: 20 },
  { id: 'dist_3000', name: 'Into the Aurora', desc: 'Fly 3000 m in one run.', reward: 60 },
  { id: 'dist_6000', name: 'Storm Rider', desc: 'Fly 6000 m in one run.', reward: 150 },
  { id: 'combo_10', name: 'Wind Song', desc: 'Chain a 10-ring combo.', reward: 25 },
  { id: 'combo_25', name: 'Endless Chord', desc: 'Chain a 25-ring combo.', reward: 80 },
  { id: 'perfect_5', name: 'Bullseye Breeze', desc: '5 perfect rings in one run.', reward: 20 },
  { id: 'whisker_5', name: 'Whiskers', desc: '5 near-misses in one run.', reward: 30 },
  { id: 'arch_1', name: 'Thread the Needle', desc: 'Fly through a stone arch.', reward: 20 },
  { id: 'boons_3', name: 'Shrine Pilgrim', desc: 'Take 3 boons in one run.', reward: 40 },
  { id: 'daily', name: 'Daily Winds', desc: 'Finish a daily seed run.', reward: 25 },
  { id: 'collector', name: 'Kite Collector', desc: 'Unlock every kite.', reward: 200 },
];
