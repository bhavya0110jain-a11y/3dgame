import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { Rng } from '../core/Rng';
import { Input } from '../core/Input';
import { loadSave, writeSave, type SaveData } from '../core/Save';
import { Renderer } from '../render/Renderer';
import { FxManager } from '../render/Fx';
import { World } from '../world/World';
import { Player } from '../entities/Player';
import { EnemyManager } from '../entities/Enemies';
import { ProjectileManager } from '../entities/Projectiles';
import { PickupManager } from '../entities/Pickups';
import { AudioManager } from '../audio/Audio';
import { UI } from '../ui/UI';
import { RunState } from './RunState';
import { Director, RUN_LENGTH } from './Director';
import { rollChoices, rollChest, applyChoice, type UpgradeChoice } from './Upgrades';
import { AchievementTracker } from './Achievements';
import type { AchievementDef } from '../data/achievements';
import { ENEMIES } from '../data/enemies';
import { getBiome, BIOMES } from '../data/biomes';
import { META_UPGRADES, CHARACTERS } from '../data/meta';
import { getWeapon } from '../data/weapons';
import { PASSIVES } from '../data/passives';
import type { GameContext } from './types';

export type GameState = 'menu' | 'playing' | 'levelup' | 'paused' | 'gameover';
/** What the 'levelup' overlay is currently showing: a level-up, a reliquary reveal, or the post-boss dawn/endless choice. */
export type LevelMode = 'levelup' | 'chest' | 'dawn';

const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

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
  private dawnPending = false;
  /** Exposed for automated tests (tools/smoke.mjs). */
  debug = { timeScale: 1 };

  constructor(canvas: HTMLCanvasElement) {
    this.save = loadSave();
    this.achievements = new AchievementTracker(() => this.save, () => this.run, this.events);
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
    this.world.setBiome(getBiome('biome_pines'), 1);
    this.renderer.applyBiome(this.world.biome);
    this.renderer.lighting.attachLantern(this.player.light, this.player.group);
    this.wireEvents();
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

  persist(): void {
    writeSave(this.save);
  }

  passiveDef(id: string) {
    return PASSIVES.find((p) => p.id === id);
  }

  applySettings(): void {
    const s = this.save.settings;
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    this.renderer.setQuality(s.quality);
    this.fx.damageNumbers = s.damageNumbers;
  }

  previewCharacter(id: string): void {
    const c = CHARACTERS.find((x) => x.id === id) ?? CHARACTERS[0];
    this.player.lightColor.setHex(c.lightColor);
    this.player.setRobeColor(c.robeColor);
  }

  // ------------------------------------------------------------------ events
  private wireEvents(): void {
    const ev = this.events;
    ev.on('enemy:killed', ({ x, z, xp, elite, defId }) => {
      this.audio.play(elite ? 'kill_elite' : 'kill');
      this.pickups.spawn('ember', x, z, xp);
      const luck = this.run.stats.luck;
      if (this.rng.chance(0.012 * luck)) this.pickups.spawn('oil', x + 0.4, z);
      if (this.rng.chance(0.0025 * luck)) this.pickups.spawn('beacon', x - 0.4, z);
      if (this.rng.chance(0.02 * luck)) this.pickups.spawn('ash', x, z + 0.4, 1);
      if (elite) {
        this.pickups.spawn('chest', x, z);
        this.pickups.spawn('ash', x + 0.6, z, 10);
        this.shake(0.3);
      }
      if (defId.startsWith('boss')) this.shake(1);
    });
    ev.on('enemy:hit', ({ crit }) => this.audio.play(crit ? 'crit' : 'hit'));
    ev.on('enemy:exploded', () => this.audio.play('explode'));
    ev.on('player:damaged', ({ amount }) => {
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
    ev.on('chest:opened', () => this.openChest());
    ev.on('weapon:fired', ({ weaponId }) => this.audio.playWeapon(weaponId));
    ev.on('weapon:evolved', ({ from, name }) => {
      const base = getWeapon(from)?.name ?? from;
      this.ui.toast(`✦ EVOLUTION ✦  ${base} → ${name}`, 4200);
      this.audio.play('evolve');
      this.fx.ring(this.player.x, this.player.z, 0xfff0a0, 0.5, 12, 1.0);
      this.fx.burst(this.player.x, 1.4, this.player.z, 0xfff0a0, 120, 10, 1.2);
      this.shake(0.5);
    });
    ev.on('boss:spawned', () => {
      this.audio.play('boss');
      this.ui.toast('The master of this night has come.', 3500);
    });
    ev.on('boss:enraged', ({ defId }) => {
      this.audio.play('boss');
      this.ui.toast(`${ENEMIES[defId]?.name ?? 'The master'} is enraged!`, 2500);
    });
    ev.on('achievement:unlocked', ({ name }) => {
      if (this.state !== 'gameover') this.ui.toast(`Achievement: ${name}`, 3000);
    });
    ev.on('boss:killed', () => {
      this.audio.bossDefeated();
      this.run.bossesKilled++;
      this.pickups.spawn('ash', this.player.x, this.player.z, this.run.endless ? 60 : 100);
      if (this.run.endless) return; // endless bosses just pay out
      this.run.victory = true;
      window.setTimeout(() => {
        if (this.state === 'playing') this.openDawnChoice();
        else if (this.state === 'levelup' || this.state === 'paused') this.dawnPending = true;
      }, 2200);
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
    this.state = 'playing';
    this.ui.showHud();
    this.audio.unlock();
    this.audio.startMusic('run');
    this.events.emit('run:started', {});
  }

  /** Ash payout for a run (also used by the balance sim). */
  static ashForRun(run: RunState, victory: boolean, difficulty: number): number {
    const minutes = run.elapsed / 60;
    const base = run.ashEarned + run.kills / 20 + minutes * 5 + (victory ? 150 * difficulty : 0) + (run.endlessTime / 60) * 12;
    return Math.round(base * run.stats.greed);
  }

  endRun(victory: boolean): void {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
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

  rerollUpgrades(): void {
    if (this.levelMode !== 'levelup' || this.run.rerolls <= 0) return;
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

  skipUpgrade(): void {
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
    const evolved = items.some((c) => c.kind === 'evolution');
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
    if (typeof ui.showChest === 'function') ui.showChest(items, evolved);
    else this.ui.showLevelUp(items, evolved ? '✦ A weapon evolves! ✦' : 'Reliquary opened');
  }

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
    if (this.state === 'gameover') return;
    this.state = 'levelup';
    this.levelMode = 'dawn';
    this.pendingChoices = [
      { kind: 'special', id: 'dawn', name: 'Greet the Dawn', icon: 'star', level: 0,
        description: 'End the vigil victorious and carry your Ash home.' },
      { kind: 'special', id: 'endless', name: 'Endless Night', icon: 'skull', level: 0,
        description: 'Keep burning. Shadows grow stronger, a master returns every 3:00, and every minute pays extra Ash. Victory is already yours.' },
    ];
    this.ui.showLevelUp(this.pendingChoices, 'The master has fallen');
  }

  private resolveDawn(id: string): void {
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
      const banish = inp.keys.has('ShiftLeft') || inp.keys.has('ShiftRight');
      for (let k = 0; k < 4; k++) {
        if (inp.pressed(DIGITS[k])) {
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
    dt *= this.debug.timeScale;
    this.time += dt;
    this.input.update();
    this.handleGlobalInput();

    if (this.state === 'playing') this.updateRun(dt);
    else if (this.state === 'menu' || this.state === 'gameover') this.updateMenu(dt);
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

    if (this.player.dead) {
      this.fx.burst(this.player.x, 1.5, this.player.z, 0xffa64d, 120, 6, 1.5);
      this.player.group.visible = false;
      this.endRun(run.victory);
      return;
    }
    if (this.state === 'playing' && run.pendingLevelUps > 0) this.openLevelUp();
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
