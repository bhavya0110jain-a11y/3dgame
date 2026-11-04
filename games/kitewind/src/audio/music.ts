/**
 * Generative music score data (data-driven: tweak here, not in Audio.ts). One "mood" per biome (index = biome order
 * in src/data/biomes.ts) plus the menu. Each mood is a key, tempo, a chord loop and the pentatonic scale used for the
 * lead bells and the ring-combo chime ladder, so every chime sits in the key of the music that is playing.
 *
 * Layering (Audio.ts): pad is always on; bass, arpeggio, percussion and lead fade in as the flight intensity rises
 * (speed, dive, combo, biome base). Thresholds are the intensity at which each layer is half faded in.
 */
export type ChordQuality = 'maj7' | 'm7' | 'add9' | 'sus2' | 'm9' | 'maj9';

export const CHORD_TONES: Record<ChordQuality, readonly number[]> = {
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  add9: [0, 4, 7, 14],
  sus2: [0, 2, 7, 12],
  m9: [0, 3, 7, 14],
  maj9: [0, 4, 11, 14],
};

export interface MusicMood {
  name: string;
  /** MIDI note of the key centre (octave 4). */
  key: number;
  bpm: number;
  /** Chord loop: [root offset from key (semitones), quality]. */
  chords: readonly (readonly [number, ChordQuality])[];
  barsPerChord: number;
  /** Pentatonic scale (semitones) for bells and the chime ladder. */
  scale: readonly number[];
  /** Pad low-pass cutoff (Hz) at intensity 0 and 1. */
  padCutoff: readonly [number, number];
  /** Intensity added on top of the flight intensity (storms are busier). */
  baseIntensity: number;
  /** Percussion flavour. */
  perc: 'shaker' | 'lantern' | 'chime' | 'taiko';
  /** Arpeggio pattern over chord-tone indices (-1 = rest), one entry per eighth note. */
  arp: readonly number[];
  /** Lead bell probability per quarter note at full intensity. */
  leadDensity: number;
}

export const MOODS: readonly MusicMood[] = [
  {
    name: 'Sunset Shoals', key: 62, bpm: 84, barsPerChord: 1,
    chords: [[0, 'add9'], [9, 'm7'], [5, 'maj7'], [7, 'sus2']],
    scale: [0, 2, 4, 7, 9], padCutoff: [700, 2400], baseIntensity: 0, perc: 'shaker',
    arp: [0, 2, 1, 3, 2, 1, 3, -1], leadDensity: 0.45,
  },
  {
    name: 'Lantern Dusk', key: 57, bpm: 80, barsPerChord: 1,
    chords: [[0, 'add9'], [10, 'add9'], [5, 'maj9'], [0, 'sus2']],
    scale: [0, 2, 4, 7, 9], padCutoff: [600, 2000], baseIntensity: 0.05, perc: 'lantern',
    arp: [0, -1, 2, 1, 3, -1, 2, 1], leadDensity: 0.5,
  },
  {
    name: 'Aurora Reach', key: 64, bpm: 72, barsPerChord: 2,
    chords: [[0, 'm9'], [8, 'maj7'], [3, 'maj9'], [10, 'add9']],
    scale: [0, 3, 5, 7, 10], padCutoff: [800, 3000], baseIntensity: 0.0, perc: 'chime',
    arp: [0, 3, 2, -1, 1, 3, 2, -1], leadDensity: 0.4,
  },
  {
    name: 'Storm Crown', key: 60, bpm: 96, barsPerChord: 1,
    chords: [[0, 'm7'], [8, 'maj7'], [10, 'sus2'], [7, 'm7']],
    scale: [0, 3, 5, 7, 10], padCutoff: [500, 1800], baseIntensity: 0.18, perc: 'taiko',
    arp: [0, 1, 2, 1, 3, 1, 2, 1], leadDensity: 0.35,
  },
];

/** The menu reuses the first mood, slower and sparser. */
export const MENU_MOOD: MusicMood = { ...MOODS[0], name: 'Menu', bpm: 66, leadDensity: 0.3 };

/** Intensity at which each optional layer is half faded in. */
export const LAYER_AT = { bass: 0.18, arp: 0.34, perc: 0.52, lead: 0.66 } as const;

/** Ring-combo chime: scale step for combo n (1-based). Climbs ~2.5 octaves, then keeps cycling the top phrase. */
export function chimeStep(scale: readonly number[], combo: number): number {
  let n = Math.max(0, combo - 1);
  const top = scale.length * 2 + 2;
  if (n > top) n = top - 3 + ((n - top) % 4);
  return scale[n % scale.length] + 12 * Math.floor(n / scale.length);
}

export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
