import { CHORD_TONES, LAYER_AT, MENU_MOOD, MOODS, chimeStep, midiHz, type MusicMood } from './music';

/**
 * Procedural WebAudio: every sound is synthesised at runtime (no samples, nothing to download).
 *
 * Public API (all calls are safe before unlock() or without WebAudio — they no-op):
 * - unlock() on the first user gesture; setVolumes(master, music, sfx); setPaused(p)
 * - sfx(name, arg = 0, pan = 0): one-shots. `arg` is the combo count for ring / glimmer chimes.
 * - setFlight(speedK, diving, bank, liftFrac, combo, active, near, updraft): continuous wind / flutter / dive rush /
 *   hazard pass-by layers and the music intensity. Call every frame (internally throttled). setWind() is the legacy
 *   two-argument form.
 * - setSlowmo(k 0..1): whisker slow-mo — muffles the mix and dips the music.
 * - startMusic('menu' | 'run'), stopMusic(), setMusicMood(biomeIndex): generative layered score (src/audio/music.ts).
 *
 * Mix: sources → sfx / music / wind buses → master → slow-mo low-pass → compressor → out, with a shared stereo
 * ping-pong echo and a generated-impulse reverb as send effects.
 */
export type SfxName =
  | 'ring' | 'perfect' | 'glimmer' | 'whisker' | 'crash' | 'splash' | 'shield' | 'shrine' | 'boon' | 'dive' | 'lightning'
  | 'gust' | 'arch' | 'updraft' | 'lowlift' | 'click' | 'hover' | 'buy' | 'deny' | 'biome' | 'combo_lost' | 'achievement'
  | 'whisker_out' | 'combo_milestone' | 'start';

type LayerId = 'pad' | 'bass' | 'arp' | 'perc' | 'lead';

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private slowLp!: BiquadFilterNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private musicLp!: BiquadFilterNode;
  private windBus!: GainNode;
  private echoIn!: GainNode;
  private verbIn!: GainNode;
  private noise!: AudioBuffer;
  private noiseB!: AudioBuffer;
  private white!: AudioBuffer;
  // continuous wind layers
  private windLowG!: GainNode;
  private windLowF!: BiquadFilterNode;
  private windHiG!: GainNode;
  private windHiF!: BiquadFilterNode;
  private flutterLfo!: OscillatorNode;
  private flutterDepth!: GainNode;
  private rushG!: GainNode;
  private rushF!: BiquadFilterNode;
  private nearG!: GainNode;
  private nearF!: BiquadFilterNode;
  private thermalG!: GainNode;
  private windPan!: StereoPannerNode;
  private layers = {} as Record<LayerId, GainNode>;
  private padFilter!: BiquadFilterNode;
  // music state
  private musicTimer: number | null = null;
  private musicMode: 'menu' | 'run' | 'off' = 'off';
  private mood: MusicMood = MOODS[0];
  private pendingMood: MusicMood | null = null;
  private moodIndex = 0;
  private nextEighth = 0;
  private eighth = 0;
  private chordIdx = 0;
  private leadNote = 0;
  private intensity = 0.2;
  private targetIntensity = 0.2;
  private lowLift = 0;
  // misc
  private vol = { master: 0.8, music: 0.55, sfx: 0.8 };
  private paused = false;
  private slow = 0;
  private lastFlight = 0;
  private glimRun = 0;
  private lastGlim = 0;
  private glimCount = 0;
  private glimWindow = 0;
  private seed = 12345;

  private rand(): number {
    // small LCG: music variation does not need crypto quality and must not allocate
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Creates the context on the first user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
    } catch {
      return;
    }
    const c = this.ctx;
    // ---- master chain
    this.master = c.createGain();
    this.slowLp = c.createBiquadFilter();
    this.slowLp.type = 'lowpass';
    this.slowLp.frequency.value = 20000;
    this.slowLp.Q.value = 0.5;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.22;
    this.master.connect(this.slowLp).connect(comp).connect(c.destination);
    this.sfxBus = c.createGain();
    this.musicBus = c.createGain();
    this.musicLp = c.createBiquadFilter();
    this.musicLp.type = 'lowpass';
    this.musicLp.frequency.value = 18000;
    this.windBus = c.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.musicLp).connect(this.master);
    this.windBus.connect(this.master);

    // ---- noise buffers: two decorrelated pink-ish (wind) + white (clicks, shakers)
    const mk = (pinkish: boolean, s: number): AudioBuffer => {
      const len = c.sampleRate * 3;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      let x = s;
      for (let i = 0; i < len; i++) {
        x = (x * 1664525 + 1013904223) >>> 0;
        const w = x / 2147483648 - 1;
        if (pinkish) {
          b0 = 0.99765 * b0 + w * 0.099;
          b1 = 0.963 * b1 + w * 0.2965;
          b2 = 0.57 * b2 + w * 1.0527;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
        } else d[i] = w * 0.5;
      }
      return buf;
    };
    this.noise = mk(true, 1);
    this.noiseB = mk(true, 777);
    this.white = mk(false, 99);

    // ---- send effects: stereo ping-pong echo + reverb
    this.echoIn = c.createGain();
    const dl = c.createDelay(1.5), dr = c.createDelay(1.5);
    dl.delayTime.value = 0.36;
    dr.delayTime.value = 0.36;
    const fb = c.createGain();
    fb.gain.value = 0.38;
    const elp = c.createBiquadFilter();
    elp.type = 'lowpass';
    elp.frequency.value = 3400;
    const merger = c.createChannelMerger(2);
    this.echoIn.connect(elp).connect(dl);
    dl.connect(dr);
    dr.connect(fb).connect(dl);
    dl.connect(merger, 0, 0);
    dr.connect(merger, 0, 1);
    const echoOut = c.createGain();
    echoOut.gain.value = 0.55;
    merger.connect(echoOut).connect(this.master);

    this.verbIn = c.createGain();
    const verb = c.createConvolver();
    verb.buffer = this.impulse(3.2, 2.6);
    const verbOut = c.createGain();
    verbOut.gain.value = 0.5;
    this.verbIn.connect(verb).connect(verbOut).connect(this.master);
    echoOut.connect(this.verbIn);

    // ---- continuous wind bed
    this.windPan = c.createStereoPanner();
    this.windPan.connect(this.windBus);
    const loop = (buf: AudioBuffer, rate = 1): AudioBufferSourceNode => {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(0, Math.random() * 2);
      return s;
    };
    // low body
    this.windLowF = c.createBiquadFilter();
    this.windLowF.type = 'lowpass';
    this.windLowF.frequency.value = 300;
    this.windLowF.Q.value = 0.7;
    this.windLowG = c.createGain();
    this.windLowG.gain.value = 0;
    loop(this.noise).connect(this.windLowF).connect(this.windLowG).connect(this.windBus);
    // airy hiss with sail flutter (LFO on the gain)
    this.windHiF = c.createBiquadFilter();
    this.windHiF.type = 'bandpass';
    this.windHiF.frequency.value = 1200;
    this.windHiF.Q.value = 0.9;
    this.windHiG = c.createGain();
    this.windHiG.gain.value = 0;
    const flutterAmp = c.createGain();
    flutterAmp.gain.value = 1;
    this.flutterLfo = c.createOscillator();
    this.flutterLfo.type = 'triangle';
    this.flutterLfo.frequency.value = 7;
    this.flutterDepth = c.createGain();
    this.flutterDepth.gain.value = 0;
    this.flutterLfo.connect(this.flutterDepth).connect(flutterAmp.gain);
    this.flutterLfo.start();
    loop(this.noiseB, 1.3).connect(this.windHiF).connect(flutterAmp).connect(this.windHiG).connect(this.windPan);
    // dive rush: resonant whistle that climbs with speed
    this.rushF = c.createBiquadFilter();
    this.rushF.type = 'bandpass';
    this.rushF.frequency.value = 900;
    this.rushF.Q.value = 5;
    this.rushG = c.createGain();
    this.rushG.gain.value = 0;
    loop(this.white, 0.8).connect(this.rushF).connect(this.rushG).connect(this.windPan);
    // hazard pass-by whoosh (proximity-driven)
    this.nearF = c.createBiquadFilter();
    this.nearF.type = 'bandpass';
    this.nearF.frequency.value = 700;
    this.nearF.Q.value = 1.4;
    this.nearG = c.createGain();
    this.nearG.gain.value = 0;
    loop(this.noise, 1.7).connect(this.nearF).connect(this.nearG).connect(this.windBus);
    // thermal (inside updrafts): a soft low hum
    const thermF = c.createBiquadFilter();
    thermF.type = 'lowpass';
    thermF.frequency.value = 220;
    this.thermalG = c.createGain();
    this.thermalG.gain.value = 0;
    loop(this.noiseB, 0.6).connect(thermF).connect(this.thermalG).connect(this.windBus);

    // ---- music layers
    this.padFilter = c.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 0.6;
    for (const id of ['pad', 'bass', 'arp', 'perc', 'lead'] as LayerId[]) {
      const g = c.createGain();
      g.gain.value = id === 'pad' ? 1 : 0;
      g.connect(this.musicBus);
      this.layers[id] = g;
    }
    this.padFilter.connect(this.layers.pad);
    const padVerb = c.createGain();
    padVerb.gain.value = 0.35;
    this.layers.pad.connect(padVerb).connect(this.verbIn);

    this.applyVolumes();
    if (this.musicMode !== 'off') {
      const m = this.musicMode;
      this.musicMode = 'off';
      this.startMusic(m);
    }
  }

  /** Stereo exponential-decay noise impulse for the convolver (a soft hall). */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45; // darker tail
        d[i] = lp * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return buf;
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.vol = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master * this.vol.master * 1.8, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * this.vol.music * 0.55 * (this.paused ? 0.45 : 1) * (1 - this.slow * 0.35), t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx * this.vol.sfx, t, 0.05);
    this.windBus.gain.setTargetAtTime(this.vol.sfx * this.vol.sfx * (this.paused ? 0 : 1), t, 0.12);
    this.musicLp.frequency.setTargetAtTime(this.paused ? 900 : 18000, t, 0.15);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.applyVolumes();
  }

  /** Whisker slow-mo amount 0..1: muffles everything a little and dips the music. */
  setSlowmo(k: number): void {
    if (!this.ctx || Math.abs(k - this.slow) < 0.02) return;
    this.slow = k;
    const t = this.ctx.currentTime;
    this.slowLp.frequency.setTargetAtTime(20000 - k * 18200, t, k > 0.5 ? 0.03 : 0.12);
    this.applyVolumes();
  }

  /** Legacy form: wind bed follows airspeed (0..1). */
  setWind(speedK: number, active: boolean): void {
    this.setFlight(speedK, false, 0, 1, 0, active);
  }

  /**
   * Continuous flight sound + music intensity. speedK 0..1, bank (rad, + = right), liftFrac 0..1, combo count,
   * active = a run is being flown, near = clearance to the nearest hazard (m), updraft = inside a thermal column.
   */
  setFlight(speedK: number, diving: boolean, bank: number, liftFrac: number, combo: number, active: boolean, near = 99, updraft = false): void {
    const c = this.ctx;
    if (!c) return;
    const now = c.currentTime;
    if (now - this.lastFlight < 0.045) return;
    this.lastFlight = now;
    const tc = 0.12;
    const s = active ? speedK : 0.15;
    const dive = active && diving ? 1 : 0;
    this.windLowG.gain.setTargetAtTime(0.05 + s * 0.16 + dive * 0.06, now, tc);
    this.windLowF.frequency.setTargetAtTime(220 + s * 520, now, tc);
    this.windHiG.gain.setTargetAtTime(active ? 0.03 + s * s * 0.2 + dive * 0.05 : 0.018, now, tc);
    this.windHiF.frequency.setTargetAtTime(800 + s * 2600, now, tc);
    this.flutterLfo.frequency.setTargetAtTime(5 + s * 11, now, 0.3);
    this.flutterDepth.gain.setTargetAtTime(active ? 0.18 + s * 0.3 : 0.1, now, 0.3);
    this.rushG.gain.setTargetAtTime(dive ? 0.02 + s * 0.07 : 0, now, dive ? 0.18 : 0.35);
    this.rushF.frequency.setTargetAtTime(700 + s * 2300, now, 0.25);
    this.windPan.pan.setTargetAtTime(Math.max(-0.6, Math.min(0.6, -bank * 0.6)), now, 0.2);
    const nk = active ? smooth(9, 1.2, near) : 0;
    this.nearG.gain.setTargetAtTime(nk * (0.12 + s * 0.12), now, 0.06);
    this.nearF.frequency.setTargetAtTime(500 + nk * 1600 + s * 600, now, 0.08);
    this.thermalG.gain.setTargetAtTime(active && updraft ? 0.2 : 0, now, 0.4);
    // music intensity
    if (this.musicMode === 'run') {
      this.targetIntensity = 0.22 + s * 0.38 + dive * 0.12 + Math.min(combo, 12) * 0.03 + this.mood.baseIntensity;
      this.lowLift = active ? smooth(0.22, 0.05, liftFrac) : 0;
    } else {
      this.targetIntensity = 0.2;
      this.lowLift = 0;
    }
  }

  // ------------------------------------------------------------------ voices
  private env(g: GainNode, t: number, peak: number, attack: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0, echo = 0, attack = 0.005, glide = 0, pan = 0, verb = 0.15, dest?: AudioNode): void {
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + dur);
    const g = c.createGain();
    this.env(g, t, gain, attack, dur);
    let out: AudioNode = g;
    if (pan) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    o.connect(g);
    out.connect(dest ?? this.sfxBus);
    this.sends(out, echo, verb);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private sends(node: AudioNode, echo: number, verb: number): void {
    const c = this.ctx!;
    if (echo > 0) {
      const e = c.createGain();
      e.gain.value = echo;
      node.connect(e).connect(this.echoIn);
    }
    if (verb > 0) {
      const v = c.createGain();
      v.gain.value = verb;
      node.connect(v).connect(this.verbIn);
    }
  }

  /** FM bell: modulator at `ratio` with a decaying index — glassy, kite-chime timbre. */
  private bell(freq: number, t: number, dur: number, gain: number, dest: AudioNode, ratio = 3.5, index = 2.2, pan = 0, echo = 0.35, verb = 0.4): void {
    const c = this.ctx!;
    const car = c.createOscillator();
    car.type = 'sine';
    car.frequency.value = freq;
    const mod = c.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * ratio;
    const mg = c.createGain();
    mg.gain.setValueAtTime(freq * index, t);
    mg.gain.exponentialRampToValueAtTime(freq * 0.05, t + dur * 0.6);
    mod.connect(mg).connect(car.frequency);
    const g = c.createGain();
    this.env(g, t, gain, 0.004, dur);
    car.connect(g);
    let out: AudioNode = g;
    if (pan) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(dest);
    this.sends(out, echo, verb);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  private hiss(dur: number, f0: number, f1: number, gain: number, when = 0, q = 1.2, type: BiquadFilterType = 'bandpass', pan = 0, buf?: AudioBuffer, dest?: AudioNode, attackFrac = 0.3): void {
    const c = this.ctx!;
    const t = c.currentTime + when;
    this.hissAt(t, dur, f0, f1, gain, q, type, pan, buf, dest ?? this.sfxBus, attackFrac);
  }

  private hissAt(t: number, dur: number, f0: number, f1: number, gain: number, q: number, type: BiquadFilterType, pan: number, buf: AudioBuffer | undefined, dest: AudioNode, attackFrac = 0.3): void {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = buf ?? this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    this.env(g, t, gain, Math.max(0.002, dur * attackFrac), dur);
    s.connect(f).connect(g);
    let out: AudioNode = g;
    if (pan) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(dest);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.05);
  }

  /** Key-relative frequency for the current mood: scale step `n` (semitones) above the key at `octave` offset. */
  private keyHz(semis: number, octave = 0): number {
    return midiHz(this.mood.key + semis + octave * 12);
  }

  /** Plays a sound. `arg` = combo count for ring/glimmer chimes; `pan` -1..1. */
  sfx(name: SfxName, arg = 0, pan = 0): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const scale = this.mood.scale;
    switch (name) {
      case 'ring':
      case 'perfect': {
        // the chime ladder climbs the music's pentatonic scale with the combo
        const f = this.keyHz(chimeStep(scale, arg), 1);
        this.bell(f, t, 1.6, 0.2, this.sfxBus, 2.0, 1.4, pan * 0.5, 0.4, 0.35);
        this.tone(f * 2, 0.5, 'sine', 0.05, 0, 0.2, 0.003, 0, pan * 0.5);
        this.hiss(0.32, 2500, 9000, 0.05, 0, 1.1, 'bandpass', pan, this.white);
        if (name === 'perfect') {
          const f2 = this.keyHz(chimeStep(scale, arg + 2), 1);
          const f3 = this.keyHz(chimeStep(scale, arg + 4), 1);
          this.bell(f2, t + 0.07, 1.3, 0.1, this.sfxBus, 3.5, 1.2, -0.3, 0.5, 0.5);
          this.bell(f3, t + 0.14, 1.5, 0.09, this.sfxBus, 3.5, 1.2, 0.3, 0.5, 0.5);
          this.tone(f * 4, 0.9, 'sine', 0.03, 0.16, 0.6, 0.02);
        }
        if (arg >= 5 && arg % 5 === 0) this.sfx('combo_milestone', arg);
        break;
      }
      case 'combo_milestone': {
        for (let i = 0; i < 4; i++) {
          const f = this.keyHz(chimeStep(scale, arg + 1 + i), 1);
          this.bell(f, t + 0.18 + i * 0.06, 1.1, 0.06, this.sfxBus, 3.5, 1, i % 2 ? 0.35 : -0.35, 0.5, 0.5);
        }
        break;
      }
      case 'glimmer': {
        // sparkle ticks: a line of glimmers walks up the scale; rate-limited so magnet swarms don't clip
        const now = t;
        if (now - this.glimWindow > 0.1) {
          this.glimWindow = now;
          this.glimCount = 0;
        }
        if (++this.glimCount > 3) break;
        this.glimRun = now - this.lastGlim < 0.45 ? this.glimRun + 1 : 0;
        this.lastGlim = now;
        const n = this.glimRun % 10;
        const f = this.keyHz(scale[n % scale.length] + 12 * Math.floor(n / scale.length), 2);
        const p = (this.rand() - 0.5) * 0.8;
        this.tone(f, 0.16, 'sine', 0.09, 0, 0.25, 0.002, 0, p, 0.25);
        this.tone(f * 2.01, 0.07, 'triangle', 0.025, 0, 0, 0.001, 0, p, 0);
        break;
      }
      case 'whisker': {
        // the world slows: a swelling "shhhwip" down-sweep + a bright suspended chord
        this.hiss(0.5, 5000, 500, 0.32, 0, 1.6, 'bandpass', pan, this.noiseB, undefined, 0.12);
        this.tone(140, 0.6, 'sine', 0.18, 0, 0, 0.005, 0.5);
        this.bell(this.keyHz(scale[2], 1), t + 0.04, 1.6, 0.09, this.sfxBus, 2, 1, -0.4, 0.6, 0.6);
        this.bell(this.keyHz(scale[4], 1), t + 0.08, 1.6, 0.08, this.sfxBus, 2, 1, 0.4, 0.6, 0.6);
        this.bell(this.keyHz(scale[1], 2), t + 0.12, 1.8, 0.06, this.sfxBus, 3.5, 1, 0, 0.6, 0.6);
        break;
      }
      case 'whisker_out':
        // time snaps back: rising whoosh
        this.hiss(0.45, 400, 4200, 0.34, 0, 1.4, 'bandpass', 0, this.noiseB, undefined, 0.8);
        break;
      case 'crash': {
        // paper sail tearing: AM'd noise bursts + thud + a sad falling bell
        for (let i = 0; i < 7; i++) {
          const w = 0.012 + this.rand() * 0.04;
          this.hiss(w + 0.04, 2400 + this.rand() * 2000, 900, 0.32 * (1 - i / 9), i * 0.035 + this.rand() * 0.02, 0.9, 'bandpass', (this.rand() - 0.5) * 0.6, this.white, undefined, 0.1);
        }
        this.tone(120, 0.7, 'sine', 0.5, 0, 0, 0.004, 0.35);
        this.hiss(1.2, 1400, 160, 0.35, 0.02, 0.7, 'lowpass', 0, this.noise, undefined, 0.05);
        this.bell(this.keyHz(scale[1], 0), t + 0.3, 2.4, 0.08, this.sfxBus, 1.41, 1.5, 0, 0.5, 0.6);
        this.bell(this.keyHz(scale[0] - 1, 0), t + 0.55, 2.8, 0.07, this.sfxBus, 1.41, 1.5, 0, 0.5, 0.6);
        break;
      }
      case 'splash':
        this.hiss(1.4, 900, 220, 0.42, 0, 0.6, 'lowpass', 0, this.noise, undefined, 0.04);
        this.hiss(0.9, 4000, 1500, 0.15, 0.05, 0.8, 'bandpass', 0, this.white, undefined, 0.06);
        for (let i = 0; i < 6; i++) this.tone(500 + this.rand() * 900, 0.08, 'sine', 0.05, 0.25 + i * 0.09 + this.rand() * 0.05, 0, 0.003, 1.8, (this.rand() - 0.5) * 0.8, 0.2);
        break;
      case 'shield': {
        // glass charm shatters
        for (let i = 0; i < 8; i++) this.tone(2400 + this.rand() * 3500, 0.25 + this.rand() * 0.3, 'sine', 0.05, i * 0.018, 0.4, 0.001, 0.97, (this.rand() - 0.5) * 1.2, 0.4);
        this.hiss(0.5, 7000, 2000, 0.22, 0, 0.8, 'highpass', 0, this.white, undefined, 0.02);
        this.tone(180, 0.35, 'sine', 0.25, 0, 0, 0.004, 0.5);
        break;
      }
      case 'shrine':
        for (let i = 0; i < 6; i++) this.bell(this.keyHz(chimeStep(scale, 1 + i * 2), 0), t + i * 0.08, 2.2, 0.08, this.sfxBus, 2, 1, (i - 2.5) * 0.15, 0.5, 0.6);
        this.hiss(1.4, 300, 2400, 0.12, 0, 0.8, 'bandpass', 0, this.noiseB, undefined, 0.6);
        break;
      case 'boon':
        for (let i = 0; i < 3; i++) this.bell(this.keyHz(scale[[0, 2, 4][i]], 1), t + i * 0.09, 1.6, 0.09, this.sfxBus, 3.5, 1.2, (i - 1) * 0.4, 0.5, 0.5);
        break;
      case 'dive':
        this.hiss(0.6, 500, 2800, 0.32, 0, 1.6, 'bandpass', 0, this.noiseB, undefined, 0.6);
        break;
      case 'lightning':
        this.hiss(0.18, 7000, 2500, 0.4 * (arg || 1), 0, 0.6, 'highpass', pan, this.white, undefined, 0.02);
        this.hiss(2.2, 260, 50, 0.45 * (arg || 1), 0.06, 0.8, 'lowpass', pan * 0.5, this.noise, undefined, 0.06);
        break;
      case 'gust':
        this.hiss(1.7, 280, 1500, 0.3, 0, 0.9, 'bandpass', pan, this.noiseB, undefined, 0.55);
        this.hiss(1.4, 2000, 3800, 0.04, 0.2, 4, 'bandpass', pan, this.noise, undefined, 0.6);
        break;
      case 'arch':
        for (let i = 0; i < 5; i++) this.bell(this.keyHz(chimeStep(scale, 3 + i), 1), t + i * 0.055, 1.2, 0.08, this.sfxBus, 2, 1, (i - 2) * 0.25, 0.5, 0.5);
        this.hiss(0.5, 3000, 600, 0.12, 0, 1, 'bandpass', 0, this.noiseB, undefined, 0.1);
        break;
      case 'updraft':
        this.hiss(1.4, 180, 1100, 0.26, 0, 0.8, 'bandpass', 0, this.noise, undefined, 0.5);
        this.tone(this.keyHz(scale[0], -1), 1.4, 'sine', 0.05, 0, 0, 0.4, 1.5);
        break;
      case 'lowlift':
        this.tone(this.keyHz(scale[0], -1), 0.3, 'triangle', 0.07);
        this.tone(this.keyHz(scale[0] - 2, -1), 0.4, 'triangle', 0.07, 0.22);
        break;
      case 'click':
        this.tone(1300, 0.05, 'triangle', 0.09, 0, 0, 0.001, 0.8, 0, 0);
        break;
      case 'hover':
        this.tone(2000, 0.035, 'sine', 0.018, 0, 0, 0.001, 0, 0, 0);
        break;
      case 'buy':
        this.bell(this.keyHz(scale[3], 0), t, 1, 0.1, this.sfxBus, 2, 1);
        this.bell(this.keyHz(scale[0], 1), t + 0.08, 1.2, 0.09, this.sfxBus, 2, 1);
        break;
      case 'deny':
        this.tone(200, 0.12, 'square', 0.03, 0, 0, 0.002, 0.9, 0, 0);
        this.tone(180, 0.14, 'square', 0.03, 0.09, 0, 0.002, 0.9, 0, 0);
        break;
      case 'biome':
        for (let i = 0; i < 4; i++) this.bell(this.keyHz(scale[[0, 2, 4, 0][i]], i === 3 ? 1 : 0), t + i * 0.22, 3, 0.08, this.sfxBus, 1.41 + i * 0.5, 1, (i - 1.5) * 0.3, 0.6, 0.7);
        this.hiss(3, 150, 900, 0.1, 0, 0.6, 'lowpass', 0, this.noise, undefined, 0.5);
        break;
      case 'combo_lost':
        this.tone(this.keyHz(scale[2], 0), 0.6, 'sine', 0.05, 0, 0.2, 0.01, 0.94);
        this.tone(this.keyHz(scale[1], 0), 0.7, 'sine', 0.045, 0.12, 0.2, 0.01, 0.94);
        break;
      case 'achievement':
        for (let i = 0; i < 4; i++) this.bell(this.keyHz([0, 4, 7, 12][i], 1), t + i * 0.09, 1.2, 0.07, this.sfxBus, 3.5, 1.2);
        break;
      case 'start':
        this.hiss(1.2, 200, 2600, 0.14, 0, 0.9, 'bandpass', 0, this.noiseB, undefined, 0.5);
        this.bell(this.keyHz(scale[0], 0), t + 0.1, 2, 0.08, this.sfxBus, 2, 1, -0.3);
        this.bell(this.keyHz(scale[2], 0), t + 0.2, 2, 0.07, this.sfxBus, 2, 1, 0.3);
        this.bell(this.keyHz(scale[4], 0), t + 0.3, 2.4, 0.07, this.sfxBus, 2, 1, 0);
        break;
    }
  }

  // ---------------------------------------------------------------- generative music
  startMusic(mode: 'menu' | 'run'): void {
    const changed = mode !== this.musicMode;
    this.musicMode = mode;
    if (mode === 'menu') this.mood = MENU_MOOD;
    else if (changed) this.mood = MOODS[this.moodIndex % MOODS.length];
    if (!this.ctx) return;
    if (this.musicTimer === null) {
      this.nextEighth = this.ctx.currentTime + 0.1;
      this.eighth = 0;
      this.chordIdx = 0;
      this.musicTimer = window.setInterval(() => this.schedule(), 100);
    }
  }

  stopMusic(): void {
    this.musicMode = 'off';
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  /** Biome index shifts key, tempo, harmony and instrumentation (applied at the next bar line). */
  setMusicMood(i: number): void {
    this.moodIndex = i;
    if (this.musicMode === 'menu') return;
    const m = MOODS[((i % MOODS.length) + MOODS.length) % MOODS.length];
    if (m !== this.mood) this.pendingMood = m;
  }

  private schedule(): void {
    const c = this.ctx;
    if (!c || this.musicMode === 'off') return;
    // intensity follows its target (fast attack, slow release) and drives layer fades
    const ti = this.targetIntensity;
    this.intensity += (ti - this.intensity) * (ti > this.intensity ? 0.06 : 0.025);
    const I = this.intensity;
    const now = c.currentTime;
    const lg = (at: number): number => smooth(at - 0.09, at + 0.09, I);
    const lowK = 1 - this.lowLift * 0.6;
    this.layers.bass.gain.setTargetAtTime(lg(LAYER_AT.bass), now, 0.8);
    this.layers.arp.gain.setTargetAtTime(lg(LAYER_AT.arp) * lowK, now, 0.8);
    this.layers.perc.gain.setTargetAtTime(lg(LAYER_AT.perc) * lowK, now, 0.6);
    this.layers.lead.gain.setTargetAtTime(lg(LAYER_AT.lead) * lowK, now, 1.2);
    const [lo, hi] = this.mood.padCutoff;
    this.padFilter.frequency.setTargetAtTime((lo + (hi - lo) * Math.min(1, I)) * (1 - this.lowLift * 0.45), now, 1.5);

    // a stalled/suspended context: don't build up a backlog
    if (this.nextEighth < now - 0.5) this.nextEighth = now + 0.05;
    while (this.nextEighth < now + 0.3) {
      const t = this.nextEighth;
      const inBar = this.eighth % 8;
      if (inBar === 0) {
        // bar line: apply a pending biome change, advance the chord loop
        if (this.pendingMood) {
          this.mood = this.pendingMood;
          this.pendingMood = null;
          this.chordIdx = 0;
          this.eighth = 0;
        }
      }
      const mm = this.mood;
      const sp = 60 / mm.bpm / 2;
      const barNo = Math.floor(this.eighth / 8);
      const chord = mm.chords[Math.floor(barNo / mm.barsPerChord) % mm.chords.length];
      const tones = CHORD_TONES[chord[1]];
      const root = chord[0];
      const chordStart = inBar === 0 && barNo % mm.barsPerChord === 0;
      if (chordStart) {
        const dur = sp * 8 * mm.barsPerChord;
        for (let v = 0; v < tones.length; v++) this.padVoice(midiHz(mm.key - 12 + root + tones[v]), t, dur, v);
      }
      // bass: root on 1, fifth or root on 3 (eighth 4)
      if (I > LAYER_AT.bass - 0.1 && (inBar === 0 || inBar === 4 || (inBar === 7 && this.rand() < 0.25 * I))) {
        const n = inBar === 4 && this.rand() < 0.5 ? root + 7 : root;
        this.bassNote(midiHz(mm.key - 24 + n), t, inBar === 7 ? sp : sp * 3.6);
      }
      // arpeggio
      if (I > LAYER_AT.arp - 0.1) {
        const ai = mm.arp[inBar];
        if (ai >= 0 && this.rand() < 0.8 + I * 0.2) {
          const n = root + tones[ai % tones.length] + (barNo % 2 === 1 && ai === 0 ? 12 : 0);
          this.pluck(midiHz(mm.key + n), t, (inBar - 3.5) / 6);
        }
      }
      // percussion
      if (I > LAYER_AT.perc - 0.1) this.perc(mm, t, inBar, I);
      // lead bells: a slow random walk on the pentatonic scale, phrase rests on bar 4
      if (I > LAYER_AT.lead - 0.1 && inBar % 2 === 0 && barNo % 4 !== 3) {
        if (this.rand() < mm.leadDensity * (0.6 + I * 0.4)) {
          this.leadNote += Math.floor(this.rand() * 5) - 2;
          if (this.leadNote < 0) this.leadNote = 1;
          if (this.leadNote > 9) this.leadNote = 8;
          const n = mm.scale[this.leadNote % mm.scale.length] + 12 * Math.floor(this.leadNote / mm.scale.length);
          this.bell(midiHz(mm.key + 12 + n), t, 2.2, 0.085, this.layers.lead, 3.5, 0.9, (this.rand() - 0.5) * 0.7, 0.5, 0.5);
        }
      }
      // low lift: a soft heartbeat under everything
      if (this.lowLift > 0.05 && (inBar === 0 || inBar === 1)) this.heartbeat(t, inBar === 0 ? 0.28 : 0.18, this.lowLift);
      this.nextEighth += sp;
      this.eighth++;
    }
  }

  private padVoice(f: number, t: number, dur: number, v: number): void {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.02, t + Math.min(1.6, dur * 0.35));
    g.gain.setValueAtTime(0.02, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.15);
    g.connect(this.padFilter);
    const types: OscillatorType[] = ['sawtooth', 'triangle'];
    for (let k = 0; k < 2; k++) {
      const o = c.createOscillator();
      o.type = types[k];
      o.frequency.value = f * (k === 1 ? 2 : 1);
      o.detune.value = (v % 2 ? 7 : -7) * (k ? -1 : 1);
      o.connect(g);
      o.start(t);
      o.stop(t + dur * 1.2);
    }
  }

  private bassNote(f: number, t: number, dur: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = c.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.17, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = c.createGain();
    g2.gain.value = 0.4; // audible on laptop speakers that cannot reproduce the fundamental
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.layers.bass);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  private pluck(f: number, t: number, pan: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 6, t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.4);
    const g = c.createGain();
    this.env(g, t, 0.1, 0.006, 0.9);
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-0.7, Math.min(0.7, pan));
    o.connect(lp).connect(g).connect(p).connect(this.layers.arp);
    const e = c.createGain();
    e.gain.value = 0.3;
    p.connect(e).connect(this.echoIn);
    o.start(t);
    o.stop(t + 1);
  }

  private perc(m: MusicMood, t: number, inBar: number, I: number): void {
    const out = this.layers.perc;
    switch (m.perc) {
      case 'shaker':
      case 'lantern': {
        const acc = inBar % 2 === 1 ? 1 : 0.55;
        this.hissAt(t, 0.06, 7000, 6000, 0.08 * acc, 1.2, 'highpass', 0.3, this.white, out, 0.3);
        if (inBar === 0 || (inBar === 4 && I > 0.7)) this.kick(t, 0.3, out);
        if (m.perc === 'lantern' && inBar === 6) this.woodblock(t, out);
        break;
      }
      case 'chime':
        if (inBar % 2 === 1) this.hissAt(t, 0.09, 9000, 8000, 0.03, 1, 'highpass', (this.rand() - 0.5) * 0.8, this.white, out, 0.5);
        if (inBar === 0) this.kick(t, 0.16, out);
        break;
      case 'taiko':
        this.hissAt(t, 0.05, 6500, 5500, inBar % 2 ? 0.045 : 0.025, 1.2, 'highpass', -0.2, this.white, out, 0.3);
        if (inBar === 0 || inBar === 3 || inBar === 6) this.taiko(t, inBar === 0 ? 0.3 : 0.18, out);
        break;
    }
  }

  private kick(t: number, gain: number, out: AudioNode): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = c.createGain();
    this.env(g, t, gain, 0.004, 0.32);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.36);
  }

  private taiko(t: number, gain: number, out: AudioNode): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.4);
    const g = c.createGain();
    this.env(g, t, gain, 0.003, 0.6);
    o.connect(g).connect(out);
    this.sends(g, 0, 0.25);
    o.start(t);
    o.stop(t + 0.65);
    this.hissAt(t, 0.12, 900, 300, gain * 0.5, 0.8, 'lowpass', 0, this.noise, out, 0.05);
  }

  private woodblock(t: number, out: AudioNode): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 1180;
    const g = c.createGain();
    this.env(g, t, 0.05, 0.001, 0.09);
    o.connect(g).connect(out);
    this.sends(g, 0.3, 0.2);
    o.start(t);
    o.stop(t + 0.12);
  }

  private heartbeat(t: number, gain: number, k: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    const g = c.createGain();
    this.env(g, t, gain * k, 0.01, 0.3);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.35);
  }
}
