/**
 * Game: owns the run state machine (menu → playing ⇄ levelup[levelup|chest|dawn] / paused → gameover).
 *
 * ── UI CONTRACT (Sprint 2) ─────────────────────────────────────────────────────────────────────────────────────────
 * State:   game.state: GameState · game.levelMode: LevelMode ('levelup' | 'chest' | 'dawn' while state==='levelup')
 *          game.run (RunState) · game.save (SaveData) · game.director.pressure (adaptive spawn multiplier, 1..PRESSURE_MAX)
 * Level-up (levelMode 'levelup'): ui.showLevelUp(choices, title)
 *          chooseUpgrade(i) · rerollUpgrades() · banishUpgrade(i) · skipUpgrade()  — all no-ops outside a level-up.
 *          banishUpgrade(i) removes offer i for the rest of the run (run.banished) and replaces that card in place,
 *          then calls ui.showLevelUp again with the new list. Remaining: run.banishes / run.rerolls / run.skips.
 * Reliquary (levelMode 'chest'): contents are ALREADY applied when the screen opens.
 *          ui.showChest?(items, evolved) is feature-detected (fallback: showLevelUp). game.lastChest holds
 *          { items, evolved, evolvedFrom?, at } for the reveal. closeChest() continues (also auto after chestTimeLeft s;
 *          game.chestTimeLeft is the live countdown). Any pending level-up / dawn choice follows.
 * Dawn (levelMode 'dawn'): after the first boss of a night falls (2.2 s later, run-scoped, pause-safe).
 *          ui.showDawn?(choices, info: DawnInfo) is feature-detected (fallback: showLevelUp(choices, 'The master has
 *          fallen')). resolveDawn('dawn') ends the run victorious; resolveDawn('endless') keeps playing (run.endless).
 *          chooseUpgrade(0|1) on the dawn screen maps to the same two ids.
 * Onboarding: events 'tutorial:hint' { id, text, duration, priority } (src/game/Tutorial.ts, text in
 *          src/data/tutorial.ts) — only while save.runs < TUTORIAL_RUNS and save.settings.hints. Ids: move, ember,
 *          damage, levelup, oil, lowlight, elite, chest, boss. Each fires once per save (save.hintsSeen).
 * Other events for UI/VFX: 'lantern:flare' { amount } (boss arrival refills light), 'elite:spawned' { defId, x, z },
 *          'boss:spawned' / 'boss:enraged' / 'boss:killed', 'achievement:unlocked', 'run:started', 'run:ended'.
 * ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { Rng } from '../core/Rng';
import { Input } from '../core/Input';
import { loadSave, writeSave, safeQuality, type SaveData } from '../core/Save';
import { Renderer } from '../render/Renderer';
import { FxManager } from '../render/Fx';
import { World } from '../world/World';
import { Player } from '../entities/Player';
import { EnemyManager } from '../entities/Enemies';
import { ProjectileManager } from '../entities/Projectiles';
import { PickupManager } from '../entities/Pickups';
import { AudioManager } from '../audio/Audio';
import { UI } from '../ui/UI';
import { RunState, ashForRun } from './RunState';
import { Director, RUN_LENGTH, ENDLESS_BOSS_EVERY } from './Director';
import { rollChoices, rollChest, applyChoice, type UpgradeChoice } from './Upgrades';
import { AchievementTracker } from './Achievements';
import type { AchievementDef } from '../data/achievements';
import { ENEMIES } from '../data/enemies';
import { getBiome, BIOMES } from '../data/biomes';
import { META_UPGRADES, CHARACTERS } from '../data/meta';
import { getWeapon } from '../data/weapons';
import { PASSIVES } from '../data/passives';
import type { GameContext } from './types';
import { Tutorial, type InputDevice } from './Tutorial';
import { HINT_LOW_LIGHT, HINT_EMBER_AFTER } from '../data/tutorial';

export type GameState = 'menu' | 'playing' | 'levelup' | 'paused' | 'gameover';
/** What the 'levelup' overlay is currently showing: a level-up, a reliquary reveal, or the post-boss dawn/endless choice. */
export type LevelMode = 'levelup' | 'chest' | 'dawn';

const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
/** Seconds between the boss kill and the dawn/endless choice (lets the death VFX + Ash fountain play). */
const DAWN_DELAY_MS = 2200;
/**
 * Boss collapse outro: after the night's master falls the run keeps simulating for BOSS_OUTRO_TIME seconds of game
 * time (≥ the 1.2 s collapse) before any level-up or the dawn choice may open, and the first BOSS_SLOWMO_TIME real
 * seconds play at BOSS_SLOWMO speed. Only armed when a live boss actually died (not for synthetic events).
 */
export const BOSS_OUTRO_TIME = 1.3;
export const BOSS_SLOWMO = 0.35;
export const BOSS_SLOWMO_TIME = 0.6;
/** Largest simulation step when debug.timeScale > 1 (BUG-QA-009: big steps tunnel fast projectiles). */
const MAX_SUBSTEP = 1 / 30;

/** What the last reliquary gave (for the chest-reveal screen). Contents are already applied. */
export interface ChestReveal {
  items: UpgradeChoice[];
  evolved: boolean;
  /** Base weapon id that evolved (when `evolved`). */
  evolvedFrom?: string;
  /** run.elapsed when it opened. */
  at: number;
}

/** Summary for the dawn/endless choice screen. */
export interface DawnInfo {
  bossId: string;
  bossName: string;
  /** Ash the run would pay if the bearer greets the dawn now. */
  ashIfDawn: number;
  /** Seconds between returning bosses in the endless night. */
  endlessBossEvery: number;
  time: number;
  kills: number;
  level: number;
}

export class Game implements GameContext {
  readonly events = new EventBus();
  rng = new Rng();
  readonly input: Input;
  save: SaveData;
  readonly audio = new AudioManager();
  readonly renderer: Renderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly world: World;
  readonly player: Player;
  readonly enemies: EnemyManager;
  readonly projectiles: ProjectileManager;
  readonly pickups: PickupManager;
  readonly fx: FxManager;
  readonly ui: UI;
  run = new RunState();
  readonly director = new Director();
  state: GameState = 'menu';
  selectedBiome = 'biome_pines';
  private shakeAmt = 0;
  private time = 0;
  private last = performance.now();
  private camTarget = new THREE.Vector3();
  private pendingChoices: UpgradeChoice[] = [];
  private menuAngle = 0;
  /** Achievement tracking (see src/game/Achievements.ts for the UI-facing API). */
  readonly achievements: AchievementTracker;
  /** Achievements earned in the last finished run (for the game-over screen). */
  lastRunAchievements: AchievementDef[] = [];
  levelMode: LevelMode = 'levelup';
  private chestTimer = 0;
  private appliedQuality: string | null = null;
  private dawnPending = false;
  /** Game seconds of boss-collapse outro left (level-ups / dawn wait for 0). */
  private outroT = 0;
  /** Real seconds of boss-kill slow-mo left. */
  private slowT = 0;
  /** Boss id of the last kill that will open the dawn choice. */
  private dawnBoss = '';
  /** BUG-QA-025: a reliquary collected during the boss outro opens once the collapse has played. */
  private chestQueued = false;
  /** What the last reliquary gave (null before the first one this run). */
  lastChest: ChestReveal | null = null;
  /** Context for the dawn/endless screen (set when it opens). */
  lastDawn: DawnInfo | null = null;
  /** First-run onboarding hints ('tutorial:hint' events). */
  readonly tutorial: Tutorial;
  /** Exposed for automated tests (tools/smoke.mjs). */
  debug = { timeScale: 1 };

  constructor(canvas: HTMLCanvasElement) {
    this.save = loadSave();
    this.achievements = new AchievementTracker(() => this.save, () => this.run, this.events);
    this.tutorial = new Tutorial(() => this.save, this.events, () => this.inputDevice(), () => this.persist());
    this.renderer = new Renderer(canvas);
    this.scene = this.renderer.scene;
    this.camera = this.renderer.camera;
    this.input = new Input(canvas.parentElement ?? document.body);
    this.world = new World(this.scene);
    this.player = new Player(this.scene);
    this.enemies = new EnemyManager(this.scene);
    this.projectiles = new ProjectileManager(this.scene);
    this.pickups = new PickupManager(this.scene);
    this.ui = new UI(this);
    this.fx = new FxManager(this.scene, this.camera, this.ui.fxLayer);
    // BUG-QA-023: legacy Fx 'ft-big' banners ('REKINDLED', …) go through the one UI announcer queue (feature-detected)
    const fxs = this.fx as unknown as { bannerSink?: ((s: string) => void) | null };
    if ('bannerSink' in fxs) fxs.bannerSink = (str: string) => this.announce(str, 'buff');
    this.world.setBiome(getBiome('biome_pines'), 1);
    this.renderer.applyBiome(this.world.biome);
    this.renderer.lighting.attachLantern(this.player.light, this.player.group);
    this.wireEvents();
    this.audio.attach(this.events, () => this.state === 'paused' || this.state === 'levelup');
    this.applySettings();
    this.previewCharacter(this.save.selectedCharacter);

    const unlockAudio = () => {
      this.audio.unlock();
      if (this.state === 'menu') this.audio.startMusic('menu');
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.togglePause();
    });

    this.ui.showMenu();
    requestAnimationFrame(() => this.frame());
  }

  // ------------------------------------------------------------------ context
  shake(intensity: number): void {
    if (this.save.settings.screenShake) this.shakeAmt = Math.min(1, this.shakeAmt + intensity);
  }

  /** World announcement banner via UI.announce (feature-detected), else the Fx 'ft-big' banner (BUG-QA-019). */
  announce(text: string, kind: 'info' | 'elite' | 'boss' | 'danger' | 'buff'): void {
    const ui = this.ui as unknown as { announce?: (t: string, k?: string) => void };
    if (typeof ui.announce === 'function') ui.announce(text, kind);
    else this.fx.text(this.player.x, 3.5, this.player.z, text, 'ft-big');
  }

  persist(): void {
    writeSave(this.save);
  }

  passiveDef(id: string) {
    return PASSIVES.find((p) => p.id === id);
  }

  applySettings(): void {
    const s = this.save.settings;
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    // BUG-QA-007: never hand the Renderer a tier it does not know (an old/edited save used to brick boot)
    s.quality = safeQuality(s.quality);
    // BUG-QA-011: re-applying a tier rebuilds shadow maps/post targets — only do it when the tier actually changed
    if (s.quality !== this.appliedQuality) {
      this.appliedQuality = s.quality;
      this.renderer.setQuality(s.quality);
    }
    this.fx.damageNumbers = s.damageNumbers;
  }

  /** The device the player is using right now (picks the onboarding hint wording). */
  inputDevice(): InputDevice {
    const inp = this.input as { usingTouch?: boolean; usingGamepad?: boolean };
    return inp.usingTouch ? 'touch' : inp.usingGamepad ? 'gamepad' : 'keyboard';
  }

  previewCharacter(id: string): void {
    const c = CHARACTERS.find((x) => x.id === id) ?? CHARACTERS[0];
    this.player.lightColor.setHex(c.lightColor);
    this.player.setRobeColor(c.robeColor);
  }

  // ------------------------------------------------------------------ events
  private wireEvents(): void {
    const ev = this.events;
    const tut = this.tutorial;
    ev.on('enemy:killed', ({ x, z, xp, elite, defId }) => {
      this.audio.play(elite ? 'kill_elite' : 'kill');
      this.pickups.spawn('ember', x, z, xp);
      // after the movement hint has had its time on screen
      if (tut.active && this.run.elapsed >= HINT_EMBER_AFTER) tut.show('ember');
      const luck = this.run.stats.luck;
      if (this.rng.chance(0.012 * luck)) {
        this.pickups.spawn('oil', x + 0.4, z);
        if (tut.active) tut.show('oil');
      }
      if (this.rng.chance(0.0025 * luck)) this.pickups.spawn('beacon', x - 0.4, z);
      if (this.rng.chance(0.02 * luck)) this.pickups.spawn('ash', x, z + 0.4, 1);
      if (elite) {
        this.pickups.spawn('chest', x, z);
        this.pickups.spawn('ash', x + 0.6, z, 10);
        this.shake(0.3);
        if (tut.active) tut.show('chest');
      }
      if (defId.startsWith('boss')) this.shake(1);
    });
    ev.on('elite:spawned', () => {
      if (tut.active) tut.show('elite');
    });
    ev.on('lantern:flare', () => {
      const p = this.player;
      this.fx.ring(p.x, p.z, 0xffd27a, 0.6, 14, 1.1);
      this.fx.burst(p.x, 1.4, p.z, 0xffe0a0, 90, 9, 1.1);
      this.announce('Your lantern flares!', 'buff');
      this.renderer.damagePulse = 0;
    });
    ev.on('enemy:hit', ({ crit }) => this.audio.play(crit ? 'crit' : 'hit'));
    ev.on('enemy:exploded', () => this.audio.play('explode'));
    ev.on('player:damaged', ({ amount }) => {
      if (tut.active) tut.show('damage');
      this.audio.play('hurt');
      this.renderer.damagePulse = Math.min(1, this.renderer.damagePulse + 0.4 + amount / 40);
      this.shake(0.15 + amount / 60);
    });
    ev.on('player:healed', ({ amount }) => {
      if (amount > 5) {
        this.audio.play('heal');
        this.fx.text(this.player.x, 2.6, this.player.z, `+${Math.round(amount)}`, 'ft-heal');
      }
    });
    ev.on('pickup:collected', ({ kind }) => {
      if (kind === 'ember') this.audio.play('pickup');
      else if (kind === 'ash') this.audio.play('pickup_ash');
    });
    ev.on('chest:opened', () => {
      if (this.outroT > 0) this.chestQueued = true; // BUG-QA-025: never freeze the boss collapse
      else this.openChest();
    });
    ev.on('weapon:fired', ({ weaponId }) => this.audio.playWeapon(weaponId));
    ev.on('weapon:evolved', ({ from, name }) => {
      const base = getWeapon(from)?.name ?? from;
      this.ui.toast(`✦ EVOLUTION ✦  ${base} → ${name}`, 4200);
      this.audio.play('evolve');
      const fx = this.fx as unknown as { evolution?: (x: number, z: number) => void };
      if (typeof fx.evolution === 'function') fx.evolution(this.player.x, this.player.z);
      else this.fx.burst(this.player.x, 1.4, this.player.z, 0xfff0a0, 120, 10, 1.2);
      this.shake(0.5);
    });
    ev.on('boss:spawned', () => {
      this.audio.play('boss');
      // first-run players get the (longer) onboarding hint instead — one message at a time on a busy moment
      if (!(tut.active && tut.show('boss'))) this.announce('The master of this night has come.', 'boss');
    });
    ev.on('boss:enraged', ({ defId }) => {
      this.audio.play('boss');
      this.announce(`${ENEMIES[defId]?.name ?? 'The master'} is enraged!`, 'boss');
    });
    ev.on('achievement:unlocked', ({ name }) => {
      if (this.state !== 'gameover') this.ui.toast(`Achievement: ${name}`, 3000);
    });
    ev.on('boss:killed', ({ defId }) => {
      this.audio.bossDefeated();
      this.run.bossesKilled++;
      this.pickups.spawn('ash', this.player.x, this.player.z, this.run.endless ? 60 : 100);
      if (this.run.endless || this.run.victory) return; // endless bosses just pay out
      this.run.victory = true;
      this.dawnBoss = defId;
      // the master's collapse plays out (slow-mo, no choice screens) before the dawn — only for a real boss death
      if (this.enemies.boss) {
        this.outroT = BOSS_OUTRO_TIME;
        this.slowT = BOSS_SLOWMO_TIME;
      }
      // BUG-QA-001: the timer belongs to THIS run — a restart within 2.2 s must not inherit the dawn choice.
      // BUG-QA-002: it only flags the choice; updateRun/afterChoice/closeChest open it whenever play resumes.
      const run = this.run;
      window.setTimeout(() => {
        if (this.run !== run || this.state === 'gameover' || this.state === 'menu') return;
        this.dawnPending = true;
        if (this.state === 'playing' && this.outroT <= 0) this.openDawnChoice();
      }, DAWN_DELAY_MS);
    });
  }

  // ------------------------------------------------------------------ run lifecycle
  startRun(): void {
    this.rng = new Rng((Math.random() * 2 ** 32) >>> 0);
    for (const w of this.run.weapons) w.dispose(this);
    this.run = new RunState();
    this.run.biomeId = this.selectedBiome;
    const s = this.run.stats;
    for (const m of META_UPGRADES) {
      const r = this.save.meta[m.id] ?? 0;
      if (r > 0) m.apply(s, r);
    }
    const char = CHARACTERS.find((c) => c.id === this.save.selectedCharacter) ?? CHARACTERS[0];
    char.apply(s);
    this.previewCharacter(char.id);
    this.run.rerolls = 1 + (this.save.meta['m_reroll'] ?? 0);
    this.run.banishes = 1 + (this.save.meta['m_banish'] ?? 0);
    this.run.skips = 1;
    this.dawnPending = false;
    this.outroT = 0;
    this.slowT = 0;
    this.dawnBoss = '';
    this.chestQueued = false;
    this.lastChest = null;
    this.lastDawn = null;
    this.chestTimer = 0;
    this.levelMode = 'levelup';

    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.fx.clear();
    this.director.reset();
    this.world.setBiome(getBiome(this.selectedBiome), (Math.random() * 1e6) | 0);
    this.renderer.applyBiome(this.world.biome);
    this.player.reset(s.maxLight);
    const start = getWeapon(char.startWeapon) ?? getWeapon('ember_bolt')!;
    this.run.weapons.push(start.create(this));
    this.achievements.onRunStart();
    this.tutorial.onRunStart();
    this.state = 'playing';
    this.ui.showHud();
    this.audio.unlock();
    this.audio.startMusic('run');
    this.events.emit('run:started', {});
  }

  /** Ash payout for a run (also used by the balance sim). */
  static ashForRun(run: RunState, victory: boolean, difficulty: number): number {
    return ashForRun(run, victory, difficulty);
  }

  endRun(victory: boolean): void {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    this.dawnPending = false;
    this.tutorial.onRunEnd();
    const run = this.run;
    victory = victory || run.victory;
    const ash = Game.ashForRun(run, victory, this.world.biome.difficulty);
    const save = this.save;
    save.ash += ash;
    save.totalAsh += ash;
    save.runs++;
    const newBest = run.elapsed > save.bestTime;
    save.bestTime = Math.max(save.bestTime, run.elapsed);
    save.bestKills = Math.max(save.bestKills, run.kills);
    const unlocks: string[] = [];
    if (victory) {
      save.victories++;
      if (!save.biomesCleared.includes(run.biomeId)) save.biomesCleared.push(run.biomeId);
      const idx = BIOMES.findIndex((b) => b.id === run.biomeId);
      const next = BIOMES[idx + 1];
      if (next?.unlock && !save.unlocked.includes(next.unlock)) {
        save.unlocked.push(next.unlock);
        unlocks.push(`New night unlocked: ${next.name}`);
      }
    }
    // achievements earned mid-run were already toasted; the summary lists everything earned this run
    this.lastRunAchievements = this.achievements.onRunEnd();
    this.achievements.takeNewlyEarned();
    for (const a of this.lastRunAchievements) unlocks.push(`Achievement: ${a.name}${a.reward ? ` — ${a.reward.label}` : ''}`);
    this.persist();
    this.audio.stopMusic();
    this.audio.play(victory ? 'victory' : 'gameover');
    this.events.emit('run:ended', { victory });
    this.ui.showGameOver(victory, ash, newBest, unlocks);
  }

  toMenu(): void {
    for (const w of this.run.weapons) w.dispose(this);
    this.run = new RunState();
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.fx.clear();
    this.player.reset(100);
    this.dawnPending = false;
    this.tutorial.onRunEnd();
    this.state = 'menu';
    this.audio.startMusic('menu');
    // Hearth purchases may have completed an achievement
    this.achievements.check(false);
    this.ui.showMenu();
  }

  togglePause(): void {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.ui.showPause();
    } else if (this.state === 'paused') {
      this.state = 'playing';
      this.ui.showHud();
    }
  }

  // ------------------------------------------------------------------ level-up flow
  private openLevelUp(): void {
    this.state = 'levelup';
    this.levelMode = 'levelup';
    this.audio.play('levelup');
    this.fx.levelUp(this.player.x, this.player.z);
    this.pendingChoices = rollChoices(this, 3 + (this.save.meta['m_choice'] ?? 0));
    this.ui.showLevelUp(this.pendingChoices);
    if (this.tutorial.active) this.tutorial.show('levelup');
  }

  chooseUpgrade(i: number): void {
    if (this.state !== 'levelup') return;
    if (this.levelMode === 'chest') return this.closeChest();
    const c = this.pendingChoices[i];
    if (!c) return;
    if (this.levelMode === 'dawn') return this.resolveDawn(c.id);
    applyChoice(this, c);
    this.player.heal(this.run.stats.maxLight * 0.05, this);
    this.afterChoice();
  }

  /** Rerolls the current level-up offers (costs one run.rerolls). No-op outside a level-up (BUG-QA-003). */
  rerollUpgrades(): void {
    if (this.state !== 'levelup' || this.levelMode !== 'levelup' || this.run.rerolls <= 0) return;
    this.run.rerolls--;
    this.pendingChoices = rollChoices(this, this.pendingChoices.length);
    this.ui.showLevelUp(this.pendingChoices);
  }

  /** Banish: removes choice `i` from the pool for the rest of the run and replaces that card. */
  banishUpgrade(i: number): void {
    if (this.state !== 'levelup' || this.levelMode !== 'levelup' || this.run.banishes <= 0) return;
    const c = this.pendingChoices[i];
    if (!c || c.kind === 'heal' || c.kind === 'ash') return;
    this.run.banishes--;
    this.run.banished.add(c.id);
    const shown = new Set(this.pendingChoices.map((x) => x.id));
    const rep = rollChoices(this, 1, shown)[0];
    if (rep && rep.kind !== 'heal' && rep.kind !== 'ash') this.pendingChoices[i] = rep;
    else this.pendingChoices.splice(i, 1);
    if (!this.pendingChoices.length) this.pendingChoices = rollChoices(this, 1);
    this.ui.toast(`${c.name} banished for this vigil.`, 1800);
    this.ui.showLevelUp(this.pendingChoices);
  }

  /** Skips the level-up for +5 Ash (one run.skips); on the reliquary screen it continues. No-op otherwise (BUG-QA-003). */
  skipUpgrade(): void {
    if (this.state !== 'levelup') return;
    if (this.levelMode === 'chest') return this.closeChest();
    if (this.levelMode !== 'levelup' || this.run.skips <= 0) return;
    this.run.skips--;
    this.run.ashEarned += 5;
    this.afterChoice();
  }

  private afterChoice(): void {
    this.run.pendingLevelUps = Math.max(0, this.run.pendingLevelUps - 1);
    this.ui.refreshSlots();
    if (this.run.pendingLevelUps > 0) this.openLevelUp();
    else if (this.dawnPending) this.openDawnChoice();
    else {
      this.state = 'playing';
      this.ui.showHud();
    }
  }

  /** Reliquary: brief pause that shows what you got (evolution first). Contents are applied immediately. */
  private openChest(): void {
    this.audio.play('chest');
    this.run.chestsOpened++;
    const items = rollChest(this);
    for (const c of items) applyChoice(this, c);
    const evo = items.find((c) => c.kind === 'evolution');
    const evolved = !!evo;
    this.lastChest = { items, evolved, evolvedFrom: evo?.from, at: this.run.elapsed };
    this.fx.ring(this.player.x, this.player.z, evolved ? 0xfff0a0 : 0xffcc55, 0.5, 8, 0.8);
    this.fx.burst(this.player.x, 1, this.player.z, 0xffcc55, 60, 8, 1);
    this.ui.refreshSlots();
    if (this.state !== 'playing') {
      // opened while something else is up (rare) — fall back to a toast
      this.ui.toast(`Reliquary: ${items.map((c) => c.name).join(', ')}`, 3000);
      return;
    }
    this.state = 'levelup';
    this.levelMode = 'chest';
    this.chestTimer = evolved ? 4.5 : 2.8;
    this.pendingChoices = items;
    const ui = this.ui as unknown as { showChest?: (items: UpgradeChoice[], evolved: boolean) => void };
    if (typeof ui.showChest === 'function') {
      ui.showChest(items, evolved);
      // BUG-QA-013: give the reveal time to land before auto-continue
      const hold = (this.ui as unknown as { chestHold?: number }).chestHold;
      if (typeof hold === 'number' && Number.isFinite(hold)) this.chestTimer = Math.max(this.chestTimer, hold);
    }
    else this.ui.showLevelUp(items, evolved ? '✦ A weapon evolves! ✦' : 'Reliquary opened');
  }

  /** Seconds until the reliquary reveal auto-continues (0 when none is showing). */
  get chestTimeLeft(): number {
    return this.state === 'levelup' && this.levelMode === 'chest' ? Math.max(0, this.chestTimer) : 0;
  }

  /** Continues from the reliquary reveal (pending level-ups / the dawn choice follow). */
  closeChest(): void {
    if (this.state !== 'levelup' || this.levelMode !== 'chest') return;
    this.levelMode = 'levelup';
    if (this.run.pendingLevelUps > 0) this.openLevelUp();
    else if (this.dawnPending) this.openDawnChoice();
    else {
      this.state = 'playing';
      this.ui.showHud();
    }
  }

  /** After the boss falls: end victorious, or keep the lantern burning in the endless night. */
  private openDawnChoice(): void {
    this.dawnPending = false;
    this.slowT = 0; // BUG-QA-026: unused boss slow-mo must not outlive the dawn screen
    if (this.state === 'gameover' || this.state === 'menu') return;
    this.state = 'levelup';
    this.levelMode = 'dawn';
    const every = Math.round(ENDLESS_BOSS_EVERY / 60);
    this.pendingChoices = [
      { kind: 'special', id: 'dawn', name: 'Greet the Dawn', icon: 'star', level: 0,
        description: 'End the vigil victorious and carry your Ash home.' },
      { kind: 'special', id: 'endless', name: 'Endless Night', icon: 'skull', level: 0,
        description: `Keep burning. Shadows grow stronger, a master returns every ${every}:00, and every minute pays extra Ash. Victory is already yours.` },
    ];
    const bossId = this.dawnBoss || this.world.biome.bossId;
    this.lastDawn = {
      bossId, bossName: ENEMIES[bossId]?.name ?? 'The master',
      ashIfDawn: Game.ashForRun(this.run, true, this.world.biome.difficulty),
      endlessBossEvery: ENDLESS_BOSS_EVERY, time: this.run.elapsed, kills: this.run.kills, level: this.run.level,
    };
    const ui = this.ui as unknown as { showDawn?: (choices: UpgradeChoice[], info: DawnInfo) => void };
    if (typeof ui.showDawn === 'function') ui.showDawn(this.pendingChoices, this.lastDawn);
    else this.ui.showLevelUp(this.pendingChoices, 'The master has fallen');
  }

  /** Dawn screen: 'dawn' ends the run victorious, 'endless' keeps the night going. No-op unless the dawn choice is up. */
  resolveDawn(id: string): void {
    if (this.state !== 'levelup' || this.levelMode !== 'dawn') return;
    this.levelMode = 'levelup';
    if (id === 'endless') {
      this.run.endless = true;
      this.state = 'playing';
      this.ui.toast('The night goes on. So do you.', 3000);
      this.ui.showHud();
    } else {
      this.state = 'playing';
      this.endRun(true);
    }
  }

  // ------------------------------------------------------------------ loop
  private handleGlobalInput(): void {
    const inp = this.input;
    if (inp.anyPressed('Escape', 'KeyP', 'Pad9')) {
      if (this.state === 'playing' || this.state === 'paused') this.togglePause();
    }
    if (this.state === 'levelup') {
      // BUG-QA-017: Shift is read with the digit's keydown (a quick tap released before this frame still banishes)
      const held = inp.keys.has('ShiftLeft') || inp.keys.has('ShiftRight');
      const shifted = (inp as { pressedWithShift?: (code: string) => boolean }).pressedWithShift;
      for (let k = 0; k < 4; k++) {
        if (inp.pressed(DIGITS[k])) {
          const banish = typeof shifted === 'function' ? shifted.call(inp, DIGITS[k]) || held : held;
          if (banish) this.banishUpgrade(k);
          else this.chooseUpgrade(k);
        }
      }
      if (this.levelMode === 'chest' && inp.anyPressed('Space', 'Enter')) this.closeChest();
    }
    if (this.state !== 'playing') {
      if (inp.anyPressed('ArrowLeft', 'Pad14')) this.ui.navigate(-1, 0);
      if (inp.anyPressed('ArrowRight', 'Pad15')) this.ui.navigate(1, 0);
      if (inp.anyPressed('ArrowUp', 'Pad12')) this.ui.navigate(0, -1);
      if (inp.anyPressed('ArrowDown', 'Pad13')) this.ui.navigate(0, 1);
      if (inp.pressed('Pad0')) (document.activeElement as HTMLElement | null)?.click();
      if (inp.pressed('Pad1')) {
        const back = document.querySelector<HTMLElement>('.screen.visible [data-act=back], .screen.visible [data-act=resume]');
        back?.click();
      }
    }
  }

  private frame(): void {
    const now = performance.now();
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.slowT > 0 && this.state === 'playing') {
      this.slowT -= dt;
      dt *= BOSS_SLOWMO;
    }
    dt *= this.debug.timeScale;
    this.time += dt;
    this.input.update();
    this.enemies.renderQuality = this.renderer.effectiveQuality; // BUG-QA-012: LOD follows the auto-fallback tier
    this.handleGlobalInput();

    if (this.state === 'playing') {
      // BUG-QA-009: with timeScale > 1 run the simulation in ≤ 1/30 s substeps so projectiles do not tunnel
      let left = dt;
      while (left > 1e-6 && this.state === 'playing') {
        const step = this.debug.timeScale > 1 ? Math.min(MAX_SUBSTEP, left) : left;
        this.updateRun(step);
        left -= step;
      }
    } else if (this.state === 'menu' || this.state === 'gameover') this.updateMenu(dt);
    else if (this.state === 'levelup' && this.levelMode === 'chest') {
      this.chestTimer -= dt;
      if (this.chestTimer <= 0) this.closeChest();
    }

    this.fx.update(this.state === 'paused' || this.state === 'levelup' ? 0 : dt);
    this.updateCamera(dt);
    this.renderer.render(this.time, dt);
    if (this.state === 'playing' || this.state === 'levelup' || this.state === 'paused') this.ui.updateHud(dt);
    this.input.endFrame();
    requestAnimationFrame(() => this.frame());
  }

  private updateRun(dt: number): void {
    const run = this.run;
    run.elapsed += dt;
    if (this.outroT > 0) {
      this.outroT -= dt;
      if (this.outroT <= 0) this.slowT = 0; // BUG-QA-026: the collapse is over — back to full speed
    }
    this.player.update(dt, this, this.time);
    this.world.update(this.player.x, this.player.z);
    this.director.update(dt, this);
    for (const w of run.weapons) w.update(dt, this);
    this.enemies.update(dt, this, this.time);
    this.projectiles.update(dt, this);
    this.pickups.update(dt, this, this.time);
    this.audio.setIntensity(Math.min(1, this.enemies.activeCount / 200 + (run.elapsed >= RUN_LENGTH ? 0.5 : 0)));
    const lf = this.player.lightFrac(run.stats.maxLight);
    this.audio.setLight(lf);
    if (lf < run.lowestLightFrac) run.lowestLightFrac = lf;
    this.achievements.update(dt, lf);
    if (this.tutorial.active) {
      this.tutorial.update(dt);
      if (lf < HINT_LOW_LIGHT && !this.player.dead) this.tutorial.show('lowlight');
    }

    if (this.player.dead) {
      this.fx.burst(this.player.x, 1.5, this.player.z, 0xffa64d, 120, 6, 1.5);
      this.player.group.visible = false;
      this.endRun(run.victory);
      return;
    }
    if (this.state !== 'playing' || this.outroT > 0) return; // boss collapse outro: no choice screens yet
    if (this.chestQueued) {
      this.chestQueued = false;
      this.openChest();
      return;
    }
    if (run.pendingLevelUps > 0) this.openLevelUp();
    else if (this.dawnPending) this.openDawnChoice();
  }

  private updateMenu(dt: number): void {
    // idle lantern-bearer in a small glade while the camera slowly orbits
    this.menuAngle += dt * 0.08;
    this.player.x = 0;
    this.player.z = 0;
    this.player.lightValue = this.run.stats.maxLight;
    const saved = { x: this.input.moveX, z: this.input.moveZ };
    this.input.moveX = 0;
    this.input.moveZ = 0;
    this.player.update(dt, this, this.time);
    this.input.moveX = saved.x;
    this.input.moveZ = saved.z;
    this.world.update(0, 0);
  }

  private updateCamera(dt: number): void {
    const p = this.player;
    const rig = this.renderer.rig;
    // trauma decays linearly; the rig squares it (small hits = subtle, big hits = punchy)
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.6);
    p.setXray?.(this.state !== 'menu'); // optional: test doubles of Player may omit it
    if (this.state === 'menu') {
      rig.menu(dt, p.x, p.z);
    } else {
      const boss = this.enemies.boss;
      const crowd = Math.min(1, this.enemies.activeCount / 320) * 0.7 + (boss ? 0.45 : 0);
      rig.follow(dt, p.x, p.z, p.vx, p.vz, crowd, this.shakeAmt, boss ? boss.x : NaN, boss ? boss.z : NaN);
    }
    this.renderer.lighting.setExtent(22 * rig.zoom);
    this.renderer.lighting.follow(rig.focus.x, rig.focus.z);
  }

}
