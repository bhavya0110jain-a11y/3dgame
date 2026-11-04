import type { SaveData } from '../core/Save';
import { ACHIEVEMENTS } from '../data/achievements';
import { BOONS, boonById } from '../data/boons';
import { KITES, type KiteDef } from '../data/kites';
import { UPGRADES, upgradeCost } from '../data/upgrades';

export type ScreenId = 'menu' | 'hud' | 'boon' | 'pause' | 'results' | 'shop' | 'settings' | 'none';

/** Data the HUD shows each frame (written by Game; read-only here). */
export interface HudState {
  distance: number;
  score: number;
  combo: number;
  multiplier: number;
  comboFrac: number;
  lift: number;
  glimmers: number;
  shields: number;
  speed: number;
  altitude: number;
  diving: boolean;
  biome: string;
  fps: number;
  nextShrine: number;
}

export interface ResultsView {
  cause: string;
  distance: number;
  score: number;
  bestCombo: number;
  rings: number;
  perfects: number;
  whiskers: number;
  arches: number;
  earned: number;
  newBestDistance: boolean;
  newBestScore: boolean;
  achievements: { name: string; reward: number }[];
  daily: boolean;
  boons: string[];
}

type Handler = (act: string, data?: string) => void;

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * DOM UI: one element per screen under #ui, toggled with `.visible`. Buttons carry data-act (and optional data-id);
 * clicks call the single handler installed by the Game. HUD updates write textContent/style only (no innerHTML per frame).
 */
export class UI {
  readonly root: HTMLElement;
  private screens = new Map<ScreenId, HTMLElement>();
  private handler: Handler = () => {};
  private hud: Record<string, HTMLElement> = {};
  private current: ScreenId = 'none';
  private shopTab: 'kites' | 'upgrades' = 'kites';
  private settingsReturn: ScreenId = 'menu';
  private lastHud = { dist: -1, score: -1, combo: -1, gl: -1, sh: -1, mult: -1 };
  onHover: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    for (const id of ['menu', 'hud', 'boon', 'pause', 'results', 'shop', 'settings'] as ScreenId[]) {
      const el = document.createElement('div');
      el.className = `screen screen-${id}`;
      root.appendChild(el);
      this.screens.set(id, el);
    }
    root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t || t.hasAttribute('disabled')) return;
      this.handler(t.dataset.act!, t.dataset.id);
    });
    root.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest('button, .card') as HTMLElement | null;
      if (t && (e as PointerEvent).pointerType === 'mouse') this.onHover();
    });
    root.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.setting) this.handler('setting', `${t.dataset.setting}=${t.type === 'checkbox' ? t.checked : t.value}`);
    });
    this.buildHud();
    const toasts = document.createElement('div');
    toasts.className = 'toasts';
    root.appendChild(toasts);
    this.hud.toasts = toasts;
  }

  onAction(fn: Handler): void {
    this.handler = fn;
  }

  get screen(): ScreenId {
    return this.current;
  }

  show(id: ScreenId): void {
    this.current = id;
    for (const [k, el] of this.screens) el.classList.toggle('visible', k === id || (k === 'hud' && (id === 'boon' || id === 'pause')));
  }

  // ------------------------------------------------------------------ menu
  renderMenu(save: SaveData, kite: KiteDef, dailyKey: string): void {
    const el = this.screens.get('menu')!;
    const dailyBest = save.daily[dailyKey] ?? 0;
    el.innerHTML = `
      <div class="menu-wrap">
        <div class="logo"><span class="logo-k">KITE</span><span class="logo-w">WIND</span></div>
        <div class="tagline">ride the warm winds over the sunset sea</div>
        <div class="menu-buttons">
          <button class="btn btn-primary" data-act="play">Fly</button>
          <button class="btn" data-act="daily">Daily Winds <small>${dailyKey}${dailyBest ? ` · best ${fmt(dailyBest)}` : ''}</small></button>
          <div class="row">
            <button class="btn btn-half" data-act="shop" data-id="kites">Kites</button>
            <button class="btn btn-half" data-act="shop" data-id="upgrades">Upgrades</button>
          </div>
          <button class="btn btn-ghost" data-act="settings">Settings</button>
        </div>
        <div class="menu-stats">
          <div><b>${fmt(save.bestDistance)} m</b><span>best distance</span></div>
          <div><b>${fmt(save.bestScore)}</b><span>best score</span></div>
          <div><b class="gl">✦ ${fmt(save.glimmers)}</b><span>glimmers</span></div>
        </div>
        <div class="menu-kite">flying <b style="color:#${kite.colors[1].toString(16).padStart(6, '0')}">${esc(kite.name)}</b></div>
        <div class="controls-hint">Steer: WASD / arrows / mouse / drag · Dive: hold Space or click · Pause: Esc</div>
      </div>`;
  }

  // ------------------------------------------------------------------ HUD
  private buildHud(): void {
    const el = this.screens.get('hud')!;
    el.innerHTML = `
      <div class="hud-tl"><div class="hud-dist"><span data-h="dist">0</span><small>m</small></div><div class="hud-biome" data-h="biome"></div></div>
      <div class="hud-tc">
        <div class="hud-score" data-h="score">0</div>
        <div class="hud-combo" data-h="comboWrap"><span data-h="combo">x1</span><div class="combo-bar"><div data-h="comboBar"></div></div></div>
      </div>
      <div class="hud-tr">
        <div class="hud-gl">✦ <span data-h="gl">0</span></div>
        <div class="hud-shields" data-h="shields"></div>
        <button class="hud-pause" data-act="pause" aria-label="Pause">❚❚</button>
      </div>
      <div class="hud-bottom">
        <div class="lift-label">LIFT</div>
        <div class="lift-bar"><div class="lift-fill" data-h="lift"></div></div>
        <div class="hud-meta"><span data-h="speed">0</span> km/h · alt <span data-h="alt">0</span> m · shrine <span data-h="shrine">-</span></div>
      </div>
      <div class="hud-callouts" data-h="callouts"></div>
      <div class="hud-banner" data-h="banner"><div class="b-title"></div><div class="b-sub"></div></div>
      <div class="hud-low" data-h="low">LOW LIFT — find a ring or updraft!</div>
      <div class="hud-fps" data-h="fps"></div>
      <div class="touch-dive">DIVE</div>
      <div class="touch-stick" data-h="stick"><div data-h="knob"></div></div>`;
    el.querySelectorAll<HTMLElement>('[data-h]').forEach((n) => (this.hud[n.dataset.h!] = n));
  }

  updateHud(s: HudState, stick: { x: number; y: number; dx: number; dy: number } | null, showFps: boolean): void {
    const h = this.hud;
    const L = this.lastHud;
    const d = Math.floor(s.distance);
    if (d !== L.dist) h.dist.textContent = fmt((L.dist = d));
    const sc = Math.round(s.score);
    if (sc !== L.score) h.score.textContent = fmt((L.score = sc));
    if (s.combo !== L.combo || s.multiplier !== L.mult) {
      L.combo = s.combo;
      L.mult = s.multiplier;
      h.combo.textContent = s.combo > 0 ? `${s.combo} chain · x${s.multiplier.toFixed(1)}` : 'x1';
      h.comboWrap.classList.toggle('on', s.combo > 0);
    }
    h.comboBar.style.transform = `scaleX(${s.comboFrac.toFixed(3)})`;
    const g = Math.floor(s.glimmers);
    if (g !== L.gl) h.gl.textContent = fmt((L.gl = g));
    if (s.shields !== L.sh) {
      L.sh = s.shields;
      h.shields.textContent = '✦'.repeat(Math.min(6, s.shields));
    }
    h.lift.style.transform = `scaleX(${Math.max(0, Math.min(1, s.lift)).toFixed(3)})`;
    h.lift.classList.toggle('low', s.lift < 0.2);
    h.low.classList.toggle('on', s.lift < 0.15);
    h.speed.textContent = String(Math.round(s.speed * 3.6));
    h.alt.textContent = String(Math.max(0, Math.round(s.altitude)));
    h.shrine.textContent = s.nextShrine > 0 ? `${Math.round(s.nextShrine)} m` : '—';
    if (h.biome.textContent !== s.biome) h.biome.textContent = s.biome;
    h.fps.textContent = showFps ? `${Math.round(s.fps)} fps` : '';
    if (stick) {
      h.stick.style.display = 'block';
      h.stick.style.left = `${stick.x}px`;
      h.stick.style.top = `${stick.y}px`;
      h.knob.style.transform = `translate(${stick.dx * 40}px, ${-stick.dy * 40}px)`;
    } else h.stick.style.display = 'none';
  }

  /** Floating callout (PERFECT, WHISKER!, ARCH…). `x,y` = screen px (or null for centre). */
  callout(text: string, cls: string, x: number | null = null, y: number | null = null): void {
    const el = document.createElement('div');
    el.className = `callout ${cls}`;
    el.textContent = text;
    if (x !== null && y !== null) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    } else el.classList.add('centre');
    this.hud.callouts.appendChild(el);
    while (this.hud.callouts.childElementCount > 8) this.hud.callouts.firstElementChild?.remove();
    setTimeout(() => el.remove(), 1300);
  }

  banner(title: string, sub: string): void {
    const b = this.hud.banner;
    (b.querySelector('.b-title') as HTMLElement).textContent = title;
    (b.querySelector('.b-sub') as HTMLElement).textContent = sub;
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
  }

  toast(title: string, sub: string): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`;
    this.hud.toasts.appendChild(t);
    setTimeout(() => t.remove(), 3600);
  }

  // ------------------------------------------------------------------ boon pick
  renderBoons(ids: string[], taken: string[]): void {
    const el = this.screens.get('boon')!;
    el.innerHTML = `
      <div class="boon-wrap">
        <div class="boon-title">Wind Shrine</div>
        <div class="boon-sub">the shrine offers a gift — choose one</div>
        <div class="boon-cards">
          ${ids
            .map((id, i) => {
              const b = boonById(id)!;
              const n = taken.filter((x) => x === id).length;
              return `<button class="card boon-card" data-act="boon" data-id="${id}" style="--c:${b.color}">
                <div class="boon-icon">${b.icon}</div><div class="boon-name">${esc(b.name)}${n ? ` <small>${'+'.repeat(n + 1)}</small>` : ''}</div>
                <div class="boon-desc">${esc(b.desc)}</div><div class="boon-key">${i + 1}</div></button>`;
            })
            .join('')}
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ pause
  renderPause(boons: string[]): void {
    const el = this.screens.get('pause')!;
    const list = boons.length ? boons.map((id) => `<span class="chip">${boonById(id)?.icon ?? ''} ${esc(boonById(id)?.name ?? id)}</span>`).join('') : '<span class="muted">no boons yet</span>';
    el.innerHTML = `
      <div class="panel pause-panel">
        <h2>Paused</h2>
        <div class="chips">${list}</div>
        <button class="btn btn-primary" data-act="resume">Resume</button>
        <button class="btn" data-act="settings">Settings</button>
        <button class="btn btn-ghost" data-act="quit">End Flight</button>
      </div>`;
  }

  // ------------------------------------------------------------------ results
  renderResults(r: ResultsView, save: SaveData): void {
    const el = this.screens.get('results')!;
    el.innerHTML = `
      <div class="panel results-panel">
        <div class="res-cause">${esc(r.cause)}</div>
        <div class="res-dist">${fmt(r.distance)}<small> m</small>${r.newBestDistance ? '<span class="badge">new best</span>' : ''}</div>
        <div class="res-score">score ${fmt(r.score)}${r.newBestScore ? ' <span class="badge">record</span>' : ''}${r.daily ? ' <span class="badge daily">daily</span>' : ''}</div>
        <div class="res-grid">
          <div><b>${r.bestCombo}</b><span>best chain</span></div>
          <div><b>${r.rings}</b><span>rings</span></div>
          <div><b>${r.perfects}</b><span>perfect</span></div>
          <div><b>${r.whiskers}</b><span>whiskers</span></div>
          <div><b>${r.arches}</b><span>arches</span></div>
          <div><b>${r.boons.length}</b><span>boons</span></div>
        </div>
        <div class="res-earned">+ ✦ ${fmt(r.earned)} glimmers <small>(now ${fmt(save.glimmers)})</small></div>
        ${r.achievements.length ? `<div class="res-ach">${r.achievements.map((a) => `<div>★ ${esc(a.name)} <small>+${a.reward}</small></div>`).join('')}</div>` : ''}
        <div class="row">
          <button class="btn btn-primary" data-act="again">Fly Again</button>
          <button class="btn" data-act="shop" data-id="upgrades">Upgrades</button>
          <button class="btn btn-ghost" data-act="menu">Menu</button>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------------ shop
  setShopTab(t: 'kites' | 'upgrades'): void {
    this.shopTab = t;
  }

  renderShop(save: SaveData): void {
    const el = this.screens.get('shop')!;
    const stat = (label: string, v: number, lo: number, hi: number): string =>
      `<div class="stat"><span>${label}</span><i><em style="width:${Math.round(((v - lo) / (hi - lo)) * 100)}%"></em></i></div>`;
    const kites = KITES.map((k) => {
      const owned = save.kites.includes(k.id);
      const sel = save.selectedKite === k.id;
      const c = (n: number): string => '#' + n.toString(16).padStart(6, '0');
      const btn = sel
        ? `<button class="btn btn-small" disabled>Flying</button>`
        : owned
          ? `<button class="btn btn-small" data-act="selectKite" data-id="${k.id}">Fly this</button>`
          : `<button class="btn btn-small btn-primary" data-act="buyKite" data-id="${k.id}" ${save.glimmers < k.cost ? 'disabled' : ''}>✦ ${fmt(k.cost)}</button>`;
      return `<div class="card kite-card ${sel ? 'sel' : ''} ${owned ? '' : 'locked'}">
        <div class="kite-swatch" style="background:linear-gradient(135deg, ${c(k.colors[0])} 0 45%, ${c(k.colors[1])} 45% 75%, ${c(k.colors[2])} 75%)"></div>
        <div class="kite-name">${esc(k.name)}</div><div class="kite-blurb">${esc(k.blurb)}</div>
        ${stat('lift', k.lift, 0.7, 1.5)}${stat('speed', k.speed, 0.85, 1.2)}${stat('turn', k.turn, 0.75, 1.2)}${stat('dive', k.dive, 0.8, 1.4)}${stat('magnet', k.magnet, 1, 7)}
        ${btn}</div>`;
    }).join('');
    const ups = UPGRADES.map((u) => {
      const rank = save.meta[u.id] ?? 0;
      const cost = upgradeCost(u, rank);
      const max = !Number.isFinite(cost);
      const pips = Array.from({ length: u.maxRank }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
      return `<div class="card up-card"><div class="up-icon">${u.icon}</div><div class="up-body"><div class="up-name">${esc(u.name)}</div>
        <div class="up-desc">${esc(u.desc)}</div><div class="pips">${pips}</div></div>
        ${max ? '<button class="btn btn-small" disabled>Max</button>' : `<button class="btn btn-small btn-primary" data-act="buyUpgrade" data-id="${u.id}" ${save.glimmers < cost ? 'disabled' : ''}>✦ ${fmt(cost)}</button>`}</div>`;
    }).join('');
    const ach = ACHIEVEMENTS.map((a) => `<div class="ach ${save.achievements.includes(a.id) ? 'on' : ''}" title="${esc(a.desc)}">★ ${esc(a.name)}</div>`).join('');
    el.innerHTML = `
      <div class="panel shop-panel">
        <div class="shop-head"><h2>Workshop</h2><div class="gl big">✦ ${fmt(save.glimmers)}</div></div>
        <div class="tabs"><button class="tab ${this.shopTab === 'kites' ? 'on' : ''}" data-act="tab" data-id="kites">Kites</button><button class="tab ${this.shopTab === 'upgrades' ? 'on' : ''}" data-act="tab" data-id="upgrades">Upgrades</button></div>
        <div class="shop-body">${this.shopTab === 'kites' ? `<div class="kite-grid">${kites}</div>` : `<div class="up-list">${ups}</div><div class="ach-list">${ach}</div>`}</div>
        <button class="btn btn-ghost" data-act="back">Back</button>
      </div>`;
  }

  // ------------------------------------------------------------------ settings
  renderSettings(save: SaveData, from: ScreenId): void {
    this.settingsReturn = from;
    const s = save.settings;
    const el = this.screens.get('settings')!;
    const slider = (k: string, label: string, v: number, min = 0, max = 1, step = 0.05): string =>
      `<label class="set-row"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-setting="${k}"></label>`;
    const tog = (k: string, label: string, v: boolean): string => `<label class="set-row"><span>${label}</span><input type="checkbox" ${v ? 'checked' : ''} data-setting="${k}"></label>`;
    el.innerHTML = `
      <div class="panel settings-panel">
        <h2>Settings</h2>
        ${slider('masterVolume', 'Master volume', s.masterVolume)}
        ${slider('musicVolume', 'Music', s.musicVolume)}
        ${slider('sfxVolume', 'Effects', s.sfxVolume)}
        ${slider('sensitivity', 'Steer sensitivity', s.sensitivity, 0.5, 2, 0.05)}
        <label class="set-row"><span>Quality</span><select data-setting="quality">${['low', 'medium', 'high'].map((q) => `<option ${q === s.quality ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
        ${tog('mouseSteer', 'Mouse steering', s.mouseSteer)}
        ${tog('invertY', 'Invert climb', s.invertY)}
        ${tog('screenShake', 'Screen shake', s.screenShake)}
        ${tog('reducedFlashing', 'Reduce flashing', s.reducedFlashing)}
        ${tog('showFps', 'Show FPS', s.showFps)}
        <button class="btn btn-ghost" data-act="settingsBack">Back</button>
      </div>`;
    el.querySelector('select')?.addEventListener('change', (e) => this.handler('setting', `quality=${(e.target as HTMLSelectElement).value}`));
  }

  get settingsFrom(): ScreenId {
    return this.settingsReturn;
  }
}

export { BOONS };
