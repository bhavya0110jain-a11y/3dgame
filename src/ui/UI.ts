import '@fontsource/lilita-one/400.css';
import '@fontsource/fredoka/latin-400.css';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import { icon } from './icons';
import { portrait, nightArt, lanternGauge, emblem, kbd, pad, hex } from './art';
import { uiSettings, applyUiPrefs, motionReduced, type FullSettings } from './prefs';
import type { Game } from '../game/Game';
import type { UpgradeChoice } from '../game/Upgrades';
import { META_UPGRADES, CHARACTERS, type CharacterDef } from '../data/meta';
import { BIOMES } from '../data/biomes';
import { RUN_LENGTH } from '../game/Director';
import { ENEMIES } from '../data/enemies';
import { getWeapon } from '../data/weapons';
import { baseStats } from '../game/Stats';

// ---------------------------------------------------------------- optional data (feature-detected, never breaks the build)
interface AchLike {
  id: string;
  name: string;
  description: string;
  icon: string;
  secret?: boolean;
  reward?: { label?: string };
}
const achModules = import.meta.glob('../data/achievements.ts', { eager: true }) as Record<string, { ACHIEVEMENTS?: AchLike[] }>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

type Screen =
  | 'menu' | 'setup' | 'hearth' | 'settings' | 'hud' | 'levelup' | 'pause' | 'gameover' | 'howto'
  | 'achievements' | 'credits' | 'none';

type PadBtn = Parameters<typeof pad>[0];
type SettingsTab = 'audio' | 'video' | 'gameplay' | 'access';

/** Rarity treatment of an upgrade card. */
function rarityOf(c: UpgradeChoice): { cls: string; label: string; isNew: boolean } {
  switch (c.kind) {
    case 'weapon-new': return { cls: 'r-weapon', label: 'New Weapon', isNew: true };
    case 'weapon-up': return { cls: 'r-weapon', label: 'Weapon', isNew: false };
    case 'evolution': return { cls: 'r-evo', label: 'Evolution', isNew: false };
    case 'passive': return { cls: 'r-relic', label: c.level <= 1 ? 'New Relic' : 'Relic', isNew: c.level <= 1 };
    case 'heal': return { cls: 'r-boon', label: 'Boon', isNew: false };
    case 'ash': return { cls: 'r-ash', label: 'Boon', isNew: false };
    default: return c.id === 'endless' ? { cls: 'r-ash', label: 'Endless', isNew: false } : { cls: 'r-evo', label: 'Victory', isNew: false };
  }
}

const NAV_SEL = 'button:not([disabled]), input, [data-nav]';

/** Chunky outlined gradient headline: an outline layer under a gradient-fill layer (stacked in one grid cell). */
function bigTitle(text: string, cls: string): string {
  return `<h2 class="btitle ${cls}" aria-label="${esc(text)}"><span class="t-o" aria-hidden="true">${text}</span><span class="t-f" aria-hidden="true">${text}</span></h2>`;
}

/** DOM-based UI layer. All screens live under #ui-root. Public API is used by Game (see src/game/Game.ts). */
export class UI {
  readonly root: HTMLElement;
  readonly fxLayer: HTMLElement;
  private screens = new Map<Screen, HTMLElement>();
  private hud!: {
    root: HTMLElement;
    xpFill: HTMLElement;
    level: HTMLElement;
    levelBadge: HTMLElement;
    timer: HTMLElement;
    kills: HTMLElement;
    ash: HTMLElement;
    gauge: HTMLElement;
    lightFill: SVGElement;
    lightFlame: SVGElement;
    lightBar: HTMLElement;
    lightText: HTMLElement;
    lightMax: HTMLElement;
    weapons: HTMLElement;
    relics: HTMLElement;
    bossBar: HTMLElement;
    bossFill: HTMLElement;
    bossTrail: HTMLElement;
    bossName: HTMLElement;
    bossSub: HTMLElement;
    fps: HTMLElement;
  };
  private toastEl: HTMLElement;
  private toastText: HTMLElement;
  private toastIcon: HTMLElement;
  private toastTimer = 0;
  private settingsReturn: Screen = 'menu';
  private howtoReturn: Screen = 'menu';
  private settingsTab: SettingsTab = 'audio';
  current: Screen = 'none';
  private levelChoices: UpgradeChoice[] = [];
  private banishMode = false;
  private lockUntil = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private hitT = 0;
  private silentFocus = false;
  private abandonArmed = 0;
  // cached HUD values (DOM writes only on change)
  private hv = { xp: -1, level: -1, time: -1, kills: -1, ash: -1, light: -1, max: -1, lf: -1, boss: -1, bossOn: false, bossId: '', low: false, urgent: false, enraged: false, hit: false };
  // gamepad edge detection for UI-only buttons (X / Y / LB / RB)
  private padPrev: boolean[] = new Array(16).fill(false);
  private padConnected = false;
  private promptMode = '';
  private modeCheck = 0;
  private sawKeyboard = false;

  constructor(private game: Game) {
    this.root = document.getElementById('ui-root')!;
    applyUiPrefs(game.save);
    this.fxLayer = el('div', 'fx-layer');
    this.root.appendChild(this.fxLayer);
    this.root.appendChild(el('div', 'lowlight-vignette'));
    this.toastEl = el('div', 'toast', '<span class="toast-icon"></span><span class="toast-text"></span>');
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');
    this.toastText = this.toastEl.querySelector('.toast-text')!;
    this.toastIcon = this.toastEl.querySelector('.toast-icon')!;
    this.root.appendChild(this.toastEl);
    this.buildHud();

    // UI sounds: focus changes (mouse hover focuses too, see below) and clicks
    this.root.addEventListener('focusin', (e) => {
      const t = e.target as HTMLElement;
      if (!this.silentFocus && t.matches?.('button:not([disabled]), [data-nav]')) this.game.audio.play('hover');
    });
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button')) this.game.audio.play('click');
    });
    // Mouse hover == focus, so keyboard / pad / mouse share one "selected" state
    this.root.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse' || this.current === 'hud') return;
      const b = (e.target as HTMLElement).closest<HTMLElement>(NAV_SEL);
      if (b && b !== document.activeElement && this.root.contains(b) && !(b instanceof HTMLInputElement)) b.focus({ preventScroll: true });
    });
    window.addEventListener('pointerdown', () => document.documentElement.classList.remove('kbd-nav'), true);
    window.addEventListener('keydown', (e) => this.onKeyCapture(e), true);
    window.addEventListener('gamepadconnected', () => (this.padConnected = true));
    window.addEventListener('gamepaddisconnected', () => (this.padConnected = !!navigator.getGamepads?.().some((g) => g)));
    game.events.on('player:damaged', () => (this.hitT = 0.28));
    const tick = () => {
      this.uiTick();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------------ input plumbing
  private get settings(): FullSettings {
    return uiSettings(this.game.save);
  }

  /** Capture-phase keys: Esc/Backspace = back on sub-screens, level-up hotkeys, settings tab hotkeys, input lock. */
  private onKeyCapture(e: KeyboardEvent): void {
    const code = e.code;
    this.sawKeyboard = true;
    if (code.startsWith('Arrow') || code === 'Tab') document.documentElement.classList.add('kbd-nav');
    const cur = this.current;
    if (cur === 'levelup') {
      if (code.startsWith('Digit') && performance.now() < this.lockUntil) {
        e.stopPropagation();
        return;
      }
      if (code === 'KeyR' && !e.repeat) this.screens.get('levelup')?.querySelector<HTMLElement>('[data-act=reroll]:not([disabled])')?.click();
      if (code === 'KeyB' && !e.repeat) this.screens.get('levelup')?.querySelector<HTMLElement>('[data-act=banish]:not([disabled])')?.click();
      return;
    }
    if (cur === 'settings' && (code === 'KeyQ' || code === 'KeyE') && !e.repeat) this.cycleTab(code === 'KeyQ' ? -1 : 1);
    const subScreens: Screen[] = ['setup', 'hearth', 'settings', 'howto', 'achievements', 'credits'];
    if ((code === 'Escape' || (code === 'Backspace' && !(e.target instanceof HTMLInputElement))) && subScreens.includes(cur)) {
      // swallow so Game doesn't also toggle pause when settings were opened from the pause menu
      e.stopPropagation();
      e.preventDefault();
      this.screens.get(cur)?.querySelector<HTMLElement>('[data-act=back]')?.click();
    }
  }

  /** Per-frame UI housekeeping: input-prompt mode, UI-only gamepad buttons, toast timer. No allocations when idle. */
  private uiTick(): void {
    const now = performance.now();
    if (now > this.modeCheck) {
      this.modeCheck = now + 250;
      const pref = this.settings.prompts;
      const inp = this.game.input;
      const coarse = !this.sawKeyboard && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
      const mode = pref !== 'auto' ? pref : inp?.usingGamepad ? 'gamepad' : inp?.usingTouch || coarse ? 'touch' : 'keyboard';
      if (mode !== this.promptMode) {
        const h = document.documentElement.classList;
        h.remove('in-keyboard', 'in-gamepad', 'in-touch');
        h.add(`in-${mode}`);
        this.promptMode = mode;
      }
    }
    if (this.padConnected && this.current !== 'hud' && navigator.getGamepads) {
      const pads = navigator.getGamepads();
      for (let p = 0; p < pads.length; p++) {
        const gp = pads[p];
        if (!gp) continue;
        for (let i = 2; i <= 5; i++) {
          const down = !!gp.buttons[i]?.pressed;
          if (down && !this.padPrev[i]) this.onPadButton(i);
          this.padPrev[i] = down;
        }
        break;
      }
    }
  }

  private onPadButton(i: number): void {
    document.documentElement.classList.add('kbd-nav');
    const s = this.screens.get(this.current);
    if (this.current === 'levelup') {
      if (i === 2) s?.querySelector<HTMLElement>('[data-act=reroll]:not([disabled])')?.click();
      if (i === 3) s?.querySelector<HTMLElement>('[data-act=banish]:not([disabled])')?.click();
    } else if (this.current === 'settings' && (i === 4 || i === 5)) this.cycleTab(i === 4 ? -1 : 1);
  }

  // ------------------------------------------------------------------ helpers
  private screen(name: Screen, build: (root: HTMLElement) => void): HTMLElement {
    let s = this.screens.get(name);
    // rebuilding the screen that is already up (tab switch, purchase, selection) must not replay entrance animations
    const instant = !!s && name !== 'levelup' && this.current === name && s.classList.contains('visible');
    if (s) s.remove();
    s = el('div', `screen screen-${name}${instant ? ' instant' : ''}`);
    build(s);
    this.screens.set(name, s);
    this.root.appendChild(s);
    return s;
  }

  show(name: Screen): void {
    this.current = name;
    for (const [k, s] of this.screens) s.classList.toggle('visible', k === name);
    const hudOn = name === 'hud' || name === 'levelup' || name === 'pause';
    this.hud.root.classList.toggle('visible', hudOn);
    this.hud.root.classList.toggle('behind', hudOn && name !== 'hud');
    this.root.classList.toggle('in-run', hudOn);
    this.root.classList.toggle('overlay-up', name !== 'hud');
    if (name !== 'hud' && name !== 'none') {
      requestAnimationFrame(() => {
        const s = this.screens.get(name);
        if (!s || this.current !== name) return;
        if (s.contains(document.activeElement)) return;
        const first = s.querySelector<HTMLElement>('[data-autofocus]') ?? s.querySelector<HTMLElement>(NAV_SEL);
        this.silentFocus = true;
        first?.focus({ preventScroll: true });
        this.silentFocus = false;
      });
    } else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  private refocus(name: Screen, selector: string): void {
    const t = this.screens.get(name)?.querySelector<HTMLElement>(selector);
    if (!t) return;
    this.silentFocus = true;
    t.focus({ preventScroll: true });
    this.silentFocus = false;
  }

  toast(msg: string, ms = 2200): void {
    let kind = '';
    let ic = 'sparkle';
    if (msg.startsWith('Achievement')) { kind = 'toast-ach'; ic = 'trophy'; msg = msg.replace(/^Achievement:\s*/, ''); }
    else if (msg.includes('EVOLUTION')) { kind = 'toast-evo'; ic = 'sparkle'; msg = msg.replace(/✦/g, '').trim(); }
    else if (/master|enraged/i.test(msg)) { kind = 'toast-boss'; ic = 'crown'; }
    else if (/need \d+ more/i.test(msg)) { kind = 'toast-warn'; ic = 'ash'; }
    // the reliquary reveal already celebrates the evolution on screen
    if (kind === 'toast-evo' && this.current === 'levelup') return;
    this.toastEl.className = `toast ${kind}`;
    this.toastIcon.innerHTML = icon(ic);
    this.toastText.textContent = msg;
    if (kind === 'toast-ach') this.toastText.insertAdjacentHTML('afterbegin', '<small>Achievement unlocked</small>');
    void this.toastEl.offsetWidth; // restart the pop-in animation
    this.toastEl.classList.add('visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('visible'), ms);
  }

  /** Arrow-key / d-pad focus navigation between visible controls (spatial). */
  navigate(dx: number, dy: number): void {
    document.documentElement.classList.add('kbd-nav');
    const s = this.screens.get(this.current);
    if (!s) return;
    const cur = document.activeElement as HTMLElement;
    // sliders: left/right adjusts the value (keyboard arrows are preventDefault'ed by Input, so this is the only path)
    if (cur instanceof HTMLInputElement && cur.type === 'range' && dx !== 0 && s.contains(cur)) {
      const step = Number(cur.step) || 0.05;
      cur.valueAsNumber = Math.max(Number(cur.min), Math.min(Number(cur.max), cur.valueAsNumber + dx * step));
      cur.dispatchEvent(new Event('input'));
      return;
    }
    const btns = Array.from(s.querySelectorAll<HTMLElement>(NAV_SEL)).filter((b) => b.offsetParent !== null);
    if (!btns.length) return;
    if (!btns.includes(cur)) {
      (s.querySelector<HTMLElement>('[data-autofocus]') ?? btns[0]).focus({ preventScroll: true });
      return;
    }
    const r0 = cur.getBoundingClientRect();
    const c0x = r0.left + r0.width / 2;
    const c0y = r0.top + r0.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const b of btns) {
      if (b === cur) continue;
      const r = b.getBoundingClientRect();
      const vx = r.left + r.width / 2 - c0x;
      const vy = r.top + r.height / 2 - c0y;
      const along = vx * dx + vy * dy;
      if (along <= 4) continue;
      const perp = Math.abs(vx * dy - vy * dx);
      const score = along + perp * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best) {
      best.focus({ preventScroll: true });
      best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: motionReduced(this.game.save) ? 'auto' : 'smooth' });
    }
  }

  /** Bottom prompt strip: shows keyboard keys or pad glyphs depending on the active input. */
  private prompts(items: [PadBtn, string, string][]): string {
    return `<div class="prompts" aria-hidden="true">${items
      .map(([p, k, label]) => `<span class="prompt"><span class="only-kbd">${kbd(k)}</span><span class="only-pad">${pad(p)}</span>${label}</span>`)
      .join('')}</div>`;
  }

  private head(title: string, extra = ''): string {
    return `<header class="frame-head">
      <button class="btn btn-icon" data-act="back" aria-label="Back">${icon('back')}</button>
      <h2>${title}</h2>
      <div class="frame-head-extra">${extra}</div>
    </header>`;
  }

  private ashPill(n: number): string {
    return `<span class="pill pill-ash">${icon('ash')}<b>${n.toLocaleString()}</b></span>`;
  }

  private achievements(): { def: AchLike; earned: boolean }[] | null {
    const tracker = (this.game as unknown as { achievements?: { list?: () => { def: AchLike; earned: boolean }[] } }).achievements;
    if (tracker && typeof tracker.list === 'function') return tracker.list();
    const list = Object.values(achModules)[0]?.ACHIEVEMENTS;
    if (!Array.isArray(list)) return null;
    const have = new Set(this.game.save.achievements ?? []);
    return list.map((def) => ({ def, earned: have.has(def.id) }));
  }

  // ------------------------------------------------------------------ menu
  showMenu(): void {
    const save = this.game.save;
    const ach = this.achievements();
    const earned = ach ? ach.filter((a) => a.earned).length : 0;
    let embers = '';
    for (let i = 0; i < 26; i++) {
      const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
      embers += `<i style="--x:${(r(1) * 100).toFixed(1)}%;--d:${(7 + r(2) * 9).toFixed(1)}s;--dl:${(-r(3) * 16).toFixed(1)}s;--s:${(3 + r(4) * 5).toFixed(1)}px;--sw:${(r(5) * 60 - 30).toFixed(0)}px"></i>`;
    }
    this.screen('menu', (s) => {
      s.innerHTML = `
        <div class="menu-embers" aria-hidden="true">${embers}</div>
        <div class="menu-shade" aria-hidden="true"></div>
        <div class="menu-col">
          <div class="logo">
            <div class="logo-glow" aria-hidden="true"></div>
            ${emblem()}
            <h1 class="logo-text" aria-label="Last Lantern">
              <span class="logo-last" data-text="LAST">LAST</span>
              <span class="logo-lantern" data-text="LANTERN">LANTERN</span>
            </h1>
            <p class="logo-tag">Your light is your life.</p>
          </div>
          <nav class="menu-nav">
            <button class="btn btn-primary btn-xl" data-act="play" data-autofocus>${icon('play')}<span>Begin the Vigil</span></button>
            <button class="btn btn-wide" data-act="hearth">${icon('hearth')}<span>The Hearth</span>${this.ashPill(save.ash)}</button>
            ${ach ? `<button class="btn btn-wide" data-act="achievements">${icon('trophy')}<span>Achievements</span><span class="pill">${earned}/${ach.length}</span></button>` : ''}
            <div class="menu-minis">
              <button class="btn btn-mini" data-act="settings">${icon('gear')}<span>Settings</span></button>
              <button class="btn btn-mini" data-act="howto">${icon('gamepad')}<span>Controls</span></button>
              <button class="btn btn-mini" data-act="credits">${icon('scroll')}<span>Credits</span></button>
            </div>
          </nav>
          <div class="menu-stats">
            <span class="chip">${icon('timer')}<small>Best</small><b>${fmtTime(save.bestTime)}</b></span>
            <span class="chip">${icon('skull')}<small>Most</small><b>${save.bestKills.toLocaleString()}</b></span>
            <span class="chip">${icon('star')}<small>Kept</small><b>${save.victories}</b></span>
          </div>
        </div>
        ${this.prompts([['A', 'Enter', 'Select'], ['D-pad', '↑↓', 'Move']])}
        <div class="version">v${__APP_VERSION__}</div>`;
      const on = (act: string, fn: () => void) => s.querySelector(`[data-act=${act}]`)?.addEventListener('click', fn);
      on('play', () => this.showSetup());
      on('hearth', () => this.showHearth());
      on('achievements', () => this.showAchievements());
      on('howto', () => this.showHowTo('menu'));
      on('settings', () => this.showSettings('menu'));
      on('credits', () => this.showCredits());
    });
    this.show('menu');
  }

  // ------------------------------------------------------------------ controls / how to play
  showHowTo(ret: Screen = 'menu'): void {
    if (ret !== 'howto') this.howtoReturn = ret;
    const rows: [string, string, string, string][] = [
      ['Move', `${kbd('W')}${kbd('A')}${kbd('S')}${kbd('D')} or ${kbd('Arrows')}`, pad('L-stick'), 'Drag anywhere'],
      ['Attack', 'Automatic', 'Automatic', 'Automatic'],
      ['Pause', `${kbd('Esc')} ${kbd('P')}`, pad('Start'), `${icon('pause')} button`],
      ['Choose upgrade', `${kbd('1')}–${kbd('4')} / click`, `${pad('D-pad')} + ${pad('A')}`, 'Tap a card'],
      ['Reroll offers', kbd('R'), pad('X'), 'Reroll button'],
      ['Banish an offer', `${kbd('B')} or ${kbd('Shift')}+${kbd('1')}–${kbd('4')}`, pad('Y'), 'Banish button'],
      ['Menus', `${kbd('Arrows')} ${kbd('Enter')}`, `${pad('D-pad')} ${pad('A')}`, 'Tap'],
      ['Back', `${kbd('Esc')}`, pad('B'), `${icon('back')} button`],
      ['Settings tabs', `${kbd('Q')} ${kbd('E')}`, `${pad('LB')} ${pad('RB')}`, 'Tap a tab'],
    ];
    const tips: [string, string, string][] = [
      ['wick', 'Your light is your life', 'Taking hits dims your lantern and the Gloom closes in. Collect <b>Lamp Oil</b> to push the dark back.'],
      ['fire', 'Weapons fire on their own', 'Focus on moving. Thread through the horde and let your arsenal work.'],
      ['star', 'Embers become power', 'Fallen shadows drop embers. Level up, pick weapons and relics, and pair them to <b>evolve</b>.'],
      ['crown', 'Outlast the night', 'At 15:00 the master of the night arrives. Defeat it to keep the vigil, then spend <b>Ash</b> at the Hearth.'],
    ];
    this.screen('howto', (s) => {
      s.innerHTML = `
        <div class="frame frame-wide">
          ${this.head('How to Play')}
          <div class="frame-body">
            <div class="tips">${tips.map(([ic, t, d]) => `<div class="tip"><span class="badge badge-amber">${icon(ic)}</span><div><h3>${t}</h3><p>${d}</p></div></div>`).join('')}</div>
            <div class="controls-table" role="table">
              <div class="ct-row ct-head" role="row"><span></span><span>${icon('keyboard')} Keyboard</span><span>${icon('gamepad')} Gamepad</span><span>${icon('touch')} Touch</span></div>
              ${rows.map(([a, k, p, t]) => `<div class="ct-row" role="row"><b>${a}</b><span>${k}</span><span>${p}</span><span>${t}</span></div>`).join('')}
            </div>
          </div>
          ${this.prompts([['B', 'Esc', 'Back']])}
        </div>`;
      s.querySelector('[data-act=back]')!.addEventListener('click', () => this.returnTo(this.howtoReturn));
    });
    this.show('howto');
  }

  private returnTo(scr: Screen): void {
    if (scr === 'pause') this.showPause();
    else if (scr === 'settings') this.showSettings(this.settingsReturn);
    else this.showMenu();
  }

  // ------------------------------------------------------------------ setup (bearer + night)
  showSetup(): void {
    const save = this.game.save;
    let inspect = save.selectedCharacter;
    let biomeSel = save.unlocked.includes(this.game.selectedBiome) || !BIOMES.find((b) => b.id === this.game.selectedBiome)?.unlock ? this.game.selectedBiome : 'biome_pines';
    const ownedChar = (id: string) => save.unlocked.includes(id);
    const ownedBiome = (b: (typeof BIOMES)[number]) => !b.unlock || save.unlocked.includes(b.unlock);

    const render = (focusSel?: string) => {
      this.screen('setup', (s) => {
        const chars = CHARACTERS.map((c) => {
          const owned = ownedChar(c.id);
          const sel = save.selectedCharacter === c.id;
          const insp = inspect === c.id;
          return `<button class="bearer ${sel ? 'selected' : ''} ${insp ? 'inspected' : ''} ${owned ? '' : 'locked'}" data-char="${c.id}" style="--accent:${hex(c.lightColor)}" aria-pressed="${sel}">
            <span class="bearer-portrait">${portrait(c.robeColor, c.lightColor, !owned)}${owned ? '' : `<span class="bearer-lock">${icon('lock')}</span>`}</span>
            <span class="bearer-name">${c.name}</span>
            <span class="bearer-title">${owned ? c.title : `${icon('ash')} ${c.unlockCost}`}</span>
            ${sel ? `<span class="bearer-check">${icon('check')}</span>` : ''}
          </button>`;
        }).join('');
        const c = CHARACTERS.find((x) => x.id === inspect) ?? CHARACTERS[0];
        const owned = ownedChar(c.id);
        const w = getWeapon(c.startWeapon);
        const bars = this.bearerStats(c).map(([label, f, delta]) => `<div class="statbar"><span>${label}</span><i><b style="transform:scaleX(${f.toFixed(3)})"></b></i><em class="${delta.startsWith('-') ? 'neg' : delta ? 'pos' : ''}">${delta || '—'}</em></div>`).join('');
        let action = '';
        let unlockBtn = '';
        if (!owned) {
          const can = save.ash >= c.unlockCost;
          const ach = c.unlockAchievement ? this.achievements()?.find((a) => a.def.id === c.unlockAchievement) : undefined;
          action = `<p class="detail-note ${can ? 'can' : ''}">${icon('lock')} ${can ? `Unlock for ${c.unlockCost} Ash.` : `Need ${c.unlockCost - save.ash} more Ash.`}${ach ? ` Or earn <b>${esc(ach.def.name)}</b>.` : ''}</p>`;
          unlockBtn = `<button class="btn btn-lg ${can ? 'btn-gold' : ''}" data-act="unlock" ${can ? 'data-autofocus' : 'aria-disabled="true"'}>${icon('lock')}<span>Unlock ${c.name}</span>${this.ashPill(c.unlockCost)}</button>`;
        }
        const nights = BIOMES.map((b, i) => {
          const ok = ownedBiome(b);
          const req = i > 0 ? `Keep the vigil in ${BIOMES[i - 1].name}` : '';
          const cleared = save.biomesCleared?.includes(b.id);
          return `<button class="night ${biomeSel === b.id ? 'selected' : ''} ${ok ? '' : 'locked'}" data-biome="${b.id}" aria-pressed="${biomeSel === b.id}" ${ok ? '' : 'aria-disabled="true"'}>
            <span class="night-art-wrap">${nightArt(b.sky, b.groundA, b.renderLantern ?? 0xffa040)}${ok ? '' : `<span class="night-lock">${icon('lock')}</span>`}</span>
            <span class="night-info">
              <span class="night-name">${b.name}${cleared ? ` <span class="tag tag-gold">${icon('star')} Kept</span>` : ''}</span>
              <span class="night-sub">${ok ? b.subtitle : req}</span>
              <span class="night-meta"><span class="danger" aria-label="Danger ${i + 1} of ${BIOMES.length}">${Array.from({ length: BIOMES.length }, (_, k) => `<i class="${k <= i ? 'on' : ''}">${icon('skull')}</i>`).join('')}</span>${ok ? `<span class="night-boss">${icon('crown')} ${ENEMIES[b.bossId]?.name ?? '?'}</span>` : ''}</span>
            </span>
          </button>`;
        }).join('');
        s.innerHTML = `
          <div class="frame frame-wide frame-setup">
            ${this.head('Choose your Bearer', this.ashPill(save.ash))}
            <div class="frame-body">
              <div class="setup-top">
                <div class="bearer-grid">${chars}</div>
                <div class="bearer-detail" style="--accent:${hex(c.lightColor)}">
                  <div class="detail-head">
                    <span class="detail-portrait">${portrait(c.robeColor, c.lightColor, !owned)}</span>
                    <div><div class="detail-name">${c.name}</div><div class="detail-title">${c.title}</div>
                    ${w ? `<div class="detail-weapon"><span class="badge badge-sm" style="--c:${hex(w.color)}">${icon(w.icon)}</span>${w.name}</div>` : ''}</div>
                  </div>
                  <p class="detail-desc">${c.description}</p>
                  <div class="statbars">${bars}</div>
                  ${action}
                </div>
              </div>
              <h3 class="sect">${icon('moon')} Choose the Night</h3>
              <div class="night-row">${nights}</div>
            </div>
            <footer class="frame-foot">
              ${this.prompts([['A', 'Enter', 'Select'], ['B', 'Esc', 'Back']])}
              <button class="btn foot-back" data-act="back-foot">${icon('back')}<span>Back</span></button>
              ${unlockBtn}
              <button class="btn btn-primary btn-lg" data-act="start" ${ownedChar(save.selectedCharacter) ? '' : 'disabled'} ${focusSel ? '' : 'data-autofocus'}>${icon('fire')}<span>Light the Lantern</span></button>
            </footer>
          </div>`;
        s.querySelectorAll<HTMLElement>('[data-char]').forEach((b) =>
          b.addEventListener('click', () => {
            const id = b.dataset.char!;
            inspect = id;
            if (ownedChar(id)) {
              save.selectedCharacter = id;
              this.game.persist();
              this.game.previewCharacter(id);
            }
            render(`[data-char="${id}"]`);
          }),
        );
        s.querySelector('[data-act=unlock]')?.addEventListener('click', () => {
          const ch = CHARACTERS.find((x) => x.id === inspect)!;
          if (save.ash < ch.unlockCost) {
            this.toast(`Need ${ch.unlockCost - save.ash} more Ash.`);
            return;
          }
          save.ash -= ch.unlockCost;
          save.unlocked.push(ch.id);
          save.selectedCharacter = ch.id;
          this.game.persist();
          this.game.previewCharacter(ch.id);
          this.game.audio.play('chest');
          this.toast(`${ch.name} joins the vigil.`);
          render(`[data-char="${ch.id}"]`);
        });
        s.querySelectorAll<HTMLElement>('[data-biome]').forEach((b) =>
          b.addEventListener('click', () => {
            const def = BIOMES.find((x) => x.id === b.dataset.biome)!;
            if (!ownedBiome(def)) {
              const i = BIOMES.indexOf(def);
              this.toast(`Keep the vigil in ${BIOMES[i - 1]?.name ?? 'the previous night'} to unlock.`);
              return;
            }
            biomeSel = def.id;
            this.game.selectedBiome = biomeSel;
            s.querySelectorAll<HTMLElement>('[data-biome]').forEach((x) => {
              x.classList.toggle('selected', x === b);
              x.setAttribute('aria-pressed', String(x === b));
            });
          }),
        );
        const back = () => this.showMenu();
        s.querySelector('[data-act=back]')!.addEventListener('click', back);
        s.querySelector('[data-act=back-foot]')!.addEventListener('click', back);
        s.querySelector('[data-act=start]')!.addEventListener('click', () => {
          this.game.selectedBiome = biomeSel;
          this.game.startRun();
        });
      });
      this.show('setup');
      if (focusSel) this.refocus('setup', focusSel);
    };
    render();
  }

  private bearerStats(c: CharacterDef): [string, number, string][] {
    const b = baseStats();
    const s = baseStats();
    c.apply(s);
    const f = (r: number) => Math.max(0.08, Math.min(1, 0.5 + (r - 1) * 1.6));
    const pct = (r: number) => (Math.abs(r - 1) < 0.001 ? '' : `${r > 1 ? '+' : '-'}${Math.round(Math.abs(r - 1) * 100)}%`);
    const lightD = s.maxLight - b.maxLight;
    return [
      ['Light', f(s.maxLight / b.maxLight), lightD ? `${lightD > 0 ? '+' : ''}${lightD}` : ''],
      ['Power', f(s.might / b.might), pct(s.might / b.might)],
      ['Speed', f(s.moveSpeed / b.moveSpeed), pct(s.moveSpeed / b.moveSpeed)],
      ['Area', f(s.area / b.area), pct(s.area / b.area)],
      ['Haste', f(b.cooldown / s.cooldown), pct(b.cooldown / s.cooldown)],
      ['Regen', s.lightRegen <= 0 ? 0.08 : f(s.lightRegen / b.lightRegen), s.lightRegen <= 0 ? 'None' : pct(s.lightRegen / b.lightRegen)],
    ];
  }

  // ------------------------------------------------------------------ hearth
  showHearth(): void {
    const save = this.game.save;
    this.screen('hearth', (s) => {
      const items = META_UPGRADES.map((m) => {
        const rank = save.meta[m.id] ?? 0;
        const maxed = rank >= m.maxRank;
        const cost = maxed ? 0 : m.cost(rank);
        const poor = !maxed && save.ash < cost;
        const pips = Array.from({ length: m.maxRank }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
        return `<button class="meta ${maxed ? 'maxed' : ''} ${poor ? 'poor' : 'afford'}" data-meta="${m.id}" ${maxed ? 'aria-disabled="true"' : ''} ${m === META_UPGRADES[0] ? 'data-autofocus' : ''}>
          <span class="badge ${maxed ? 'badge-gold' : 'badge-amber'}">${icon(m.icon)}</span>
          <span class="meta-text"><span class="meta-name">${m.name}</span><span class="meta-desc">${m.description}</span></span>
          <span class="meta-foot"><span class="pips">${pips}</span><span class="meta-cost">${maxed ? `${icon('check')} MAX` : `${icon('ash')} ${cost}`}</span></span>
        </button>`;
      }).join('');
      s.innerHTML = `
        <div class="frame frame-wide">
          ${this.head('The Hearth', this.ashPill(save.ash))}
          <p class="frame-sub">Ash from fallen shadows feeds the hearth. Its warmth carries into every vigil.</p>
          <div class="frame-body"><div class="meta-grid">${items}</div></div>
          ${this.prompts([['A', 'Enter', 'Buy rank'], ['B', 'Esc', 'Back']])}
        </div>`;
      s.querySelectorAll<HTMLElement>('[data-meta]').forEach((b) =>
        b.addEventListener('click', () => {
          const m = META_UPGRADES.find((x) => x.id === b.dataset.meta)!;
          const rank = save.meta[m.id] ?? 0;
          if (rank >= m.maxRank) return;
          const cost = m.cost(rank);
          if (save.ash < cost) {
            this.toast(`Need ${cost - save.ash} more Ash.`);
            b.classList.remove('shake');
            void b.offsetWidth;
            b.classList.add('shake');
            return;
          }
          save.ash -= cost;
          save.meta[m.id] = rank + 1;
          this.game.persist();
          this.game.audio.play('levelup');
          const id = m.id;
          this.showHearth();
          this.refocus('hearth', `[data-meta="${id}"]`);
          this.screens.get('hearth')?.querySelector(`[data-meta="${id}"]`)?.classList.add('bought');
        }),
      );
      s.querySelector('[data-act=back]')!.addEventListener('click', () => this.showMenu());
    });
    this.show('hearth');
  }

  // ------------------------------------------------------------------ achievements
  showAchievements(): void {
    const list = this.achievements() ?? [];
    const earned = list.filter((a) => a.earned).length;
    this.screen('achievements', (s) => {
      const cards = list.map(({ def, earned: got }) => {
        const hidden = def.secret && !got;
        return `<div class="ach ${got ? 'earned' : ''}" data-nav tabindex="-1">
          <span class="badge ${got ? 'badge-gold' : 'badge-dim'}">${icon(hidden ? 'lock' : def.icon)}</span>
          <span class="ach-text"><span class="ach-name">${hidden ? '???' : esc(def.name)}</span>
          <span class="ach-desc">${hidden ? 'A secret of the night.' : esc(def.description)}</span>
          ${def.reward?.label && !hidden ? `<span class="ach-reward">${icon('sparkle')} ${esc(def.reward.label)}</span>` : ''}</span>
          ${got ? `<span class="ach-check">${icon('check')}</span>` : ''}
        </div>`;
      }).join('');
      s.innerHTML = `
        <div class="frame frame-wide">
          ${this.head('Achievements', `<span class="pill pill-gold">${icon('trophy')}<b>${earned}/${list.length}</b></span>`)}
          <div class="ach-progress"><i style="transform:scaleX(${list.length ? earned / list.length : 0})"></i></div>
          <div class="frame-body"><div class="ach-grid">${list.length ? cards : '<p class="frame-sub">No achievements yet.</p>'}</div></div>
          ${this.prompts([['B', 'Esc', 'Back']])}
        </div>`;
      s.querySelector('[data-act=back]')!.addEventListener('click', () => this.showMenu());
    });
    this.show('achievements');
  }

  // ------------------------------------------------------------------ credits
  showCredits(): void {
    this.screen('credits', (s) => {
      s.innerHTML = `
        <div class="frame frame-narrow">
          ${this.head('Credits')}
          <div class="frame-body credits">
            <div class="credits-logo">${emblem()}<div><b>Last Lantern</b><small>v${__APP_VERSION__}</small></div></div>
            <section><h3>Made with</h3>
              <p><b>Claude Code</b> — design, code, art and audio generated by an AI game studio.</p>
              <p><b>Claude Code Game Studios</b> template by Donchitos — MIT License</p></section>
            <section><h3>Open-source technology</h3>
              <p><b>three.js</b> — MIT License, © three.js authors</p>
              <p><b>N8AO</b> ambient occlusion — ISC License, © N8python</p>
              <p><b>Vite</b> &amp; <b>TypeScript</b> — MIT / Apache-2.0</p></section>
            <section><h3>Fonts</h3>
              <p><b>Lilita One</b> by Juan Montoreano — SIL Open Font License 1.1</p>
              <p><b>Fredoka</b> by Milena Brandão — SIL Open Font License 1.1</p>
              <p><b>Cinzel</b> by Natanael Gama — SIL Open Font License 1.1</p>
              <p><b>Nunito</b> by Vernon Adams — SIL Open Font License 1.1</p>
              <p>Bundled offline via Fontsource.</p></section>
            <section><h3>Audio</h3><p>Original score and sound design, synthesised from scratch (tools/audio) and mixed live with the Web Audio API.</p></section>
            <p class="credits-thanks">Thank you for keeping the light.</p>
          </div>
          ${this.prompts([['B', 'Esc', 'Back']])}
        </div>`;
      s.querySelector('[data-act=back]')!.addEventListener('click', () => this.showMenu());
    });
    this.show('credits');
  }

  // ------------------------------------------------------------------ settings
  showSettings(ret: Screen): void {
    if (ret !== 'settings') this.settingsReturn = ret;
    const st = this.settings;
    const tabs: [SettingsTab, string, string][] = [
      ['audio', 'sound', 'Audio'],
      ['video', 'display', 'Video'],
      ['gameplay', 'gamepad', 'Gameplay'],
      ['access', 'access', 'Accessibility'],
    ];
    const slider = (key: keyof FullSettings, label: string) => {
      const v = st[key] as number;
      return `<div class="setting"><label for="set-${key}">${label}</label>
        <div class="slider"><input id="set-${key}" type="range" min="0" max="1" step="0.05" value="${v}" data-key="${key}" style="--v:${v}"><output>${Math.round(v * 100)}%</output></div></div>`;
    };
    const toggle = (key: keyof FullSettings, label: string, hint = '') => {
      const v = !!st[key];
      return `<div class="setting"><div class="setting-label">${label}${hint ? `<small>${hint}</small>` : ''}</div>
        <button class="switch ${v ? 'on' : ''}" role="switch" aria-checked="${v}" aria-label="${label}" data-toggle="${key}"><span class="switch-track"><span class="switch-knob"></span></span><span class="switch-text">${v ? 'On' : 'Off'}</span></button></div>`;
    };
    const seg = (key: keyof FullSettings, label: string, opts: [string, string][], hint = '') =>
      `<div class="setting"><div class="setting-label">${label}${hint ? `<small>${hint}</small>` : ''}</div>
        <div class="seg" role="radiogroup" aria-label="${label}">${opts.map(([v, t]) => `<button class="seg-btn ${String(st[key]) === v ? 'on' : ''}" role="radio" aria-checked="${String(st[key]) === v}" data-seg="${key}" data-val="${v}">${t}</button>`).join('')}</div></div>`;
    const body = (tab: SettingsTab): string => {
      switch (tab) {
        case 'audio':
          return slider('masterVolume', 'Master Volume') + slider('musicVolume', 'Music') + slider('sfxVolume', 'Effects');
        case 'video':
          return seg('quality', 'Graphics Quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], 'Lower this if the night stutters.') +
            `<div class="setting"><div class="setting-label">Fullscreen</div><button class="btn btn-small" data-act="fs">${icon('fullscreen')}<span>Toggle</span></button></div>` +
            toggle('showFps', 'Show FPS');
        case 'gameplay':
          return seg('prompts', 'Button Prompts', [['auto', 'Auto'], ['keyboard', 'Keys'], ['gamepad', 'Pad'], ['touch', 'Touch']]) +
            toggle('confirmAbandon', 'Confirm Abandon', 'Ask before leaving a vigil.') +
            `<div class="setting"><div class="setting-label">Controls</div><button class="btn btn-small" data-act="controls">${icon('gamepad')}<span>View</span></button></div>`;
        case 'access':
          return seg('uiScale', 'UI Scale', [['0.85', '85%'], ['1', '100%'], ['1.15', '115%'], ['1.3', '130%']]) +
            toggle('reducedFlashing', 'Reduce Flashing', 'Calmer warnings and hit flashes.') +
            toggle('colorBlind', 'Colour-blind Highlights', 'High-contrast rarity and warning colours.') +
            toggle('reducedMotion', 'Reduce Motion', 'Fewer UI animations.') +
            toggle('damageNumbers', 'Damage Numbers') +
            toggle('screenShake', 'Screen Shake');
      }
    };
    this.screen('settings', (s) => {
      s.innerHTML = `
        <div class="frame frame-narrow">
          ${this.head('Settings')}
          <div class="tabs" role="tablist">
            <span class="tab-hint only-kbd">${kbd('Q')}</span><span class="tab-hint only-pad">${pad('LB')}</span>
            ${tabs.map(([id, ic, t]) => `<button class="tab ${this.settingsTab === id ? 'on' : ''}" role="tab" aria-selected="${this.settingsTab === id}" data-tab="${id}">${icon(ic)}<span>${t}</span></button>`).join('')}
            <span class="tab-hint only-kbd">${kbd('E')}</span><span class="tab-hint only-pad">${pad('RB')}</span>
          </div>
          <div class="frame-body settings-body" role="tabpanel">${body(this.settingsTab)}</div>
          ${this.prompts([['A', 'Enter', 'Change'], ['D-pad', '←→', 'Adjust'], ['B', 'Esc', 'Back']])}
        </div>`;
      const changed = () => {
        this.game.applySettings();
        applyUiPrefs(this.game.save);
      };
      s.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) =>
        b.addEventListener('click', () => {
          this.settingsTab = b.dataset.tab as SettingsTab;
          this.showSettings('settings');
          this.refocus('settings', `[data-tab="${this.settingsTab}"]`);
        }),
      );
      s.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) =>
        inp.addEventListener('input', () => {
          (st as unknown as Record<string, number>)[inp.dataset.key!] = inp.valueAsNumber;
          inp.style.setProperty('--v', String(inp.valueAsNumber));
          inp.nextElementSibling!.textContent = `${Math.round(inp.valueAsNumber * 100)}%`;
          changed();
        }),
      );
      s.querySelectorAll<HTMLElement>('[data-toggle]').forEach((b) =>
        b.addEventListener('click', () => {
          const k = b.dataset.toggle!;
          const rec = st as unknown as Record<string, boolean>;
          rec[k] = !rec[k];
          b.classList.toggle('on', rec[k]);
          b.setAttribute('aria-checked', String(rec[k]));
          b.querySelector('.switch-text')!.textContent = rec[k] ? 'On' : 'Off';
          changed();
        }),
      );
      s.querySelectorAll<HTMLElement>('[data-seg]').forEach((b) =>
        b.addEventListener('click', () => {
          const k = b.dataset.seg!;
          const raw = b.dataset.val!;
          (st as unknown as Record<string, unknown>)[k] = k === 'uiScale' ? Number(raw) : raw;
          b.parentElement!.querySelectorAll('[data-seg]').forEach((x) => {
            x.classList.toggle('on', x === b);
            x.setAttribute('aria-checked', String(x === b));
          });
          if (k === 'prompts') this.modeCheck = 0;
          changed();
        }),
      );
      s.querySelector('[data-act=fs]')?.addEventListener('click', () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => {});
      });
      s.querySelector('[data-act=controls]')?.addEventListener('click', () => {
        this.game.persist();
        this.showHowTo('settings');
      });
      s.querySelector('[data-act=back]')!.addEventListener('click', () => {
        this.game.persist();
        if (this.settingsReturn === 'pause') this.showPause();
        else this.showMenu();
      });
    });
    this.show('settings');
  }

  private cycleTab(d: number): void {
    const order: SettingsTab[] = ['audio', 'video', 'gameplay', 'access'];
    this.settingsTab = order[(order.indexOf(this.settingsTab) + d + order.length) % order.length];
    this.showSettings('settings');
    this.refocus('settings', `[data-tab="${this.settingsTab}"]`);
    this.game.audio.play('hover');
  }

  // ------------------------------------------------------------------ HUD
  private buildHud(): void {
    const root = el('div', 'hud');
    root.innerHTML = `
      <div class="hud-top">
        <div class="lvl-badge" aria-label="Level"><small>LV</small><b class="lvl-num">1</b></div>
        <div class="xp-bar"><div class="xp-fill"></div><div class="xp-shine"></div></div>
        <button class="hud-pause" aria-label="Pause">${icon('pause')}</button>
      </div>
      <div class="hud-row2">
        <div class="hud-slots"><div class="slot-row slot-weapons"></div><div class="slot-row slot-relics"></div></div>
        <div class="hud-center">
          <div class="hud-timer">00:00</div>
          <div class="boss-bar" aria-live="polite">
            <div class="boss-plate">${icon('crown')}<span class="boss-name"></span>${icon('crown')}</div>
            <div class="boss-track"><div class="boss-trail"></div><div class="boss-fill"></div><div class="boss-ticks"></div></div>
            <div class="boss-sub"></div>
          </div>
        </div>
        <div class="hud-counters">
          <span class="counter counter-kills">${icon('skull')}<b class="kills-num">0</b></span>
          <span class="counter counter-ash">${icon('ash')}<b class="ash-num">0</b></span>
        </div>
      </div>
      <div class="light-gauge">
        <div class="lantern-wrap">${lanternGauge()}</div>
        <div class="light-info">
          <div class="light-label"><span>LIGHT</span><span class="light-warn">${icon('warning')} Fading — find oil</span></div>
          <div class="light-bar"><div class="light-fill"></div><div class="light-gloss"></div></div>
          <div class="light-num"><b class="light-val">100</b><span class="light-max">/100</span></div>
        </div>
      </div>
      <div class="hud-fps"></div>`;
    this.root.appendChild(root);
    root.querySelector('.hud-pause')!.addEventListener('click', () => this.game.togglePause());
    this.hud = {
      root,
      xpFill: root.querySelector('.xp-fill')!,
      level: root.querySelector('.lvl-num')!,
      levelBadge: root.querySelector('.lvl-badge')!,
      timer: root.querySelector('.hud-timer')!,
      kills: root.querySelector('.kills-num')!,
      ash: root.querySelector('.ash-num')!,
      gauge: root.querySelector('.light-gauge')!,
      lightFill: root.querySelector('.lg-fill')!,
      lightFlame: root.querySelector('.lg-flame')!,
      lightBar: root.querySelector('.light-fill')!,
      lightText: root.querySelector('.light-val')!,
      lightMax: root.querySelector('.light-max')!,
      weapons: root.querySelector('.slot-weapons')!,
      relics: root.querySelector('.slot-relics')!,
      bossBar: root.querySelector('.boss-bar')!,
      bossFill: root.querySelector('.boss-fill')!,
      bossTrail: root.querySelector('.boss-trail')!,
      bossName: root.querySelector('.boss-name')!,
      bossSub: root.querySelector('.boss-sub')!,
      fps: root.querySelector('.hud-fps')!,
    };
  }

  showHud(): void {
    this.banishMode = false;
    this.show('hud');
    this.refreshSlots();
  }

  refreshSlots(): void {
    const run = this.game.run;
    const evo = new Set(run.evolutions ?? []);
    const pips = (lv: number, max: number) => {
      if (lv >= max) return `<span class="slot-max">MAX</span>`;
      let p = '';
      for (let i = 0; i < max; i++) p += `<i class="${i < lv ? 'on' : ''}"></i>`;
      return `<span class="slot-pips">${p}</span>`;
    };
    let w = '';
    for (let i = 0; i < run.maxWeapons; i++) {
      const x = run.weapons[i];
      if (!x) { w += '<div class="slot empty"></div>'; continue; }
      const isEvo = evo.has(x.def.id) || !!x.def.hidden;
      w += `<div class="slot weapon ${isEvo ? 'evo' : ''} ${x.level >= x.def.maxLevel ? 'maxed' : ''}" title="${esc(x.def.name)} — Lv ${x.level}" style="--c:${hex(x.def.color)}">${icon(x.def.icon)}${pips(x.level, x.def.maxLevel)}</div>`;
    }
    let p = '';
    const relics = Array.from(run.passives.entries());
    for (let i = 0; i < run.maxPassives; i++) {
      const r = relics[i];
      if (!r) { p += '<div class="slot empty relic-empty"></div>'; continue; }
      const def = this.game.passiveDef(r[0]);
      const max = def?.maxLevel ?? 5;
      p += `<div class="slot relic ${r[1] >= max ? 'maxed' : ''}" title="${esc(def?.name ?? r[0])} — Lv ${r[1]}">${icon(def?.icon ?? 'star')}${pips(r[1], max)}</div>`;
    }
    this.hud.weapons.innerHTML = w;
    this.hud.relics.innerHTML = p;
  }

  updateHud(dt: number): void {
    const g = this.game;
    const run = g.run;
    const hv = this.hv;
    const h = this.hud;
    const frac = Math.min(1, run.xp / Math.max(1, run.xpToNext));
    const fq = Math.round(frac * 400);
    if (fq !== hv.xp) {
      hv.xp = fq;
      h.xpFill.style.transform = `scaleX(${fq / 400})`;
    }
    if (run.level !== hv.level) {
      const up = hv.level > 0 && run.level > hv.level;
      hv.level = run.level;
      h.level.textContent = String(run.level);
      if (up) {
        h.levelBadge.classList.remove('pop');
        void h.levelBadge.offsetWidth;
        h.levelBadge.classList.add('pop');
      }
    }
    const t = Math.floor(run.elapsed);
    if (t !== hv.time) {
      hv.time = t;
      const remaining = RUN_LENGTH - run.elapsed;
      h.timer.textContent = run.endless ? `${fmtTime(run.elapsed)}` : remaining > 0 ? fmtTime(run.elapsed) : 'DAWN?';
      const urgent = remaining > 0 && remaining < 30;
      if (urgent !== hv.urgent) {
        hv.urgent = urgent;
        h.timer.classList.toggle('urgent', urgent);
      }
      h.timer.classList.toggle('endless', !!run.endless);
    }
    if (run.kills !== hv.kills) {
      hv.kills = run.kills;
      h.kills.textContent = run.kills.toLocaleString();
    }
    const ash = Math.floor(run.ashEarned);
    if (ash !== hv.ash) {
      hv.ash = ash;
      h.ash.textContent = String(ash);
    }
    const lf = g.player.lightFrac(run.stats.maxLight);
    const lq = Math.round(lf * 300);
    if (lq !== hv.lf) {
      hv.lf = lq;
      const f = lq / 300;
      h.lightBar.style.transform = `scaleX(${f})`;
      h.lightFill.style.transform = `scaleY(${f})`;
      h.lightFlame.style.transform = `scale(${0.35 + 0.65 * f})`;
    }
    const lv = Math.ceil(g.player.lightValue);
    if (lv !== hv.light) {
      hv.light = lv;
      h.lightText.textContent = String(Math.max(0, lv));
    }
    const mx = Math.round(run.stats.maxLight);
    if (mx !== hv.max) {
      hv.max = mx;
      h.lightMax.textContent = `/${mx}`;
    }
    const low = lf < 0.3;
    if (low !== hv.low) {
      hv.low = low;
      h.root.classList.toggle('low-light', low);
      this.root.classList.toggle('low-light', low && this.current === 'hud');
    }
    if (this.hitT > 0) this.hitT -= dt;
    const hit = this.hitT > 0;
    if (hit !== hv.hit) {
      hv.hit = hit;
      h.gauge.classList.toggle('hit', hit);
    }
    const boss = g.enemies.boss;
    const bossOn = !!boss && boss.hp > 0;
    if (bossOn !== hv.bossOn) {
      hv.bossOn = bossOn;
      h.bossBar.classList.toggle('visible', bossOn);
      h.root.classList.toggle('has-boss', bossOn);
    }
    if (boss && bossOn) {
      if (boss.def.id !== hv.bossId) {
        hv.bossId = boss.def.id;
        h.bossName.textContent = boss.def.name;
        const biome = BIOMES.find((b) => b.bossId === boss.def.id);
        h.bossSub.textContent = biome ? `Master of ${biome.name}` : 'Master of the Night';
      }
      const bf = Math.round(Math.max(0, boss.hp / boss.maxHp) * 500);
      if (bf !== hv.boss) {
        hv.boss = bf;
        h.bossFill.style.transform = `scaleX(${bf / 500})`;
        h.bossTrail.style.transform = `scaleX(${bf / 500})`;
      }
      const enr = !!boss.enraged;
      if (enr !== hv.enraged) {
        hv.enraged = enr;
        h.bossBar.classList.toggle('enraged', enr);
      }
    } else if (hv.bossId) {
      hv.bossId = '';
      hv.boss = -1;
    }
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      h.fps.textContent = g.save.settings.showFps ? `${Math.round(this.fpsFrames / this.fpsAcc)} fps · ${g.enemies.activeCount} foes` : '';
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  // ------------------------------------------------------------------ level up / reliquary / dawn
  private choiceCard(c: UpgradeChoice, i: number, interactive = true): string {
    const r = rarityOf(c);
    let max = 0;
    if (c.kind === 'weapon-new' || c.kind === 'weapon-up') max = getWeapon(c.id)?.maxLevel ?? 0;
    else if (c.kind === 'passive') max = this.game.passiveDef(c.id)?.maxLevel ?? 0;
    let pips = '';
    if (max > 0 && c.level > 0) {
      for (let k = 1; k <= max; k++) pips += `<i class="${k < c.level ? 'on' : k === c.level ? 'next' : ''}"></i>`;
      pips = `<span class="uc-pips" aria-label="Level ${c.level} of ${max}">${pips}</span>`;
    }
    const wColor = c.kind.startsWith('weapon') || c.kind === 'evolution' ? getWeapon(c.id)?.color : undefined;
    const lvText = c.kind === 'weapon-up' || (c.kind === 'passive' && c.level > 1) ? `Lv ${c.level - 1} → ${c.level}` : c.kind === 'evolution' && c.from ? `${getWeapon(c.from)?.name ?? ''} →` : '';
    return `<button class="ucard ${r.cls}" data-i="${i}" ${i === 0 ? 'data-autofocus' : ''} style="--i:${i}${wColor !== undefined ? `;--wc:${hex(wColor)}` : ''}" ${interactive ? '' : 'tabindex="-1"'}>
      <span class="uc-rays" aria-hidden="true"></span>
      <span class="uc-ribbon">${r.label}</span>
      ${r.isNew ? '<span class="uc-new">NEW!</span>' : ''}
      ${interactive ? `<span class="uc-key"><span class="only-kbd">${kbd(String(i + 1))}</span><span class="only-pad">${pad('A')}</span></span>` : ''}
      <span class="uc-badge">${icon(c.icon)}</span>
      <span class="uc-name">${c.name}</span>
      ${lvText ? `<span class="uc-lv">${lvText}</span>` : ''}
      ${pips}
      <span class="uc-desc">${c.description}</span>
      <span class="uc-banish" aria-hidden="true">${icon('banish')} Banish</span>
    </button>`;
  }

  showLevelUp(choices: UpgradeChoice[], title = 'The flame grows'): void {
    this.levelChoices = choices;
    const run = this.game.run;
    const mode = this.game.levelMode ?? 'levelup';
    const isLevel = mode === 'levelup';
    if (!isLevel) this.banishMode = false;
    this.lockUntil = performance.now() + (motionReduced(this.game.save) ? 200 : 420);
    this.screen('levelup', (s) => {
      s.classList.toggle('mode-dawn', mode === 'dawn');
      s.classList.toggle('banishing', this.banishMode);
      const kicker = mode === 'dawn' ? 'Victory is yours' : `Level ${run.level}`;
      const big = mode === 'dawn' ? title : 'Level Up!';
      const banishes = run.banishes ?? 0;
      s.innerHTML = `
        <div class="lu-burst" aria-hidden="true"></div>
        <div class="lu-wrap">
          <div class="lu-head">
            <div class="lu-kicker">${kicker}</div>
            ${bigTitle(big, 'lu-title')}
            ${mode === 'dawn' ? '' : `<div class="lu-sub">${title}</div>`}
          </div>
          <div class="lu-cards n${choices.length}">${choices.map((c, i) => this.choiceCard(c, i)).join('')}</div>
          ${isLevel ? `<div class="lu-actions">
            <button class="btn btn-small" data-act="reroll" ${run.rerolls > 0 ? '' : 'disabled'}>${icon('reroll')}<span>Reroll</span><span class="count">${run.rerolls}</span><span class="only-kbd">${kbd('R')}</span><span class="only-pad">${pad('X')}</span></button>
            <button class="btn btn-small btn-danger ${this.banishMode ? 'on' : ''}" data-act="banish" ${banishes > 0 ? '' : 'disabled'} aria-pressed="${this.banishMode}">${icon('banish')}<span>${this.banishMode ? 'Cancel' : 'Banish'}</span><span class="count">${banishes}</span><span class="only-kbd">${kbd('B')}</span><span class="only-pad">${pad('Y')}</span></button>
            <button class="btn btn-small" data-act="skip" ${run.skips > 0 ? '' : 'disabled'}>${icon('skip')}<span>Skip</span><span class="count">${run.skips}</span></button>
          </div>
          <div class="lu-hint">${this.banishMode ? 'Pick an offer to banish it for the rest of this vigil.' : 'Skipping grants +5 Ash.'}</div>` : ''}
        </div>`;
      s.querySelectorAll<HTMLElement>('[data-i]').forEach((b) =>
        b.addEventListener('click', () => {
          if (performance.now() < this.lockUntil) return;
          const i = Number(b.dataset.i);
          if (this.banishMode) {
            this.banishMode = false;
            this.game.banishUpgrade(i);
          } else this.game.chooseUpgrade(i);
        }),
      );
      s.querySelector('[data-act=reroll]')?.addEventListener('click', () => {
        this.banishMode = false;
        this.game.rerollUpgrades();
      });
      s.querySelector('[data-act=skip]')?.addEventListener('click', () => this.game.skipUpgrade());
      s.querySelector('[data-act=banish]')?.addEventListener('click', () => {
        this.banishMode = !this.banishMode;
        s.classList.toggle('banishing', this.banishMode);
        const b = s.querySelector<HTMLElement>('[data-act=banish]')!;
        b.classList.toggle('on', this.banishMode);
        b.setAttribute('aria-pressed', String(this.banishMode));
        b.querySelector('span')!.textContent = this.banishMode ? 'Cancel' : 'Banish';
        s.querySelector('.lu-hint')!.textContent = this.banishMode ? 'Pick an offer to banish it for the rest of this vigil.' : 'Skipping grants +5 Ash.';
        this.refocus('levelup', '[data-i="0"]');
      });
    });
    this.show('levelup');
    this.game.audio.play('hover');
  }

  /** Reliquary reveal (Game feature-detects this). Contents were already applied; any input continues. */
  showChest(items: UpgradeChoice[], evolved: boolean): void {
    this.levelChoices = items;
    this.lockUntil = performance.now() + 300;
    const dur = evolved ? 4.5 : 2.8;
    // the evolution toast fired a moment ago (weapon:evolved) — the reveal replaces it
    if (evolved) this.toastEl.classList.remove('visible');
    this.screen('levelup', (s) => {
      s.classList.add('mode-chest');
      s.classList.toggle('chest-evo', evolved);
      s.innerHTML = `
        <div class="lu-burst" aria-hidden="true"></div>
        <div class="lu-wrap">
          <div class="lu-head">
            <div class="lu-kicker">${icon('sparkle')} Reliquary ${icon('sparkle')}</div>
            ${bigTitle(evolved ? 'Evolution!' : 'Treasure!', 'lu-title')}
          </div>
          <div class="lu-cards n${items.length}">${items.map((c, i) => this.choiceCard(c, i, false)).join('')}</div>
          <div class="lu-actions">
            <button class="btn btn-primary chest-go" data-act="continue" data-autofocus style="--dur:${dur}s">${icon('check')}<span>Continue</span><span class="only-kbd">${kbd('Space')}</span><span class="only-pad">${pad('A')}</span><i class="chest-timer"></i></button>
          </div>
        </div>`;
      const go = () => {
        if (performance.now() < this.lockUntil) return;
        this.game.closeChest();
      };
      s.querySelector('[data-act=continue]')!.addEventListener('click', go);
      s.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => b.addEventListener('click', go));
    });
    this.show('levelup');
  }

  // ------------------------------------------------------------------ pause
  showPause(): void {
    const run = this.game.run;
    this.abandonArmed = 0;
    this.screen('pause', (s) => {
      const st = run.stats;
      const rows: [string, string, string][] = [
        ['wick', 'Max Light', `${Math.round(st.maxLight)}`],
        ['oil', 'Regen', `${st.lightRegen.toFixed(2)}/s`],
        ['flint', 'Might', `${Math.round(st.might * 100)}%`],
        ['nova', 'Area', `${Math.round(st.area * 100)}%`],
        ['clock', 'Cooldown', `${Math.round(st.cooldown * 100)}%`],
        ['boots', 'Speed', `${st.moveSpeed.toFixed(1)}`],
        ['armor', 'Armor', `${st.armor}`],
        ['magnet', 'Magnet', `${st.magnet.toFixed(1)}`],
        ['luck', 'Crit', `${Math.round(st.critChance * st.luck * 100)}%`],
        ['twin', 'Amount', `+${st.amount}`],
      ];
      const build = [
        ...run.weapons.map((w) => `<div class="build-item"><span class="badge badge-sm badge-tint" style="--c:${hex(w.def.color)}">${icon(w.def.icon)}</span><span>${w.def.name}</span><b>${w.level >= w.def.maxLevel ? 'MAX' : `Lv ${w.level}`}</b></div>`),
        ...Array.from(run.passives.entries()).map(([id, lv]) => {
          const d = this.game.passiveDef(id);
          return `<div class="build-item relic"><span class="badge badge-sm badge-blue">${icon(d?.icon ?? 'star')}</span><span>${d?.name ?? id}</span><b>${d && lv >= d.maxLevel ? 'MAX' : `Lv ${lv}`}</b></div>`;
        }),
      ].join('');
      s.innerHTML = `
        <div class="frame pause-frame">
          <div class="pause-left">
            <h2 class="pause-title">Paused</h2>
            <div class="pause-meta"><span class="chip">${icon('timer')}<b>${fmtTime(run.elapsed)}</b></span><span class="chip">${icon('star')}<small>Lv</small><b>${run.level}</b></span><span class="chip">${icon('skull')}<b>${run.kills.toLocaleString()}</b></span></div>
            <nav class="menu-nav">
              <button class="btn btn-primary btn-lg" data-act="resume" data-autofocus>${icon('play')}<span>Resume</span></button>
              <button class="btn btn-wide" data-act="settings">${icon('gear')}<span>Settings</span></button>
              <button class="btn btn-wide" data-act="controls">${icon('gamepad')}<span>Controls</span></button>
              <button class="btn btn-wide btn-danger" data-act="quit">${icon('cross')}<span>Abandon Vigil</span></button>
            </nav>
          </div>
          <div class="pause-right">
            <h3 class="sect">${icon('fire')} Your Build</h3>
            <div class="build-list">${build || '<p class="frame-sub">Nothing yet.</p>'}</div>
            <h3 class="sect">${icon('star')} Stats</h3>
            <div class="stat-grid">${rows.map(([ic, k, v]) => `<div>${icon(ic)}<span>${k}</span><b>${v}</b></div>`).join('')}</div>
          </div>
          ${this.prompts([['A', 'Enter', 'Select'], ['B', 'Esc', 'Resume']])}
        </div>`;
      s.querySelector('[data-act=resume]')!.addEventListener('click', () => this.game.togglePause());
      s.querySelector('[data-act=settings]')!.addEventListener('click', () => this.showSettings('pause'));
      s.querySelector('[data-act=controls]')!.addEventListener('click', () => this.showHowTo('pause'));
      const quit = s.querySelector<HTMLElement>('[data-act=quit]')!;
      quit.addEventListener('click', () => {
        if (this.settings.confirmAbandon && performance.now() > this.abandonArmed) {
          this.abandonArmed = performance.now() + 3000;
          quit.classList.add('armed');
          quit.querySelector('span')!.textContent = 'Really abandon?';
          window.setTimeout(() => {
            quit.classList.remove('armed');
            const sp = quit.querySelector('span');
            if (sp) sp.textContent = 'Abandon Vigil';
            this.abandonArmed = 0;
          }, 3000);
          return;
        }
        this.game.endRun(false);
      });
    });
    this.show('pause');
  }

  // ------------------------------------------------------------------ game over
  showGameOver(victory: boolean, ash: number, newBest: boolean, unlocks: string[]): void {
    const run = this.game.run;
    const g = this.game as unknown as { lastRunAchievements?: AchLike[] };
    const achs = Array.isArray(g.lastRunAchievements) ? g.lastRunAchievements : null;
    const notes = achs ? unlocks.filter((u) => !u.startsWith('Achievement')) : unlocks;
    // damage per source (feature-detected)
    type Row = { source: string; damage: number; share: number };
    let dmg: Row[] = [];
    const r = run as unknown as { damageSummary?: () => Row[]; damageBySource?: Map<string, number> };
    if (typeof r.damageSummary === 'function') dmg = r.damageSummary();
    else if (r.damageBySource instanceof Map) {
      const total = Math.max(1, run.damageDealt);
      dmg = [...r.damageBySource.entries()].map(([source, damage]) => ({ source, damage, share: damage / total })).sort((a, b) => b.damage - a.damage);
    }
    dmg = dmg.filter((d) => d.damage > 0).slice(0, 7);
    const top = dmg[0]?.damage ?? 1;
    const srcInfo = (id: string): { name: string; ic: string; color: number } => {
      if (id === 'blast') return { name: 'Cinder Blasts', ic: 'fire', color: 0xff7a2a };
      const w = getWeapon(id.replace(/^burn:/, ''));
      if (w) return { name: w.name, ic: w.icon, color: w.color };
      return { name: id.replace(/[_:]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()), ic: 'star', color: 0xffc76a };
    };
    const dmgRows = dmg.map((d) => {
      const info = srcInfo(d.source);
      return `<div class="dmg-row" style="--c:${hex(info.color)}"><span class="badge badge-sm badge-tint" style="--c:${hex(info.color)}">${icon(info.ic)}</span>
        <span class="dmg-name">${esc(info.name)}</span>
        <span class="dmg-bar"><i style="transform:scaleX(${(d.damage / top).toFixed(3)})"></i></span>
        <b class="dmg-val">${Math.round(d.damage).toLocaleString()}</b><em>${Math.round(d.share * 100)}%</em></div>`;
    }).join('');
    const all = this.achievements();
    const nextGoal = all?.find((a) => !a.earned && !a.def.secret);
    const achCards = (achs ?? []).map((a) => `<div class="go-ach"><span class="badge badge-gold">${icon(a.icon)}</span><div><b>${esc(a.name)}</b><small>${a.reward?.label ? esc(a.reward.label) : esc(a.description)}</small></div></div>`).join('');
    const tiles: [string, string, number, string, string][] = [
      ['timer', 'Survived', Math.floor(run.elapsed), 'time', newBest ? 'New best!' : ''],
      ['star', 'Level', run.level, '', ''],
      ['skull', 'Shadows banished', run.kills, '', ''],
      ['ash', 'Ash earned', ash, 'ash', ''],
    ];
    this.screen('gameover', (s) => {
      s.classList.toggle('victory', victory);
      s.innerHTML = `
        ${victory ? '<div class="lu-burst go-burst" aria-hidden="true"></div>' : ''}
        <div class="go-wrap ${victory ? 'victory' : 'defeat'}">
          <div class="go-head">
            <div class="go-kicker">${victory ? `${icon('sparkle')} Dawn breaks ${icon('sparkle')}` : 'The vigil ends'}</div>
            ${bigTitle(victory ? 'The Vigil is Kept' : 'Your Light Fades', 'go-title')}
            <p class="go-sub">${victory ? 'Dawn finds you still burning.' : 'The dark takes back what was always its own.'}</p>
          </div>
          <div class="go-tiles">${tiles.map(([ic, label, v, fmt, badge], i) => `<div class="go-tile ${fmt === 'ash' ? 'tile-ash' : ''}" style="--i:${i}">
            <span class="badge ${fmt === 'ash' ? 'badge-violet' : 'badge-amber'}">${icon(ic)}</span>
            <small>${label}</small><b data-count="${v}" data-fmt="${fmt}">${fmt === 'time' ? fmtTime(v) : fmt === 'ash' ? `+${v}` : v.toLocaleString()}</b>
            ${badge ? `<span class="tag tag-gold">${badge}</span>` : ''}</div>`).join('')}</div>
          <div class="go-cols">
            ${dmgRows ? `<section class="go-card"><h3 class="sect">${icon('fire')} Damage by weapon <span class="sect-right">${Math.round(run.damageDealt).toLocaleString()} total</span></h3><div class="dmg-list">${dmgRows}</div></section>` : ''}
            <section class="go-card">
              <h3 class="sect">${icon('trophy')} This vigil</h3>
              ${achCards ? `<div class="go-achs">${achCards}</div>` : ''}
              ${notes.map((u) => `<div class="unlock-note">${icon('sparkle')} ${esc(u)}</div>`).join('')}
              ${!achCards && !notes.length ? `<p class="frame-sub">No new unlocks this time.</p>` : ''}
              ${nextGoal ? `<div class="next-goal"><small>Next goal</small><div><span class="badge badge-sm badge-dim">${icon(nextGoal.def.icon)}</span><b>${esc(nextGoal.def.name)}</b> — ${esc(nextGoal.def.description)}${nextGoal.def.reward?.label ? ` <em>${esc(nextGoal.def.reward.label)}</em>` : ''}</div></div>` : ''}
            </section>
          </div>
          <div class="go-buttons">
            <button class="btn" data-act="menu">${icon('home')}<span>Main Menu</span></button>
            <button class="btn" data-act="hearth">${icon('hearth')}<span>Hearth</span>${this.ashPill(this.game.save.ash)}</button>
            <button class="btn btn-primary btn-lg" data-act="again" data-autofocus>${icon('reroll')}<span>Light Again</span></button>
          </div>
        </div>`;
      s.querySelector('[data-act=menu]')!.addEventListener('click', () => this.game.toMenu());
      s.querySelector('[data-act=hearth]')!.addEventListener('click', () => {
        this.game.toMenu();
        this.showHearth();
      });
      s.querySelector('[data-act=again]')!.addEventListener('click', () => this.game.startRun());
    });
    this.show('gameover');
    this.countUp(this.screens.get('gameover')!);
  }

  /** Animated count-up for [data-count] numbers (skipped with reduced motion). */
  private countUp(root: HTMLElement): void {
    if (motionReduced(this.game.save)) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-count]'));
    const t0 = performance.now();
    const dur = 900;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      for (const n of els) {
        const v = Math.round(Number(n.dataset.count) * e);
        const fmt = n.dataset.fmt;
        n.textContent = fmt === 'time' ? fmtTime(v) : fmt === 'ash' ? `+${v}` : v.toLocaleString();
      }
      if (k < 1 && this.current === 'gameover') requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
