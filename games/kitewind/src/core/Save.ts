/** Versioned localStorage persistence. Every read/write is guarded — storage may be unavailable. */
export const QUALITY_TIERS = ['low', 'medium', 'high'] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  screenShake: boolean;
  quality: QualityTier;
  invertY: boolean;
  /** Mouse steering sensitivity 0.5..2. */
  sensitivity: number;
  mouseSteer: boolean;
  showFps: boolean;
  reducedFlashing: boolean;
}

export interface SaveData {
  version: 1;
  /** Spendable currency. */
  glimmers: number;
  totalGlimmers: number;
  bestDistance: number;
  bestScore: number;
  bestCombo: number;
  runs: number;
  meta: Record<string, number>;
  kites: string[];
  selectedKite: string;
  achievements: string[];
  /** Daily seed bests: date key -> score. */
  daily: Record<string, number>;
  settings: Settings;
}

const KEY = 'kitewind-save-v1';

export function defaultSave(): SaveData {
  return {
    version: 1,
    glimmers: 0,
    totalGlimmers: 0,
    bestDistance: 0,
    bestScore: 0,
    bestCombo: 0,
    runs: 0,
    meta: {},
    kites: ['swallow'],
    selectedKite: 'swallow',
    achievements: [],
    daily: {},
    settings: {
      masterVolume: 0.8,
      musicVolume: 0.55,
      sfxVolume: 0.8,
      screenShake: true,
      quality: 'high',
      invertY: false,
      sensitivity: 1,
      mouseSteer: true,
      showFps: false,
      reducedFlashing: false,
    },
  };
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
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Merges a parsed save over the defaults, coercing every field (a corrupt save must never break boot). */
export function sanitizeSave(p: Record<string, unknown>): SaveData {
  const def = defaultSave();
  const ps = isRecord(p.settings) ? p.settings : {};
  const ds = def.settings;
  const kites = [...new Set([...def.kites, ...strs(p.kites)])];
  const selected = typeof p.selectedKite === 'string' && kites.includes(p.selectedKite) ? p.selectedKite : def.selectedKite;
  return {
    version: 1,
    glimmers: Math.max(0, Math.floor(num(p.glimmers, 0))),
    totalGlimmers: Math.max(0, Math.floor(num(p.totalGlimmers, 0))),
    bestDistance: Math.max(0, num(p.bestDistance, 0)),
    bestScore: Math.max(0, num(p.bestScore, 0)),
    bestCombo: Math.max(0, Math.floor(num(p.bestCombo, 0))),
    runs: Math.max(0, Math.floor(num(p.runs, 0))),
    meta: numRecord(p.meta),
    kites,
    selectedKite: selected,
    achievements: [...new Set(strs(p.achievements))],
    daily: numRecord(p.daily),
    settings: {
      masterVolume: clamp01(num(ps.masterVolume, ds.masterVolume)),
      musicVolume: clamp01(num(ps.musicVolume, ds.musicVolume)),
      sfxVolume: clamp01(num(ps.sfxVolume, ds.sfxVolume)),
      screenShake: bool(ps.screenShake, ds.screenShake),
      quality: (QUALITY_TIERS as readonly unknown[]).includes(ps.quality) ? (ps.quality as QualityTier) : ds.quality,
      invertY: bool(ps.invertY, ds.invertY),
      sensitivity: Math.min(2, Math.max(0.5, num(ps.sensitivity, ds.sensitivity))),
      mouseSteer: bool(ps.mouseSteer, ds.mouseSteer),
      showFps: bool(ps.showFps, ds.showFps),
      reducedFlashing: bool(ps.reducedFlashing, ds.reducedFlashing),
    },
  };
}

/** Minimal storage interface (injectable for tests). */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const defaultStore = (): KV | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export function loadSave(store: KV | null = defaultStore()): SaveData {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return defaultSave();
    return sanitizeSave(parsed);
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData, store: KV | null = defaultStore()): void {
  try {
    store?.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable — progress is session-only */
  }
}
