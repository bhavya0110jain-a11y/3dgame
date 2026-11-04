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
  /** First-run onboarding: ids of 'tutorial:hint' hints already shown (each hint shows once per save). */
  hintsSeen: string[];
  settings: {
    masterVolume: number;
    musicVolume: number;
    sfxVolume: number;
    screenShake: boolean;
    /** 'all' | 'crits' (critical hits only) | 'off'. Pre-sprint-3 saves stored a boolean; sanitizeSave maps it. */
    damageNumbers: DamageNumbersMode;
    quality: QualityTier;
    showFps: boolean;
    /** Show first-run onboarding hints (only active while save.runs < TUTORIAL_RUNS). */
    hints: boolean;
  };
}

/** Render quality tiers the Renderer understands. Anything else in a save falls back to DEFAULT_QUALITY. */
export const QUALITY_TIERS = ['low', 'medium', 'high'] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];
export const DEFAULT_QUALITY: QualityTier = 'high';
/** Damage-number display modes (art review s3 #12). */
export const DAMAGE_NUMBER_MODES = ['all', 'crits', 'off'] as const;
export type DamageNumbersMode = (typeof DAMAGE_NUMBER_MODES)[number];

/** Coerces a stored damage-number setting: legacy true → 'all', false → 'off', unknown → 'all'. */
export function safeDamageNumbers(v: unknown): DamageNumbersMode {
  if (v === false) return 'off';
  if (v === true) return 'all';
  return (DAMAGE_NUMBER_MODES as readonly unknown[]).includes(v) ? (v as DamageNumbersMode) : 'all';
}

/** Onboarding hints are emitted only while the save has fewer than this many finished runs. */
export const TUTORIAL_RUNS = 2;

/** Coerces any value to a known quality tier (BUG-QA-007: an unknown tier used to brick boot in Renderer.applyTier). */
export function safeQuality(q: unknown): QualityTier {
  return (QUALITY_TIERS as readonly unknown[]).includes(q) ? (q as QualityTier) : DEFAULT_QUALITY;
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
    hintsSeen: [],
    settings: {
      masterVolume: 0.8,
      musicVolume: 0.6,
      sfxVolume: 0.8,
      screenShake: true,
      damageNumbers: 'all',
      quality: 'high',
      showFps: false,
      hints: true,
    },
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultSave();
    return sanitizeSave(parsed as Record<string, unknown>);
  } catch {
    return defaultSave();
  }
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numRecord = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isRecord(v)) for (const k in v) if (typeof v[k] === 'number' && Number.isFinite(v[k])) out[k] = v[k] as number;
  return out;
};

/**
 * Merges a parsed save over the defaults and coerces every field to its declared type (BUG-QA-005 / BUG-QA-007):
 * a corrupt, hand-edited or future-version save must never crash boot or poison later reads.
 */
export function sanitizeSave(p: Record<string, unknown>): SaveData {
  const def = defaultSave();
  const ps = isRecord(p.settings) ? p.settings : {};
  const ds = def.settings;
  // unknown keys are kept (forward-compatible), every known key is coerced
  return {
    ...p,
    version: 1,
    ash: Math.max(0, num(p.ash, def.ash)),
    totalAsh: Math.max(0, num(p.totalAsh, def.totalAsh)),
    bestTime: Math.max(0, num(p.bestTime, def.bestTime)),
    bestKills: Math.max(0, num(p.bestKills, def.bestKills)),
    runs: Math.max(0, Math.floor(num(p.runs, def.runs))),
    victories: Math.max(0, Math.floor(num(p.victories, def.victories))),
    meta: numRecord(p.meta),
    unlocked: [...new Set([...def.unlocked, ...strs(p.unlocked)])],
    selectedCharacter: typeof p.selectedCharacter === 'string' ? p.selectedCharacter : def.selectedCharacter,
    achievements: [...new Set(strs(p.achievements))],
    biomesCleared: [...new Set(strs(p.biomesCleared))],
    lifetime: isRecord(p.lifetime) ? numRecord(p.lifetime) : undefined,
    hintsSeen: [...new Set(strs(p.hintsSeen))],
    settings: {
      ...ps,
      masterVolume: Math.min(1, Math.max(0, num(ps.masterVolume, ds.masterVolume))),
      musicVolume: Math.min(1, Math.max(0, num(ps.musicVolume, ds.musicVolume))),
      sfxVolume: Math.min(1, Math.max(0, num(ps.sfxVolume, ds.sfxVolume))),
      screenShake: bool(ps.screenShake, ds.screenShake),
      damageNumbers: safeDamageNumbers(ps.damageNumbers),
      quality: safeQuality(ps.quality),
      showFps: bool(ps.showFps, ds.showFps),
      hints: bool(ps.hints, ds.hints),
    },
  };
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — progress is session-only */
  }
}
