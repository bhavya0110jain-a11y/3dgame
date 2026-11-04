import * as THREE from 'three';
import '@fontsource/lilita-one/400.css';
import { Frame } from './vfx/atlas';
import { ParticleSystem, PF_BOUNCE, PF_FLICKER, PF_GROUND, PF_SOFTFADE, PF_UNSCALED } from './vfx/Particles';
import { GroundFx, GF_UNSCALED, GM_GLOW, GM_RUNE, GM_SHOCK, GM_TELEGRAPH } from './vfx/GroundFx';
import { Lightning, Ribbons, Strips } from './vfx/Strips';
import { Billboards } from './vfx/Billboards';
import { FirePools } from './vfx/FirePools';
import { setFocusPoint } from './vfx/focus';
import { damageNumbersMode, type DamageNumbersSetting } from './vfx/damageNumbers';

/**
 * FxManager — every transient visual effect in the game ("moonlit storybook" VFX). Draw calls, total:
 *   particles (1) + ground decals (1) + strips: lightning & ribbon trails (1) + billboards: glows & light
 *   columns (1) + fire pools (1) = 5, regardless of how much is going on.
 * Budgets: 4000 particles (emitters throttle by `pressure`), 160 ground decals, 96 bolts, 32 ribbons,
 * 48 fire pools, 2 pooled flash point-lights, 90 DOM damage numbers. No per-frame allocations.
 *
 * Legacy API (kept): burst, spark, ring, text, update, clear, damageNumbers.
 * Gameplay-facing additions: hit, enemyDeath, telegraph, shockwave, levelUp, lightning, firePool, flash,
 * glow (immediate, this frame), muzzle, frostPuff, streak, ribbons.
 */

interface FloatText {
  el: HTMLDivElement;
  x: number; y: number; z: number;
  vx: number; vy: number;
  age: number; life: number;
  pop: number;
  active: boolean;
  /** Damage number (merge-able, counts toward NUM_CAP) vs. callout text. */
  dmg: boolean;
  crit: boolean;
  /** Running total shown (merged hits) and seconds since it first appeared (merge window). */
  value: number;
  since: number;
  /** Bumped every time the slot is reused, so stale merge handles are rejected. */
  serial: number;
  /** Base opacity (non-crit numbers are drawn at 80%). */
  alpha: number;
  /** Index in the pool (merge handle). */
  idx: number;
}

/** Damage numbers: hits on one enemy within NUM_MERGE seconds add up in one number; at most NUM_CAP numbers are on
 *  screen (non-crits are dropped first). Non-crits draw at NUM_SMALL scale and NUM_ALPHA opacity. */
export const NUM_MERGE = 0.25;
export const NUM_CAP = 24;
export const NUM_SMALL = 0.7;
export const NUM_ALPHA = 0.8;
/** Seconds (real time) before another level-up pillar may start; matches the gold column's life. */
const LEVELUP_GAP = 1.8;
/** World banners ('ft-big'): one at a time, under the dawn bar, BANNER_TIME seconds each. */
export const BANNER_TIME = 1.2;
const BANNER_QUEUE = 4;

/** Text style per damage-number class: [cssClass, life, popScale, rise]. */
const TEXT_STYLES: Record<string, [string, number, number, number]> = {
  '': ['fxt', 0.75, 1.3, 2.6],
  'ft-crit': ['fxt fxt-crit', 0.95, 1.85, 3.4],
  'ft-blue': ['fxt fxt-blue', 0.75, 1.35, 2.6],
  'ft-fire': ['fxt fxt-fire', 0.75, 1.3, 2.6],
  'ft-frost': ['fxt fxt-frost', 0.75, 1.3, 2.6],
  'ft-light': ['fxt fxt-light', 0.75, 1.3, 2.6],
  'ft-heal': ['fxt fxt-heal', 1.1, 1.5, 2.2],
  'ft-big': ['fxt fxt-big', 2.4, 1.25, 0.9],
  'ft-player': ['fxt fxt-player', 0.9, 1.5, 2.4],
};

const SS_0: readonly [number, string] = [0xffa040, 'ft-fire'];
const SS_1: readonly [number, string] = [0xff8a2a, 'ft-fire'];
const SS_2: readonly [number, string] = [0xffe08a, 'ft-light'];
const SS_3: readonly [number, string] = [0xb0e4ff, 'ft-blue'];
const SS_4: readonly [number, string] = [0xb8f0ff, 'ft-frost'];
const SS_5: readonly [number, string] = [0xc8b0ff, ''];
const SS_6: readonly [number, string] = [0xff7a2a, 'ft-fire'];
const SS_7: readonly [number, string] = [0xff5a1a, 'ft-fire'];
const SS_8: readonly [number, string] = [0xfff0b0, 'ft-light'];
const SS_9: readonly [number, string] = [0x9ad8ff, 'ft-blue'];
const SS_10: readonly [number, string] = [0x9ae8ff, 'ft-frost'];
const SS_11: readonly [number, string] = [0xffd8a0, ''];
/** Hit spark colour + damage-number class per damage source (weapon id). */
function sourceStyle(source: string | undefined): readonly [number, string] {
  switch (source) {
    case 'ember_bolt':
    case 'sunspear_volley': return SS_0;
    case 'solar_crown':
    case 'pyre_garden': return SS_1;
    case 'dawnbreak':
    case 'beacon_ray':
    case 'vesper_bell':
    case 'cathedral_toll':
    case 'lantern_hook':
    case 'moth_lantern': return SS_2;
    case 'tempest_choir':
    case 'gloam_beam': return SS_3;
    case 'glacier_heart': return SS_4;
    case 'moonhook_reaper':
    case 'lunar_monarchs':
    case 'eclipse_beam': return SS_5;
    case 'cinder_halo': return SS_6;
    case 'brazier': return SS_7;
    case 'flare_nova': return SS_2;
    case 'wick_lance': return SS_8;
    case 'spark_chain': return SS_9;
    case 'frost_shards': return SS_10;
    default: return SS_11;
  }
}

const FX_CSS = `
.fx-layer{pointer-events:none}
.fxt{position:absolute;left:0;top:0;pointer-events:none;font-family:'Lilita One','Fredoka',system-ui,sans-serif;font-weight:400;font-size:19px;line-height:1;letter-spacing:.02em;color:#fff7e6;white-space:nowrap;will-change:transform,opacity;-webkit-text-stroke:3px #24122e;paint-order:stroke fill;text-shadow:0 2px 0 #24122e,0 0 10px rgba(255,190,110,.35);contain:layout style}
.fxt-fire{color:#ffd08a;text-shadow:0 2px 0 #3a1206,0 0 10px rgba(255,120,40,.55);-webkit-text-stroke-color:#3a1206}
.fxt-light{color:#fff2b8;text-shadow:0 2px 0 #3a2a06,0 0 12px rgba(255,220,120,.6);-webkit-text-stroke-color:#3a2606}
.fxt-blue{color:#c4f0ff;text-shadow:0 2px 0 #0c2448,0 0 12px rgba(110,200,255,.8);-webkit-text-stroke-color:#0c2448}
.fxt-frost{color:#dcfbff;text-shadow:0 2px 0 #0d3346,0 0 12px rgba(140,230,255,.75);-webkit-text-stroke-color:#0d3346}
.fxt-crit{font-size:26px;color:#fffdf7;-webkit-text-stroke:4px #c4570e;text-shadow:0 3px 0 #3a1004,0 0 6px rgba(20,8,30,.85)}
.fxt-heal{font-size:24px;color:#d2ff7a;-webkit-text-stroke:3px #1d3a0a;text-shadow:0 2px 0 #1d3a0a,0 0 14px rgba(170,255,90,.7)}
.fxt-player{font-size:22px;color:#ff6a6a;-webkit-text-stroke:3px #3a0612;text-shadow:0 2px 0 #3a0612,0 0 12px rgba(255,60,80,.7)}
.fxt-big{font-family:'Cinzel',var(--font-display,serif);font-weight:700;font-size:30px;letter-spacing:.06em;color:#ffe9c4;-webkit-text-stroke:0;text-shadow:0 0 18px #ff8a3c,0 0 42px rgba(255,120,40,.6),0 3px 4px #000}
.fx-banner{position:absolute;left:50%;top:22%;transform:translate(-50%,-50%);pointer-events:none;white-space:nowrap;font-family:'Cinzel',var(--font-display,serif);font-weight:700;font-size:27px;letter-spacing:.06em;color:#ffe9c4;text-shadow:0 0 14px rgba(255,138,60,.75),0 0 30px rgba(255,120,40,.4),0 2px 4px #000;opacity:0;will-change:opacity,transform}
`;

const LIGHTS = 2;
/** Immediate-mode sprite stride: x y z size frame color intensity rot kind alpha (kind: 0 glow, 1 ground, 2 column). */
const IMM_F = 10;
const IMM_MAX = 768;
const IK_GLOW = 0, IK_GROUND = 1, IK_COLUMN = 2;
/** Immediate-mode strip header: n w0 w1 color intensity a0 a1 core, then n xyz points. */
const IS_H = 8;
const IS_CAP = 16384;

/**
 * Brightness governor (art review s2 #3.1). load = Σ layer energy / layer reference; gain falls linearly from 1 at
 * load GOV_KNEE to GAIN_FLOOR at GOV_KNEE + GOV_RANGE. References ≈ what one busy-but-readable mid-game frame emits.
 */
export const GAIN_FLOOR = 0.3;
export const GOV_KNEE = 2.5;
export const GOV_RANGE = 5.0;
const GOV_PARTICLES = 220;
const GOV_GROUND = 120;
const GOV_IMM = 60;
const GOV_STRIPS = 40;
const GOV_FIRE = 12;
/** Dawnbreak sunrise ring: max visible width (m). */
export const DAWN_RING = 1.2;

export class FxManager {
  readonly particles: ParticleSystem;
  readonly ground: GroundFx;
  readonly strips: Strips;
  readonly bolts: Lightning;
  readonly ribbons: Ribbons;
  readonly fire: FirePools;
  private boards: Billboards;
  /** Damage-number setting from the save: legacy boolean or 'all' | 'crits' | 'off' (crit filtering is the caller's). */
  damageNumbers: DamageNumbersSetting = true;

  // transient light columns (level-up, boss death): SoA x y z w h color int age life flags
  private cols = new Float32Array(16 * 10);
  private colCount = 0;
  // immediate-mode sprites (glows, ground sprites, light shafts) for this frame — see IMM_F
  private imm = new Float32Array(IMM_MAX * IMM_F);
  private immCount = 0;
  private immFresh = false;
  private immEnergy = 0;
  // immediate-mode strips (beams, tethers) for this frame — see IS_H
  private immS = new Float32Array(IS_CAP);
  private immSLen = 0;
  /** Scratch polyline for helpers that build strips (tethers, beams). */
  private poly = new Float32Array(16 * 3);

  /**
   * Accessibility: dims every flash/strobe (core flashes, crit bursts, point-light pops, light columns, lightning
   * flicker). Set by the game from save.settings.reducedFlashing; also follows the `a11y-noflash` class on <html>
   * that ui/prefs.applyUiPrefs toggles, so it works without extra wiring.
   */
  reducedFlashing = false;
  /** 1 normally, ~0.35 with reduced flashing: multiplier for flash intensity. */
  private flashK = 1;
  private flashCheck = 0;
  /** Current brightness-governor gain (1 = calm, GAIN_FLOOR = screen full of light). */
  private gain = 1;
  /** Governor input last frame: normalised additive light on screen (0 calm, ≥1 saturated). */
  private load = 0;
  private critBudget = 0;
  private deathBudget = 0;
  private tollT = -1;
  private tollX = 0;
  private tollZ = 0;
  /** Player position (set every simulated frame via setFocus) — big effects keep their brightest parts off the player. */
  private fx0 = 0;
  private fz0 = 0;

  // pooled flash lights
  private lights: THREE.PointLight[] = [];
  private lightLife = new Float32Array(LIGHTS);
  private lightMax = new Float32Array(LIGHTS);
  private lightPeak = new Float32Array(LIGHTS);

  private texts: FloatText[] = [];
  private readonly maxTexts = 90;
  private textSerial = 0;
  private activeNums = 0;
  /**
   * When set (Game wires it to the UI announcer), `banner()` forwards here instead of drawing its own DOM banner,
   * so there is a single announcement queue (BUG-QA-023).
   */
  bannerSink: ((s: string) => void) | null = null;
  private bannerEl: HTMLDivElement | null = null;
  private bannerQ: string[] = [];
  private bannerT = -1;
  private tmp = new THREE.Vector3();
  private lastReal = 0;
  private hitBudget = 0;
  private lastHitSource = '';
  private time = 0;
  /** Real time of the last level-up pillar (see levelUp). */
  private levelUpAt = -1e9;
  /** Last Pyre Garden pool drawn on the bearer (time, position) — see pyreBloom. */
  private pyreT = -1e9;
  /** Simulated (scaled) time, advanced by update(dt). */
  private simTime = 0;
  private pyreX = 0;
  private pyreZ = 0;

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private uiLayer: HTMLElement) {
    this.particles = new ParticleSystem(scene, 4000);
    this.ground = new GroundFx(scene, 160);
    this.strips = new Strips(scene, 12000);
    this.bolts = new Lightning(160);
    this.ribbons = new Ribbons(64);
    this.fire = new FirePools(scene, 48);
    this.boards = new Billboards(scene, IMM_MAX + 16, 23, true);
    for (let i = 0; i < LIGHTS; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 1.6);
      l.castShadow = false;
      l.name = `fx-flash-light-${i}`;
      scene.add(l);
      this.lights.push(l);
    }
    if (typeof document !== 'undefined' && !document.getElementById('fx-styles')) {
      const st = document.createElement('style');
      st.id = 'fx-styles';
      st.textContent = FX_CSS;
      document.head.appendChild(st);
    }
  }

  private r(): number {
    return this.particles.rand();
  }

  // ======================================================================== legacy API
  /** Radial burst of glowing sparks (dark colours become alpha smoke puffs instead). */
  burst(x: number, y: number, z: number, color: number, count: number, speed = 4, life = 0.6, size = 0.35, gravity = -4): void {
    const ps = this.particles;
    const lum = ((color >> 16) & 255) * 0.3 + ((color >> 8) & 255) * 0.59 + (color & 255) * 0.11;
    const n = Math.ceil(count * (1 - ps.pressure * 0.7));
    if (lum < 40) {
      for (let i = 0; i < n; i++) {
        const a = this.r() * Math.PI * 2;
        const s = speed * (0.2 + this.r() * 0.5);
        ps.emit(x, y, z, Math.cos(a) * s, 0.6 + this.r(), Math.sin(a) * s, life * (0.8 + this.r() * 0.6), size * 1.5, size * 4, 0x3a3346, 0x15121c, 1, this.r() < 0.5 ? Frame.SMOKE : Frame.SMOKE2, 0, 0.4, 1.5, 0, PF_SOFTFADE, this.r() * 6, (this.r() - 0.5) * 2, 0, 0.15);
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      const a = this.r() * Math.PI * 2;
      const e = (this.r() - 0.35) * Math.PI * 0.8;
      const s = speed * (0.4 + this.r() * 0.8);
      const vx = Math.cos(a) * Math.cos(e) * s, vy = Math.abs(Math.sin(e)) * s + 1, vz = Math.sin(a) * Math.cos(e) * s;
      const l = life * (0.6 + this.r() * 0.6);
      if (i % 3 === 2) {
        ps.emit(x, y, z, vx * 0.5, vy * 0.5, vz * 0.5, l, size * 2.2, size * 0.6, color, color, 1.6, Frame.GLOW, 1, gravity * 0.3, 2.5);
      } else {
        ps.emit(x, y, z, vx, vy, vz, l, size * 0.7, size * 0.25, 0xfff4d8, color, 3, Frame.STREAK, 1, gravity * 2, 1.8, 0.045, PF_BOUNCE, 0, 0, 0, 0);
      }
    }
  }

  /** Single drifting ember/spark (slightly velocity-stretched). */
  spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life = 0.5, size = 0.3): void {
    const ps = this.particles;
    if (ps.pressure > 0.85 && this.r() < 0.6) return;
    ps.emit(x, y, z, vx, vy, vz, life, size, size * 0.3, 0xfff0c8, color, 2.6, Frame.GLOW, 1, 0, 0.5, 0.03);
  }

  /** Expanding shockwave ring on the ground (analytic, crisp at any size). */
  ring(x: number, z: number, color: number, from: number, to: number, life = 0.4): void {
    this.ground.add(GM_SHOCK, x, z, from, to, life, color, 2.2, Math.max(0.12, to * 0.045));
  }

  /**
   * Floating callout / damage number (pooled DOM, pop + bounce animation, styled per class). 'ft-big' announcements
   * become screen banners (one at a time, under the dawn bar — never over the bearer). Damage numbers from enemy hits
   * should use damageNumber()/addToNumber() so they merge and respect the on-screen cap.
   */
  text(x: number, y: number, z: number, str: string, cls = ''): void {
    if (cls === 'ft-big') {
      this.banner(str);
      return;
    }
    if (damageNumbersMode(this.damageNumbers) === 'off' && cls !== 'ft-heal') return;
    let key = cls;
    if (key === '' && this.lastHitSource) key = this.lastHitSource;
    this.lastHitSource = '';
    this.spawnText(x, y, z, key === 'ft-crit' ? `${str}!` : str, key, false, false);
  }

  /**
   * Damage number for a hit worth `amount`. Returns the slot to pass to addToNumber() for hits that follow within
   * NUM_MERGE seconds, or -1 when the number was dropped (cap reached by crits / numbers off).
   */
  damageNumber(x: number, y: number, z: number, amount: number, cls = ''): number {
    if (damageNumbersMode(this.damageNumbers) === 'off') return -1;
    let key = cls;
    if (key === '' && this.lastHitSource) key = this.lastHitSource;
    this.lastHitSource = '';
    const crit = key === 'ft-crit';
    const t = this.spawnText(x, y, z, crit ? `${Math.round(amount)}!` : `${Math.round(amount)}`, key, true, crit);
    if (!t) return -1;
    t.value = amount;
    return t.idx;
  }

  /** Serial of a text slot (pair it with the slot so a recycled slot is never merged into). */
  numberSerial(slot: number): number {
    return this.texts[slot]?.serial ?? 0;
  }

  /** Adds a hit to a live damage number (see damageNumber). False when the slot is stale or its window has closed. */
  addToNumber(slot: number, serial: number, amount: number, crit: boolean): boolean {
    if (slot < 0) return false;
    const t = this.texts[slot];
    if (!t || !t.active || !t.dmg || t.serial !== serial || t.since > NUM_MERGE) return false;
    this.lastHitSource = '';
    t.value += amount;
    if (crit && !t.crit) {
      t.crit = true;
      const st = TEXT_STYLES['ft-crit'];
      t.el.className = st[0];
      t.life = Math.max(t.life, st[1]);
      t.pop = st[2];
      t.alpha = 1;
    }
    t.el.textContent = t.crit ? `${Math.round(t.value)}!` : `${Math.round(t.value)}`;
    // small re-pop so the growing total reads, without extending the number's life much
    if (t.age > 0.12) t.age = 0.12;
    return true;
  }

  private spawnText(x: number, y: number, z: number, str: string, key: string, dmg: boolean, crit: boolean): FloatText | null {
    const style = TEXT_STYLES[key] ?? TEXT_STYLES[''];
    let t: FloatText | undefined;
    if (dmg && this.activeNums >= NUM_CAP) {
      // cap reached: a non-crit is dropped; a crit replaces the oldest non-crit (or the oldest crit)
      if (!crit) return null;
      let best = -1;
      for (const c of this.texts) if (c.active && c.dmg && !c.crit && c.since > best) { best = c.since; t = c; }
      if (!t) for (const c of this.texts) if (c.active && c.dmg && c.since > best) { best = c.since; t = c; }
      if (!t) return null;
      this.activeNums--;
    }
    if (!t) for (const c of this.texts) if (!c.active) { t = c; break; }
    if (!t) {
      if (this.texts.length < this.maxTexts) {
        const el = document.createElement('div');
        this.uiLayer.appendChild(el);
        t = { el, x: 0, y: 0, z: 0, vx: 0, vy: 0, age: 0, life: 1, pop: 1, active: false, dmg: false, crit: false, value: 0, since: 0, serial: 0, alpha: 1, idx: this.texts.length };
        this.texts.push(t);
      } else {
        // recycle the oldest
        let best = -1;
        for (const c of this.texts) if (c.age > best) { best = c.age; t = c; }
        if (!t) return null;
        if (t.dmg) this.activeNums--;
      }
    }
    t.active = true;
    t.dmg = dmg;
    t.crit = crit;
    t.serial = ++this.textSerial;
    t.since = 0;
    t.value = 0;
    if (dmg) this.activeNums++;
    if (t.el.className !== style[0]) t.el.className = style[0];
    t.el.textContent = str;
    t.el.style.display = '';
    t.x = x + (this.r() - 0.5) * 0.5;
    t.y = y;
    t.z = z;
    t.vx = (this.r() - 0.5) * 1.6;
    t.vy = style[3];
    t.age = 0;
    t.life = style[1];
    const small = dmg && !crit;
    t.pop = style[2] * (small ? NUM_SMALL : 1);
    t.alpha = small ? NUM_ALPHA : 1;
    return t;
  }

  /** Queues a world announcement banner (deduplicated; one shown at a time). */
  banner(str: string): void {
    if (this.bannerSink) {
      this.bannerSink(str);
      return;
    }
    if (typeof document === 'undefined') return;
    const q = this.bannerQ;
    if (q[q.length - 1] === str || (this.bannerT >= 0 && this.bannerEl?.textContent === str && q.length === 0)) return;
    if (q.length >= BANNER_QUEUE) q.shift();
    q.push(str);
  }

  private updateBanner(realDt: number): void {
    if (this.bannerT < 0 && this.bannerQ.length === 0) return;
    if (!this.bannerEl) {
      const el = document.createElement('div');
      el.className = 'fx-banner';
      this.uiLayer.appendChild(el);
      this.bannerEl = el;
    }
    const el = this.bannerEl;
    if (this.bannerT < 0) {
      el.textContent = this.bannerQ.shift() ?? '';
      this.bannerT = 0;
    }
    this.bannerT += realDt;
    const t = this.bannerT;
    if (t >= BANNER_TIME) {
      this.bannerT = -1;
      el.style.opacity = '0';
      return;
    }
    const a = Math.min(1, t / 0.15, (BANNER_TIME - t) / 0.3);
    el.style.opacity = a.toFixed(2);
    el.style.transform = `translate(-50%,-50%) scale(${(1 + 0.12 * Math.max(0, 1 - t / 0.2)).toFixed(3)})`;
  }

  // ======================================================================== combat feedback
  /**
   * Impact on an enemy: sparks spray along the hit direction (dirX/dirZ = from source towards target),
   * a hot flash, and for crits a big starburst + ring. Throttled per frame for mass hits.
   */
  hit(x: number, y: number, z: number, dirX: number, dirZ: number, source?: string, crit = false, scale = 1): void {
    const [color, textCls] = sourceStyle(source);
    this.lastHitSource = textCls;
    const ps = this.particles;
    this.hitBudget--;
    const cheap = this.hitBudget < 0 || ps.pressure > 0.8;
    const dl = Math.hypot(dirX, dirZ);
    let dx = 0, dz = 0;
    if (dl > 1e-4) { dx = dirX / dl; dz = dirZ / dl; } else { const a = this.r() * 6.28; dx = Math.cos(a); dz = Math.sin(a); }
    // impact point on the side of the body facing the attacker
    const ix = x - dx * 0.35 * scale, iz = z - dz * 0.35 * scale;
    // only a handful of crits per frame get the full starburst (a Dawnbreak pulse can crit dozens at once)
    if (crit && this.critBudget-- <= 0) crit = false;
    if (crit || this.hitBudget > 20) ps.emit(ix, y, iz, 0, 0, 0, crit ? 0.14 : 0.08, crit ? 1.1 : 0.6, crit ? 2.0 : 1.0, 0xffffff, color, (crit ? 2.0 : 1.3) * this.flashK, crit ? Frame.BURST : Frame.FLARE, 1, 0, 0, 0, 0, this.r() * 6.28);
    if (cheap && !crit) return;
    const n = crit ? 12 : 4;
    for (let i = 0; i < n; i++) {
      // cone around the hit direction (sparks fly through/away from the impact)
      const spread = (this.r() - 0.5) * (crit ? 2.4 : 1.6);
      const c = Math.cos(spread), s = Math.sin(spread);
      const sx = dx * c - dz * s, sz = dx * s + dz * c;
      const sp = 6 + this.r() * (crit ? 10 : 7);
      ps.emit(ix, y, iz, sx * sp, 1.5 + this.r() * 4, sz * sp, 0.18 + this.r() * 0.16, 0.16, 0.06, 0xffffff, color, 3.2, Frame.STREAK, 1, -18, 2.5, 0.04, PF_BOUNCE);
    }
    if (crit) {
      this.ground.add(GM_SHOCK, x, z, 0.3 * scale, 1.7 * scale, 0.26, 0xfff0d8, 1.3, 0.1);
      ps.emit(ix, y + 0.2, iz, 0, 0, 0, 0.22, 0.5, 1.8, 0xffffff, 0xffc890, 1.8 * this.flashK, Frame.STAR, 1, 0, 0, 0, 0, this.r() * 0.6, 0);
    }
  }

  /**
   * Enemy death: colour-matched spark burst, soul wisps, ash smoke + falling flakes, ground light splash.
   * tier 0 = normal, 1 = elite (bigger, real light flash, ring), 2 = boss (staged multi-second spectacle).
   */
  enemyDeath(x: number, z: number, scale: number, color: number, tier = 0): void {
    const ps = this.particles;
    const y = 0.8 * scale;
    const k = tier === 2 ? 5 : tier === 1 ? 2.2 : 1;
    // mass kills (a pulse clearing a pack): past the per-frame budget a death is just smoke, ash and a soul wisp,
    // so 60 simultaneous deaths don't stack 60 core flashes + ground splashes into a white disc
    if (tier === 0 && this.deathBudget-- <= 0) {
      ps.emit(x, y, z, 0, 0, 0, 0.1, 0.5 * scale, 1.1 * scale, 0xfff0e0, color, 0.8 * this.flashK, Frame.CORE, 1);
      ps.emit(x, y, z, (this.r() - 0.5) * 0.6, 2.2, (this.r() - 0.5) * 0.6, 0.9, 0.6 * scale, 1.0 * scale, color, 0x6a4aff, 1.0, Frame.WISP, 1, 0.6, 0.8, 0, PF_FLICKER, 0, 0, 0, 0.15);
      if (ps.pressure < 0.8) ps.emit(x, y * 0.8, z, 0, 0.8, 0, 0.8, 0.7 * scale, 1.8 * scale, 0x4a4060, 0x1c1826, 1, Frame.SMOKE, 0, 0.3, 1.6, 0, PF_SOFTFADE, this.r() * 6.28, 0, 0, 0.12);
      return;
    }
    const room = 1 - ps.pressure * 0.75;
    // core flash
    ps.emit(x, y, z, 0, 0, 0, 0.14 * Math.sqrt(k), 0.9 * scale, 2.0 * scale, 0xffffff, color, 1.8 * this.flashK, Frame.CORE, 1);
    // ground light splash (fake light) — a ring, plus a soft pool only for elites / bosses
    if (tier > 0) this.ground.add(GM_GLOW, x, z, 1.2 * scale, 2.0 * scale * Math.sqrt(k), 0.28 * Math.sqrt(k), color, 0.45);
    this.ground.add(GM_SHOCK, x, z, 0.3 * scale, 1.6 * scale * Math.sqrt(k), 0.3, color, 1.2, 0.1 * scale);
    // spark burst
    const sparks = Math.ceil(10 * k * room);
    for (let i = 0; i < sparks; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = (4 + this.r() * 6) * Math.sqrt(scale) * (tier === 2 ? 2 : 1);
      ps.emit(x, y, z, Math.cos(a) * sp, 2 + this.r() * 5, Math.sin(a) * sp, 0.35 + this.r() * 0.35, 0.22, 0.08, 0xffffff, color, 3, Frame.STREAK, 1, -14, 1.6, 0.05, PF_BOUNCE);
    }
    // glowing motes that hang a moment
    const motes = Math.ceil(4 * k * room);
    for (let i = 0; i < motes; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 1 + this.r() * 2.5;
      ps.emit(x, y, z, Math.cos(a) * sp, 0.5 + this.r() * 2, Math.sin(a) * sp, 0.6 + this.r() * 0.6, 0.3 * scale, 0.05, color, color, 1.8, Frame.GLOW, 1, 1.2, 1.8);
    }
    // soul wisps rising
    const wisps = tier === 0 ? 1 : Math.ceil(3 * k);
    for (let i = 0; i < wisps; i++) {
      ps.emit(x + (this.r() - 0.5) * 0.4 * scale, y, z + (this.r() - 0.5) * 0.4 * scale, (this.r() - 0.5) * 0.6, 2.2 + this.r() * 1.5, (this.r() - 0.5) * 0.6, 0.9 + this.r() * 0.4, 0.7 * scale, 1.2 * scale, color, 0x6a4aff, 1.2, Frame.WISP, 1, 0.6, 0.8, 0, PF_FLICKER, (this.r() - 0.5) * 0.5, 0, 0, 0.15);
    }
    // ash smoke (alpha) + flakes
    const puffs = Math.ceil(3 * k * room);
    for (let i = 0; i < puffs; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 0.6 + this.r() * 1.4;
      ps.emit(x + Math.cos(a) * 0.2, y * 0.8, z + Math.sin(a) * 0.2, Math.cos(a) * sp, 0.7 + this.r() * 0.8, Math.sin(a) * sp, 0.7 + this.r() * 0.5, 0.7 * scale, 1.9 * scale, 0x4a4060, 0x1c1826, 1, this.r() < 0.5 ? Frame.SMOKE : Frame.SMOKE2, 0, 0.3, 1.6, 0, PF_SOFTFADE, this.r() * 6.28, (this.r() - 0.5) * 2, 0, 0.12);
    }
    // ash flakes: none when the field is busy (hundreds of near-black slivers read as static), lifted colours
    const flakes = ps.pressure > 0.5 ? 0 : Math.ceil(2 * k * room);
    for (let i = 0; i < flakes; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 1.5 + this.r() * 3;
      ps.emit(x, y, z, Math.cos(a) * sp, 3 + this.r() * 3, Math.sin(a) * sp, 0.9 + this.r() * 0.5, 0.16 * scale, 0.1 * scale, 0x5a4c6a, 0x2e2838, 1, Frame.FLAKE, 0, -12, 0.8, 0, PF_BOUNCE, this.r() * 6, (this.r() - 0.5) * 14, 0, 0.02);
    }
    if (tier >= 1) {
      this.light(x, y + 0.6, z, color, tier === 2 ? 70 : 35, tier === 2 ? 18 : 9, tier === 2 ? 1.4 : 0.45);
      ps.emit(x, y, z, 0, 0, 0, 0.26, 1.2 * scale, 3.5 * scale, 0xffffff, color, 2 * this.flashK, Frame.FLARE, 1);
      this.ground.add(GM_SHOCK, x, z, 0.5, 3.5 * scale * (tier === 2 ? 2 : 1), 0.55, color, 1.8, 0.25);
    }
    if (tier === 2) this.bossDeath(x, z, scale, color);
  }

  private bossDeath(x: number, z: number, scale: number, color: number): void {
    const ps = this.particles;
    // a pillar of the boss's light tearing upward, then golden victory light
    this.column(x, 0, z, 3.6, 30, color, 1.8, 2.2, 0);
    this.column(x, 0, z, 1.4, 34, 0xffe2a0, 2.2, 2.6, 0);
    // staged shockwaves
    for (let i = 0; i < 4; i++) this.ground.add(GM_SHOCK, x, z, 1, 8 + i * 4, 0.9 + i * 0.2, i % 2 ? 0xffd27a : color, 1.8, 0.35, i * 0.25);
    this.ground.add(GM_GLOW, x, z, 3, 6, 1.6, color, 0.6);
    this.ground.add(GM_RUNE, x, z, 2, 6, 2.2, 0xffd27a, 1.3, 0.14);
    // rolling secondary eruptions around the corpse over ~1.4 s
    for (let i = 0; i < 14; i++) {
      const a = this.r() * Math.PI * 2;
      const rr = this.r() * 2.5 * scale * 0.5;
      const ex = x + Math.cos(a) * rr, ez = z + Math.sin(a) * rr;
      const delay = 0.1 + i * 0.1;
      ps.emit(ex, 1.5, ez, 0, 0, 0, 0.22, 1, 2.8, 0xffffff, color, 2 * this.flashK, Frame.BURST, 1, 0, 0, 0, 0, this.r() * 6, 0, delay);
      for (let j = 0; j < 12; j++) {
        const b = this.r() * Math.PI * 2;
        const sp = 6 + this.r() * 10;
        ps.emit(ex, 1.5, ez, Math.cos(b) * sp, 4 + this.r() * 8, Math.sin(b) * sp, 0.6 + this.r() * 0.5, 0.26, 0.08, 0xffffff, j % 3 ? color : 0xffd27a, 2.6, Frame.STREAK, 1, -14, 1.2, 0.05, PF_BOUNCE, 0, 0, delay);
      }
    }
    // fountain of golden embers that drift down for a while
    for (let i = 0; i < 120; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 2 + this.r() * 6;
      ps.emit(x, 2, z, Math.cos(a) * sp, 8 + this.r() * 10, Math.sin(a) * sp, 2 + this.r() * 1.5, 0.26, 0.1, 0xfff0b0, 0xff9a3a, 2.4, Frame.GLOW, 1, -6, 0.9, 0.02, PF_FLICKER, 0, 0, 0.3 + this.r() * 0.8);
    }
    // huge smoke collapse
    for (let i = 0; i < 26; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 1 + this.r() * 4;
      ps.emit(x, 1 + this.r() * 2, z, Math.cos(a) * sp, 0.5 + this.r() * 2, Math.sin(a) * sp, 1.6 + this.r(), 2, 6, 0x3a3150, 0x120f18, 1, i & 1 ? Frame.SMOKE : Frame.SMOKE2, 0, 0.2, 0.8, 0, PF_SOFTFADE, this.r() * 6, (this.r() - 0.5), 0.15, 0.15);
    }
    this.light(x, 3, z, 0xffd27a, 70, 22, 2.4);
  }

  /** Danger-zone telegraph that fills over `duration` seconds then flashes. For gameplay (boss slams etc). */
  telegraph(x: number, z: number, radius: number, duration: number, color = 0xb04dff, intensity = 3.2): void {
    this.ground.add(GM_TELEGRAPH, x, z, radius, radius, duration, color, intensity, Math.max(0.1, radius * 0.04));
  }

  /**
   * Player-weapon target mark (Vesper Bell etc.): a thin golden sigil ring that draws itself over `duration`.
   * Deliberately NOT the danger telegraph — players learn that the dark pulsing zone means "move", so their own
   * weapons must never borrow it — and with no fill, so stacked marks never wash a pack out to white.
   */
  markZone(x: number, z: number, radius: number, duration: number, color = 0xffd27a): void {
    this.ground.add(GM_SHOCK, x, z, radius * 0.25, radius, duration, color, 1.2, Math.max(0.08, radius * 0.03));
  }

  /** Flare Nova: crisp shockwave + inner heat band + blinding flash + rising sparks + radial ground sparks. */
  shockwave(x: number, z: number, radius: number, color = 0xffd27a): void {
    const ps = this.particles;
    // AoE reads as rings (no disc fill): a crisp wavefront and a thinner white echo inside it
    this.ground.add(GM_SHOCK, x, z, 0.4, radius, 0.42, color, 2.0, Math.min(0.5, Math.max(0.16, radius * 0.05)));
    this.ground.add(GM_SHOCK, x, z, 0.2, radius * 0.75, 0.32, 0xffffff, 1.0, 0.1, 0.04);
    // core flash: small and capped so a huge pulse never whites out the player standing in its centre
    ps.emit(x, 1.2, z, 0, 0, 0, 0.1, 0.8, Math.min(1.4, radius * 0.3), 0xffffff, color, 0.8 * this.flashK, Frame.CORE, 1);
    const n = Math.ceil(40 * (1 - ps.pressure * 0.7));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.r() * 0.15;
      const sp = radius * (2.4 + this.r() * 0.8);
      ps.emit(x + Math.cos(a) * 0.5, 0.35, z + Math.sin(a) * 0.5, Math.cos(a) * sp, 0.6 + this.r(), Math.sin(a) * sp, 0.32, 0.3, 0.1, 0xffffff, color, 3, Frame.STREAK, 1, 0, 5, 0.035);
    }
    for (let i = 0; i < n * 0.6; i++) {
      const a = this.r() * Math.PI * 2;
      const rr = this.r() * radius;
      ps.emit(x + Math.cos(a) * rr, 0.2, z + Math.sin(a) * rr, 0, 2.5 + this.r() * 3, 0, 0.6 + this.r() * 0.4, 0.22, 0.06, 0xfff4d0, color, 2.8, Frame.GLOW, 1, 1, 1, 0.04, PF_FLICKER, 0, 0, this.r() * 0.15);
    }
    this.light(x, 1.5, z, color, 10, radius * 1.8, 0.25);
  }

  /** Level-up: radiant column of light, rune circle, shockwave and rising stars. Animates on real time (game is paused). */
  levelUp(x: number, z: number): void {
    const ps = this.particles;
    // chained level-ups (several levels from one gem burst) must not stack pillars on the bearer: one at a time
    if (this.time - this.levelUpAt < LEVELUP_GAP) return;
    this.levelUpAt = this.time;
    this.column(x, 0, z, 3.2, 16, 0xffd27a, 2.4, 1.8, PF_UNSCALED);
    this.column(x, 0, z, 1.2, 18, 0xffffff, 2.5, 1.5, PF_UNSCALED);
    this.ground.add(GM_RUNE, x, z, 0.8, 3.4, 1.8, 0xffd27a, 2.2, 0.12, 0, GF_UNSCALED);
    this.ground.add(GM_SHOCK, x, z, 0.5, 8, 0.7, 0xffe2a0, 2.6, 0.35, 0, GF_UNSCALED);
    this.ground.add(GM_GLOW, x, z, 2.5, 4, 1.6, 0xffb040, 0.7, 0, 0, GF_UNSCALED);
    for (let i = 0; i < 46; i++) {
      const a = this.r() * Math.PI * 2;
      const rr = 0.4 + this.r() * 1.6;
      const fr = i % 3 === 0 ? Frame.STAR : Frame.SPARKLE;
      ps.emit(x + Math.cos(a) * rr, 0.3 + this.r() * 0.6, z + Math.sin(a) * rr, Math.cos(a) * 0.4, 3 + this.r() * 5, Math.sin(a) * 0.4, 1.1 + this.r() * 0.8, fr === Frame.STAR ? 0.7 : 0.4, 0.15, 0xffffff, 0xffc04a, 3, fr, 1, -1, 0.6, 0, PF_UNSCALED | PF_FLICKER, this.r() * 6, (this.r() - 0.5) * 3, this.r() * 0.4);
    }
    ps.emit(x, 1.3, z, 0, 0, 0, 0.35, 1.5, 4.5, 0xffffff, 0xffc04a, 1.6 * this.flashK, Frame.FLARE, 1, 0, 0, 0, PF_UNSCALED);
    this.light(x, 2, z, 0xffd27a, 45, 12, 0.9);
  }

  /** Jagged flickering lightning between two points, with impact flare and occasional side forks. */
  lightning(ax: number, ay: number, az: number, bx: number, by: number, bz: number, color = 0x9ad8ff, width = 0.28, life = 0.24): void {
    this.bolts.add(ax, ay, az, bx, by, bz, color, width, life);
    const len = Math.hypot(bx - ax, bz - az);
    // side forks
    const forks = len > 2.5 ? 1 + (this.r() < 0.5 ? 1 : 0) : this.r() < 0.4 ? 1 : 0;
    for (let i = 0; i < forks; i++) {
      const t = 0.25 + this.r() * 0.5;
      const fx = ax + (bx - ax) * t, fy = ay + (by - ay) * t, fz = az + (bz - az) * t;
      const a = Math.atan2(bz - az, bx - ax) + (this.r() < 0.5 ? -1 : 1) * (0.5 + this.r() * 0.7);
      const fl = 0.8 + this.r() * 1.4;
      this.bolts.add(fx, fy, fz, fx + Math.cos(a) * fl, fy - 0.3 - this.r() * 0.5, fz + Math.sin(a) * fl, color, width * 0.5, life * 0.7, 0.18);
    }
    const ps = this.particles;
    ps.emit(bx, by, bz, 0, 0, 0, 0.1, 0.5, 1.3, 0xffffff, color, 1.8 * this.flashK, Frame.FLARE, 1, 0, 0, 0, 0, this.r() * 6);
    for (let i = 0; i < 4; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 4 + this.r() * 6;
      ps.emit(bx, by, bz, Math.cos(a) * sp, 2 + this.r() * 4, Math.sin(a) * sp, 0.2 + this.r() * 0.15, 0.1, 0.04, 0xffffff, color, 2.6, Frame.STREAK, 1, -10, 2, 0.04);
    }
    this.ground.add(GM_GLOW, bx, bz, 0.7, 1.0, 0.2, color, 0.3);
  }

  /** Animated fire pool (visual only) — see vfx/FirePools. */
  firePool(x: number, z: number, radius: number, life: number): void {
    this.fire.add(x, z, radius, life);
    const ps = this.particles;
    // ignition whoosh
    this.ground.add(GM_SHOCK, x, z, radius * 0.3, radius * 1.25, 0.3, 0xff7a2a, 2.2, 0.18);
    ps.emit(x, 0.6, z, 0, 0, 0, 0.18, radius * 0.6, radius * 1.6, 0xffe0a0, 0xff5a1a, 1.3, Frame.CORE, 1);
    for (let i = 0; i < 14; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 2 + this.r() * 4;
      ps.emit(x, 0.4, z, Math.cos(a) * sp, 3 + this.r() * 4, Math.sin(a) * sp, 0.4 + this.r() * 0.3, 0.7, 0.2, 0xffe08a, 0xff3a0a, 2.6, Frame.FLAME, 1, -4, 2, 0, PF_FLICKER, this.r() - 0.5);
    }
  }

  /** Bright flash sprite + ground splash (+ optional real light). */
  flash(x: number, y: number, z: number, color: number, size = 2, intensity = 3, withLight = false): void {
    this.particles.emit(x, y, z, 0, 0, 0, 0.12, size * 0.4, size * 0.8, 0xffffff, color, intensity * 0.6 * this.flashK, Frame.CORE, 1);
    this.ground.add(GM_GLOW, x, z, size * 0.5, size * 0.8, 0.22, color, 0.35);
    if (withLight) this.light(x, y + 0.5, z, color, 30, size * 4, 0.25);
  }

  /** Small directional muzzle flash (weapon fire). */
  muzzle(x: number, y: number, z: number, dirX: number, dirZ: number, color: number, size = 1): void {
    const ps = this.particles;
    if (ps.pressure > 0.9) return;
    ps.emit(x, y, z, dirX * 2, 0, dirZ * 2, 0.08, 0.5 * size, 1.1 * size, 0xffffff, color, 1.8, Frame.CORE, 1);
    for (let i = 0; i < 3; i++) {
      const s = (this.r() - 0.5) * 0.9;
      const c = Math.cos(s), sn = Math.sin(s);
      const vx = dirX * c - dirZ * sn, vz = dirX * sn + dirZ * c;
      const sp = 5 + this.r() * 5;
      ps.emit(x, y, z, vx * sp, 0.5 + this.r(), vz * sp, 0.12 + this.r() * 0.08, 0.14, 0.05, 0xffffff, color, 3, Frame.STREAK, 1, -6, 3, 0.04);
    }
  }

  /** Frost puff: soft icy smoke + sparkles. */
  frostPuff(x: number, y: number, z: number, n = 4, size = 0.6): void {
    const ps = this.particles;
    const k = Math.ceil(n * (1 - ps.pressure * 0.7));
    for (let i = 0; i < k; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 0.6 + this.r() * 1.6;
      ps.emit(x, y, z, Math.cos(a) * sp, 0.3 + this.r() * 0.6, Math.sin(a) * sp, 0.45 + this.r() * 0.35, size * 0.8, size * 2, 0xbfeeff, 0x4a9cff, 0.55, Frame.FROST, 0.55, 0, 2.2, 0, PF_SOFTFADE, this.r() * 6, (this.r() - 0.5) * 2, 0, 0.1);
      if (i & 1) ps.emit(x, y, z, Math.cos(a) * sp * 2, 1 + this.r() * 2, Math.sin(a) * sp * 2, 0.4 + this.r() * 0.3, 0.26, 0.08, 0xffffff, 0x9ae8ff, 2.4, Frame.SPARKLE, 1, -3, 1.5, 0, PF_FLICKER, this.r() * 6);
    }
  }

  /** Orbiting fire orb (Cinder Halo): layered glow + white-hot core + flame licks peeling off upward. Call every frame. */
  fireOrb(x: number, y: number, z: number, scale: number, dt: number, color = 0xff6a2a): void {
    const flick = 0.9 + 0.2 * this.r();
    this.glow(x, y, z, 2.1 * scale * flick, color, 0.75);
    this.glow(x, y + 0.15 * scale, z, 1.25 * scale, 0xff8a2a, 1.6, Frame.FLAME);
    this.glow(x, y, z, 0.75 * scale, 0xffd890, 2.4, Frame.CORE);
    const ps = this.particles;
    if (dt > 0 && this.r() < 50 * dt * (1 - ps.pressure)) {
      ps.emit(x + (this.r() - 0.5) * 0.2, y + 0.1, z + (this.r() - 0.5) * 0.2, (this.r() - 0.5) * 0.6, 1.4 + this.r() * 1.2, (this.r() - 0.5) * 0.6, 0.28 + this.r() * 0.15, 0.6 * scale, 0.15, 0xffe0a0, 0xff3a0a, 2.6, Frame.FLAME, 1, 1, 1, 0, PF_FLICKER, (this.r() - 0.5) * 0.5);
    }
    if (dt > 0 && this.r() < 18 * dt) ps.emit(x, y, z, (this.r() - 0.5) * 3, 1 + this.r() * 2, (this.r() - 0.5) * 3, 0.5, 0.12, 0.04, 0xfff0b0, color, 3.5, Frame.DOT, 1, -4, 1, 0.04);
  }

  /** Motion streak (magnetised pickups etc). */
  streak(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, size = 0.18, life = 0.18): void {
    this.particles.emit(x, y, z, vx * 0.1, vy * 0.1, vz * 0.1, life, size, size * 0.4, 0xffffff, color, 2.6, Frame.STREAK, 1, 0, 0, 0.22);
  }

  /**
   * Immediate-mode glow sprite drawn THIS frame only (orbiting orbs, beacons). Persists while paused.
   * frame defaults to GLOW; intensity >1 blooms.
   */
  glow(x: number, y: number, z: number, size: number, color: number, intensity = 2, frame: number = Frame.GLOW, rot = 0, alpha = 1): void {
    this.pushImm(IK_GLOW, x, y, z, size, frame, color, intensity, rot, alpha);
  }

  /** Immediate-mode atlas sprite lying flat on the ground (this frame only). */
  groundGlow(x: number, z: number, size: number, color: number, intensity = 1, frame: number = Frame.GLOW, rot = 0, alpha = 1, y = 0.06): void {
    this.pushImm(IK_GROUND, x, y, z, size, frame, color, intensity, rot, alpha);
  }

  /** Immediate-mode vertical light shaft standing on (x, y, z) (this frame only). */
  shaft(x: number, y: number, z: number, width: number, height: number, color: number, intensity: number, alpha = 1): void {
    this.pushImm(IK_COLUMN, x, y, z, width, 0, color, intensity * this.flashK, height, alpha);
  }

  private beginImm(): void {
    if (this.immFresh) {
      this.immCount = 0;
      this.immSLen = 0;
      this.immFresh = false;
    }
  }

  private pushImm(kind: number, x: number, y: number, z: number, size: number, frame: number, color: number, intensity: number, rot: number, alpha: number): void {
    this.beginImm();
    if (this.immCount >= IMM_MAX) return;
    const o = this.immCount++ * IMM_F;
    const m = this.imm;
    m[o] = x; m[o + 1] = y; m[o + 2] = z; m[o + 3] = size; m[o + 4] = frame; m[o + 5] = color; m[o + 6] = intensity;
    m[o + 7] = rot; m[o + 8] = kind; m[o + 9] = alpha;
  }

  /**
   * Immediate-mode glowing polyline (this frame only): `pts` holds n xyz points from `off`. Width/alpha interpolate
   * head → tail; `core` 0..1 is the white-hot centre. Used for beams and tethers.
   */
  polyline(pts: Float32Array, n: number, w0: number, w1: number, color: number, intensity: number, a0: number, a1: number, core: number, off = 0): void {
    this.beginImm();
    if (n < 2 || this.immSLen + IS_H + n * 3 > IS_CAP) return;
    const b = this.immS;
    let o = this.immSLen;
    b[o++] = n; b[o++] = w0; b[o++] = w1; b[o++] = color; b[o++] = intensity; b[o++] = a0; b[o++] = a1; b[o++] = core;
    for (let i = 0; i < n * 3; i++) b[o++] = pts[off + i];
    this.immSLen = o;
  }

  /** Immediate-mode straight beam between two points (this frame only). */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w0: number, w1: number, color: number, intensity: number, a0 = 1, a1 = 0.2, core = 0.8): void {
    const q = this.poly;
    q[0] = ax; q[1] = ay; q[2] = az;
    q[3] = (ax + bx) * 0.5; q[4] = (ay + by) * 0.5; q[5] = (az + bz) * 0.5;
    q[6] = bx; q[7] = by; q[8] = bz;
    this.polyline(q, 3, w0, w1, color, intensity, a0, a1, core);
  }

  /** Player position for this frame (keeps big flashes and flame licks off the hero). */
  setFocus(x: number, z: number): void {
    this.fx0 = x;
    this.fz0 = z;
    this.fire.focusX = x;
    this.fire.focusZ = z;
    setFocusPoint(x, z);
  }

  /** Squared distance from the player (see setFocus). */
  private focusD2(x: number, z: number): number {
    return (x - this.fx0) * (x - this.fx0) + (z - this.fz0) * (z - this.fz0);
  }

  /** Transient vertical light shaft. flags: PF_UNSCALED to animate during pause. */
  column(x: number, y: number, z: number, width: number, height: number, color: number, intensity: number, life: number, flags = 0): void {
    if (this.colCount >= 16) return;
    const o = this.colCount++ * 10;
    const c = this.cols;
    c[o] = x; c[o + 1] = y; c[o + 2] = z; c[o + 3] = width; c[o + 4] = height; c[o + 5] = color; c[o + 6] = intensity * (0.45 + 0.55 * this.flashK); c[o + 7] = 0; c[o + 8] = life; c[o + 9] = flags;
  }

  /** Brief real point-light flash from a small pool (steals the most-faded light). */
  light(x: number, y: number, z: number, color: number, intensity: number, distance: number, duration: number): void {
    intensity *= this.flashK * this.gain;
    let best = 0;
    let bestLeft = Infinity;
    for (let i = 0; i < LIGHTS; i++) {
      const left = this.lightLife[i] / Math.max(1e-3, this.lightMax[i]) * this.lightPeak[i];
      if (left < bestLeft) { bestLeft = left; best = i; }
    }
    if (bestLeft > intensity) return;
    const l = this.lights[best];
    l.position.set(x, y, z);
    l.color.setHex(color);
    l.distance = distance;
    this.lightLife[best] = duration;
    this.lightMax[best] = duration;
    this.lightPeak[best] = intensity;
  }

  // ======================================================================== weapon signatures (Sprint 2)
  // Every weapon gets anticipation (wind-up / tell), impact and afterglow. Evolutions add white-hot cores and golden
  // accents. Immediate-mode helpers (hookHead, hookTether, bellFall, lighthouseBeam, sunOrb, dawnGather) must be
  // called every simulated frame by their owner; the rest are one-shot.

  /**
   * Weapon evolution moment: a white-gold pillar, the reliquary rune, a ring of stars thrown outward and a rising
   * fountain of golden motes. Animates on real time (the reliquary screen pauses the game).
   */
  evolution(x: number, z: number, color = 0xfff0a0): void {
    const ps = this.particles;
    this.column(x, 0, z, 3.4, 22, 0xffd27a, 1.6, 2.0, PF_UNSCALED);
    this.column(x, 0, z, 1.1, 24, 0xffffff, 1.6, 1.6, PF_UNSCALED);
    this.ground.add(GM_RUNE, x, z, 1.2, 4.2, 2.2, 0xffd27a, 2.4, 0.14, 0, GF_UNSCALED);
    this.ground.add(GM_SHOCK, x, z, 0.5, 12, 1.0, color, 2.6, 0.4, 0, GF_UNSCALED);
    this.ground.add(GM_SHOCK, x, z, 0.5, 7, 0.8, 0xffffff, 1.6, 0.2, 0.12, GF_UNSCALED);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ps.emit(x + Math.cos(a) * 0.6, 1.2, z + Math.sin(a) * 0.6, Math.cos(a) * 9, 1.5, Math.sin(a) * 9, 0.7, 0.7, 0.2, 0xffffff, color, 3, Frame.STAR, 1, -2, 2.2, 0, PF_UNSCALED | PF_FLICKER, a, 3);
    }
    for (let i = 0; i < 60; i++) {
      const a = this.r() * Math.PI * 2;
      const rr = 0.3 + this.r() * 1.4;
      ps.emit(x + Math.cos(a) * rr, 0.3, z + Math.sin(a) * rr, Math.cos(a) * 0.5, 4 + this.r() * 7, Math.sin(a) * 0.5, 1.2 + this.r() * 0.8, 0.3, 0.08, 0xfff6d0, 0xffb030, 2.8, i % 4 === 0 ? Frame.STAR : Frame.GLOW, 1, -1.5, 0.5, 0.02, PF_UNSCALED | PF_FLICKER, 0, 0, this.r() * 0.5);
    }
    this.light(x, 2.5, z, 0xffd27a, 50, 16, 1.2);
  }

  /** Lantern Hook head (every frame): a spinning sickle of lamp-light with a hot core and a light pool below. */
  hookHead(x: number, y: number, z: number, spin: number, s: number, evolved: boolean): void {
    const c = evolved ? 0xa47cff : 0xffb43a;
    this.glow(x, y, z, 1.7 * s, c, 0.4);
    this.glow(x, y, z, 1.35 * s, c, 1.5, Frame.WISP, spin);
    this.glow(x, y, z, 1.35 * s, evolved ? 0xd8c8ff : 0xffd890, 1.3, Frame.WISP, spin + Math.PI);
    this.glow(x, y, z, 0.45 * s, 0xfff6e0, 2.2, Frame.CORE);
    if (evolved) this.glow(x, y, z, 1.3 * s, 0xffe08a, 0.9, Frame.STAR, -spin * 0.35);
    this.groundGlow(x, z, 2.4 * s, c, 0.35);
  }

  /** The glowing lamp-chain from the bearer's hand to a hook (every frame). `t` = time, for the chain's sway. */
  hookTether(px: number, pz: number, hx: number, hz: number, t: number, evolved: boolean): void {
    const q = this.poly;
    const n = 9;
    const dx = hx - px, dz = hz - pz;
    const len = Math.hypot(dx, dz) || 1;
    const sx = -dz / len, sz = dx / len;
    const sway = Math.min(0.5, len * 0.05);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const env = Math.sin(f * Math.PI);
      const w = Math.sin(t * 9 + f * 5) * sway * env;
      q[i * 3] = px + dx * f + sx * w;
      q[i * 3 + 1] = 1.25 - 0.25 * f - env * Math.min(0.6, len * 0.06);
      q[i * 3 + 2] = pz + dz * f + sz * w;
    }
    this.polyline(q, n, evolved ? 0.16 : 0.11, evolved ? 0.2 : 0.14, evolved ? 0xb89cff : 0xffb347, 1.25, 0.25, 0.8, 0.75);
  }

  /** Hook thrown: a short directional whoosh from the hand. */
  hookThrow(x: number, z: number, dx: number, dz: number, evolved: boolean): void {
    this.muzzle(x + dx * 0.6, 1.2, z + dz * 0.6, dx, dz, evolved ? 0xc8b0ff : 0xffcf6a, evolved ? 1.3 : 0.9);
  }

  /** Hook bites a shadow: a curved slash of sparks across the travel direction. */
  hookSlash(x: number, z: number, dx: number, dz: number, evolved: boolean): void {
    const ps = this.particles;
    if (ps.pressure > 0.8) return;
    const c = evolved ? 0xc8b0ff : 0xffcf6a;
    const l = Math.hypot(dx, dz) || 1;
    const sx = -dz / l, sz = dx / l;
    for (let i = 0; i < 4; i++) {
      const k = (this.r() - 0.5) * 2;
      const sp = 5 + this.r() * 4;
      ps.emit(x, 0.9, z, (sx * k + dx / l * 0.4) * sp, 1 + this.r() * 2, (sz * k + dz / l * 0.4) * sp, 0.18, 0.2, 0.06, 0xffffff, c, 3, Frame.STREAK, 1, -10, 2, 0.05);
    }
  }

  /** Moths released from the lantern: a puff of glowing wing-dust. */
  mothRelease(x: number, z: number, color: number, evolved: boolean): void {
    const ps = this.particles;
    const n = Math.ceil((evolved ? 10 : 6) * (1 - ps.pressure * 0.7));
    for (let i = 0; i < n; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 1 + this.r() * 2;
      ps.emit(x, 1.5, z, Math.cos(a) * sp, 0.5 + this.r() * 1.5, Math.sin(a) * sp, 0.5 + this.r() * 0.4, 0.22, 0.05, 0xffffff, color, 2.6, Frame.SPARKLE, 1, -1.5, 1.5, 0, PF_FLICKER, this.r() * 6);
    }
    if (evolved) ps.emit(x, 1.6, z, 0, 0.5, 0, 0.3, 0.5, 1.6, 0xfff0c0, 0xffd27a, 1.8 * this.flashK, Frame.STAR, 1, 0, 0, 0, 0, this.r());
  }

  /** A moth splits into a hunting swarm (Lunar Monarchs). */
  mothSplit(x: number, z: number): void {
    const ps = this.particles;
    if (ps.pressure > 0.85) return;
    ps.emit(x, 1.3, z, 0, 0, 0, 0.18, 0.4, 1.4, 0xffffff, 0xffe08a, 2 * this.flashK, Frame.STAR, 1, 0, 0, 0, 0, this.r() * 6);
    for (let i = 0; i < 6; i++) {
      const a = this.r() * Math.PI * 2;
      ps.emit(x, 1.3, z, Math.cos(a) * 3, 1 + this.r() * 2, Math.sin(a) * 3, 0.45, 0.2, 0.05, 0xffffff, 0xa0c8ff, 2.6, Frame.SPARKLE, 1, -2, 2, 0, PF_FLICKER);
    }
  }

  /**
   * Vesper Bell anticipation (every frame while a toll falls; p = 0 → 1): a shaft of light narrows onto the mark
   * while the phantom bell-light drops out of the sky and the ground ring tightens.
   */
  bellFall(x: number, z: number, r: number, p: number, evolved: boolean): void {
    const c = evolved ? 0xfff0a0 : 0xffd27a;
    const e = p * p;
    const big = evolved ? 1.35 : 1;
    const y = 0.9 + (1 - e) * 10;
    const onHero = this.focusD2(x, z) < r * r ? 0.45 : 1;
    this.shaft(x, 0, z, Math.min(1.6, r * 0.45) * (1.2 - 0.6 * p), 15, c, 0.35 + 0.5 * p, (0.18 + 0.3 * p) * onHero);
    this.glow(x, y, z, (1.2 + 0.9 * p) * big, c, 1.1);
    this.glow(x, y, z, 0.6 * big, 0xffffff, 1.8, Frame.CORE);
    this.groundGlow(x, z, r * 2.1 * (1.2 - 0.2 * p), c, 0.25 + 0.5 * p, Frame.RING, p * 2.5);
    if (evolved) this.glow(x, y, z, 1.6 * p, 0xfff4d0, 0.9, Frame.STAR, p * 4);
  }

  /** Vesper Bell impact: shock rings, a bell-sigil afterglow, dust thrown along the ground, motes rising after. */
  bellToll(x: number, z: number, r: number, evolved: boolean, aftershock = false): void {
    const ps = this.particles;
    const c = evolved ? 0xfff0a0 : 0xffd27a;
    // several bells landing on the same pack in the same instant must not stack into a white-out
    const stacked = this.time - this.tollT < 0.2 && (x - this.tollX) ** 2 + (z - this.tollZ) ** 2 < r * r;
    this.tollT = this.time;
    this.tollX = x;
    this.tollZ = z;
    const aft = aftershock || stacked ? 0.5 : 1;
    const near = this.focusD2(x, z) < 6;
    this.ground.add(GM_SHOCK, x, z, 0.3, r * 1.15, 0.4, c, 1.9, Math.max(0.14, r * 0.05));
    this.ground.add(GM_SHOCK, x, z, 0.2, r * 0.7, 0.26, 0xffffff, 1.1, 0.1, 0.05);
    this.ground.add(GM_RUNE, x, z, r * 0.45, r * 0.85, 1.0, c, 0.8 * aft, 0.1);
    if (!stacked) this.ground.add(GM_GLOW, x, z, r * 0.4, r * 0.8, 0.5, c, 0.15);
    ps.emit(x, 0.9, z, 0, 0, 0, 0.14, 0.8, near ? 1.6 : Math.min(2.6, r * 0.6), 0xffffff, c, 1.1 * this.flashK * aft * aft, Frame.BURST, 1, 0, 0, 0, 0, this.r() * 6);
    const room = 1 - ps.pressure * 0.7;
    const n = Math.ceil(22 * aft * room);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.r() * 0.2;
      const sp = r * (2.2 + this.r());
      ps.emit(x + Math.cos(a) * 0.3 * r, 0.25, z + Math.sin(a) * 0.3 * r, Math.cos(a) * sp, 0.8 + this.r(), Math.sin(a) * sp, 0.35, 0.3, 0.1, 0xffffff, c, 2.6, Frame.STREAK, 1, -4, 4, 0.04);
    }
    const puffs = Math.ceil(6 * aft * room);
    for (let i = 0; i < puffs; i++) {
      const a = this.r() * Math.PI * 2;
      ps.emit(x + Math.cos(a) * r * 0.85, 0.35, z + Math.sin(a) * r * 0.85, Math.cos(a) * 1.2, 0.5 + this.r() * 0.6, Math.sin(a) * 1.2, 0.8 + this.r() * 0.3, 0.8, 2.2, 0x5a4a60, 0x201828, 1, this.r() < 0.5 ? Frame.SMOKE : Frame.SMOKE2, 0, 0.2, 1.4, 0, PF_SOFTFADE, this.r() * 6, (this.r() - 0.5) * 1.5, 0, 0.12);
    }
    const motes = Math.ceil(10 * aft * room);
    for (let i = 0; i < motes; i++) {
      const a = this.r() * Math.PI * 2;
      const rr = Math.sqrt(this.r()) * r * 0.8;
      ps.emit(x + Math.cos(a) * rr, 0.2, z + Math.sin(a) * rr, 0, 1.5 + this.r() * 1.5, 0, 0.8 + this.r() * 0.4, 0.22, 0.06, 0xfff4d0, c, 2.8, Frame.GLOW, 1, 0.5, 1, 0.03, PF_FLICKER, 0, 0, 0.12 + this.r() * 0.25);
    }
    if (evolved && !aftershock && !stacked) {
      this.column(x, 0, z, 0.9, 16, 0xfff4c0, 1.4, 0.45);
      ps.emit(x, 1.4, z, 0, 0, 0, 0.26, 0.8, 2.6, 0xffffff, 0xffd27a, 1.4 * this.flashK, Frame.STAR, 1, 0, 0, 0, 0, this.r());
    }
    if (!stacked) this.light(x, 1.5, z, c, evolved ? 10 : 8, r * 2, 0.3);
  }

  /**
   * Lighthouse beam (every frame per beam): soft cone + white-hot core from a lens just outside the bearer, a light
   * pool swept along the ground and a flare where the beam ends. (cx, cz) = unit direction.
   */
  lighthouseBeam(px: number, pz: number, cx: number, cz: number, len: number, w: number, evolved: boolean, t: number): void {
    const c = evolved ? 0xff7ad0 : 0x7ac8ff;
    const hot = evolved ? 0xfff0c0 : 0xe6f6ff;
    // the lens sits 1.4 m out and the beam fades IN along its length (art review s3 #1a): stacked evolved beams
    // must not start at full white on the bearer's chest
    const ax = px + cx * 1.4, az = pz + cz * 1.4;
    const bx = px + cx * len, bz = pz + cz * len;
    this.beam(ax, 1.05, az, bx, 0.75, bz, w * 1.4, w * 4.2, c, 0.75, 0.15, 0.18, 0.12);
    this.beam(ax, 1.05, az, bx, 0.75, bz, w * 0.4, w * 0.9, hot, 1.5, 0.25, 0.1, 0.5);
    for (let k = 1; k <= 3; k++) {
      const f = k / 3.6;
      this.groundGlow(px + cx * len * f, pz + cz * len * f, w * 2.2 + len * f * 0.55, c, 0.2);
    }
    this.glow(ax, 1.05, az, 0.6, hot, 1.1, Frame.CORE);
    this.glow(bx, 0.75, bz, 1.3, c, 1.0, Frame.FLARE, t * 2);
    if (evolved) this.glow(bx, 0.75, bz, 1.1, 0xffe08a, 1.2, Frame.STAR, -t * 3);
  }

  /** Solar Crown orb (every frame): a little sun — golden halo, rotating rays, white-hot core, golden flame licks. */
  sunOrb(x: number, y: number, z: number, s: number, dt: number, spin: number): void {
    this.glow(x, y, z, 1.7 * s, 0xff9a20, 0.45);
    this.glow(x, y, z, 1.6 * s, 0xffe08a, 1.1, Frame.STAR, spin);
    this.glow(x, y, z, 0.7 * s, 0xffffff, 2.2, Frame.CORE);
    const ps = this.particles;
    if (dt > 0 && this.r() < 30 * dt * (1 - ps.pressure)) {
      ps.emit(x + (this.r() - 0.5) * 0.2, y + 0.1, z + (this.r() - 0.5) * 0.2, (this.r() - 0.5) * 0.6, 1.4 + this.r(), (this.r() - 0.5) * 0.6, 0.3, 0.6 * s, 0.15, 0xfff0b0, 0xff7a10, 2.6, Frame.FLAME, 1, 1, 1, 0, PF_FLICKER, (this.r() - 0.5) * 0.5);
    }
  }

  /** Sunspear impact: a golden starburst, shock ring and flame licks. */
  sunBurst(x: number, z: number, r: number): void {
    const ps = this.particles;
    // s3: a volley lands in the contact ring around the bearer every 0.5 s — softer star, no sparks when busy
    this.ground.add(GM_SHOCK, x, z, 0.2, r, 0.24, 0xffe08a, 1.0, 0.12);
    ps.emit(x, 1, z, 0, 0, 0, 0.16, 0.5, Math.min(1.3, r), 0xfff4d8, 0xffd27a, 0.8 * this.flashK, Frame.STAR, 1, 0, 0, 0, 0, this.r() * 6);
    if (ps.pressure > 0.5) return;
    for (let i = 0; i < 6; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 5 + this.r() * 6;
      ps.emit(x, 1, z, Math.cos(a) * sp, 2 + this.r() * 3, Math.sin(a) * sp, 0.28, 0.22, 0.06, 0xffffff, 0xffc04a, 3, Frame.STREAK, 1, -12, 2, 0.05, PF_BOUNCE);
    }
    for (let i = 0; i < 3; i++) ps.emit(x, 0.6, z, (this.r() - 0.5) * 2, 2 + this.r() * 2, (this.r() - 0.5) * 2, 0.35, 0.6, 0.15, 0xfff0b0, 0xff5a10, 2.6, Frame.FLAME, 1, 1, 2, 0, PF_FLICKER, this.r() - 0.5);
  }

  /** Sunspear volley loosed: golden muzzle + a sun-sigil flash at the hand. */
  sunVolley(x: number, z: number, dx: number, dz: number): void {
    this.muzzle(x + dx * 1.2, 1.4, z + dz * 1.2, dx, dz, 0xffe08a, 1.2);
    this.ground.add(GM_SHOCK, x + dx * 1.2, z + dz * 1.2, 0.2, 1.4, 0.2, 0xffd27a, 1.0, 0.08);
  }

  /** Dawnbreak anticipation (every frame in the last ~0.35 s before a pulse; p = 0 → 1): light gathers inward. */
  dawnGather(x: number, z: number, r: number, p: number): void {
    this.groundGlow(x, z, 2 * (r * (1 - p * 0.7) + 0.6), 0xffe0a0, 0.3 + 0.6 * p, Frame.RING, p * 2);
    if (this.flashK < 1) return;
    const ps = this.particles;
    if (this.r() < 0.7 && ps.pressure < 0.85) {
      const a = this.r() * Math.PI * 2;
      const d = r * (0.5 + 0.5 * this.r());
      ps.emit(x + Math.cos(a) * d, 0.3 + this.r() * 0.5, z + Math.sin(a) * d, -Math.cos(a) * d / 0.32, 0.6, -Math.sin(a) * d / 0.32, 0.3, 0.28, 0.12, 0xfff4d0, 0xffc04a, 2.8, Frame.STREAK, 1, 0, 0, 0.03);
    }
  }

  /**
   * Dawnbreak pulse (echo = the softer second pulse). Photosensitivity-safe by construction (art review s2 #3.3):
   * one crisp sunrise ring ≤ DAWN_RING m wide that starts outside the bearer, thin ground sun-ray strokes and a faint
   * lingering rune — no disc fill, no core flash, a small real light. Peak additive inside 3 m stays ≤ ~0.5 (focus
   * protection does the rest). Reduced flashing: the ring only.
   */
  dawnPulse(x: number, z: number, r: number, echo: boolean): void {
    const ps = this.particles;
    const k = echo ? 0.6 : 1;
    const c = echo ? 0xfff0c8 : 0xffd890;
    this.ground.add(GM_SHOCK, x, z, Math.min(2.2, r * 0.3), r, 0.45, c, 1.7 * k, DAWN_RING * 0.35);
    if (this.flashK < 1) return;
    if (!echo) this.ground.add(GM_RUNE, x, z, 1.6, 3.0, 0.8, 0xffd27a, 0.55, 0.08);
    const n = Math.ceil((echo ? 10 : 16) * (1 - ps.pressure * 0.7));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = r * 3.2;
      ps.emit(x + Math.cos(a) * 2.2, 0.25, z + Math.sin(a) * 2.2, Math.cos(a) * sp, 0, Math.sin(a) * sp, 0.28, 0.24, 0.1, 0xfff4d8, 0xffc860, 1.6 * k, Frame.STREAK, 1, 0, 3, 0.08);
    }
    this.light(x, 1.5, z, 0xffd27a, 6 * k, r * 1.5, 0.22);
  }

  /** Tempest Choir: a bolt from the sky onto the first target of a storm. */
  stormStrike(x: number, z: number): void {
    const jx = (this.r() - 0.5) * 3, jz = (this.r() - 0.5) * 3;
    this.lightning(x + jx, 12, z + jz, x, 0.9, z, 0xfff4d0, 0.55, 0.3);
    this.ground.add(GM_SHOCK, x, z, 0.3, 2.6, 0.3, 0xc0e8ff, 2.2, 0.12);
    this.ground.add(GM_GLOW, x, z, 1.0, 2.0, 0.3, 0xc0e8ff, 0.35);
    this.light(x, 2, z, 0xc0e8ff, 16, 8, 0.2);
  }

  /** Stunned by the storm: a couple of sparkles over the target's head. */
  stunSpark(x: number, z: number): void {
    const ps = this.particles;
    if (ps.pressure > 0.75) return;
    ps.emit(x, 1.9, z, (this.r() - 0.5) * 1.5, 0.6, (this.r() - 0.5) * 1.5, 0.45, 0.35, 0.1, 0xffffff, 0xc0e8ff, 2.6, Frame.STAR, 1, -1, 1, 0, PF_FLICKER, this.r() * 6, 4);
  }

  /** Beacon Ray loosed: star flares where each ray leaves the bearer, plus a golden ground ring. */
  beaconFlare(x: number, z: number, a0: number, n: number): void {
    const ps = this.particles;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const fx = x + Math.cos(a) * 1.6, fz = z + Math.sin(a) * 1.6;
      ps.emit(fx, 1.1, fz, Math.cos(a) * 4, 0, Math.sin(a) * 4, 0.16, 0.5, 1.4, 0xfff4d8, 0xffe08a, 1.3 * this.flashK, Frame.STAR, 1, 0, 0, 0, 0, a);
    }
    this.ground.add(GM_SHOCK, x, z, 1.2, 3.2, 0.3, 0xffe8b0, 1.0, 0.1);
  }

  /** Pyre Garden: a fire pool plus a golden garden-sigil around it that burns for its lifetime. */
  pyreBloom(x: number, z: number, r: number, life: number): void {
    // Pyre Garden plants one zone on the bearer every volley and zones outlive the cooldown, so 2–3 fire discs used
    // to stack on her (the brightest thing in the late-game frame). A new pool on top of a still-young one close to
    // the bearer keeps only its faint sigil; the damage zone itself is unchanged.
    const onBearer = this.focusD2(x, z) < 2.25;
    if (onBearer && this.simTime - this.pyreT < life * 0.75 && (x - this.pyreX) ** 2 + (z - this.pyreZ) ** 2 < r * r * 0.36) {
      this.ground.add(GM_RUNE, x, z, r * 0.92, r * 1.02, life * 0.5, 0xffa040, 0.45, 0.05);
      return;
    }
    if (onBearer) {
      this.pyreT = this.simTime;
      this.pyreX = x;
      this.pyreZ = z;
    }
    this.firePool(x, z, r, life);
    this.ground.add(GM_RUNE, x, z, r * 0.92, r * 1.02, life, 0xffa040, onBearer ? 0.6 : 0.9, 0.05);
  }

  /** Standing in your own garden: warm golden motes rise around the bearer's feet. */
  warmth(x: number, z: number): void {
    const ps = this.particles;
    for (let i = 0; i < 3; i++) {
      const a = this.r() * Math.PI * 2;
      ps.emit(x + Math.cos(a) * 0.7, 0.2, z + Math.sin(a) * 0.7, 0, 1.5 + this.r(), 0, 0.7, 0.22, 0.05, 0xfff4d0, 0xffd27a, 2.6, Frame.SPARKLE, 1, 0, 1, 0, PF_FLICKER, this.r() * 6);
    }
  }

  /** Glacier Heart shatter: ice shards burst out of a frozen shadow. */
  shatter(x: number, z: number, r: number): void {
    const ps = this.particles;
    this.ground.add(GM_SHOCK, x, z, 0.2, r, 0.28, 0xa0e8ff, 2.2, 0.12);
    ps.emit(x, 0.9, z, 0, 0, 0, 0.14, 0.6, r * 1.1, 0xffffff, 0xb8f0ff, 2 * this.flashK, Frame.STAR, 1, 0, 0, 0, 0, this.r() * 6);
    this.frostPuff(x, 0.8, z, 4, 0.7);
    if (ps.pressure > 0.8) return;
    for (let i = 0; i < 8; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 4 + this.r() * 5;
      ps.emit(x, 0.9, z, Math.cos(a) * sp, 3 + this.r() * 4, Math.sin(a) * sp, 0.55 + this.r() * 0.3, 0.35, 0.2, 0xffffff, 0x9ae8ff, 2.4, Frame.SHARD, 1, -16, 0.8, 0, PF_BOUNCE, this.r() * 6, (this.r() - 0.5) * 16);
    }
  }

  /** Glacier Heart volley: a frost sigil and icy burst at the bearer's feet. */
  glacierNova(x: number, z: number): void {
    // shock starts 1.2 m out at half strength, faint rune (BUG-QA-029: the volley must not bury the bearer)
    this.ground.add(GM_RUNE, x, z, 1.2, 2.6, 0.55, 0xb8f0ff, 0.6, 0.1);
    this.ground.add(GM_SHOCK, x, z, 1.2, 3.4, 0.35, 0xd8f8ff, 1.0, 0.1);
    this.frostPuff(x, 0.6, z, 4, 0.7);
  }

  // ======================================================================== frame
  update(dt: number): void {
    const now = performance.now();
    const realDt = this.lastReal ? Math.min(0.05, (now - this.lastReal) / 1000) : 0;
    this.lastReal = now;
    this.time += realDt;
    this.simTime += dt;
    this.hitBudget = 28;
    this.critBudget = 6;
    this.deathBudget = 10;
    // no glow() call since the last simulated frame → the owners stopped drawing: drop the stale set
    if (dt > 0 && this.immFresh) {
      this.immCount = 0;
      this.immSLen = 0;
    }
    this.flashCheck -= realDt;
    if (this.flashCheck <= 0) {
      this.flashCheck = 0.5;
      const cls = typeof document !== 'undefined' && document.documentElement.classList.contains('a11y-noflash');
      const reduced = this.reducedFlashing || cls;
      this.flashK = reduced ? 0.35 : 1;
      this.bolts.steady = reduced;
      this.ground.flashEnd = reduced ? 1 : 1.6;
    }

    // brightness governor: when the screen fills with additive light (hundreds of hits, stacked evolutions,
    // beams, rings and pools) every additive layer is scaled down so the scene never washes out to white.
    // Input = last frame's additive energy of every layer (particles, ground decals, fire pools, immediate glows /
    // shafts, strips), each normalised by what a busy-but-readable mid-game frame emits.
    const load =
      this.particles.energy / GOV_PARTICLES +
      this.ground.energy / GOV_GROUND +
      this.immEnergy / GOV_IMM +
      this.strips.energy / GOV_STRIPS +
      this.fire.liveCount / GOV_FIRE;
    this.load = load;
    const gainT = 1 - (1 - GAIN_FLOOR) * Math.min(1, Math.max(0, (load - GOV_KNEE) / GOV_RANGE));
    // falls fast (a burst must not white out the first frames), recovers slowly
    const gdt = Math.max(dt, realDt);
    this.gain += (gainT - this.gain) * Math.min(1, gdt * (gainT < this.gain ? 10 : 2.5));
    this.particles.gain = this.gain;
    this.ground.gain = this.gain;
    this.fire.gain = this.gain;
    this.strips.uniforms.uGain.value = this.gain;
    this.ribbons.gain = this.gain;
    this.fire.update(dt, this.particles);
    this.particles.update(dt, realDt);
    this.ground.update(dt, realDt);

    this.strips.begin(this.camera);
    this.bolts.update(dt, this.strips);
    this.ribbons.update(dt, this.strips);
    const sb = this.immS;
    for (let o = 0; o < this.immSLen; ) {
      const n = sb[o];
      this.strips.strip(sb, n, sb[o + 1], sb[o + 2], sb[o + 3], sb[o + 4], sb[o + 5], sb[o + 6], sb[o + 7], o + IS_H);
      o += IS_H + n * 3;
    }
    this.strips.end();

    // billboards: light columns + immediate glows
    const b = this.boards;
    b.begin(this.time);
    let i = 0;
    while (i < this.colCount) {
      const o = i * 10;
      const c = this.cols;
      c[o + 7] += c[o + 9] & PF_UNSCALED ? realDt : dt;
      const t = c[o + 7] / c[o + 8];
      if (t >= 1) {
        const last = --this.colCount;
        if (i !== last) c.copyWithin(o, last * 10, last * 10 + 10);
        continue;
      }
      // shoots up fast, widens slightly, fades
      const grow = Math.min(1, t * 6);
      const env = Math.min(1, t * 10) * (1 - t) * (1 - t);
      // level-up / evolution pillars stand on the bearer and keep shining after the pause: governed + focus-dimmed
      b.column(c[o], c[o + 1], c[o + 2], c[o + 3] * (0.6 + 0.5 * grow), c[o + 4] * (0.3 + 0.7 * grow), c[o + 5], c[o + 6] * this.gain, env);
      i++;
    }
    const m = this.imm;
    let immE = 0;
    for (let j = 0; j < this.immCount; j++) {
      const o = j * IMM_F;
      const kind = m[o + 8];
      const sz = m[o + 3];
      immE += m[o + 6] * m[o + 9] * (kind === IK_COLUMN ? sz * m[o + 7] * 0.4 : kind === IK_GROUND ? sz * sz * 0.35 : sz * sz);
      const g = m[o + 6] * this.gain;
      if (kind === IK_GLOW) b.add(m[o], m[o + 1], m[o + 2], m[o + 3], m[o + 4], m[o + 5], g, m[o + 9], m[o + 7]);
      else if (kind === IK_GROUND) b.ground(m[o], m[o + 1], m[o + 2], m[o + 3], m[o + 4], m[o + 5], g, m[o + 9], m[o + 7]);
      else b.column(m[o], m[o + 1], m[o + 2], m[o + 3], m[o + 7], m[o + 5], g, m[o + 9]);
    }
    b.end();
    this.immEnergy = immE;
    // glows queued during this sim step are consumed; while paused (dt = 0) keep showing the last set
    if (dt > 0) this.immFresh = true;

    // flash lights
    for (let k = 0; k < LIGHTS; k++) {
      const l = this.lights[k];
      if (this.lightLife[k] > 0) {
        this.lightLife[k] = Math.max(0, this.lightLife[k] - Math.max(dt, realDt * 0.5));
        const f = this.lightLife[k] / this.lightMax[k];
        l.intensity = this.lightPeak[k] * f * f;
      } else if (l.intensity !== 0) l.intensity = 0;
    }

    this.updateTexts(dt);
    this.updateBanner(realDt);
  }

  /** Brightness-governor gain this frame (1 = calm … GAIN_FLOOR = saturated). Renderer can drive bloom with it. */
  get brightness(): number {
    return this.gain;
  }

  /** Governor input (normalised on-screen additive light; ~1 = a busy mid-game frame). */
  get lightLoad(): number {
    return this.load;
  }

  private updateTexts(dt: number): void {
    if (this.texts.length === 0) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const t of this.texts) {
      if (!t.active) continue;
      t.age += dt;
      t.since += dt;
      if (t.age >= t.life) {
        t.active = false;
        if (t.dmg) this.activeNums--;
        t.el.style.display = 'none';
        continue;
      }
      const a = t.age;
      // arc: rise, slow down, drop a little (bounce feel)
      const big = t.life > 2;
      const y = t.y + t.vy * a - (big ? 0 : 3.2 * a * a);
      const x = t.x + t.vx * a * (big ? 0 : 1);
      this.tmp.set(x, y, t.z).project(this.camera);
      if (this.tmp.z > 1) {
        t.el.style.opacity = '0';
        continue;
      }
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (-this.tmp.y * 0.5 + 0.5) * h;
      // pop: 0.3 → overshoot → settle (elastic), shrink at the very end
      let s: number;
      if (a < 0.07) s = 0.3 + (t.pop - 0.3) * (a / 0.07);
      else if (a < 0.22) {
        const k = (a - 0.07) / 0.15;
        s = t.pop + (1 - t.pop) * (1 - Math.cos(k * Math.PI * 1.5) * Math.exp(-k * 3));
      } else s = 1;
      const left = t.life - a;
      if (left < 0.2) s *= 0.7 + 1.5 * left;
      t.el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0) translate(-50%,-50%) scale(${s.toFixed(3)})`;
      t.el.style.opacity = (t.alpha * (left < 0.25 ? left * 4 : 1)).toFixed(2);
    }
  }

  clear(): void {
    this.particles.clear();
    this.ground.clear();
    this.bolts.clear();
    this.ribbons.clear();
    this.fire.clear();
    this.colCount = 0;
    this.immCount = 0;
    this.immSLen = 0;
    this.strips.begin(this.camera);
    this.strips.end();
    this.boards.begin(this.time);
    this.boards.end();
    for (let k = 0; k < LIGHTS; k++) {
      this.lightLife[k] = 0;
      this.lights[k].intensity = 0;
    }
    for (const t of this.texts) {
      t.active = false;
      t.el.style.display = 'none';
    }
    this.activeNums = 0;
    this.bannerQ.length = 0;
    this.bannerT = -1;
    if (this.bannerEl) this.bannerEl.style.opacity = '0';
  }
}

export { PF_GROUND };
