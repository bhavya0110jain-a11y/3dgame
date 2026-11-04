import * as THREE from 'three';
import { Audio } from '../audio/Audio';
import { EventBus, type GameEvents } from '../core/EventBus';
import { Input } from '../core/Input';
import { clamp, damp } from '../core/math';
import { dailyKey, dailySeed } from '../core/Rng';
import { loadSave, writeSave, type QualityTier, type SaveData } from '../core/Save';
import { BIOMES } from '../data/biomes';
import { boonById } from '../data/boons';
import { kiteById } from '../data/kites';
import { FLIGHT, SCORING, WORLD } from '../data/tuning';
import { HazardsView } from '../entities/HazardsView';
import { KiteView } from '../entities/KiteView';
import { RingsView } from '../entities/RingsView';
import { CameraRig } from '../render/CameraRig';
import { Fx } from '../render/Fx';
import { SpeedLines } from '../render/SpeedLines';
import { shared } from '../render/materials';
import type { Models } from '../render/Models';
import { Renderer } from '../render/Renderer';
import { UI, type HudState, type ScreenId } from '../ui/UI';
import { Environment } from '../world/Environment';
import { Ocean } from '../world/Ocean';
import { Sky } from '../world/Sky';
import { WorldView } from '../world/WorldView';
import { autopilot } from './Autopilot';
import type { FlightInput } from './Flight';
import { applyRun, buyKite, buyUpgrade, selectKite } from './Meta';
import { buildMods } from './Mods';
import { CAUSE_TEXT, Run } from './Run';

export type GameState = 'menu' | 'playing' | 'boon' | 'paused' | 'dying' | 'results';

const STEP = 1 / 60;
const MENU_SEED = 20261104;

/**
 * Top-level state machine and frame loop: menu (attract flight) → playing ⇄ boon/paused → dying → results → menu.
 * Owns the render stack and wires run events to audio, FX and UI. Exposed as `window.__game` (see api in main.ts).
 */
export class Game {
  state: GameState = 'menu';
  readonly events = new EventBus();
  readonly renderer: Renderer;
  readonly rig: CameraRig;
  readonly env = new Environment();
  readonly input: Input;
  readonly audio = new Audio();
  readonly ui: UI;
  readonly fx: Fx;
  /** 3-D wind streaks (feel). */
  readonly streaks: SpeedLines;
  readonly kite: KiteView;
  readonly worldView: WorldView;
  readonly rings: RingsView;
  readonly hazards: HazardsView;
  private sky: Sky;
  private ocean: Ocean;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  save: SaveData;
  /** The active run (the attract-mode run while on the menu). */
  run: Run;
  private attract = true;
  private acc = 0;
  /** Sim time scale (slow-mo on whiskers). */
  timeScale = 1;
  private slowmo = 0;
  private dyingT = 0;
  private flash = 0;
  private stormFlash = 0;
  private clock = 0;
  private fps = 60;
  private last = 0;
  private boonChoices: string[] = [];
  private pilotInput: FlightInput = { steerX: 0, steerY: 0, dive: false };
  private playerInput: FlightInput = { steerX: 0, steerY: 0, dive: false };
  private hud: HudState = { distance: 0, score: 0, combo: 0, multiplier: 1, comboFrac: 0, lift: 1, glimmers: 0, shields: 0, speed: 0, altitude: 0, diving: false, biome: '', fps: 60, nextShrine: 0 };
  private proj = new THREE.Vector3();
  private lastResults: unknown = null;
  /** Automation: when true the frame loop does not step the sim (the probe drives it via simulate()). */
  manual = false;
  private daily: string | null = null;
  private unsub: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, readonly models: Models) {
    this.save = loadSave();
    this.renderer = new Renderer(canvas);
    this.renderer.setQuality(this.save.settings.quality);
    const scene = this.renderer.scene;
    this.rig = new CameraRig(this.renderer.camera);
    this.sky = new Sky(scene);
    this.ocean = new Ocean(scene);
    this.sun = new THREE.DirectionalLight(0xffd2a0, 2.5);
    this.hemi = new THREE.HemisphereLight(0x9fb4ff, 0xf0a070, 0.9);
    scene.add(this.sun, this.sun.target, this.hemi);
    this.worldView = new WorldView(scene, models);
    this.rings = new RingsView(scene, models);
    this.hazards = new HazardsView(scene, models);
    this.kite = new KiteView(scene, models);
    this.fx = new Fx(scene);
    this.streaks = new SpeedLines(scene);
    this.input = new Input(canvas);
    this.ui = new UI(uiRoot);
    this.ui.onAction((a, d) => this.action(a, d));
    this.ui.onHover = () => this.audio.sfx('hover');
    this.applySettings();
    this.run = this.makeAttractRun();
    this.kite.setKite(kiteById(this.save.selectedKite));
    this.toMenu();
    window.addEventListener('keydown', (e) => this.onKey(e.code));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    const unlock = (): void => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  // ------------------------------------------------------------------ runs
  private makeAttractRun(): Run {
    const m = buildMods(kiteById(this.save.selectedKite), {});
    const r = new Run(MENU_SEED, m, new EventBus());
    this.attract = true;
    this.kite.resetTrails(r.flight.x, r.flight.y, r.flight.z);
    return r;
  }

  /** Starts a real run. `seed` defaults to a random one; daily=true uses today's shared seed. */
  startRun(opts: { daily?: boolean; seed?: number } = {}): void {
    this.audio.unlock();
    for (const u of this.unsub) u();
    this.unsub = [];
    this.events.clear();
    const kite = kiteById(this.save.selectedKite);
    const mods = buildMods(kite, this.save.meta);
    this.daily = opts.daily ? dailyKey() : null;
    const seed = opts.seed ?? (opts.daily ? dailySeed() : (Math.random() * 2 ** 32) >>> 0);
    this.run = new Run(seed, mods, this.events, !!opts.daily);
    this.attract = false;
    this.wireEvents();
    this.kite.setKite(kite);
    this.kite.resetTrails(this.run.flight.x, this.run.flight.y, this.run.flight.z);
    this.fx.clear();
    this.rig.orbit = false;
    this.rig.dying = false;
    this.rig.slowmo = 0;
    this.acc = 0;
    this.timeScale = 1;
    this.slowmo = 0;
    this.state = 'playing';
    this.input.enabled = true;
    this.ui.show('hud');
    this.ui.banner(BIOMES[0].name, opts.daily ? `daily winds · ${this.daily}` : BIOMES[0].subtitle);
    this.audio.startMusic('run');
    this.audio.setMusicMood(0);
    this.audio.setPaused(false);
    this.audio.setSlowmo(0);
    this.audio.sfx('start');
    this.events.emit('run:started', { seed, daily: !!opts.daily });
    this.updateCamera(1, true);
  }

  private wireEvents(): void {
    const e = this.events;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const on = (k: keyof GameEvents, fn: (p: any) => void): void => {
      this.unsub.push(e.on(k, fn));
    };
    on('ring:passed', ((p: { combo: number; perfect: boolean; x: number; y: number; z: number; points: number }) => {
      const s = this.screen(p.x, p.y + 4, p.z);
      const pan = s ? clamp((s.x / Math.max(1, window.innerWidth)) * 2 - 1, -1, 1) : 0;
      this.audio.sfx(p.perfect ? 'perfect' : 'ring', p.combo, pan);
      const rr = 3.6 * this.run.mods.ringRadiusMul;
      this.fx.ringBurst(p.x, p.y, p.z, rr, this.env.ring, p.perfect ? 64 : 40, p.perfect ? 3.5 : 2.4);
      this.fx.shockwave(p.x, p.y, p.z, rr * 0.95, rr * (p.perfect ? 2.1 : 1.7), this.env.ring, p.perfect ? 1.3 : 0.8, p.perfect ? 0.55 : 0.4);
      if (p.perfect) this.fx.shockwave(p.x, p.y, p.z, rr * 0.3, rr * 1.2, 0xffffff, 0.9, 0.35);
      this.rig.punch(p.perfect ? 26 : 14 + Math.min(p.combo, 10) * 0.8);
      if (p.perfect) this.ui.callout(`PERFECT +${p.points}`, 'perfect', s?.x ?? null, s?.y ?? null);
      else this.ui.callout(`+${p.points}`, 'ring', s?.x ?? null, s?.y ?? null);
      if (p.combo > 0 && p.combo % 10 === 0) this.ui.callout(`${p.combo} CHAIN!`, 'perfect');
    }) as never);
    on('glimmer:collected', ((p: { x: number; y: number; z: number; combo: number }) => {
      this.audio.sfx('glimmer', p.combo);
      this.fx.burst(p.x, p.y, p.z, 6, 0xffd36e, 4, 0.25, 0.4, 2.5);
    }) as never);
    on('whisker', ((p: { points: number }) => {
      this.audio.sfx('whisker');
      this.slowmo = SCORING.whiskerSlowmo;
      const wf = this.run.flight;
      this.fx.shockwave(wf.x, wf.y, wf.z + 1, 0.6, 5, 0xe2b6ff, 1, 0.5);
      this.fx.burst(wf.x, wf.y, wf.z, 24, 0xfff0d0, 9, 0.18, 0.5, 2.2, 0, 1.5);
      this.rig.shake = Math.max(this.rig.shake, 0.9);
      this.flash = 0.6;
      this.ui.callout(`WHISKER! +${p.points}`, 'whisker');
    }) as never);
    on('arch:threaded', ((p: { points: number }) => {
      this.audio.sfx('arch');
      const af = this.run.flight;
      this.fx.shockwave(af.x, af.y, af.z + 3, 1, 9, 0xffd36e, 1.2, 0.7);
      this.rig.punch(30);
      this.ui.callout(`ARCH THREADED +${p.points}`, 'arch');
      this.flash = 0.4;
    }) as never);
    on('shield:hit', (() => {
      this.audio.sfx('shield');
      const f = this.run.flight;
      this.fx.burst(f.x, f.y, f.z, 60, 0xb7f7a8, 12, 0.5, 0.8, 2.5);
      this.rig.shake = 1.2;
      this.ui.callout('CHARM BROKEN', 'shield');
    }) as never);
    on('crash', ((p: { x: number; y: number; z: number; cause: string }) => {
      this.audio.sfx('crash');
      if (p.cause === 'sea') this.audio.sfx('splash');
      this.rig.dying = true;
      this.slowmo = 0;
      const k = kiteById(this.save.selectedKite);
      this.fx.burst(p.x, p.y, p.z, 70, k.colors[1], 9, 0.45, 1.6, 1.4, 6, 1.2);
      this.fx.burst(p.x, p.y, p.z, 50, k.colors[0], 7, 0.4, 1.8, 1.2, 5, 1.2);
      if (p.cause === 'sea') this.fx.burst(p.x, 0.5, p.z, 60, 0xffffff, 10, 0.5, 1.2, 1.2, 9, 1.5);
      this.rig.shake = 1.5;
      this.state = 'dying';
      this.dyingT = 0;
    }) as never);
    on('biome:changed', ((p: { index: number; name: string }) => {
      this.audio.sfx('biome');
      this.audio.setMusicMood(p.index);
      this.ui.banner(p.name, BIOMES[p.index].subtitle);
    }) as never);
    on('shrine:reached', (() => {
      this.audio.sfx('shrine');
      const f = this.run.flight;
      this.fx.shockwave(f.x, f.y, f.z + 2, 2, 12, 0xffd36e, 1.3, 0.9);
      this.fx.burst(f.x, f.y, f.z, 90, 0xffd36e, 14, 0.5, 1.2, 3);
      this.openBoons();
    }) as never);
    on('boon:picked', ((p: { name: string }) => {
      this.audio.sfx('boon');
      this.ui.toast(p.name, 'boon taken');
    }) as never);
    on('lightning:strike', ((p: { x: number; y: number; z: number }) => {
      const f = this.run.flight;
      if (Math.abs(p.z - f.z) < 140) {
        this.audio.sfx('lightning', clamp(1.15 - Math.abs(p.z - f.z) / 140, 0.25, 1), clamp((f.x - p.x) / 40, -0.8, 0.8));
        this.stormFlash = Math.max(this.stormFlash, Math.abs(p.z - f.z) < 60 ? 0.5 : 0.2);
      }
    }) as never);
    on('gust:warn', (() => this.audio.sfx('gust')) as never);
    on('lift:low', (() => this.audio.sfx('lowlift')) as never);
    on('dive:start', (() => this.audio.sfx('dive')) as never);
    on('updraft:enter', (() => this.audio.sfx('updraft')) as never);
    on('combo:lost', ((p: { combo: number }) => {
      if (p.combo >= 5) {
        this.ui.callout(`chain of ${p.combo} fades`, 'lost');
        this.audio.sfx('combo_lost');
      }
    }) as never);
    on('secondwind', (() => this.ui.callout('SECOND WIND', 'perfect')) as never);
  }

  private openBoons(): void {
    this.boonChoices = this.run.rollBoons();
    this.ui.renderBoons(this.boonChoices, this.run.boons);
    this.state = 'boon';
    this.ui.show('boon');
    this.input.enabled = false;
  }

  /** Picks boon by index (0..2) or id. */
  chooseBoon(which: number | string): void {
    if (this.state !== 'boon') return;
    const id = typeof which === 'number' ? this.boonChoices[which] : which;
    if (!id) return;
    this.run.pickBoon(id);
    this.state = 'playing';
    this.input.enabled = true;
    this.ui.show('hud');
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.ui.renderPause(this.run.boons);
    this.ui.show('pause');
    this.audio.setPaused(true);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.enabled = true;
    this.ui.show('hud');
    this.audio.setPaused(false);
  }

  /** Ends the current run and shows results. */
  endRun(cause?: string): void {
    if (this.attract) return;
    if (!this.run.ended) this.run.ended = cause ?? 'quit';
    const r = this.run;
    const s = r.scoring;
    const dist = Math.floor(r.distance);
    const earned = s.earned(dist);
    const res = applyRun(this.save, { distance: dist, score: Math.round(s.score), bestCombo: s.bestCombo, perfects: s.perfects, whiskers: s.whiskers, arches: s.arches, boons: r.boons.length, earned, daily: this.daily });
    writeSave(this.save);
    for (const a of res.achievements) {
      this.ui.toast(`★ ${a.name}`, `achievement · +${a.reward} glimmers`);
      this.audio.sfx('achievement');
    }
    const view = {
      cause: CAUSE_TEXT[r.ended ?? 'quit'] ?? r.ended ?? '', distance: dist, score: Math.round(s.score), bestCombo: s.bestCombo, rings: s.rings, perfects: s.perfects,
      whiskers: s.whiskers, arches: s.arches, earned: res.totalEarned, newBestDistance: res.newBestDistance, newBestScore: res.newBestScore,
      achievements: res.achievements, daily: !!this.daily, boons: r.boons,
    };
    this.lastResults = view;
    this.ui.renderResults(view, this.save);
    this.state = 'results';
    this.input.enabled = false;
    this.ui.show('results');
    this.audio.setPaused(true);
    this.events.emit('run:ended', { distance: dist, score: view.score, cause: view.cause });
  }

  toMenu(): void {
    this.state = 'menu';
    this.input.enabled = false;
    this.run = this.makeAttractRun();
    this.kite.setKite(kiteById(this.save.selectedKite));
    this.rig.orbit = true;
    this.rig.dying = false;
    this.ui.renderMenu(this.save, kiteById(this.save.selectedKite), dailyKey());
    this.ui.show('menu');
    this.audio.setPaused(false);
    this.audio.startMusic('menu');
    this.audio.setMusicMood(0);
  }

  openShop(tab: 'kites' | 'upgrades' = 'kites'): void {
    this.ui.setShopTab(tab);
    this.ui.renderShop(this.save);
    this.ui.show('shop');
    if (this.state === 'results') this.state = 'menu';
  }

  private action(act: string, d?: string): void {
    this.audio.unlock();
    if (act !== 'setting') this.audio.sfx('click');
    switch (act) {
      case 'play':
      case 'again':
        this.startRun();
        break;
      case 'daily':
        this.startRun({ daily: true });
        break;
      case 'shop':
        if (this.state === 'results') this.toMenu();
        this.openShop((d as 'kites' | 'upgrades') ?? 'kites');
        break;
      case 'tab':
        this.openShop(d as 'kites' | 'upgrades');
        break;
      case 'buyKite':
        if (d && buyKite(this.save, d)) {
          selectKite(this.save, d);
          this.audio.sfx('buy');
          writeSave(this.save);
          this.kite.setKite(kiteById(d));
        } else this.audio.sfx('deny');
        this.ui.renderShop(this.save);
        break;
      case 'selectKite':
        if (d && selectKite(this.save, d)) {
          writeSave(this.save);
          this.kite.setKite(kiteById(d));
        }
        this.ui.renderShop(this.save);
        break;
      case 'buyUpgrade':
        if (d && buyUpgrade(this.save, d)) {
          this.audio.sfx('buy');
          writeSave(this.save);
        } else this.audio.sfx('deny');
        this.ui.renderShop(this.save);
        break;
      case 'back':
      case 'menu':
        this.toMenu();
        break;
      case 'settings':
        this.ui.renderSettings(this.save, this.ui.screen);
        this.ui.show('settings');
        break;
      case 'settingsBack': {
        const from: ScreenId = this.ui.settingsFrom;
        if (from === 'pause') {
          this.ui.renderPause(this.run.boons);
          this.ui.show('pause');
        } else this.toMenu();
        break;
      }
      case 'setting':
        if (d) this.setSetting(d);
        break;
      case 'boon':
        if (d) this.chooseBoon(d);
        break;
      case 'pause':
        this.pause();
        break;
      case 'resume':
        this.resume();
        break;
      case 'quit':
        this.endRun('quit');
        break;
    }
  }

  private setSetting(kv: string): void {
    const [k, v] = kv.split('=');
    const s = this.save.settings as unknown as Record<string, unknown>;
    if (!(k in s)) return;
    if (typeof s[k] === 'boolean') s[k] = v === 'true';
    else if (typeof s[k] === 'number') s[k] = Number(v);
    else s[k] = v;
    this.applySettings();
    writeSave(this.save);
  }

  private applySettings(): void {
    const s = this.save.settings;
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    this.renderer.setQuality(s.quality as QualityTier);
    this.input.invertY = s.invertY;
    this.input.sensitivity = s.sensitivity;
    this.input.mouseSteer = s.mouseSteer;
    document.documentElement.classList.toggle('a11y-noflash', s.reducedFlashing);
  }

  private onKey(code: string): void {
    if (this.state === 'playing' && (code === 'Escape' || code === 'KeyP')) this.pause();
    else if (this.state === 'paused' && (code === 'Escape' || code === 'KeyP')) this.resume();
    else if (this.state === 'boon' && (code === 'Digit1' || code === 'Digit2' || code === 'Digit3')) this.chooseBoon(Number(code.slice(5)) - 1);
    else if (this.state === 'results' && (code === 'Enter' || code === 'Space')) this.startRun();
    else if (this.state === 'menu' && code === 'Enter' && this.ui.screen === 'menu') this.startRun();
  }

  // ------------------------------------------------------------------ simulation
  /** One fixed sim step (playing or attract). */
  private stepSim(dt: number): void {
    const r = this.run;
    if (this.attract) {
      r.invuln = 99;
      if (r.pendingBoon) r.pickBoon(r.rollBoons()[0]);
      r.step(dt, autopilot(r, this.pilotInput));
      if (r.distance > 4200) {
        this.run = this.makeAttractRun();
      }
      return;
    }
    if (this.state !== 'playing') return;
    const pi = this.playerInput;
    pi.steerX = this.input.steerX;
    pi.steerY = this.input.steerY;
    pi.dive = this.input.dive;
    r.step(dt, pi);
  }

  /**
   * Automation hook: advance `seconds` of game time in fixed steps. mode 'auto' flies the autopilot,
   * 'input' uses the live input, or pass an explicit FlightInput. Auto-picks boons when `autoBoon`.
   */
  simulate(seconds: number, mode: 'auto' | 'input' | FlightInput = 'auto', autoBoon = false): void {
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      if (this.state === 'boon' && autoBoon) this.chooseBoon(0);
      if (this.state === 'dying') {
        this.dyingT += STEP;
        if (this.dyingT > 1.2) this.endRun();
        continue;
      }
      if (this.state !== 'playing' && !(this.attract && this.state === 'menu')) break;
      if (mode === 'auto' && !this.attract) {
        this.run.step(STEP, autopilot(this.run, this.pilotInput));
      } else if (typeof mode === 'object' && !this.attract) {
        this.run.step(STEP, mode);
      } else this.stepSim(STEP);
      this.fx.update(STEP);
      this.clock += STEP;
    }
    this.updateCamera(STEP, true);
  }

  private updateCamera(dt: number, snap = false): void {
    const f = this.run.flight;
    const speedK = clamp((f.airspeed - FLIGHT.cruiseSpeed) / (FLIGHT.maxSpeed - FLIGHT.cruiseSpeed), 0, 1);
    this.rig.update(dt, f.x, f.y, f.z, f.yaw, f.pitch, f.bank, speedK, f.diving, this.renderer.baseFov, this.save.settings.screenShake);
    if (snap) {
      this.rig.snap();
      this.rig.update(0, f.x, f.y, f.z, f.yaw, f.pitch, f.bank, speedK, f.diving, this.renderer.baseFov, false);
    }
  }

  /** Frame loop body (requestAnimationFrame). */
  frame(now: number): void {
    const rdt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.fps += (1 / Math.max(1e-3, rdt) - this.fps) * 0.05;
    this.input.update(rdt);
    if (this.input.anyPressed('Pad9')) {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused') this.resume();
    }
    if (this.state === 'boon') {
      if (this.input.anyPressed('Pad14')) this.chooseBoon(0);
      if (this.input.anyPressed('Pad12', 'Pad13')) this.chooseBoon(1);
      if (this.input.anyPressed('Pad15')) this.chooseBoon(2);
    }
    if (this.state === 'results' && this.input.anyPressed('Pad0')) this.startRun();

    // time scale (whisker slow-mo is real-time)
    if (this.slowmo > 0) {
      this.slowmo -= rdt;
      this.timeScale = SCORING.whiskerTimeScale;
      if (this.slowmo <= 0) this.audio.sfx('whisker_out');
    } else this.timeScale += (1 - this.timeScale) * damp(6, rdt);

    if (!this.manual) {
      if (this.state === 'playing' || this.state === 'menu') {
        this.acc += rdt * this.timeScale;
        let steps = 0;
        while (this.acc >= STEP && steps < 6) {
          this.stepSim(STEP);
          this.acc -= STEP;
          steps++;
        }
        if (steps === 6) this.acc = 0;
      } else if (this.state === 'dying') {
        this.dyingT += rdt;
        // keep the world alive at slow-mo while the kite tumbles
        if (this.dyingT > 1.3) this.endRun();
      }
      this.fx.update(rdt * (this.state === 'dying' ? 0.6 : this.timeScale));
      this.clock += rdt * (this.state === 'paused' || this.state === 'boon' ? 0 : this.timeScale);
    }
    this.renderFrame(rdt);
    this.input.endFrame();
  }

  /** Updates all views from the current run state and renders. */
  renderFrame(rdt: number): void {
    const r = this.run;
    const f = r.flight;
    this.env.update(f.z);
    const env = this.env;
    // shared uniforms
    shared.uTime.value = this.clock;
    for (let i = 0; i < 8; i++) shared.uPalette.value[i].copy(env.palette[i]);
    shared.uRim.value.copy(env.rim);
    shared.uSunDir.value.copy(env.sunDir);
    if (env.flashes > 0.05 && this.state === 'playing' && Math.random() < env.flashes * rdt * 0.25) this.stormFlash = 0.35 + Math.random() * 0.3;
    this.stormFlash = Math.max(0, this.stormFlash - rdt * 3);
    shared.uFlash.value = this.save.settings.reducedFlashing ? this.stormFlash * 0.3 : this.stormFlash;
    // lights & fog
    const fog = this.renderer.scene.fog as THREE.Fog;
    fog.color.copy(env.fog);
    fog.near = env.fogNear;
    fog.far = env.fogFar;
    this.sun.color.copy(env.sunLight);
    this.sun.intensity = env.sunIntensity;
    this.sun.position.set(f.x + env.sunDir.x * 100, f.y + env.sunDir.y * 100 + 40, f.z + env.sunDir.z * 100);
    this.sun.target.position.set(f.x, f.y, f.z);
    this.hemi.color.copy(env.skyHemi);
    this.hemi.groundColor.copy(env.groundHemi);
    this.hemi.intensity = env.hemiIntensity;
    this.renderer.renderer.toneMappingExposure = env.exposure;
    this.renderer.bloom.strength = env.bloom;

    // camera
    if (!this.manual || this.state === 'menu') {
      if (this.state !== 'paused' && this.state !== 'boon') this.updateCamera(Math.min(rdt, 0.05));
    }
    const cam = this.renderer.camera;
    this.sky.update(env, cam);
    this.ocean.update(env, cam);
    this.worldView.update(r.world, env, cam, this.clock);
    this.rings.radiusMul = r.mods.ringRadiusMul;
    this.rings.update(r.world, env, this.state === 'paused' || this.state === 'boon' ? 0 : rdt, this.clock);
    this.hazards.update(r.world, env, cam, this.clock);
    const speedK = clamp((f.airspeed - FLIGHT.cruiseSpeed) / (FLIGHT.maxSpeed - FLIGHT.cruiseSpeed), 0, 1);
    this.kite.visible = this.state !== 'dying' && this.state !== 'results';
    this.kite.update(f.x, f.y, f.z, f.yaw, f.pitch, f.bank, cam, this.clock, Math.max(speedK, f.diving ? 0.6 : 0), r.shields, r.invuln > 50 ? 0 : r.invuln);

    // post
    const fin = this.renderer.finish.uniforms;
    fin.uTime.value = this.clock;
    fin.uSpeed.value += ((this.state === 'playing' ? Math.max(0, speedK * 1.2 - 0.1) + (f.diving ? 0.35 : 0) : 0) - fin.uSpeed.value) * damp(5, rdt);
    const low = this.state === 'playing' ? clamp((0.2 - f.liftFrac) / 0.2, 0, 1) : 0;
    fin.uLowLift.value += (low - fin.uLowLift.value) * damp(4, rdt);
    this.flash = Math.max(0, this.flash - rdt * 2.5);
    fin.uFlash.value = this.save.settings.reducedFlashing ? this.flash * 0.3 : this.flash;

    // audio + HUD
    const slowK = this.state === 'playing' ? clamp((1 - this.timeScale) / (1 - SCORING.whiskerTimeScale), 0, 1) : 0;
    this.rig.slowmo = slowK;
    this.audio.setSlowmo(slowK);
    this.audio.setFlight(speedK, f.diving, f.bank, f.liftFrac, r.scoring.combo, this.state === 'playing', r.nearest, r.inUpdraft);
    const streakK = this.state === 'playing' || this.state === 'menu' ? clamp(speedK * 1.1 + (f.diving ? 0.35 : 0) + (this.state === 'menu' ? 0.12 : 0.08), 0, 1) : 0;
    this.streaks.update(f.x, f.y, f.z, f.vx, f.vy, f.vz, streakK);
    if (this.state === 'playing' || this.state === 'boon' || this.state === 'paused' || this.state === 'dying') {
      const h = this.hud;
      const s = r.scoring;
      h.distance = r.distance;
      h.score = s.score;
      h.combo = s.combo;
      h.multiplier = s.multiplier;
      h.comboFrac = s.combo > 0 ? s.comboTimer / s.comboWindow : 0;
      h.lift = f.liftFrac;
      h.glimmers = s.glimmers;
      h.shields = r.shields;
      h.speed = f.airspeed;
      h.altitude = f.y;
      h.diving = f.diving;
      h.biome = BIOMES[r.biomeIndex].name;
      h.fps = this.fps;
      const next = this.nextShrine(r.distance);
      h.nextShrine = next - r.distance;
      this.ui.updateHud(h, this.input.stick, this.save.settings.showFps);
    }
    this.renderer.render();
  }

  private nextShrine(d: number): number {
    if (d < WORLD.shrineFirst) return WORLD.shrineFirst;
    return WORLD.shrineFirst + Math.ceil((d - WORLD.shrineFirst + 1) / WORLD.shrineEvery) * WORLD.shrineEvery;
  }

  /** World point → screen px (null when behind the camera). */
  private screen(x: number, y: number, z: number): { x: number; y: number } | null {
    this.proj.set(x, y, z).project(this.renderer.camera);
    if (this.proj.z > 1) return null;
    return { x: (this.proj.x * 0.5 + 0.5) * window.innerWidth, y: (-this.proj.y * 0.5 + 0.5) * window.innerHeight };
  }

  get results(): unknown {
    return this.lastResults;
  }

  /** Boon choices currently on offer. */
  get boonOffer(): string[] {
    return this.boonChoices.map((id) => boonById(id)?.id ?? id);
  }
}
