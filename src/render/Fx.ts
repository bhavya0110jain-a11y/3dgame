import * as THREE from 'three';
import '@fontsource/lilita-one/400.css';
import { Frame } from './vfx/atlas';
import { ParticleSystem, PF_BOUNCE, PF_FLICKER, PF_GROUND, PF_SOFTFADE, PF_UNSCALED } from './vfx/Particles';
import { GroundFx, GF_UNSCALED, GM_GLOW, GM_RUNE, GM_SHOCK, GM_TELEGRAPH } from './vfx/GroundFx';
import { Lightning, Ribbons, Strips } from './vfx/Strips';
import { Billboards } from './vfx/Billboards';
import { FirePools } from './vfx/FirePools';

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
}

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
.fxt-crit{font-size:30px;color:#ffe04a;-webkit-text-stroke:4px #5a1206;text-shadow:0 3px 0 #5a1206,0 0 18px rgba(255,120,30,.95),0 0 4px #fff3b0}
.fxt-heal{font-size:24px;color:#d2ff7a;-webkit-text-stroke:3px #1d3a0a;text-shadow:0 2px 0 #1d3a0a,0 0 14px rgba(170,255,90,.7)}
.fxt-player{font-size:22px;color:#ff6a6a;-webkit-text-stroke:3px #3a0612;text-shadow:0 2px 0 #3a0612,0 0 12px rgba(255,60,80,.7)}
.fxt-big{font-family:'Cinzel',var(--font-display,serif);font-weight:700;font-size:30px;letter-spacing:.06em;color:#ffe9c4;-webkit-text-stroke:0;text-shadow:0 0 18px #ff8a3c,0 0 42px rgba(255,120,40,.6),0 3px 4px #000}
`;

const LIGHTS = 2;

export class FxManager {
  readonly particles: ParticleSystem;
  readonly ground: GroundFx;
  readonly strips: Strips;
  readonly bolts: Lightning;
  readonly ribbons: Ribbons;
  readonly fire: FirePools;
  private boards: Billboards;
  damageNumbers = true;

  // transient light columns (level-up, boss death): SoA x y z w h color int age life flags
  private cols = new Float32Array(16 * 10);
  private colCount = 0;
  // immediate-mode glows for this frame: x y z size frame color intensity
  private imm = new Float32Array(256 * 7);
  private immCount = 0;
  private immFresh = false;

  // pooled flash lights
  private lights: THREE.PointLight[] = [];
  private lightLife = new Float32Array(LIGHTS);
  private lightMax = new Float32Array(LIGHTS);
  private lightPeak = new Float32Array(LIGHTS);

  private texts: FloatText[] = [];
  private readonly maxTexts = 90;
  private tmp = new THREE.Vector3();
  private lastReal = 0;
  private hitBudget = 0;
  private lastHitSource = '';
  private time = 0;

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private uiLayer: HTMLElement) {
    this.particles = new ParticleSystem(scene, 4000);
    this.ground = new GroundFx(scene, 160);
    this.strips = new Strips(scene, 6000);
    this.bolts = new Lightning(96);
    this.ribbons = new Ribbons(32);
    this.fire = new FirePools(scene, 48);
    this.boards = new Billboards(scene, 256 + 16, 23);
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

  /** Floating damage number / announcement (pooled DOM, pop + bounce animation, styled per class). */
  text(x: number, y: number, z: number, str: string, cls = ''): void {
    if (!this.damageNumbers && cls !== 'ft-big' && cls !== 'ft-heal') return;
    let key = cls;
    if (key === '' && this.lastHitSource) key = this.lastHitSource;
    this.lastHitSource = '';
    const style = TEXT_STYLES[key] ?? TEXT_STYLES[''];
    let t: FloatText | undefined;
    for (const c of this.texts) if (!c.active) { t = c; break; }
    if (!t) {
      if (this.texts.length < this.maxTexts) {
        const el = document.createElement('div');
        this.uiLayer.appendChild(el);
        t = { el, x: 0, y: 0, z: 0, vx: 0, vy: 0, age: 0, life: 1, pop: 1, active: false };
        this.texts.push(t);
      } else {
        // recycle the oldest non-announcement
        let best = -1;
        for (const c of this.texts) if (c.life < 2 && c.age > best) { best = c.age; t = c; }
        if (!t) return;
      }
    }
    t.active = true;
    if (t.el.className !== style[0]) t.el.className = style[0];
    t.el.textContent = key === 'ft-crit' ? `${str}!` : str;
    t.el.style.display = '';
    t.x = x + (this.r() - 0.5) * 0.5;
    t.y = y;
    t.z = z;
    t.vx = (this.r() - 0.5) * 1.6;
    t.vy = style[3];
    t.age = 0;
    t.life = style[1];
    t.pop = style[2];
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
    if (crit || this.hitBudget > 16) ps.emit(ix, y, iz, 0, 0, 0, crit ? 0.14 : 0.08, crit ? 1.1 : 0.6, crit ? 2.0 : 1.0, 0xffffff, color, crit ? 2.4 : 1.5, crit ? Frame.BURST : Frame.FLARE, 1, 0, 0, 0, 0, this.r() * 6.28);
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
      this.ground.add(GM_SHOCK, x, z, 0.3 * scale, 1.7 * scale, 0.26, 0xffd04a, 1.6, 0.1);
      ps.emit(ix, y + 0.2, iz, 0, 0, 0, 0.22, 0.5, 1.8, 0xfff6c0, 0xffb030, 2.2, Frame.STAR, 1, 0, 0, 0, 0, this.r() * 0.6, 0);
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
    const room = 1 - ps.pressure * 0.75;
    // core flash
    ps.emit(x, y, z, 0, 0, 0, 0.14 * Math.sqrt(k), 0.9 * scale, 2.0 * scale, 0xffffff, color, 2.2, Frame.CORE, 1);
    // ground light splash (fake light)
    this.ground.add(GM_GLOW, x, z, 1.2 * scale, 2.0 * scale * Math.sqrt(k), 0.28 * Math.sqrt(k), color, 0.5);
    this.ground.add(GM_SHOCK, x, z, 0.3 * scale, 1.6 * scale * Math.sqrt(k), 0.3, color, 1.4, 0.1 * scale);
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
    const flakes = Math.ceil(3 * k * room);
    for (let i = 0; i < flakes; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 1.5 + this.r() * 3;
      ps.emit(x, y, z, Math.cos(a) * sp, 3 + this.r() * 3, Math.sin(a) * sp, 0.9 + this.r() * 0.5, 0.16 * scale, 0.1 * scale, 0x2a2430, 0x141018, 1, Frame.FLAKE, 0, -12, 0.8, 0, PF_BOUNCE, this.r() * 6, (this.r() - 0.5) * 14, 0, 0.02);
    }
    if (tier >= 1) {
      this.light(x, y + 0.6, z, color, tier === 2 ? 70 : 35, tier === 2 ? 18 : 9, tier === 2 ? 1.4 : 0.45);
      ps.emit(x, y, z, 0, 0, 0, 0.26, 1.2 * scale, 3.5 * scale, 0xffffff, color, 2, Frame.FLARE, 1);
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
      ps.emit(ex, 1.5, ez, 0, 0, 0, 0.22, 1, 2.8, 0xffffff, color, 2, Frame.BURST, 1, 0, 0, 0, 0, this.r() * 6, 0, delay);
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
  telegraph(x: number, z: number, radius: number, duration: number, color = 0xb04dff): void {
    this.ground.add(GM_TELEGRAPH, x, z, radius, radius, duration, color, 3.2, Math.max(0.1, radius * 0.04));
  }

  /** Flare Nova: crisp shockwave + inner heat band + blinding flash + rising sparks + radial ground sparks. */
  shockwave(x: number, z: number, radius: number, color = 0xffd27a): void {
    const ps = this.particles;
    this.ground.add(GM_SHOCK, x, z, 0.4, radius, 0.42, color, 2.2, Math.max(0.16, radius * 0.05));
    this.ground.add(GM_SHOCK, x, z, 0.2, radius * 0.75, 0.32, 0xffffff, 1.2, 0.1, 0.04);
    this.ground.add(GM_GLOW, x, z, radius * 0.5, radius * 0.9, 0.3, color, 0.35);
    ps.emit(x, 1.2, z, 0, 0, 0, 0.12, 1.2, radius * 0.45, 0xffffff, color, 1.3, Frame.CORE, 1);
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
    this.light(x, 1.5, z, color, 22, radius * 2.2, 0.3);
  }

  /** Level-up: radiant column of light, rune circle, shockwave and rising stars. Animates on real time (game is paused). */
  levelUp(x: number, z: number): void {
    const ps = this.particles;
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
    ps.emit(x, 1.3, z, 0, 0, 0, 0.35, 1.5, 4.5, 0xffffff, 0xffc04a, 1.6, Frame.FLARE, 1, 0, 0, 0, PF_UNSCALED);
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
    ps.emit(bx, by, bz, 0, 0, 0, 0.1, 0.5, 1.3, 0xffffff, color, 1.8, Frame.FLARE, 1, 0, 0, 0, 0, this.r() * 6);
    for (let i = 0; i < 4; i++) {
      const a = this.r() * Math.PI * 2;
      const sp = 4 + this.r() * 6;
      ps.emit(bx, by, bz, Math.cos(a) * sp, 2 + this.r() * 4, Math.sin(a) * sp, 0.2 + this.r() * 0.15, 0.1, 0.04, 0xffffff, color, 2.6, Frame.STREAK, 1, -10, 2, 0.04);
    }
    this.ground.add(GM_GLOW, bx, bz, 0.9, 1.3, 0.2, color, 0.5);
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
    this.particles.emit(x, y, z, 0, 0, 0, 0.12, size * 0.4, size * 0.8, 0xffffff, color, intensity * 0.6, Frame.CORE, 1);
    this.ground.add(GM_GLOW, x, z, size * 0.5, size * 0.8, 0.22, color, 0.5);
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
  glow(x: number, y: number, z: number, size: number, color: number, intensity = 2, frame: number = Frame.GLOW): void {
    if (this.immFresh) {
      this.immCount = 0;
      this.immFresh = false;
    }
    if (this.immCount >= 256) return;
    const o = this.immCount++ * 7;
    const m = this.imm;
    m[o] = x; m[o + 1] = y; m[o + 2] = z; m[o + 3] = size; m[o + 4] = frame; m[o + 5] = color; m[o + 6] = intensity;
  }

  /** Transient vertical light shaft. flags: PF_UNSCALED to animate during pause. */
  column(x: number, y: number, z: number, width: number, height: number, color: number, intensity: number, life: number, flags = 0): void {
    if (this.colCount >= 16) return;
    const o = this.colCount++ * 10;
    const c = this.cols;
    c[o] = x; c[o + 1] = y; c[o + 2] = z; c[o + 3] = width; c[o + 4] = height; c[o + 5] = color; c[o + 6] = intensity; c[o + 7] = 0; c[o + 8] = life; c[o + 9] = flags;
  }

  /** Brief real point-light flash from a small pool (steals the most-faded light). */
  light(x: number, y: number, z: number, color: number, intensity: number, distance: number, duration: number): void {
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

  // ======================================================================== frame
  update(dt: number): void {
    const now = performance.now();
    const realDt = this.lastReal ? Math.min(0.05, (now - this.lastReal) / 1000) : 0;
    this.lastReal = now;
    this.time += realDt;
    this.hitBudget = 28;
    // no glow() call since the last simulated frame → the owners stopped drawing: drop the stale set
    if (dt > 0 && this.immFresh) this.immCount = 0;

    this.fire.update(dt, this.particles);
    this.particles.update(dt, realDt);
    this.ground.update(dt, realDt);

    this.strips.begin(this.camera);
    this.bolts.update(dt, this.strips);
    this.ribbons.update(dt, this.strips);
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
      b.column(c[o], c[o + 1], c[o + 2], c[o + 3] * (0.6 + 0.5 * grow), c[o + 4] * (0.3 + 0.7 * grow), c[o + 5], c[o + 6], env);
      i++;
    }
    const m = this.imm;
    for (let j = 0; j < this.immCount; j++) {
      const o = j * 7;
      b.add(m[o], m[o + 1], m[o + 2], m[o + 3], m[o + 4], m[o + 5], m[o + 6]);
    }
    b.end();
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
  }

  private updateTexts(dt: number): void {
    if (this.texts.length === 0) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const t of this.texts) {
      if (!t.active) continue;
      t.age += dt;
      if (t.age >= t.life) {
        t.active = false;
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
      t.el.style.opacity = left < 0.25 ? (left * 4).toFixed(2) : '1';
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
  }
}

export { PF_GROUND };
