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
import { rollChoices, applyChoice, type UpgradeChoice } from './Upgrades';
import { getBiome, BIOMES } from '../data/biomes';
import { META_UPGRADES, CHARACTERS } from '../data/meta';
import { getWeapon } from '../data/weapons';
import { PASSIVES } from '../data/passives';
import type { GameContext } from './types';

export type GameState = 'menu' | 'playing' | 'levelup' | 'paused' | 'gameover';

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
  /** Exposed for automated tests (tools/smoke.mjs). */
  debug = { timeScale: 1 };

  constructor(canvas: HTMLCanvasElement) {
    this.save = loadSave();
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
      this.audio.play('kill');
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
    ev.on('enemy:hit', () => this.audio.play('hit'));
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
      if (kind === 'ember' || kind === 'ash') this.audio.play('pickup');
    });
    ev.on('chest:opened', () => this.openChest());
    ev.on('weapon:fired', ({ weaponId }) => {
      if (weaponId === 'flare_nova') this.audio.play('nova');
      else if (weaponId === 'spark_chain') this.audio.play('zap');
      else this.audio.play('shoot');
    });
    ev.on('boss:spawned', () => {
      this.audio.play('boss');
      this.ui.toast('The master of this night has come.', 3500);
    });
    ev.on('boss:killed', () => {
      this.run.bossesKilled++;
      this.run.victory = true;
      this.pickups.spawn('ash', this.player.x, this.player.z, 100);
      window.setTimeout(() => {
        if (this.state === 'playing' || this.state === 'levelup') this.endRun(true);
      }, 2500);
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

    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.fx.clear();
    this.director.reset();
    this.world.setBiome(getBiome(this.selectedBiome), (Math.random() * 1e6) | 0);
    this.player.reset(s.maxLight);
    const start = getWeapon(char.startWeapon) ?? getWeapon('ember_bolt')!;
    this.run.weapons.push(start.create(this));
    this.state = 'playing';
    this.ui.showHud();
    this.audio.unlock();
    this.audio.startMusic('run');
    this.events.emit('run:started', {});
  }

  endRun(victory: boolean): void {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    const run = this.run;
    const minutes = run.elapsed / 60;
    const ash = Math.round((run.ashEarned + run.kills / 25 + minutes * 4 + (victory ? 150 : 0)) * run.stats.greed);
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
    this.audio.play('levelup');
    this.fx.ring(this.player.x, this.player.z, 0xffd27a, 0.5, 6, 0.6);
    this.pendingChoices = rollChoices(this, 3 + (this.save.meta['m_choice'] ?? 0));
    this.ui.showLevelUp(this.pendingChoices);
  }

  chooseUpgrade(i: number): void {
    if (this.state !== 'levelup') return;
    const c = this.pendingChoices[i];
    if (!c) return;
    applyChoice(this, c);
    this.player.heal(this.run.stats.maxLight * 0.05, this);
    this.afterChoice();
  }

  rerollUpgrades(): void {
    if (this.run.rerolls <= 0) return;
    this.run.rerolls--;
    this.pendingChoices = rollChoices(this, this.pendingChoices.length);
    this.ui.showLevelUp(this.pendingChoices);
  }

  skipUpgrade(): void {
    if (this.run.skips <= 0) return;
    this.run.skips--;
    this.run.ashEarned += 5;
    this.afterChoice();
  }

  private afterChoice(): void {
    this.run.pendingLevelUps = Math.max(0, this.run.pendingLevelUps - 1);
    this.ui.refreshSlots();
    if (this.run.pendingLevelUps > 0) this.openLevelUp();
    else {
      this.state = 'playing';
      this.ui.showHud();
    }
  }

  private openChest(): void {
    this.audio.play('chest');
    const n = this.rng.chance(0.15 * this.run.stats.luck) ? 3 : this.rng.chance(0.4) ? 2 : 1;
    const names: string[] = [];
    for (let i = 0; i < n; i++) {
      const choices = rollChoices(this, 1).filter((c) => c.kind !== 'weapon-new');
      const c = choices[0] ?? rollChoices(this, 1)[0];
      if (!c) break;
      applyChoice(this, c);
      names.push(c.name);
    }
    this.fx.ring(this.player.x, this.player.z, 0xffcc55, 0.5, 8, 0.8);
    this.fx.burst(this.player.x, 1, this.player.z, 0xffcc55, 60, 8, 1);
    this.ui.toast(`Reliquary: ${names.join(', ')}`, 3000);
    this.ui.refreshSlots();
  }

  // ------------------------------------------------------------------ loop
  private handleGlobalInput(): void {
    const inp = this.input;
    if (inp.anyPressed('Escape', 'KeyP', 'Pad9')) {
      if (this.state === 'playing' || this.state === 'paused') this.togglePause();
    }
    if (this.state === 'levelup') {
      if (inp.pressed('Digit1')) this.chooseUpgrade(0);
      if (inp.pressed('Digit2')) this.chooseUpgrade(1);
      if (inp.pressed('Digit3')) this.chooseUpgrade(2);
      if (inp.pressed('Digit4')) this.chooseUpgrade(3);
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

    if (this.player.dead) {
      this.fx.burst(this.player.x, 1.5, this.player.z, 0xffa64d, 120, 6, 1.5);
      this.player.group.visible = false;
      this.endRun(false);
      return;
    }
    if (run.pendingLevelUps > 0) this.openLevelUp();
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
    if (this.state === 'menu') {
      const r = 9;
      this.camera.position.set(Math.sin(this.menuAngle) * r, 4.5, Math.cos(this.menuAngle) * r);
      this.camera.lookAt(0, 1.4, 0);
      return;
    }
    // lead the camera slightly in the direction of movement
    this.camTarget.set(p.x + p.vx * 0.15, 0, p.z + p.vz * 0.15);
    const k = 1 - Math.exp(-dt * 6);
    const cx = this.camera.position.x + (this.camTarget.x - this.camera.position.x) * k;
    const cz = this.camera.position.z - 14 + (this.camTarget.z - (this.camera.position.z - 14)) * k;
    this.camera.position.set(cx, 20, cz + 14);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    const sh = this.shakeAmt * this.shakeAmt * 0.6;
    this.camera.position.x += (Math.random() - 0.5) * sh;
    this.camera.position.y += (Math.random() - 0.5) * sh;
    this.camera.lookAt(cx, 0, cz);
  }
}
