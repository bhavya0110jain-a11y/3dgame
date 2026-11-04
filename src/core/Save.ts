/** Versioned localStorage persistence. All reads/writes are guarded — storage may be unavailable. */
export interface SaveData {
  version: 1;
  ash: number; // meta currency
  totalAsh: number;
  bestTime: number; // seconds survived (best)
  bestKills: number;
  runs: number;
  victories: number;
  meta: Record<string, number>; // meta upgrade id -> rank
  unlocked: string[]; // character / weapon unlock ids
  selectedCharacter: string;
  achievements: string[];
  biomesCleared: string[];
  /** Lifetime counters for achievements (src/game/Achievements.ts). Optional for old saves. */
  lifetime?: Record<string, number>;
  settings: {
    masterVolume: number;
    musicVolume: number;
    sfxVolume: number;
    screenShake: boolean;
    damageNumbers: boolean;
    quality: 'low' | 'medium' | 'high';
    showFps: boolean;
  };
}

const KEY = 'last-lantern-save-v1';

export function defaultSave(): SaveData {
  return {
    version: 1,
    ash: 0,
    totalAsh: 0,
    bestTime: 0,
    bestKills: 0,
    runs: 0,
    victories: 0,
    meta: {},
    unlocked: ['char_keeper', 'biome_pines'],
    selectedCharacter: 'char_keeper',
    achievements: [],
    biomesCleared: [],
    settings: {
      masterVolume: 0.8,
      musicVolume: 0.6,
      sfxVolume: 0.8,
      screenShake: true,
      damageNumbers: true,
      quality: 'high',
      showFps: false,
    },
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    const def = defaultSave();
    return { ...def, ...parsed, settings: { ...def.settings, ...(parsed.settings ?? {}) } };
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — progress is session-only */
  }
}
