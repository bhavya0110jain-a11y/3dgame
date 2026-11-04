import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EnemyShape } from '../data/enemies';
import { getModel, MODEL_LIST } from '../render/Assets';
import type { Enemy } from './Enemies';

/** Regular (non-boss) enemy GLBs that ship a `<name>_lo` horde LOD (tools/blender/characters/build.py). */
export const ENEMY_LOD_MODELS = ['shade', 'crawler', 'wisp', 'brute', 'stalker', 'spitter', 'bog', 'knight', 'blob', 'bloater', 'warden'];

/** Makes sure the asset loader fetches every enemy GLB this module draws (new shapes + horde LODs). Idempotent;
 *  runs at import, i.e. before main.ts calls loadAssets(). Files missing from the manifest are simply skipped. */
export function registerEnemyModels(list: { enemies: string[] } = MODEL_LIST): void {
  for (const n of ENEMY_LOD_MODELS) {
    if (!list.enemies.includes(n)) list.enemies.push(n);
    if (!list.enemies.includes(n + '_lo')) list.enemies.push(n + '_lo');
  }
}
registerEnemyModels();

const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map(ni));

function eyes(y: number, z: number, spread: number, size: number): THREE.BufferGeometry {
  return merge([
    new THREE.SphereGeometry(size, 6, 4).translate(-spread, y, z),
    new THREE.SphereGeometry(size, 6, 4).translate(spread, y, z),
  ]);
}

export interface EnemyModel {
  body: THREE.BufferGeometry;
  eyes: THREE.BufferGeometry;
  vertexColors: boolean;
}

/** Returns body + eye geometry for a shape. Models face +Z, sit on y=0, unit scale ~1 unit tall. */
export function buildEnemyModel(shape: EnemyShape): EnemyModel {
  const m = getModel(shape);
  if (m && m.body) {
    return { body: m.body, eyes: m.glow ?? new THREE.BufferGeometry(), vertexColors: true };
  }
  return { ...buildProcedural(shape), vertexColors: false };
}

/** Horde LOD (~600-900 triangles incl. a few dozen for the eyes) for a shape, or null when the GLB has none
 *  (bosses, or the full model failed to load: never mix a procedural body with a GLB LOD). */
export function buildEnemyLodModel(shape: EnemyShape): EnemyModel | null {
  if (!getModel(shape)?.body) return null;
  const m = getModel(shape + '_lo');
  if (!m || !m.body) return null;
  return { body: m.body, eyes: m.glow ?? new THREE.BufferGeometry(), vertexColors: true };
}

function buildProcedural(shape: EnemyShape): { body: THREE.BufferGeometry; eyes: THREE.BufferGeometry } {
  switch (shape) {
    case 'shade':
      return {
        body: merge([
          new THREE.ConeGeometry(0.5, 1.3, 7, 1, true).translate(0, 0.65, 0),
          new THREE.SphereGeometry(0.34, 7, 5).translate(0, 1.25, 0),
          new THREE.ConeGeometry(0.12, 0.6, 4).rotateZ(1.1).translate(-0.5, 0.8, 0.1),
          new THREE.ConeGeometry(0.12, 0.6, 4).rotateZ(-1.1).translate(0.5, 0.8, 0.1),
        ]),
        eyes: eyes(1.28, 0.28, 0.11, 0.06),
      };
    case 'crawler': {
      const legs: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 3; i++) {
        const z = -0.25 + i * 0.25;
        legs.push(new THREE.BoxGeometry(1.2, 0.06, 0.06).rotateZ(0.0).translate(0, 0.25, z));
        legs.push(new THREE.BoxGeometry(0.06, 0.3, 0.06).translate(-0.6, 0.12, z));
        legs.push(new THREE.BoxGeometry(0.06, 0.3, 0.06).translate(0.6, 0.12, z));
      }
      return {
        body: merge([
          new THREE.SphereGeometry(0.42, 7, 5).scale(1, 0.55, 1.2).translate(0, 0.35, -0.05),
          new THREE.SphereGeometry(0.24, 6, 4).translate(0, 0.38, 0.45),
          ...legs,
        ]),
        eyes: merge([eyes(0.45, 0.66, 0.08, 0.045), eyes(0.38, 0.68, 0.14, 0.035)]),
      };
    }
    case 'wisp':
      return {
        body: merge([
          new THREE.IcosahedronGeometry(0.32, 0).translate(0, 0.9, 0),
          new THREE.ConeGeometry(0.22, 0.7, 5).rotateX(Math.PI).translate(0, 0.45, -0.1),
        ]),
        eyes: eyes(0.95, 0.26, 0.09, 0.055),
      };
    case 'brute':
      return {
        body: merge([
          new THREE.BoxGeometry(0.9, 0.9, 0.7).translate(0, 0.85, 0),
          new THREE.BoxGeometry(0.5, 0.45, 0.45).translate(0, 1.45, 0.15),
          new THREE.BoxGeometry(0.28, 0.85, 0.28).translate(-0.62, 0.65, 0.1),
          new THREE.BoxGeometry(0.28, 0.85, 0.28).translate(0.62, 0.65, 0.1),
          new THREE.BoxGeometry(0.25, 0.45, 0.25).translate(-0.22, 0.22, 0),
          new THREE.BoxGeometry(0.25, 0.45, 0.25).translate(0.22, 0.22, 0),
          new THREE.ConeGeometry(0.08, 0.3, 4).translate(-0.2, 1.75, 0.15),
          new THREE.ConeGeometry(0.08, 0.3, 4).translate(0.2, 1.75, 0.15),
        ]),
        eyes: eyes(1.5, 0.38, 0.12, 0.06),
      };
    case 'stalker':
      return {
        body: merge([
          new THREE.ConeGeometry(0.35, 1.6, 5).translate(0, 0.8, 0),
          new THREE.ConeGeometry(0.22, 0.6, 4).rotateX(-Math.PI / 2).translate(0, 1.45, 0.3),
          new THREE.BoxGeometry(0.06, 0.9, 0.06).rotateZ(0.6).translate(-0.4, 0.9, 0.2),
          new THREE.BoxGeometry(0.06, 0.9, 0.06).rotateZ(-0.6).translate(0.4, 0.9, 0.2),
        ]),
        eyes: eyes(1.48, 0.45, 0.08, 0.05),
      };
    case 'spitter':
      return {
        body: merge([
          new THREE.SphereGeometry(0.5, 8, 6).scale(1, 0.85, 1).translate(0, 0.55, 0),
          new THREE.CylinderGeometry(0.12, 0.2, 0.4, 6).rotateX(Math.PI / 2).translate(0, 0.7, 0.5),
          new THREE.SphereGeometry(0.15, 5, 4).translate(-0.35, 0.95, -0.1),
          new THREE.SphereGeometry(0.12, 5, 4).translate(0.3, 1.0, -0.2),
        ]),
        eyes: merge([eyes(0.92, 0.36, 0.14, 0.05), eyes(1.02, 0.3, 0.05, 0.04)]),
      };
    case 'bog':
      return {
        body: merge([
          new THREE.SphereGeometry(0.6, 8, 6).scale(1.1, 0.7, 1.2).translate(0, 0.42, 0),
          new THREE.ConeGeometry(0.1, 0.5, 4).translate(-0.3, 0.9, -0.1),
          new THREE.ConeGeometry(0.1, 0.6, 4).translate(0.2, 0.95, -0.25),
          new THREE.ConeGeometry(0.08, 0.4, 4).translate(0.35, 0.8, 0.1),
        ]),
        eyes: merge([eyes(0.62, 0.6, 0.22, 0.06), eyes(0.7, 0.55, 0.08, 0.045)]),
      };
    case 'knight':
      return {
        body: merge([
          new THREE.CylinderGeometry(0.35, 0.45, 1.1, 6).translate(0, 0.75, 0),
          new THREE.BoxGeometry(1.0, 0.25, 0.45).translate(0, 1.25, 0),
          new THREE.CylinderGeometry(0.22, 0.26, 0.45, 6).translate(0, 1.6, 0),
          new THREE.ConeGeometry(0.06, 0.45, 4).translate(0, 2.0, 0),
          new THREE.BoxGeometry(0.08, 1.6, 0.12).translate(0.6, 0.9, 0.3),
          new THREE.BoxGeometry(0.5, 0.7, 0.08).translate(-0.6, 0.85, 0.2),
        ]),
        eyes: merge([new THREE.BoxGeometry(0.28, 0.04, 0.05).translate(0, 1.63, 0.24)]),
      };
    // --- gameplay-agent fallbacks for new behaviours (character artist: replace with GLBs) ---
    case 'blob':
      return {
        body: merge([
          new THREE.SphereGeometry(0.55, 12, 9).scale(1, 0.8, 1).translate(0, 0.45, 0),
          new THREE.SphereGeometry(0.22, 8, 6).translate(-0.28, 0.85, -0.05),
          new THREE.SphereGeometry(0.16, 8, 6).translate(0.3, 0.82, -0.12),
        ]),
        eyes: eyes(0.62, 0.48, 0.16, 0.08),
      };
    case 'bloater':
      return {
        body: merge([
          new THREE.SphereGeometry(0.48, 12, 9).translate(0, 0.62, -0.05),
          new THREE.ConeGeometry(0.12, 0.35, 6).translate(0, 1.18, -0.05),
          new THREE.CylinderGeometry(0.05, 0.05, 0.45, 5).rotateZ(0.9).translate(-0.42, 0.25, 0.15),
          new THREE.CylinderGeometry(0.05, 0.05, 0.45, 5).rotateZ(-0.9).translate(0.42, 0.25, 0.15),
          new THREE.CylinderGeometry(0.05, 0.05, 0.45, 5).rotateZ(0.9).translate(-0.42, 0.25, -0.25),
          new THREE.CylinderGeometry(0.05, 0.05, 0.45, 5).rotateZ(-0.9).translate(0.42, 0.25, -0.25),
        ]),
        eyes: merge([eyes(0.72, 0.42, 0.13, 0.06), new THREE.SphereGeometry(0.09, 6, 4).translate(0, 1.38, -0.05)]),
      };
    case 'warden':
      return {
        body: merge([
          new THREE.CylinderGeometry(0.32, 0.45, 1.2, 8).translate(0, 0.7, 0),
          new THREE.SphereGeometry(0.3, 10, 8).translate(0, 1.48, 0),
          new THREE.CylinderGeometry(0.62, 0.62, 0.1, 14).rotateX(Math.PI / 2).translate(0, 0.85, 0.55),
          new THREE.BoxGeometry(0.08, 1.4, 0.08).translate(0.55, 0.9, 0.1),
        ]),
        eyes: merge([eyes(1.52, 0.26, 0.1, 0.05), new THREE.SphereGeometry(0.12, 8, 6).translate(0, 0.85, 0.62)]),
      };
    case 'stag': {
      const antler = (s: number) =>
        merge([
          new THREE.CylinderGeometry(0.04, 0.06, 0.8, 4).rotateZ(s * 0.5).translate(s * 0.25, 1.95, 0.35),
          new THREE.CylinderGeometry(0.03, 0.04, 0.5, 4).rotateZ(s * -0.3).translate(s * 0.48, 2.3, 0.35),
          new THREE.CylinderGeometry(0.03, 0.04, 0.45, 4).rotateZ(s * 1.1).translate(s * 0.62, 2.15, 0.35),
          new THREE.CylinderGeometry(0.025, 0.035, 0.35, 4).rotateX(0.6).translate(s * 0.4, 2.2, 0.5),
        ]);
      return {
        body: merge([
          new THREE.BoxGeometry(0.6, 0.55, 1.3).translate(0, 1.0, -0.1),
          new THREE.BoxGeometry(0.32, 0.5, 0.32).rotateX(-0.5).translate(0, 1.4, 0.55),
          new THREE.BoxGeometry(0.28, 0.25, 0.5).translate(0, 1.65, 0.75),
          new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(-0.22, 0.38, 0.4),
          new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(0.22, 0.38, 0.4),
          new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(-0.22, 0.38, -0.6),
          new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(0.22, 0.38, -0.6),
          antler(1),
          antler(-1),
        ]),
        eyes: eyes(1.7, 0.95, 0.1, 0.05),
      };
    }
    case 'mire':
      return {
        body: merge([
          new THREE.SphereGeometry(0.7, 9, 7).scale(1.2, 0.8, 1.2).translate(0, 0.6, 0),
          new THREE.SphereGeometry(0.4, 8, 6).translate(0, 1.25, 0.25),
          new THREE.TorusGeometry(0.5, 0.08, 4, 10).rotateX(Math.PI / 2).translate(0, 0.9, 0),
          new THREE.ConeGeometry(0.08, 0.6, 4).rotateZ(0.7).translate(-0.6, 1.2, 0),
          new THREE.ConeGeometry(0.08, 0.6, 4).rotateZ(-0.7).translate(0.6, 1.2, 0),
        ]),
        eyes: merge([eyes(1.3, 0.6, 0.14, 0.06), eyes(1.42, 0.55, 0.05, 0.05), eyes(1.15, 0.62, 0.24, 0.04)]),
      };
    case 'king':
    default:
      return {
        body: merge([
          new THREE.ConeGeometry(0.6, 1.8, 8).translate(0, 0.9, 0),
          new THREE.SphereGeometry(0.3, 7, 6).translate(0, 1.95, 0),
          new THREE.CylinderGeometry(0.3, 0.26, 0.2, 8, 1, true).translate(0, 2.25, 0),
          new THREE.ConeGeometry(0.05, 0.25, 4).translate(0.2, 2.45, 0),
          new THREE.ConeGeometry(0.05, 0.25, 4).translate(-0.2, 2.45, 0),
          new THREE.ConeGeometry(0.05, 0.3, 4).translate(0, 2.47, 0.2),
          new THREE.BoxGeometry(1.6, 0.12, 0.35).translate(0, 1.6, 0),
          new THREE.BoxGeometry(0.08, 2.2, 0.08).translate(0.75, 1.1, 0.25),
        ]),
        eyes: eyes(1.98, 0.27, 0.09, 0.05),
      };
  }
}

// ============================================================================================ materials
/**
 * Per-instance FX attribute (vec4) driving the enemy body shader:
 *   x = hit flash (0..1; negative = spawn-in darkness, -1 = black), y = elite aura, z = frozen/slowed, w = burning.
 * The glow (eyes) batch shares the same attribute object, so one write drives both meshes.
 */
export const ENEMY_FX_ATTR = 'aFx';

/** Shares geometry buffers but adds a per-instance FX attribute (so batches never mutate cached models).
 *  Pass `fx` to share one attribute between a body and its glow geometry. */
export function withEnemyFx(src: THREE.BufferGeometry, capacity: number, fx?: THREE.InstancedBufferAttribute): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [k, v] of Object.entries(src.attributes)) g.setAttribute(k, v);
  if (src.index) g.setIndex(src.index);
  if (!fx) {
    fx = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    fx.setUsage(THREE.DynamicDrawUsage);
  }
  g.setAttribute(ENEMY_FX_ATTR, fx);
  g.boundingSphere = src.boundingSphere;
  return g;
}

const RIM_COLOR = new THREE.Color(0.55, 0.62, 1.0);

/**
 * Horde palette knobs (shared by every enemy body material; tweak live via `ENEMY_PALETTE.set(...)`):
 *   x = how far amber/orange body colours are pulled to dusky cool grey (0..1)
 *   y = luminance knee above which body values are compressed (mid-dark bodies)
 *   z = global saturation kept (1 = untouched)
 *   w = slope above the knee (0 = hard clamp, 1 = untouched)
 */
export const ENEMY_PALETTE = new THREE.Vector4(0.75, 0.24, 0.85, 0.3); // s3 #2: steel/bone (knight, warden) top out ~0.47

/**
 * Instance tint multiplied onto a vertex-coloured GLB body (white = as authored). Gloam Jelly's rose-pink skin is
 * pulled to dusk violet (bubblegum → ~#4a2f78, art review s3 #5); its bubbles, eyes and inner glow are a separate
 * glow mesh and keep their pink.
 */
const GLB_BODY_TINT: Partial<Record<EnemyShape, number>> = { blob: 0x4a61a6 };

/** Base instance tint for a GLB (vertex-coloured) enemy body of `shape`. */
export function glbBodyTint(shape: EnemyShape): number {
  return GLB_BODY_TINT[shape] ?? 0xffffff;
}

/** Lit enemy body material: vertex colours + cool moonlit rim (separates enemies from the ground at
 *  night), horde palette (amber pulled cool, values mid-dark), rim-light hit flash, crimson elite aura, icy slow
 *  tint and burning ember rim. */
export function makeEnemyBodyMaterial(vertexColors: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.0,
    flatShading: !vertexColors,
    vertexColors,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = { value: RIM_COLOR };
    sh.uniforms.uPalette = { value: ENEMY_PALETTE };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFx;\nvarying vec4 vFx;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFx = aFx;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vFx;\nuniform vec3 uRimColor;\nuniform vec4 uPalette;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // horde palette (art review s2 #P0): warm amber belongs to the bearer, her weapons and pickups. Enemy
        // bodies pull amber/orange hues toward a dusky cool grey, lose a little saturation and have their
        // values compressed to mid-dark, so a horde reads as silhouettes against the lantern pool.
        {
          vec3 pc = diffuseColor.rgb;
          float pl = dot(pc, vec3(0.2126, 0.7152, 0.0722));
          float mx = max(pc.r, max(pc.g, pc.b));
          float mn = min(pc.r, min(pc.g, pc.b));
          float psat = (mx - mn) / max(mx, 1e-4);
          // hue/60deg for r >= g >= b; amber/yellow-orange sits at 0.4..1.0, red stays below ~0.25
          float hr = (pc.g - pc.b) / max(pc.r - pc.b, 1e-4);
          float amber = step(pc.b, pc.g) * step(pc.g, pc.r + 0.02) * smoothstep(0.22, 0.45, hr) * smoothstep(0.15, 0.45, psat);
          pc = mix(pc, vec3(pl) * vec3(1.02, 0.9, 1.16), amber * uPalette.x);
          pc = mix(vec3(pl), pc, uPalette.z);
          float kl = max(pl, 1e-4);
          if (pl > uPalette.y) pc *= (uPalette.y + (pl - uPalette.y) * uPalette.w) / kl;
          diffuseColor.rgb = pc;
        }
        float fxLum = dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2));
        // slowed / stunned: a cool frost tint that keeps the body mid-dark (a stunned pack must not turn pastel)
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.48, 0.74) * (0.32 + fxLum), vFx.z * 0.38);
        float fxFlash = max(vFx.x, 0.0);
        // hit flash is mostly a rim light (see emissive below): the albedo only lifts a little, so a boss under
        // constant fire keeps its body hue instead of turning into a pale ghost
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.94), fxFlash * 0.2);
        diffuseColor.rgb *= 1.0 + min(vFx.x, 0.0);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float fxRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.2);
        totalEmissiveRadiance += diffuseColor.rgb * (uRimColor * fxRim * 0.45 + 0.05);
        totalEmissiveRadiance += vec3(1.0, 0.94, 0.85) * fxFlash * (0.1 + fxRim * 1.15);
        // elite aura: hostile crimson-magenta (gold/amber is reserved for the player's side)
        totalEmissiveRadiance += vec3(1.0, 0.22, 0.5) * (0.1 + fxRim * 2.0) * vFx.y;
        totalEmissiveRadiance += vec3(0.45, 0.75, 1.0) * fxRim * vFx.z * 0.5;
        totalEmissiveRadiance += vec3(1.0, 0.38, 0.08) * (0.06 + fxRim * 1.2) * vFx.w;`,
      )
      // soft knee on direct light: enemies pressing into the lantern pool stay readable (and keep their hue)
      // instead of blowing out to pink-white; moonlight (below the knee) is untouched
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.directDiffuse = reflectedLight.directDiffuse / (1.0 + max(reflectedLight.directDiffuse - 0.35, 0.0) * 1.3);`,
      );
  };
  mat.customProgramCacheKey = () => 'enemy-body-fx';
  return mat;
}

/** Unlit glow material (eyes, flames, runes) with the same per-instance FX: the hit flash pushes the glow to a
 *  hot white (wisps are mostly glow, so their flash must show here), burning warms it. Spawn darkness is
 *  ignored on purpose: the eyes open in the dark first, then the body rises into the light. */
export function makeEnemyGlowMaterial(vertexColors: boolean, color = 0xffffff): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color, vertexColors });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFx;\nvarying vec4 vFx;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFx = aFx;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vFx;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float gFlash = max(vFx.x, 0.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.9, 1.85, 1.8), gFlash * 0.45);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(2.2, 0.9, 0.3), vFx.w * 0.35);`,
      );
  };
  mat.customProgramCacheKey = () => 'enemy-glow-fx';
  return mat;
}

// ============================================================================================ animation
/** Local-space pose offsets for one enemy instance (applied on top of position / facing / scale). */
export interface EnemyPose {
  y: number;
  sx: number;
  sy: number;
  sz: number;
  pitch: number; // + = lean forward
  yaw: number; // extra heading wobble
  roll: number; // + = lean to its left
  /** Value for the FX attribute's x: hit / death flash (0..1) or spawn darkness (< 0). */
  flash: number;
}

/** Seconds an enemy takes to rise out of the ground / shadow after spawning (bosses: a slower emergence). */
export const SPAWN_TIME = 0.35;
export const BOSS_SPAWN_TIME = 1.0;
/** Death animation length: regular enemies squash + shrink + sink; bosses collapse. */
export const DEATH_TIME = 0.25;
export const BOSS_DEATH_TIME = 1.2;

const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth01 = (v: number) => v * v * (3 - 2 * v);

/**
 * Procedural per-shape animation for instanced enemies (no allocations): floaty ghosts, skittering
 * crawlers, lurching brutes, slinking stalkers with a squash wind-up and stretched dash, jelly spitters
 * that inflate before spitting, waddling bogs, stomping knights; bosses gallop / hop / glide with
 * telegraphed wind-ups. Hit = squash punch, knockback = lean back.
 */
export function poseEnemy(e: Enemy, out: EnemyPose): EnemyPose {
  const t = e.phase;
  const v = (e.id % 7) * 0.13; // per-instance variation
  let y = 0;
  let sx = 1;
  let sy = 1;
  let sz = 1;
  let pitch = 0;
  let yaw = 0;
  let roll = 0;
  const wind = e.state === 1 && (e.def.behavior === 'dash' || e.def.behavior === 'boss');
  const dash = e.state === 2 && (e.def.behavior === 'dash' || e.def.behavior === 'boss');
  const k = wind ? sat(e.stateTime / (e.def.boss ? 0.9 : 0.6)) : 0;
  switch (e.def.shape) {
    case 'shade': {
      y = 0.12 + Math.sin(t * 3 + v) * 0.1;
      sy = 1 + Math.sin(t * 6 + v) * 0.045;
      pitch = 0.16 + Math.sin(t * 3 + v + 0.8) * 0.06;
      roll = Math.sin(t * 2 + v) * 0.09;
      break;
    }
    case 'wisp': {
      y = 0.22 + Math.sin(t * 5 + v) * 0.13;
      sy = 1 + Math.sin(t * 10 + v) * 0.08;
      pitch = 0.22 + Math.cos(t * 5 + v) * 0.12;
      roll = Math.sin(t * 4 + v) * 0.16;
      break;
    }
    case 'crawler': {
      const hop = Math.abs(Math.sin(t * 15 + v));
      y = hop * 0.07;
      sy = 1 - (1 - hop) * 0.09 + hop * 0.04;
      roll = Math.sin(t * 15 + v) * 0.07;
      yaw = Math.sin(t * 8.3 + v * 3) * 0.14;
      pitch = 0.05;
      break;
    }
    case 'brute': {
      const s = Math.sin(t * 3.1 + v);
      const step = Math.abs(s);
      y = step * 0.07;
      sy = 1 - Math.pow(1 - step, 4) * 0.1 + step * 0.03;
      roll = s * 0.11;
      pitch = 0.1 + step * 0.05;
      yaw = s * 0.06;
      break;
    }
    case 'bog': {
      const s = Math.sin(t * 4.2 + v);
      y = Math.abs(s) * 0.05;
      sy = 1 + Math.sin(t * 8.4 + v) * 0.06;
      roll = s * 0.13;
      yaw = s * 0.08;
      break;
    }
    case 'spitter': {
      sy = 1 + Math.sin(t * 7 + v) * 0.06;
      y = Math.abs(Math.sin(t * 3.5 + v)) * 0.05;
      roll = Math.sin(t * 3.5 + v) * 0.06;
      const iv = e.def.attackInterval ?? 2.5;
      const pre = sat(1 - e.timer / 0.55); // inflate right before spitting
      const post = sat(1 - (iv - e.timer) / 0.25); // recoil right after
      sx *= 1 + pre * 0.28;
      sz *= 1 + pre * 0.28;
      sy *= 1 + pre * 0.16 - post * 0.18;
      pitch = -0.1 * pre - post * 0.35;
      break;
    }
    case 'stalker': {
      sy = 1 + Math.sin(t * 9 + v) * 0.03;
      roll = Math.sin(t * 4.5 + v) * 0.06;
      pitch = 0.22;
      if (wind) {
        sy = 1 - 0.32 * k;
        sx = sz = 1 + 0.16 * k;
        pitch = 0.22 - 0.5 * k;
        yaw = Math.sin(t * 70) * 0.06 * k;
      } else if (dash) {
        sy = 0.82;
        sx = 0.9;
        sz = 1.4;
        pitch = 0.5;
      }
      break;
    }
    case 'knight': {
      const s = Math.sin(t * 3.4 + v);
      y = Math.abs(s) * 0.05;
      roll = s * 0.07;
      pitch = 0.05;
      if (wind) {
        pitch = -0.32 * k;
        y += 0.15 * k;
        sy = 1 + 0.06 * k;
        yaw = Math.sin(t * 60) * 0.04 * k;
      } else if (dash) {
        pitch = 0.38;
        sz = 1.2;
        sy = 0.92;
      }
      break;
    }
    case 'blob': {
      // jelly lurch in sync with the splitter's surge (Enemies: speed pulses with sin(phase*4 + id)):
      // stretches forward while surging, gathers up tall in between, with a fast secondary jiggle
      const s = Math.sin(t * 4 + e.id);
      const surge = Math.max(0, s);
      const gather = Math.max(0, -s);
      const jig = Math.sin(t * 13 + v * 7) * 0.035;
      sy = 1 - surge * 0.14 + gather * 0.1 + jig;
      sx = 1 + surge * 0.06 - gather * 0.05 - jig * 0.6;
      sz = 1 + surge * 0.16 - gather * 0.05 - jig * 0.6;
      pitch = surge * 0.16 - gather * 0.05;
      roll = Math.sin(t * 2.5 + v) * 0.07;
      y = gather * gather * 0.05;
      break;
    }
    case 'bloater': {
      // skittering tick: rapid leg hop + breathing abdomen; primed (state 3) = rears up, swells and shakes
      const hop = Math.abs(Math.sin(t * 17 + v));
      y = hop * 0.045;
      roll = Math.sin(t * 17 + v) * 0.06;
      yaw = Math.sin(t * 7.1 + v * 3) * 0.1;
      sy = 1 + Math.sin(t * 6 + v) * 0.035;
      sx = sz = 1 - Math.sin(t * 6 + v) * 0.02;
      pitch = 0.06;
      if (e.state === 3) {
        const pk = sat(e.stateTime / (e.def.fuse ?? 0.85));
        const shake = Math.sin(t * 85 + v) * (0.05 + 0.1 * pk);
        pitch = -0.28 * pk;
        yaw = shake;
        roll = Math.sin(t * 71) * 0.06 * pk;
        sy = 1 + 0.12 * pk + Math.sin(t * 40) * 0.04 * pk;
        sx = sz = 1 + 0.1 * pk;
        y = 0.04 * pk;
      }
      break;
    }
    case 'warden': {
      // stately sentinel glide; once its ward breaks it hunches and sways, flustered
      const s = Math.sin(t * 2.6 + v);
      y = Math.abs(s) * 0.03;
      roll = s * 0.045;
      pitch = 0.03;
      sy = 1 + Math.sin(t * 5.2 + v) * 0.015;
      if (e.maxShield > 0 && e.shield <= 0) {
        pitch = 0.16 + Math.sin(t * 3.3 + v) * 0.04;
        roll = s * 0.09;
        sy *= 0.96;
      }
      break;
    }
    case 'stag': {
      const s = Math.sin(t * 5);
      y = Math.abs(s) * 0.08;
      pitch = s * 0.06;
      if (wind) {
        pitch = -0.4 * k;
        y += 0.1 * k;
        yaw = Math.sin(t * 40) * 0.03 * k;
      } else if (dash) {
        pitch = 0.16 + s * 0.05;
        sz = 1.12;
        y = Math.abs(Math.sin(t * 9)) * 0.12;
      }
      break;
    }
    case 'mire': {
      const s = Math.sin(t * 2.2);
      const hop = Math.max(0, s);
      y = hop * 0.22;
      sy = 1 - Math.max(0, -s) * 0.14 + hop * 0.08;
      sx = sz = 1 / Math.sqrt(sy);
      if (wind) {
        sy = 1 - 0.28 * k;
        sx = sz = 1 + 0.15 * k;
        y = 0;
      } else if (dash) {
        sy = 1.12;
        sz = 1.15;
        y = 0.3;
        pitch = 0.2;
      }
      break;
    }
    case 'king':
    default: {
      y = 0.06 + Math.sin(t * 1.5) * 0.06;
      roll = Math.sin(t * 1.2) * 0.04;
      sy = 1 + Math.sin(t * 3) * 0.015;
      if (wind) {
        y += 0.45 * k;
        sy = 1 + 0.08 * k;
        pitch = -0.15 * k;
      } else if (dash) {
        pitch = 0.28;
        sz = 1.1;
      }
      break;
    }
  }
  // volume-preserving squash on the vertical axis when not explicitly authored
  if (sx === 1 && sz === 1 && sy !== 1) {
    sx = sz = 1 / Math.sqrt(sy);
  }
  // hit reaction: squash punch + flinch back
  const f = e.hitFlash;
  if (f > 0) {
    sy *= 1 - 0.2 * f;
    sx *= 1 + 0.12 * f;
    sz *= 1 + 0.12 * f;
    pitch -= 0.25 * f;
  }
  // knockback: lean away from the push (local space)
  const sf = Math.sin(e.facing);
  const cf = Math.cos(e.facing);
  const kbF = e.kbx * sf + e.kbz * cf;
  const kbS = e.kbx * cf - e.kbz * sf;
  pitch += Math.max(-0.5, Math.min(0.5, kbF * 0.05));
  roll += Math.max(-0.4, Math.min(0.4, -kbS * 0.04));
  let flash = f;
  const boss = !!e.def.boss;
  if (e.dying >= 0) {
    const d = e.dying;
    if (boss) {
      // collapse: shudder + white pulses, topple forward while sinking, darken into shadow, shrink away
      const k = sat(d / BOSS_DEATH_TIME);
      const shud = 1 - sat(k / 0.35);
      yaw += Math.sin(d * 55) * 0.09 * shud;
      roll += Math.sin(d * 43) * 0.05 * shud;
      const fall = smooth01(sat((k - 0.2) / 0.6));
      pitch += fall * 1.05;
      roll += fall * 0.22;
      sy *= 1 - 0.22 * fall;
      y -= smooth01(sat((k - 0.45) / 0.55)) * 0.9;
      const g = 1 - smooth01(sat((k - 0.72) / 0.28)) * 0.92;
      sx *= g;
      sy *= g;
      sz *= g;
      flash = k < 0.4 ? 0.55 + 0.45 * Math.sin(d * 38) : k < 0.6 ? 1 - (k - 0.4) * 5 : -sat((k - 0.6) / 0.4) * 0.85;
    } else {
      // pop: squash flat (white flash), then shrink and sink into the ground
      const k = sat(d / DEATH_TIME);
      const sq = Math.sin(sat(k * 1.7) * Math.PI * 0.5);
      sy *= 1 - 0.55 * sq;
      const w = 1 + 0.42 * sq * (1 - k);
      const g = 1 - k * k * 0.8;
      sx *= w * g;
      sz *= w * g;
      sy *= g;
      y -= k * k * 0.3;
      flash = k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55;
    }
  } else {
    const st = boss ? BOSS_SPAWN_TIME : SPAWN_TIME;
    if (e.age < st) {
      // rise out of the ground / fade in from shadow, with a little stretch overshoot
      const k = sat(e.age / st);
      const ke = 1 - (1 - k) * (1 - k);
      y -= (1 - ke) * (boss ? 1.6 : 1.1);
      const g = 0.7 + 0.3 * ke;
      sx *= g;
      sz *= g;
      sy *= g * (1 + Math.sin(k * Math.PI) * 0.14);
      if (f <= 0) flash = -(1 - k) * 0.9;
    }
  }
  out.flash = flash;
  out.y = y;
  out.sx = sx;
  out.sy = sy;
  out.sz = sz;
  out.pitch = pitch;
  out.yaw = yaw;
  out.roll = roll;
  return out;
}

/** Shared scratch pose (single-threaded render loop: reuse to avoid per-frame allocations). */
export const POSE_SCRATCH: EnemyPose = { y: 0, sx: 1, sy: 1, sz: 1, pitch: 0, yaw: 0, roll: 0, flash: 0 };
const poseEuler = new THREE.Euler(0, 0, 0, 'YXZ');
/** Writes facing + pose lean into a quaternion. */
export function poseQuaternion(facing: number, p: EnemyPose, out: THREE.Quaternion): THREE.Quaternion {
  poseEuler.set(p.pitch, facing + p.yaw, p.roll, 'YXZ');
  return out.setFromEuler(poseEuler);
}
