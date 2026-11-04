/**
 * Last Lantern audio runtime.
 *
 * All sounds and music are original, rendered offline by `tools/audio/build.py` (numpy/scipy synthesis:
 * physical-model harp, FM celesta and bells, string/brass/choir models, convolution reverb, mastering)
 * into small Ogg Vorbis files in `public/audio/` (see `audioManifest.ts`, generated). This class plays them with:
 *   - adaptive music: 4 sample-locked run stems faded in by intensity, boss theme, menu waltz, stingers
 *   - music ducking under big SFX, a muffling low-pass while the game is paused or the lantern is dying
 *   - voice limiting, round-robin variants, pitch/pan jitter and density attenuation for high-rate SFX
 *   - low-light heartbeat / breathing, XP-combo pitch ladder
 * Public API (used by Game/UI): unlock, play, startMusic, stopMusic, setVolumes, setIntensity
 * (+ playWeapon, setLight, bossDefeated).
 */
import { SFX_FILES, MUSIC_FILES, type MusicFile } from './audioManifest';

export type SfxName =
  // legacy names (kept for existing callers)
  | 'shoot' | 'hit' | 'kill' | 'pickup' | 'levelup' | 'hurt' | 'nova' | 'zap'
  | 'boss' | 'click' | 'hover' | 'gameover' | 'victory' | 'chest' | 'heal' | 'elite'
  // combat / player
  | 'crit' | 'kill_elite' | 'explode' | 'pickup_ash' | 'evolve' | 'heartbeat' | 'breath'
  | 'boss_roar' | 'boss_death' | 'warn'
  // UI
  | 'confirm' | 'back' | 'deny'
  // per-weapon fire sounds
  | 'fire_bolt' | 'fire_lance' | 'fire_spark' | 'fire_frost' | 'fire_nova' | 'fire_bell' | 'fire_hook'
  | 'fire_moth' | 'fire_beam' | 'fire_halo' | 'fire_brazier';

export type MusicMode = 'menu' | 'run' | 'boss';

type BusId = 'sfx' | 'ui';

interface SfxDef {
  /** key in SFX_FILES */
  sample: string;
  /** gain in dB at the voice */
  db: number;
  /** random pitch spread, ± cents */
  cents?: number;
  /** minimum seconds between two triggers */
  gap?: number;
  /** max simultaneous voices of this sound (oldest is stolen) */
  voices?: number;
  /** random stereo spread (0..1) */
  pan?: number;
  /** music duck depth in dB (negative) and release seconds */
  duck?: number;
  duckRelease?: number;
  /** attenuate when the sound is triggered very densely */
  dense?: boolean;
  bus?: BusId;
}

const D = (sample: string, db: number, o: Partial<SfxDef> = {}): SfxDef => ({ sample, db, ...o });

/** The mix sheet in code. See design/audio/mix-sheet.md. */
const SFX: Record<string, SfxDef> = {
  // UI
  hover: D('ui_hover', -2, { gap: 0.045, voices: 2, cents: 25, bus: 'ui' }),
  click: D('ui_click', -2, { gap: 0.03, voices: 3, cents: 20, bus: 'ui' }),
  confirm: D('ui_confirm', -2, { gap: 0.08, voices: 2, bus: 'ui' }),
  back: D('ui_back', -2, { gap: 0.08, voices: 2, bus: 'ui' }),
  deny: D('ui_deny', -2, { gap: 0.12, voices: 1, bus: 'ui' }),
  // weapons (frequent, quiet, jittered)
  fire_bolt: D('fire_bolt', -3, { gap: 0.045, voices: 4, cents: 120, pan: 0.25, dense: true }),
  fire_lance: D('fire_lance', -3, { gap: 0.06, voices: 3, cents: 90, pan: 0.2, dense: true }),
  fire_spark: D('fire_spark', -3, { gap: 0.07, voices: 3, cents: 150, pan: 0.3, dense: true }),
  fire_frost: D('fire_frost', -3, { gap: 0.06, voices: 3, cents: 120, pan: 0.3, dense: true }),
  fire_nova: D('fire_nova', -2, { gap: 0.12, voices: 2, cents: 60, duck: -2.5, duckRelease: 0.5 }),
  fire_bell: D('fire_bell', -2, { gap: 0.2, voices: 2, cents: 30, duck: -2, duckRelease: 0.8 }),
  fire_hook: D('fire_hook', -3, { gap: 0.08, voices: 3, cents: 100, pan: 0.3, dense: true }),
  fire_moth: D('fire_moth', -2, { gap: 0.08, voices: 3, cents: 150, pan: 0.5, dense: true }),
  fire_beam: D('fire_beam', -3, { gap: 0.15, voices: 2, cents: 60, pan: 0.2 }),
  fire_halo: D('fire_halo', -3, { gap: 0.15, voices: 2, cents: 80, pan: 0.2 }),
  fire_brazier: D('fire_brazier', -3, { gap: 0.12, voices: 2, cents: 80, pan: 0.3 }),
  // combat
  hit: D('hit', -4, { gap: 0.022, voices: 6, cents: 160, pan: 0.45, dense: true }),
  crit: D('crit', -3, { gap: 0.04, voices: 4, cents: 100, pan: 0.4, dense: true }),
  kill: D('kill', -4, { gap: 0.02, voices: 6, cents: 180, pan: 0.5, dense: true }),
  kill_elite: D('kill_elite', -1, { gap: 0.2, voices: 2, duck: -4, duckRelease: 0.8 }),
  explode: D('explode', -3, { gap: 0.06, voices: 3, cents: 120, pan: 0.4, dense: true }),
  // pickups / player
  pickup: D('pickup', -3, { gap: 0.018, voices: 5, pan: 0.15, dense: true }),
  pickup_ash: D('pickup_ash', -3, { gap: 0.05, voices: 3, cents: 40, pan: 0.15 }),
  heal: D('heal', -2, { gap: 0.25, voices: 1, duck: -2, duckRelease: 0.6 }),
  levelup: D('levelup', -1, { gap: 0.3, voices: 1, duck: -7, duckRelease: 1.4 }),
  chest: D('chest', -1, { gap: 0.3, voices: 1, duck: -7, duckRelease: 1.6 }),
  evolve: D('evolve', 0, { gap: 0.5, voices: 1, duck: -9, duckRelease: 2.2 }),
  hurt: D('hurt', -1, { gap: 0.09, voices: 2, cents: 80, duck: -3, duckRelease: 0.35 }),
  heartbeat: D('heartbeat', -2, { gap: 0.3, voices: 1 }),
  breath: D('breath', -2, { gap: 1.5, voices: 1 }),
  // threats
  boss_roar: D('boss_roar', 0, { gap: 1.0, voices: 1, duck: -9, duckRelease: 2.5 }),
  boss_death: D('boss_death', 0, { gap: 1.0, voices: 1, duck: -10, duckRelease: 3.0 }),
  elite: D('elite', -2, { gap: 0.6, voices: 1, duck: -3, duckRelease: 1.0 }),
  warn: D('warn', -2, { gap: 1.0, voices: 1, duck: -4, duckRelease: 1.5 }),
};
// legacy aliases
SFX.shoot = SFX.fire_bolt;
SFX.zap = SFX.fire_spark;
SFX.nova = SFX.fire_nova;
SFX.boss = SFX.boss_roar;

/** weapon id -> fire sound (evolutions share their family's sound, slightly lower + louder). */
const WEAPON_SFX: Record<string, [SfxName, boolean]> = {
  ember_bolt: ['fire_bolt', false], sunspear_volley: ['fire_bolt', true],
  wick_lance: ['fire_lance', false], beacon_ray: ['fire_lance', true],
  spark_chain: ['fire_spark', false], tempest_choir: ['fire_spark', true],
  frost_shards: ['fire_frost', false], glacier_heart: ['fire_frost', true],
  flare_nova: ['fire_nova', false], dawnbreak: ['fire_nova', true],
  vesper_bell: ['fire_bell', false], cathedral_toll: ['fire_bell', true],
  lantern_hook: ['fire_hook', false], moonhook_reaper: ['fire_hook', true],
  moth_lantern: ['fire_moth', false], lunar_monarchs: ['fire_moth', true],
  gloam_beam: ['fire_beam', false], eclipse_beam: ['fire_beam', true],
  cinder_halo: ['fire_halo', false], solar_crown: ['fire_halo', true],
  brazier: ['fire_brazier', false], pyre_garden: ['fire_brazier', true],
};

/** XP combo ladder: A-minor pentatonic from the A5 sample (sits inside the D-minor score). */
const COMBO_STEPS = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

/**
 * Bus trims, calibrated with tools/audio/mixsim.py so that at the default sliders (master .8, music .6,
 * sfx .8 with the squared slider law) full run music sits near -21 LUFS and dense combat SFX near -17 LUFS.
 */
const MUSIC_TRIM = 2.2;
const SFX_TRIM = 2.4;
const AMB_TRIM = 0.75;
const BASE_URL = `${import.meta.env.BASE_URL ?? '/'}audio/`;

interface Voice {
  name: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
  start: number;
}

interface MusicCue {
  key: string;
  gain: GainNode;
  layers: GainNode[];
  sources: AudioBufferSourceNode[];
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private uiBus!: GainNode;
  private musicBus!: GainNode;
  private musicDuck!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private musicIn!: GainNode;
  private ambGain!: GainNode;
  private stingerGain!: GainNode;

  /** encoded files (kept so music can be re-decoded after being released) */
  private encoded = new Map<string, Promise<ArrayBuffer | null>>();
  private decoded = new Map<string, AudioBuffer>();
  private decoding = new Map<string, Promise<AudioBuffer | null>>();

  private lastPlay = new Map<string, number>();
  private rr = new Map<string, number>();
  private density = new Map<string, number>();
  private densityT = new Map<string, number>();
  private voices: Voice[] = [];
  private readonly maxVoices = 40;

  private pickupCombo = 0;
  private pickupComboT = 0;

  private mode: MusicMode | null = null;
  private cue: MusicCue | null = null;
  private amb: MusicCue | null = null;
  private wantAmbience = false;
  private musicToken = 0;

  private intensity = 0;
  private intensitySmooth = 0;
  private lastIntensityCall = 0;
  private paused = false;
  private light = 1;
  private nextBeat = 0;
  private nextBreath = 0;
  private duckUntil = 0;
  private duckDepth = 0;
  private tickTimer: number | null = null;
  private lastTick = 0;

  volumes = { master: 0.8, music: 0.6, sfx: 0.8 };

  constructor() {
    // Start downloading early (no AudioContext needed); UI + menu first, the rest right after.
    if (typeof fetch === 'undefined') return;
    const first = ['ui_hover', 'ui_click', 'ui_confirm', 'ui_back'];
    for (const k of first) for (const f of SFX_FILES[k] ?? []) this.fetchFile(f);
    for (const m of MUSIC_FILES.menu ?? []) this.fetchFile(m.file);
    for (const m of MUSIC_FILES.ambience ?? []) this.fetchFile(m.file);
    for (const files of Object.values(SFX_FILES)) for (const f of files) this.fetchFile(f);
    for (const cues of Object.values(MUSIC_FILES)) for (const m of cues) this.fetchFile(m.file);
  }

  /** True once the context exists and is running. */
  get isRunning(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume();
      return;
    }
    try {
      // 48 kHz matches the assets, so loops are never resampled at their seams.
      this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    } catch {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
    }
    const c = this.ctx;
    this.master = c.createGain();
    const glue = c.createDynamicsCompressor();
    glue.threshold.value = -10;
    glue.knee.value = 12;
    glue.ratio.value = 2;
    glue.attack.value = 0.005;
    glue.release.value = 0.25;
    const limit = c.createDynamicsCompressor();
    limit.threshold.value = -1.5;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.1;
    this.master.connect(glue).connect(limit).connect(c.destination);

    this.sfxBus = c.createGain();
    this.uiBus = c.createGain();
    this.sfxBus.connect(this.master);
    this.uiBus.connect(this.master);

    this.musicBus = c.createGain();
    this.musicDuck = c.createGain();
    this.musicFilter = c.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicFilter.Q.value = 0.5;
    this.musicIn = c.createGain();
    this.musicIn.connect(this.musicFilter).connect(this.musicDuck).connect(this.musicBus).connect(this.master);
    this.ambGain = c.createGain();
    this.ambGain.gain.value = AMB_TRIM;
    this.ambGain.connect(this.musicFilter);
    this.stingerGain = c.createGain();
    this.stingerGain.connect(this.musicBus);

    this.applyVolumes(true);
    // decode the essentials first
    for (const k of ['ui_hover', 'ui_click', 'ui_confirm', 'ui_back']) for (const f of SFX_FILES[k] ?? []) void this.decode(f);
    for (const m of MUSIC_FILES.menu ?? []) void this.decode(m.file);
    for (const files of Object.values(SFX_FILES)) for (const f of files) void this.decode(f);
    for (const k of ['ambience', 'victory', 'defeat']) for (const m of MUSIC_FILES[k] ?? []) void this.decode(m.file);
    this.tickTimer = window.setInterval(() => this.tick(), 100);
    c.addEventListener?.('statechange', () => {
      if (c.state === 'running' && this.mode && !this.cue) this.startMusic(this.mode, true);
    });
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes = { master, music, sfx };
    this.applyVolumes(false);
  }

  private applyVolumes(immediate: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => {
      if (immediate) p.value = v;
      else p.setTargetAtTime(v, t, 0.03);
    };
    // perceptual (squared) volume curve for the sliders
    set(this.master.gain, this.volumes.master * this.volumes.master);
    set(this.musicBus.gain, this.volumes.music * this.volumes.music * MUSIC_TRIM);
    set(this.sfxBus.gain, this.volumes.sfx * this.volumes.sfx * SFX_TRIM);
    set(this.uiBus.gain, this.volumes.sfx * this.volumes.sfx * SFX_TRIM * 0.9);
  }

  /** 0..1 — drives music layering (called every gameplay frame). */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
    this.lastIntensityCall = performance.now();
  }

  /** Lantern light fraction 0..1 (1 = full). Drives heartbeat/breathing and the closing-in music filter. */
  setLight(frac: number): void {
    this.light = Math.max(0, Math.min(1, frac));
  }

  /** Weapon fire sound for a weapon id (evolved weapons sound bigger). */
  playWeapon(weaponId: string): void {
    const w = WEAPON_SFX[weaponId];
    if (!w) return this.play('fire_bolt');
    this.play(w[0], w[1] ? { rate: 0.9, gain: 1.25 } : undefined);
  }

  /** Boss died: death sting, then the run music returns (endless) or the stinger follows (victory). */
  bossDefeated(): void {
    this.play('boss_death');
    if (this.mode === 'boss') this.startMusic('run');
  }

  // ------------------------------------------------------------------ loading
  private fetchFile(file: string): Promise<ArrayBuffer | null> {
    let p = this.encoded.get(file);
    if (!p) {
      p = fetch(BASE_URL + file)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
      this.encoded.set(file, p);
    }
    return p;
  }

  private decode(file: string): Promise<AudioBuffer | null> {
    const have = this.decoded.get(file);
    if (have) return Promise.resolve(have);
    let p = this.decoding.get(file);
    if (p) return p;
    const c = this.ctx;
    if (!c) return Promise.resolve(null);
    p = this.fetchFile(file).then(async (ab) => {
      if (!ab) return null;
      try {
        // decodeAudioData detaches its input: keep the encoded copy for later re-decodes
        const buf = await c.decodeAudioData(ab.slice(0));
        this.decoded.set(file, buf);
        return buf;
      } catch {
        return null;
      } finally {
        this.decoding.delete(file);
      }
    });
    this.decoding.set(file, p);
    return p;
  }

  private release(key: string): void {
    for (const m of MUSIC_FILES[key] ?? []) this.decoded.delete(m.file);
  }

  // ------------------------------------------------------------------ SFX
  play(name: SfxName, opts?: { rate?: number; gain?: number; pan?: number }): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    if (name === 'victory' || name === 'gameover') return this.stinger(name === 'victory' ? 'victory' : 'defeat');
    const def = SFX[name];
    if (!def) return;
    const now = c.currentTime;
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < (def.gap ?? 0)) return;
    const files = SFX_FILES[def.sample];
    if (!files || files.length === 0) return;
    // random round-robin without immediate repeats
    const prev = this.rr.get(def.sample) ?? -1;
    let i = Math.floor(Math.random() * files.length);
    if (files.length > 1 && i === prev) i = (i + 1) % files.length;
    this.rr.set(def.sample, i);
    const buf = this.decoded.get(files[i]);
    if (!buf) {
      void this.decode(files[i]);
      return;
    }
    this.lastPlay.set(name, now);

    let rate = opts?.rate ?? 1;
    let gainDb = def.db;
    if (def.cents) rate *= Math.pow(2, ((Math.random() * 2 - 1) * def.cents) / 1200);
    if (name === 'pickup') {
      if (now - this.pickupComboT > 0.8) this.pickupCombo = 0;
      this.pickupComboT = now;
      const step = Math.min(this.pickupCombo++, COMBO_STEPS.length - 1);
      const top = step === COMBO_STEPS.length - 1 && this.pickupCombo % 2 === 0 ? -2 : 0;
      rate *= Math.pow(2, (COMBO_STEPS[step] + top) / 12);
      gainDb -= step * 0.35; // higher notes are perceptually brighter: keep the ladder even
    }
    if (def.dense) {
      // exponential trigger-density estimate -> gentle attenuation when hundreds of hits pile up
      const lt = this.densityT.get(def.sample) ?? now;
      const d = (this.density.get(def.sample) ?? 0) * Math.exp(-(now - lt) / 0.35) + 1;
      this.density.set(def.sample, d);
      this.densityT.set(def.sample, now);
      if (d > 2) gainDb -= Math.min(9, 4.5 * Math.log2(d / 2));
    }
    const gain = Math.pow(10, gainDb / 20) * (opts?.gain ?? 1);

    // voice limiting: per-sound, then global
    this.reapVoices(now);
    let same = 0;
    let oldest: Voice | null = null;
    for (const v of this.voices) {
      if (v.name !== def.sample) continue;
      same++;
      if (!oldest || v.start < oldest.start) oldest = v;
    }
    if (same >= (def.voices ?? 4) && oldest) this.kill(oldest, now);
    if (this.voices.length >= this.maxVoices) {
      // steal the oldest dense (least important) voice, else the oldest overall
      let victim: Voice | null = null;
      for (const v of this.voices) if (!victim || v.start < victim.start) victim = v;
      if (victim) this.kill(victim, now);
    }

    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = gain;
    let node: AudioNode = src.connect(g);
    const panAmt = opts?.pan ?? (def.pan ? (Math.random() * 2 - 1) * def.pan : 0);
    if (panAmt !== 0 && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, panAmt));
      node = g.connect(p);
    }
    node.connect(def.bus === 'ui' ? this.uiBus : this.sfxBus);
    src.start(now);
    const voice: Voice = { name: def.sample, src, gain: g, start: now };
    this.voices.push(voice);
    src.onended = () => {
      const k = this.voices.indexOf(voice);
      if (k >= 0) this.voices.splice(k, 1);
      try {
        g.disconnect();
      } catch {
        /* ignore */
      }
    };
    if (def.duck) this.duck(def.duck, def.duckRelease ?? 0.8);
    if (name === 'boss' || name === 'boss_roar') {
      if (this.mode === 'run') this.startMusic('boss');
    }
  }

  private kill(v: Voice, now: number): void {
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + 0.015);
      v.src.stop(now + 0.02);
    } catch {
      /* already stopped */
    }
    const k = this.voices.indexOf(v);
    if (k >= 0) this.voices.splice(k, 1);
  }

  private reapVoices(now: number): void {
    // onended normally removes voices; this guards against contexts that never fire it
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      const dur = (v.src.buffer?.duration ?? 0) / Math.max(0.05, v.src.playbackRate.value);
      if (now - v.start > dur + 0.5) this.voices.splice(i, 1);
    }
  }

  private duck(depthDb: number, release: number): void {
    const c = this.ctx!;
    const now = c.currentTime;
    if (now < this.duckUntil && depthDb > this.duckDepth) return; // a deeper duck is already active
    this.duckDepth = depthDb;
    this.duckUntil = now + 0.15 + release;
    const p = this.musicDuck.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.setTargetAtTime(Math.pow(10, depthDb / 20), now, 0.02);
    p.setTargetAtTime(1, now + 0.15, release / 3);
  }

  // ------------------------------------------------------------------ music
  startMusic(mode: MusicMode, force = false): void {
    const c = this.ctx;
    if (!c) {
      this.mode = mode;
      return;
    }
    if (!force && this.mode === mode && this.cue) return;
    this.mode = mode;
    const token = ++this.musicToken;
    const files = MUSIC_FILES[mode] ?? [];
    // memory policy: keep only what this mode (and its likely next cue) needs decoded
    if (mode === 'menu') {
      this.release('run');
      this.release('boss');
    } else {
      this.release('menu');
      if (mode === 'run') for (const m of MUSIC_FILES.boss ?? []) void this.decode(m.file);
    }
    this.wantAmbience = true;
    void this.ensureAmbience();
    void Promise.all(files.map((m) => this.decode(m.file))).then((bufs) => {
      if (token !== this.musicToken || !this.ctx) return;
      if (bufs.some((b) => !b)) return;
      const fadeOut = mode === 'boss' ? 0.8 : 1.6;
      this.fadeCue(this.cue, fadeOut);
      this.cue = this.makeCue(mode, files, bufs as AudioBuffer[], mode === 'boss' ? 0.4 : mode === 'run' ? 1.2 : 2.5);
      this.intensitySmooth = mode === 'run' ? Math.min(this.intensitySmooth, this.intensity) : this.intensitySmooth;
    });
  }

  private makeCue(key: string, files: MusicFile[], bufs: AudioBuffer[], fadeIn: number, dest?: AudioNode): MusicCue {
    const c = this.ctx!;
    const when = c.currentTime + 0.08;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(1, when + fadeIn);
    gain.connect(dest ?? this.musicIn);
    const layers: GainNode[] = [];
    const sources: AudioBufferSourceNode[] = [];
    files.forEach((f, i) => {
      const src = c.createBufferSource();
      src.buffer = bufs[i];
      src.loop = f.loop;
      if (f.loop && f.loopStart !== undefined && f.loopEnd !== undefined) {
        src.loopStart = f.loopStart;
        src.loopEnd = Math.min(f.loopEnd, bufs[i].duration);
      }
      const lg = c.createGain();
      lg.gain.value = key === 'run' ? this.layerTarget(i, this.intensitySmooth) : 1;
      src.connect(lg).connect(gain);
      src.start(when, f.loopStart ?? 0); // all stems share `when` -> sample-locked
      layers.push(lg);
      sources.push(src);
    });
    return { key, gain, layers, sources };
  }

  private fadeCue(cue: MusicCue | null, seconds: number): void {
    if (!cue || !this.ctx) return;
    const now = this.ctx.currentTime;
    const p = cue.gain.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(Math.max(0.0001, p.value), now);
    p.exponentialRampToValueAtTime(0.0001, now + seconds);
    for (const s of cue.sources) {
      try {
        s.stop(now + seconds + 0.05);
      } catch {
        /* ignore */
      }
    }
    window.setTimeout(() => {
      try {
        cue.gain.disconnect();
      } catch {
        /* ignore */
      }
    }, (seconds + 0.3) * 1000);
  }

  private async ensureAmbience(): Promise<void> {
    if (this.amb || !this.ctx) return;
    const files = MUSIC_FILES.ambience ?? [];
    const bufs = await Promise.all(files.map((m) => this.decode(m.file)));
    if (!this.wantAmbience || this.amb || !this.ctx || bufs.some((b) => !b)) return;
    this.amb = this.makeCue('ambience', files, bufs as AudioBuffer[], 4, this.ambGain);
  }

  stopMusic(): void {
    this.musicToken++;
    this.mode = null;
    this.wantAmbience = false;
    this.fadeCue(this.cue, 0.9);
    this.cue = null;
    this.fadeCue(this.amb, 1.5);
    this.amb = null;
  }

  private stinger(key: 'victory' | 'defeat'): void {
    const c = this.ctx!;
    const f = MUSIC_FILES[key]?.[0];
    if (!f) return;
    void this.decode(f.file).then((buf) => {
      if (!buf || !this.ctx) return;
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      g.gain.value = 1.2;
      src.connect(g).connect(this.stingerGain);
      src.start(c.currentTime + 0.35); // let the run music fade first
      src.onended = () => g.disconnect();
    });
  }

  private layerTarget(i: number, x: number): number {
    if (i === 0) return 1;
    if (i === 1) return smoothstep(0.06, 0.24, x);
    if (i === 2) return smoothstep(0.32, 0.55, x);
    return smoothstep(0.62, 0.85, x);
  }

  // ------------------------------------------------------------------ 10 Hz control loop
  private tick(): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    const inRun = this.mode === 'run' || this.mode === 'boss';
    // gameplay calls setIntensity every frame; silence for >500 ms means paused / level-up / chest screen
    const paused = inRun && performance.now() - this.lastIntensityCall > 500;
    if (paused !== this.paused) this.paused = paused;

    // intensity smoothing: swell in faster than it decays (no flapping on wave edges)
    const dt = Math.min(1, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    const target = this.intensity;
    const tau = target > this.intensitySmooth ? 2.0 : 7.0;
    this.intensitySmooth += (target - this.intensitySmooth) * (1 - Math.exp(-dt / tau));
    if (this.cue && this.cue.key === 'run') {
      this.cue.layers.forEach((g, i) => g.gain.setTargetAtTime(this.layerTarget(i, this.intensitySmooth), now, 0.6));
    }

    // low light: the world closes in
    const danger = inRun && !paused ? Math.max(0, Math.min(1, (0.35 - this.light) / 0.3)) : 0;
    let cutoff = 20000;
    if (paused) cutoff = 750;
    else if (danger > 0) cutoff = 20000 * Math.pow(2400 / 20000, danger * 0.85);
    this.musicFilter.frequency.setTargetAtTime(cutoff, now, paused ? 0.12 : 0.5);
    this.musicIn.gain.setTargetAtTime(paused ? 0.6 : 1, now, 0.15);

    if (danger > 0.001) {
      if (this.nextBeat < now) this.nextBeat = now + 0.05;
      if (this.nextBeat < now + 0.15) {
        const g = 0.35 + 0.65 * danger;
        this.playAt('heartbeat', this.nextBeat, g, 1 + danger * 0.06);
        this.nextBeat += 1.0 - 0.45 * danger;
      }
      if (danger > 0.55) {
        if (this.nextBreath < now) this.nextBreath = now + 1.2;
        if (this.nextBreath < now + 0.15) {
          this.playAt('breath', this.nextBreath, 0.5 + 0.5 * danger, 1);
          this.nextBreath += 3.6 - 1.0 * danger;
        }
      }
    } else {
      this.nextBeat = 0;
      this.nextBreath = 0;
    }
  }

  /** Scheduled (sample-accurate) one-shot used by the control loop. */
  private playAt(sample: string, when: number, gain: number, rate: number): void {
    const c = this.ctx!;
    const def = SFX[sample];
    const file = SFX_FILES[def?.sample ?? sample]?.[0];
    const buf = file ? this.decoded.get(file) : undefined;
    if (!buf || !def) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = Math.pow(10, def.db / 20) * gain;
    src.connect(g).connect(this.sfxBus);
    src.start(when);
    src.onended = () => g.disconnect();
  }

  /** Stop everything and close the context (tests / teardown). */
  dispose(): void {
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.tickTimer = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
