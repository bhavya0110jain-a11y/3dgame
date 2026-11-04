import { icon } from './icons';
import type { Game } from '../game/Game';
import type { UpgradeChoice } from '../game/Upgrades';
import { META_UPGRADES, CHARACTERS } from '../data/meta';
import { BIOMES } from '../data/biomes';
import { RUN_LENGTH } from '../game/Director';
import { ENEMIES } from '../data/enemies';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

type Screen = 'menu' | 'setup' | 'hearth' | 'settings' | 'hud' | 'levelup' | 'pause' | 'gameover' | 'howto' | 'none';

/** DOM-based UI layer. All screens live under #ui-root. */
export class UI {
  readonly root: HTMLElement;
  readonly fxLayer: HTMLElement;
  private screens = new Map<Screen, HTMLElement>();
  private hud!: {
    root: HTMLElement;
    xpFill: HTMLElement;
    level: HTMLElement;
    timer: HTMLElement;
    kills: HTMLElement;
    ash: HTMLElement;
    lightFill: HTMLElement;
    lightText: HTMLElement;
    slots: HTMLElement;
    bossBar: HTMLElement;
    bossFill: HTMLElement;
    bossName: HTMLElement;
    fps: HTMLElement;
  };
  private toastEl: HTMLElement;
  private settingsReturn: Screen = 'menu';
  current: Screen = 'none';
  private levelChoices: UpgradeChoice[] = [];
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(private game: Game) {
    this.root = document.getElementById('ui-root')!;
    this.fxLayer = el('div', 'fx-layer');
    this.root.appendChild(this.fxLayer);
    this.toastEl = el('div', 'toast');
    this.root.appendChild(this.toastEl);
    this.buildHud();
    this.root.addEventListener('mouseover', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button:not([disabled])')) this.game.audio.play('hover');
    });
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button')) this.game.audio.play('click');
    });
  }

  // ------------------------------------------------------------------ helpers
  private screen(name: Screen, build: (root: HTMLElement) => void): HTMLElement {
    let s = this.screens.get(name);
    if (s) s.remove();
    s = el('div', `screen screen-${name}`);
    build(s);
    this.screens.set(name, s);
    this.root.appendChild(s);
    return s;
  }

  show(name: Screen): void {
    this.current = name;
    for (const [k, s] of this.screens) s.classList.toggle('visible', k === name || (k === 'hud' && (name === 'levelup' || name === 'pause')));
    this.hud.root.classList.toggle('visible', name === 'hud' || name === 'levelup' || name === 'pause');
    requestAnimationFrame(() => {
      const s = this.screens.get(name);
      const first = s?.querySelector<HTMLElement>('[data-autofocus]') ?? s?.querySelector<HTMLElement>('button:not([disabled])');
      first?.focus({ preventScroll: true });
    });
  }

  toast(msg: string, ms = 2200): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('visible');
    window.clearTimeout((this.toastEl as any)._t);
    (this.toastEl as any)._t = window.setTimeout(() => this.toastEl.classList.remove('visible'), ms);
  }

  /** Arrow-key / d-pad focus navigation between visible buttons. */
  navigate(dx: number, dy: number): void {
    const s = this.screens.get(this.current);
    if (!s) return;
    const btns = Array.from(s.querySelectorAll<HTMLElement>('button:not([disabled]), input')).filter((b) => b.offsetParent !== null);
    if (!btns.length) return;
    const cur = document.activeElement as HTMLElement;
    if (!btns.includes(cur)) {
      btns[0].focus();
      return;
    }
    const r0 = cur.getBoundingClientRect();
    const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const b of btns) {
      if (b === cur) continue;
      const r = b.getBoundingClientRect();
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const vx = c.x - c0.x;
      const vy = c.y - c0.y;
      const along = vx * dx + vy * dy;
      if (along <= 4) continue;
      const perp = Math.abs(vx * dy - vy * dx);
      const score = along + perp * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    best?.focus();
    if (cur instanceof HTMLInputElement && cur.type === 'range' && dx !== 0 && !best) {
      cur.valueAsNumber += dx * 0.05;
      cur.dispatchEvent(new Event('input'));
    }
  }

  // ------------------------------------------------------------------ menu
  showMenu(): void {
    const save = this.game.save;
    this.screen('menu', (s) => {
      s.innerHTML = `
        <div class="title-block">
          <div class="title-glow"></div>
          <h1 class="game-title">Last <span>Lantern</span></h1>
          <p class="tagline">Your light is your life. Carry it through the dark.</p>
        </div>
        <div class="menu-buttons">
          <button class="btn btn-primary" data-act="play" data-autofocus>Begin the Vigil</button>
          <button class="btn" data-act="hearth">The Hearth <span class="ash-pill">${icon('ash')} ${save.ash}</span></button>
          <button class="btn" data-act="howto">How to Play</button>
          <button class="btn" data-act="settings">Settings</button>
        </div>
        <div class="menu-stats">
          <span>${icon('timer')} Best ${fmtTime(save.bestTime)}</span>
          <span>${icon('skull')} Best ${save.bestKills}</span>
          <span>${icon('star')} Vigils kept ${save.victories}</span>
        </div>
        <div class="version">v${__APP_VERSION__}</div>`;
      s.querySelector('[data-act=play]')!.addEventListener('click', () => this.showSetup());
      s.querySelector('[data-act=hearth]')!.addEventListener('click', () => this.showHearth());
      s.querySelector('[data-act=howto]')!.addEventListener('click', () => this.showHowTo());
      s.querySelector('[data-act=settings]')!.addEventListener('click', () => this.showSettings('menu'));
    });
    this.show('menu');
  }

  showHowTo(): void {
    this.screen('howto', (s) => {
      s.innerHTML = `
        <div class="panel panel-wide">
          <h2>How to Play</h2>
          <div class="howto-grid">
            <div><h3>Move</h3><p>WASD / Arrow keys, left stick, or drag anywhere on touch screens. Your weapons fire on their own.</p></div>
            <div><h3>Your Light is Your Life</h3><p>Taking damage dims your lantern — and the world grows darker around you. Collect <b>Lamp Oil</b> to rekindle it.</p></div>
            <div><h3>Gather Embers</h3><p>Fallen shadows leave embers. Collect them to level up and choose new weapons or upgrades.</p></div>
            <div><h3>Survive the Night</h3><p>Hold out for 15 minutes. Then the night's master comes for your flame. Defeat it to keep the vigil.</p></div>
            <div><h3>The Hearth</h3><p>Earn <b>Ash</b> each run. Spend it on permanent upgrades and new lantern-bearers.</p></div>
            <div><h3>Pause</h3><p>Esc / P / Start pauses the game at any time.</p></div>
          </div>
          <button class="btn" data-act="back" data-autofocus>Back</button>
        </div>`;
      s.querySelector('[data-act=back]')!.addEventListener('click', () => this.showMenu());
    });
    this.show('howto');
  }

  // ------------------------------------------------------------------ setup
  showSetup(): void {
    const save = this.game.save;
    let biomeSel = save.unlocked.includes(this.game.selectedBiome) ? this.game.selectedBiome : 'biome_pines';
    this.screen('setup', (s) => {
      const chars = CHARACTERS.map((c) => {
        const owned = save.unlocked.includes(c.id);
        const sel = save.selectedCharacter === c.id;
        const color = '#' + c.lightColor.toString(16).padStart(6, '0');
        return `<button class="card char-card ${sel ? 'selected' : ''} ${owned ? '' : 'locked'}" data-char="${c.id}" style="--accent:${color}">
          <div class="card-icon">${owned ? icon('wick') : icon('lock')}</div>
          <div class="card-title">${c.name}</div>
          <div class="card-sub">${c.title}</div>
          <div class="card-desc">${c.description}</div>
          ${owned ? '' : `<div class="card-cost">${icon('ash')} ${c.unlockCost}</div>`}
        </button>`;
      }).join('');
      const biomes = BIOMES.map((b, i) => {
        const owned = !b.unlock || save.unlocked.includes(b.unlock);
        const req = i > 0 ? `Keep the vigil in ${BIOMES[i - 1].name} to unlock` : '';
        return `<button class="card biome-card ${biomeSel === b.id ? 'selected' : ''} ${owned ? '' : 'locked'}" data-biome="${b.id}" ${owned ? '' : 'disabled'}>
          <div class="card-title">${b.name}</div>
          <div class="card-sub">${owned ? b.subtitle : req}</div>
          <div class="card-desc">${owned ? `Danger ${'◆'.repeat(i + 1)}${'◇'.repeat(BIOMES.length - i - 1)} · Boss: ${ENEMIES[b.bossId]?.name ?? '?'}` : icon('lock')}</div>
        </button>`;
      }).join('');
      s.innerHTML = `
        <div class="panel panel-wide">
          <h2>Choose your Lantern-bearer</h2>
          <div class="card-row chars">${chars}</div>
          <h2>Choose the Night</h2>
          <div class="card-row biomes">${biomes}</div>
          <div class="row-buttons">
            <button class="btn" data-act="back">Back</button>
            <button class="btn btn-primary" data-act="start" data-autofocus>Light the Lantern</button>
          </div>
        </div>`;
      s.querySelectorAll<HTMLElement>('[data-char]').forEach((b) =>
        b.addEventListener('click', () => {
          const id = b.dataset.char!;
          const c = CHARACTERS.find((x) => x.id === id)!;
          if (!save.unlocked.includes(id)) {
            if (save.ash >= c.unlockCost) {
              save.ash -= c.unlockCost;
              save.unlocked.push(id);
              this.game.persist();
              this.toast(`${c.name} joins the vigil.`);
              this.game.audio.play('chest');
            } else {
              this.toast(`Need ${c.unlockCost - save.ash} more Ash.`);
              return;
            }
          }
          save.selectedCharacter = id;
          this.game.persist();
          this.game.previewCharacter(id);
          this.showSetup();
        }),
      );
      s.querySelectorAll<HTMLElement>('[data-biome]').forEach((b) =>
        b.addEventListener('click', () => {
          biomeSel = b.dataset.biome!;
          this.game.selectedBiome = biomeSel;
          s.querySelectorAll('[data-biome]').forEach((x) => x.classList.toggle('selected', x === b));
        }),
      );
      s.querySelector('[data-act=back]')!.addEventListener('click', () => this.showMenu());
      s.querySelector('[data-act=start]')!.addEventListener('click', () => {
        this.game.selectedBiome = biomeSel;
        this.game.startRun();
      });
    });
    this.show('setup');
  }

  // ------------------------------------------------------------------ hearth
  showHearth(): void {
    const save = this.game.save;
    this.screen('hearth', (s) => {
      const items = META_UPGRADES.map((m) => {
        const rank = save.meta[m.id] ?? 0;
        const maxed = rank >= m.maxRank;
        const cost = maxed ? 0 : m.cost(rank);
        const pips = Array.from({ length: m.maxRank }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
        return `<button class="card meta-card ${maxed ? 'maxed' : ''}" data-meta="${m.id}" ${!maxed && save.ash < cost ? 'data-poor="1"' : ''}>
          <div class="card-icon">${icon(m.icon)}</div>
          <div class="card-title">${m.name}</div>
          <div class="card-desc">${m.description}</div>
          <div class="pips">${pips}</div>
          <div class="card-cost">${maxed ? 'MAX' : `${icon('ash')} ${cost}`}</div>
        </button>`;
      }).join('');
      s.innerHTML = `
        <div class="panel panel-wide">
          <h2>The Hearth</h2>
          <p class="subtle">Ash from fallen shadows feeds the hearth. Its warmth carries into every vigil.</p>
          <div class="ash-total">${icon('ash')} <b>${save.ash}</b> Ash</div>
          <div class="card-grid">${items}</div>
          <div class="row-buttons"><button class="btn" data-act="back" data-autofocus>Back</button></div>
        </div>`;
      s.querySelectorAll<HTMLElement>('[data-meta]').forEach((b) =>
        b.addEventListener('click', () => {
          const m = META_UPGRADES.find((x) => x.id === b.dataset.meta)!;
          const rank = save.meta[m.id] ?? 0;
          if (rank >= m.maxRank) return;
          const cost = m.cost(rank);
          if (save.ash < cost) {
            this.toast(`Need ${cost - save.ash} more Ash.`);
            return;
          }
          save.ash -= cost;
          save.meta[m.id] = rank + 1;
          this.game.persist();
          this.game.audio.play('levelup');
          const id = m.id;
          this.showHearth();
          this.screens.get('hearth')?.querySelector<HTMLElement>(`[data-meta="${id}"]`)?.focus();
        }),
      );
      s.querySelector('[data-act=back]')!.addEventListener('click', () => this.showMenu());
    });
    this.show('hearth');
  }

  // ------------------------------------------------------------------ settings
  showSettings(ret: Screen): void {
    this.settingsReturn = ret;
    const st = this.game.save.settings;
    this.screen('settings', (s) => {
      const slider = (key: string, label: string, v: number) =>
        `<label class="setting"><span>${label}</span><input type="range" min="0" max="1" step="0.05" value="${v}" data-key="${key}"></label>`;
      const toggle = (key: string, label: string, v: boolean) =>
        `<label class="setting"><span>${label}</span><button class="btn btn-small toggle ${v ? 'on' : ''}" data-toggle="${key}">${v ? 'On' : 'Off'}</button></label>`;
      s.innerHTML = `
        <div class="panel">
          <h2>Settings</h2>
          ${slider('masterVolume', 'Master Volume', st.masterVolume)}
          ${slider('musicVolume', 'Music', st.musicVolume)}
          ${slider('sfxVolume', 'Effects', st.sfxVolume)}
          ${toggle('screenShake', 'Screen Shake', st.screenShake)}
          ${toggle('damageNumbers', 'Damage Numbers', st.damageNumbers)}
          ${toggle('showFps', 'Show FPS', st.showFps)}
          <label class="setting"><span>Graphics</span>
            <span class="seg">${(['low', 'medium', 'high'] as const).map((q) => `<button class="btn btn-small ${st.quality === q ? 'on' : ''}" data-quality="${q}">${q}</button>`).join('')}</span>
          </label>
          <label class="setting"><span>Fullscreen</span><button class="btn btn-small" data-act="fs">Toggle</button></label>
          <div class="row-buttons"><button class="btn" data-act="back" data-autofocus>Back</button></div>
        </div>`;
      s.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) =>
        inp.addEventListener('input', () => {
          (st as any)[inp.dataset.key!] = inp.valueAsNumber;
          this.game.applySettings();
        }),
      );
      s.querySelectorAll<HTMLElement>('[data-toggle]').forEach((b) =>
        b.addEventListener('click', () => {
          const k = b.dataset.toggle!;
          (st as any)[k] = !(st as any)[k];
          b.classList.toggle('on', (st as any)[k]);
          b.textContent = (st as any)[k] ? 'On' : 'Off';
          this.game.applySettings();
        }),
      );
      s.querySelectorAll<HTMLElement>('[data-quality]').forEach((b) =>
        b.addEventListener('click', () => {
          st.quality = b.dataset.quality as any;
          s.querySelectorAll('[data-quality]').forEach((x) => x.classList.toggle('on', x === b));
          this.game.applySettings();
        }),
      );
      s.querySelector('[data-act=fs]')!.addEventListener('click', () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => {});
      });
      s.querySelector('[data-act=back]')!.addEventListener('click', () => {
        this.game.persist();
        if (this.settingsReturn === 'pause') this.showPause();
        else this.showMenu();
      });
    });
    this.show('settings');
  }

  // ------------------------------------------------------------------ HUD
  private buildHud(): void {
    const root = el('div', 'hud');
    root.innerHTML = `
      <div class="xp-bar"><div class="xp-fill"></div><div class="xp-level">Lv 1</div></div>
      <div class="hud-top">
        <div class="hud-timer">00:00</div>
        <div class="hud-counters"><span class="hud-kills">${icon('skull')} 0</span><span class="hud-ash">${icon('ash')} 0</span></div>
      </div>
      <div class="light-meter"><div class="light-icon">${icon('wick')}</div><div class="light-bar"><div class="light-fill"></div></div><div class="light-text">100</div></div>
      <div class="hud-slots"></div>
      <div class="boss-bar"><div class="boss-name"></div><div class="boss-track"><div class="boss-fill"></div></div></div>
      <button class="hud-pause" aria-label="Pause">${icon('pause')}</button>
      <div class="hud-fps"></div>`;
    this.root.appendChild(root);
    root.querySelector('.hud-pause')!.addEventListener('click', () => this.game.togglePause());
    this.hud = {
      root,
      xpFill: root.querySelector('.xp-fill')!,
      level: root.querySelector('.xp-level')!,
      timer: root.querySelector('.hud-timer')!,
      kills: root.querySelector('.hud-kills')!,
      ash: root.querySelector('.hud-ash')!,
      lightFill: root.querySelector('.light-fill')!,
      lightText: root.querySelector('.light-text')!,
      slots: root.querySelector('.hud-slots')!,
      bossBar: root.querySelector('.boss-bar')!,
      bossFill: root.querySelector('.boss-fill')!,
      bossName: root.querySelector('.boss-name')!,
      fps: root.querySelector('.hud-fps')!,
    };
  }

  showHud(): void {
    this.show('hud');
    this.refreshSlots();
  }

  refreshSlots(): void {
    const run = this.game.run;
    const w = run.weapons.map((x) => `<div class="slot weapon" title="${x.def.name}" style="--c:#${x.def.color.toString(16).padStart(6, '0')}">${icon(x.def.icon)}<b>${x.level}</b></div>`).join('');
    const p = Array.from(run.passives.entries()).map(([id, lv]) => {
      const def = this.game.passiveDef(id);
      return `<div class="slot passive" title="${def?.name ?? id}">${icon(def?.icon ?? 'star')}<b>${lv}</b></div>`;
    }).join('');
    this.hud.slots.innerHTML = `<div class="slot-row">${w}</div><div class="slot-row">${p}</div>`;
  }

  updateHud(dt: number): void {
    const g = this.game;
    const run = g.run;
    const frac = run.xp / run.xpToNext;
    this.hud.xpFill.style.transform = `scaleX(${frac})`;
    this.hud.level.textContent = `Lv ${run.level}`;
    const remaining = RUN_LENGTH - run.elapsed;
    this.hud.timer.textContent = remaining > 0 ? fmtTime(run.elapsed) : 'DAWN BREAKS?';
    this.hud.timer.classList.toggle('urgent', remaining > 0 && remaining < 30);
    this.hud.kills.innerHTML = `${icon('skull')} ${run.kills}`;
    this.hud.ash.innerHTML = `${icon('ash')} ${Math.floor(run.ashEarned)}`;
    const lf = g.player.lightFrac(run.stats.maxLight);
    this.hud.lightFill.style.transform = `scaleX(${lf})`;
    this.hud.lightText.textContent = `${Math.ceil(g.player.lightValue)}/${Math.round(run.stats.maxLight)}`;
    this.hud.root.classList.toggle('low-light', lf < 0.3);
    const boss = g.enemies.boss;
    this.hud.bossBar.classList.toggle('visible', !!boss);
    if (boss) {
      this.hud.bossName.textContent = boss.def.name;
      this.hud.bossFill.style.transform = `scaleX(${Math.max(0, boss.hp / boss.maxHp)})`;
    }
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.hud.fps.textContent = g.save.settings.showFps ? `${Math.round(this.fpsFrames / this.fpsAcc)} fps · ${g.enemies.activeCount} foes` : '';
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  // ------------------------------------------------------------------ level up
  showLevelUp(choices: UpgradeChoice[], title = 'The flame grows'): void {
    this.levelChoices = choices;
    const run = this.game.run;
    this.screen('levelup', (s) => {
      const cards = choices.map((c, i) => {
        const tag = c.kind === 'weapon-new' ? '<span class="tag new">NEW</span>' : c.kind === 'weapon-up' || c.kind === 'passive' ? `<span class="tag">Lv ${c.level}</span>` : '';
        const kindLabel = c.kind.startsWith('weapon') ? 'Weapon' : c.kind === 'passive' ? 'Relic' : 'Boon';
        return `<button class="card up-card kind-${c.kind}" data-i="${i}" ${i === 0 ? 'data-autofocus' : ''}>
          <div class="card-key">${i + 1}</div>
          <div class="card-icon">${icon(c.icon)}</div>
          <div class="card-title">${c.name} ${tag}</div>
          <div class="card-sub">${kindLabel}</div>
          <div class="card-desc">${c.description}</div>
        </button>`;
      }).join('');
      s.innerHTML = `
        <div class="levelup-wrap">
          <h2 class="levelup-title">${title}</h2>
          <div class="card-row up-row">${cards}</div>
          <div class="row-buttons">
            <button class="btn btn-small" data-act="reroll" ${run.rerolls > 0 ? '' : 'disabled'}>Reroll (${run.rerolls})</button>
            <button class="btn btn-small" data-act="skip" ${run.skips > 0 ? '' : 'disabled'}>Skip (${run.skips})</button>
          </div>
        </div>`;
      s.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => b.addEventListener('click', () => this.game.chooseUpgrade(Number(b.dataset.i))));
      s.querySelector('[data-act=reroll]')!.addEventListener('click', () => this.game.rerollUpgrades());
      s.querySelector('[data-act=skip]')!.addEventListener('click', () => this.game.skipUpgrade());
    });
    this.show('levelup');
  }

  // ------------------------------------------------------------------ pause
  showPause(): void {
    const run = this.game.run;
    this.screen('pause', (s) => {
      const st = run.stats;
      const rows: [string, string][] = [
        ['Max Light', `${Math.round(st.maxLight)}`],
        ['Regen', `${st.lightRegen.toFixed(2)}/s`],
        ['Might', `${Math.round(st.might * 100)}%`],
        ['Area', `${Math.round(st.area * 100)}%`],
        ['Cooldown', `${Math.round(st.cooldown * 100)}%`],
        ['Speed', `${st.moveSpeed.toFixed(1)}`],
        ['Armor', `${st.armor}`],
        ['Magnet', `${st.magnet.toFixed(1)}`],
        ['Crit', `${Math.round(st.critChance * st.luck * 100)}%`],
        ['Amount', `+${st.amount}`],
      ];
      s.innerHTML = `
        <div class="panel">
          <h2>Paused</h2>
          <div class="stat-grid">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
          <div class="menu-buttons">
            <button class="btn btn-primary" data-act="resume" data-autofocus>Resume</button>
            <button class="btn" data-act="settings">Settings</button>
            <button class="btn btn-danger" data-act="quit">Abandon Vigil</button>
          </div>
        </div>`;
      s.querySelector('[data-act=resume]')!.addEventListener('click', () => this.game.togglePause());
      s.querySelector('[data-act=settings]')!.addEventListener('click', () => this.showSettings('pause'));
      s.querySelector('[data-act=quit]')!.addEventListener('click', () => this.game.endRun(false));
    });
    this.show('pause');
  }

  // ------------------------------------------------------------------ game over
  showGameOver(victory: boolean, ash: number, newBest: boolean, unlocks: string[]): void {
    const run = this.game.run;
    this.screen('gameover', (s) => {
      s.innerHTML = `
        <div class="panel ${victory ? 'victory' : 'defeat'}">
          <h2 class="go-title">${victory ? 'The Vigil is Kept' : 'Your Light Fades'}</h2>
          <p class="subtle">${victory ? 'Dawn finds you still burning.' : 'The dark takes back what was always its own.'}</p>
          <div class="stat-grid big">
            <div><span>Survived</span><b>${fmtTime(run.elapsed)}${newBest ? ' <em>NEW BEST</em>' : ''}</b></div>
            <div><span>Level</span><b>${run.level}</b></div>
            <div><span>Shadows banished</span><b>${run.kills}</b></div>
            <div><span>Damage dealt</span><b>${Math.round(run.damageDealt).toLocaleString()}</b></div>
          </div>
          <div class="ash-earned">${icon('ash')} +${ash} Ash</div>
          ${unlocks.map((u) => `<div class="unlock-note">${icon('star')} ${u}</div>`).join('')}
          <div class="row-buttons">
            <button class="btn" data-act="menu">Main Menu</button>
            <button class="btn btn-primary" data-act="again" data-autofocus>Light Again</button>
          </div>
        </div>`;
      s.querySelector('[data-act=menu]')!.addEventListener('click', () => this.game.toMenu());
      s.querySelector('[data-act=again]')!.addEventListener('click', () => this.game.startRun());
    });
    this.show('gameover');
  }
}
