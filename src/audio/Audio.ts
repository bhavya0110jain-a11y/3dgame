/** Procedural WebAudio sound + generative music. No audio files needed. */
export type SfxName =
  | 'shoot' | 'hit' | 'kill' | 'pickup' | 'levelup' | 'hurt' | 'nova' | 'zap'
  | 'boss' | 'click' | 'hover' | 'gameover' | 'victory' | 'chest' | 'heal' | 'elite';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private lastPlay = new Map<SfxName, number>();
  private pickupCombo = 0;
  private pickupComboT = 0;
  private musicTimer: number | null = null;
  private musicNodes: AudioNode[] = [];
  private intensity = 0;
  volumes = { master: 0.8, music: 0.6, sfx: 0.8 };

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfxBus = c.createGain();
    this.musicBus = c.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.musicBus.gain.value = this.volumes.music * 0.5;
    this.sfxBus.gain.value = this.volumes.sfx * 0.6;
  }

  /** 0..1 — drives music layering. */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, filterFreq: number, type: BiquadFilterType = 'lowpass', delay = 0, q = 1): void {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  play(name: SfxName): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const minGap: Partial<Record<SfxName, number>> = { hit: 0.03, kill: 0.025, shoot: 0.05, pickup: 0.02, zap: 0.08, nova: 0.1 };
    const last = this.lastPlay.get(name) ?? -1;
    if (now - last < (minGap[name] ?? 0)) return;
    this.lastPlay.set(name, now);
    const r = () => 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'shoot':
        this.tone(520 * r(), 0.08, 'triangle', 0.08, 260);
        this.noise(0.05, 0.05, 3000, 'highpass');
        break;
      case 'hit':
        this.noise(0.06, 0.12, 1200 * r(), 'bandpass', 0, 2);
        break;
      case 'kill':
        this.tone(220 * r(), 0.12, 'sine', 0.12, 80);
        this.noise(0.1, 0.08, 900, 'lowpass');
        break;
      case 'pickup': {
        if (now - this.pickupComboT > 0.6) this.pickupCombo = 0;
        this.pickupComboT = now;
        const semis = Math.min(this.pickupCombo++, 24);
        const f = 660 * Math.pow(2, semis / 12);
        this.tone(f, 0.07, 'sine', 0.06);
        break;
      }
      case 'levelup':
        [0, 4, 7, 12, 16].forEach((s, i) => this.tone(440 * Math.pow(2, s / 12), 0.35, 'triangle', 0.12, undefined, i * 0.06));
        break;
      case 'hurt':
        this.tone(140, 0.2, 'sawtooth', 0.15, 60);
        this.noise(0.15, 0.15, 500);
        break;
      case 'nova':
        this.noise(0.4, 0.15, 800, 'lowpass');
        this.tone(180, 0.35, 'sine', 0.12, 90);
        break;
      case 'zap':
        this.noise(0.12, 0.08, 4000, 'highpass');
        this.tone(1200 * r(), 0.1, 'square', 0.03, 300);
        break;
      case 'boss':
        this.tone(55, 2.2, 'sawtooth', 0.25, 40);
        this.tone(82, 2.2, 'sawtooth', 0.18, 60);
        this.noise(1.5, 0.15, 300);
        break;
      case 'elite':
        this.tone(110, 0.9, 'sawtooth', 0.14, 70);
        break;
      case 'click':
        this.tone(900, 0.04, 'square', 0.04);
        break;
      case 'hover':
        this.tone(1400, 0.025, 'sine', 0.025);
        break;
      case 'chest':
        [0, 7, 12, 19, 24].forEach((s, i) => this.tone(523 * Math.pow(2, s / 12), 0.5, 'sine', 0.1, undefined, i * 0.09));
        break;
      case 'heal':
        this.tone(392, 0.3, 'sine', 0.1, 784);
        break;
      case 'gameover':
        [0, -3, -7, -12].forEach((s, i) => this.tone(330 * Math.pow(2, s / 12), 0.8, 'triangle', 0.12, undefined, i * 0.25));
        break;
      case 'victory':
        [0, 4, 7, 12, 7, 12, 16, 19].forEach((s, i) => this.tone(392 * Math.pow(2, s / 12), 0.6, 'triangle', 0.12, undefined, i * 0.12));
        break;
    }
  }

  /** Minimal generative ambient score: drone + minor pad + sparse bells. Scheduled in 2-bar chunks. */
  startMusic(mode: 'menu' | 'run'): void {
    if (!this.ctx) return;
    this.stopMusic();
    const c = this.ctx;
    const root = mode === 'menu' ? 49 : 45; // MIDI-ish semitone offsets from A0
    const mtof = (m: number) => 27.5 * Math.pow(2, m / 12);
    // drone
    const droneGain = c.createGain();
    droneGain.gain.value = 0.0;
    droneGain.gain.linearRampToValueAtTime(0.18, c.currentTime + 3);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    droneGain.connect(lp).connect(this.musicBus);
    for (const det of [-7, 0, 7]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(root - 12);
      o.detune.value = det;
      o.connect(droneGain);
      o.start();
      this.musicNodes.push(o);
    }
    this.musicNodes.push(droneGain, lp);
    const lfo = c.createOscillator();
    const lfoG = c.createGain();
    lfo.frequency.value = 0.07;
    lfoG.gain.value = 200;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start();
    this.musicNodes.push(lfo, lfoG);

    const chords = [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]];
    const scale = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15];
    let bar = 0;
    const barLen = mode === 'menu' ? 4.8 : 3.2;
    const schedule = () => {
      if (!this.ctx) return;
      const t0 = c.currentTime + 0.05;
      const chord = chords[bar % chords.length];
      // pad
      for (const s of chord) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'triangle';
        o.frequency.value = mtof(root + s);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.05, t0 + barLen * 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + barLen * 1.1);
        o.connect(g).connect(this.musicBus);
        o.start(t0);
        o.stop(t0 + barLen * 1.15);
      }
      // bells
      const notes = mode === 'run' ? 2 + Math.round(this.intensity * 4) : 2;
      for (let i = 0; i < notes; i++) {
        if (Math.random() < 0.35) continue;
        const s = scale[Math.floor(Math.random() * scale.length)];
        const tt = t0 + (i / notes) * barLen;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sine';
        o.frequency.value = mtof(root + 24 + s);
        g.gain.setValueAtTime(0.0001, tt);
        g.gain.exponentialRampToValueAtTime(0.035, tt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.6);
        o.connect(g).connect(this.musicBus);
        o.start(tt);
        o.stop(tt + 1.7);
      }
      // pulse when intense
      if (mode === 'run' && this.intensity > 0.35) {
        const beats = 8;
        for (let i = 0; i < beats; i++) {
          const tt = t0 + (i / beats) * barLen;
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(90, tt);
          o.frequency.exponentialRampToValueAtTime(40, tt + 0.15);
          g.gain.setValueAtTime(i % 2 === 0 ? 0.12 * this.intensity : 0.05 * this.intensity, tt);
          g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.2);
          o.connect(g).connect(this.musicBus);
          o.start(tt);
          o.stop(tt + 0.25);
        }
      }
      bar++;
    };
    schedule();
    this.musicTimer = window.setInterval(schedule, barLen * 1000);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
    for (const n of this.musicNodes) {
      try {
        if (n instanceof OscillatorNode) n.stop();
        n.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.musicNodes = [];
  }
}
