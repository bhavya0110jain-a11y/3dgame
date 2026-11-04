// Store art from the REAL game: in-engine marketing screenshots, clean key-art plates, composed capsules/key art
// (title logo over a plate) and a short gameplay capture for the trailer/GIF. Re-runnable: every image is staged the
// same way from a production build, so the lead can regenerate the whole set after visual changes land.
//
//   node tools/package-screens.mjs [--dist dist] [--out production/release/store-art] [--only a,b] [--res 1920x1080]
//                                  [--no-capture] [--no-compose] [--video] [--video-only] [--seed 7]
//
//   --dist       production build to stage (default: dist; run `npm run build` first)
//   --out        output folder (default: production/release/store-art)
//   --only       capture only these shot names (see SHOTS below), e.g. --only title,horde
//   --no-capture skip the in-engine capture and only re-compose capsules from the plates already on disk
//   --no-compose skip composing capsules
//   --video      also record the trailer/GIF capture (slow under SwiftShader: ~10–20 min at 1280×720)
//   --video-only only record the capture
//
// Output (see docs/store/README.md):
//   screens/NN-<name>.png      1920×1080 gameplay screenshots WITH the real HUD (Steam / itch screenshot slots)
//   plates/<name>.png          the same moments with the DOM UI hidden (backgrounds for key art and capsules)
//   capsules/<asset>.png       composed store assets (Steam header/capsules/library, itch cover, OG image, logo)
//   capture/gameplay.{webm,mp4,gif}
//
// How it stays honest and deterministic: an init script seeds Math.random and takes over requestAnimationFrame and
// performance.now, so the game loop only advances when this script steps it (fixed 1/30 s frames). Fast-forwards
// call Game.updateRun directly (the same call the real loop makes) without rendering, then a few real rendered frames
// let the VFX settle before the screenshot. Every pixel is the shipping renderer; staging only chooses the moment
// (night, bearer, kit, crowd, camera framing) via the window.__game debug hooks exposed by src/main.ts.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const dist = resolve(root, opt('--dist', process.env.DIST ?? 'dist'));
const out = resolve(root, opt('--out', 'production/release/store-art'));
const [W, H] = opt('--res', '1920x1080').split('x').map(Number);
const only = opt('--only', null)?.split(',');
const SEED = Number(opt('--seed', '7'));
const videoOnly = flag('--video-only');
const doCapture = !flag('--no-capture') && !videoOnly;
const doCompose = !flag('--no-compose') && !videoOnly;
const doVideo = flag('--video') || videoOnly;
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`✖ no build in ${dist} — run \`npm run build\` (or pass --dist)`);
  process.exit(1);
}
for (const d of ['screens', 'plates', 'capsules', 'capture']) mkdirSync(join(out, d), { recursive: true });

// ---------------------------------------------------------------- static server (dist + compositor page)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png',
  '.json': 'application/json', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
let composeHtml = '';
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (url === '/__compose.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(composeHtml); return; }
  const file = url.startsWith('/__art/') ? join(out, url.slice(7)) : join(dist, url === '/' ? 'index.html' : url);
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const base = `http://localhost:${port}`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// ---------------------------------------------------------------- page harness
const ALL_CHARS = ['char_keeper', 'char_warden', 'char_seer', 'char_pyre', 'char_frost', 'char_bell'];
/** A veteran save: everything unlocked, onboarding off, so no tutorial hint or first-time toast lands in a shot. */
function veteranSave(extra = {}) {
  return {
    version: 1, ash: 2140, totalAsh: 18400, bestTime: 1342, bestKills: 6120, runs: 23, victories: 4,
    meta: { m_light: 3, m_might: 3, m_speed: 2, m_regen: 2, m_magnet: 2, m_growth: 2, m_cooldown: 1 },
    unlocked: [...ALL_CHARS, 'biome_pines', 'biome_marsh', 'biome_ruins'],
    selectedCharacter: 'char_keeper',
    achievements: ['ach_first_vigil', 'ach_survive_5', 'ach_kills_500', 'ach_level_20', 'ach_survive_10', 'ach_kills_1000', 'ach_evolve',
      'ach_elites', 'ach_full_kit', 'ach_relics', 'ach_close_call', 'ach_untouched', 'ach_chain', 'ach_toll', 'ach_dawn', 'ach_evolve_2',
      'ach_wardbreaker', 'ach_marsh', 'ach_endless', 'ach_legend', 'ach_hearth', 'ach_faithful', 'ach_ruins', 'ach_absurd'],
    biomesCleared: ['biome_pines', 'biome_marsh'],
    hintsSeen: ['move', 'levelup', 'lowlight', 'chest', 'evolve', 'boss'],
    settings: { masterVolume: 0, musicVolume: 0, sfxVolume: 0, screenShake: false, damageNumbers: true, quality: 'high', showFps: false, hints: false },
    ...extra,
  };
}

/** Init script: seeded Math.random + a manual clock (the game loop advances only when __step is called). */
const harness = ({ seed, save }) => {
  try { localStorage.setItem('last-lantern-save-v1', JSON.stringify(save)); } catch { /* storage blocked */ }
  let s = seed >>> 0 || 1;
  Math.random = () => { // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const realNow = performance.now.bind(performance);
  let vnow = realNow();
  let queue = [];
  performance.now = () => vnow;
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  /** Advances the clock by dt seconds and runs one frame of every rAF callback (game loop + UI). */
  window.__step = (dt = 1 / 30, n = 1) => {
    for (let i = 0; i < n; i++) {
      vnow += dt * 1000;
      const cbs = queue;
      queue = [];
      for (const cb of cbs) { try { cb(vnow); } catch (e) { console.error(e); } }
    }
  };
  /** Advances only the clock (no frame callbacks). */
  window.__tick = (dt) => { vnow += dt * 1000; };
  // a slow real-time pump while booting (asset loading may await animation frames)
  const pump = setInterval(() => { if (!window.__game) window.__step(1 / 30); else clearInterval(pump); }, 50);
};

const errors = [];
const verbose = flag('--verbose');
const T0 = Date.now();
const log = (...m) => { if (verbose) console.log(`    [${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...m); };
async function openGame({ save = veteranSave(), viewport = { width: W, height: H }, seed = SEED, video } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(video ? { recordVideo: video } : {}) });
  await ctx.addInitScript(harness, { seed, save });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300_000);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext|autoplay/i.test(m.text())) errors.push(m.text()); });
  log('goto');
  await page.goto(`${base}/`);
  log('loaded');
  // polling, not rAF: the harness owns requestAnimationFrame
  await page.waitForFunction(() => !!window.__game, null, { polling: 250 });
  // in-page staging helpers (all through the public debug hooks)
  await page.evaluate(() => {
    const gm = window.__game;
    gm.renderer.autoQuality = false;
    const H = (window.__stage = {
      /** Starts a vigil on `biome` with `char`. */
      start(biome, char, { numbers = false } = {}) {
        gm.save.selectedCharacter = char ?? 'char_keeper';
        gm.selectedBiome = biome ?? 'biome_pines';
        gm.startRun();
        // damage numbers off by default: hundreds of hits read as noise in a still
        gm.fx.damageNumbers = numbers;
        // fast-forwarded level-ups would leave their light pillars standing in the shot; only the level-up still keeps one
        H.levelFx ??= gm.fx.levelUp.bind(gm.fx);
        gm.fx.levelUp = () => {};
        // skip the menu → run crane swoop: the first follow() starts it, snap() completes it
        gm.updateCamera(1 / 30);
        gm.renderer.rig.snap(gm.player.x, gm.player.z);
      },
      /** Removes weapons whose full-screen pulse would white out a still (Flare Nova / Dawnbreak flash). */
      drop(ids = ['flare_nova', 'dawnbreak']) {
        for (let i = gm.run.weapons.length - 1; i >= 0; i--) {
          const w = gm.run.weapons[i];
          if (ids === '*' || ids.includes(w.def.id)) { w.dispose(gm); gm.run.weapons.splice(i, 1); }
        }
        gm.ui.refreshSlots?.();
      },
      /** Sets the shown bearer level (the HUD level badge) to match a staged late-run kit. */
      level(n) { gm.run.level = Math.max(gm.run.level, n); },
      /** Picks the best-looking offer at a level-up: new weapon > evolution > weapon level > relic. */
      autoPick() {
        for (let n = 0; n < 12 && gm.state === 'levelup'; n++) {
          if (gm.levelMode === 'chest') { gm.closeChest(); continue; }
          if (gm.levelMode === 'dawn') { gm.resolveDawn('endless'); continue; }
          const c = gm.pendingChoices ?? [];
          const rank = (k) => ({ evolution: 0, 'weapon-new': 1, 'weapon-up': 2, passive: 3 })[k] ?? 9;
          let best = 0;
          for (let i = 1; i < c.length; i++) if (rank(c[i].kind) < rank(c[best].kind)) best = i;
          gm.chooseUpgrade(best);
        }
      },
      /** Fast-forwards `seconds` of real simulation (no rendering) while the bearer kites in a slow circle. */
      ff(seconds, { turn = 0.35, heal = true, dir = 0 } = {}) {
        const steps = Math.round(seconds * 30);
        let a = dir;
        for (let i = 0; i < steps && gm.state !== 'gameover'; i++) {
          if (gm.state === 'levelup') H.autoPick();
          if (gm.state !== 'playing') continue;
          a += turn / 30;
          gm.input.moveX = Math.cos(a);
          gm.input.moveZ = Math.sin(a);
          gm.player.invuln = 0.39; // > 0 blocks damage; ≤ 0.4 keeps the bearer from blinking
          if (heal) gm.player.lightValue = gm.run.stats.maxLight;
          gm.updateRun(1 / 30);
        }
        gm.input.moveX = 0;
        gm.input.moveZ = 0;
        gm.renderer.rig.snap(gm.player.x, gm.player.z);
      },
      /** Gives weapons [[id, level]] and relics [[id, level]] (same effect as picking them at level-ups). */
      kit(weapons = [], relics = []) {
        for (const [id, lv] of weapons) {
          let w = gm.run.weapons.find((x) => x.def.id === id);
          if (!w) {
            const def = window.__weapons.find((d) => d.id === id);
            if (!def) { console.warn('[stage] unknown weapon ' + id); continue; }
            if (gm.run.weapons.length >= gm.run.maxWeapons) gm.run.weapons.shift().dispose(gm);
            w = def.create(gm);
            gm.run.weapons.push(w);
          }
          while (w.level < Math.min(lv, w.def.maxLevel)) { w.level++; w.onLevelUp?.(gm); }
        }
        for (const [id, lv] of relics) {
          const p = gm.passiveDef(id);
          if (!p) continue;
          while ((gm.run.passives.get(id) ?? 0) < Math.min(lv, p.maxLevel)) {
            gm.run.passives.set(id, (gm.run.passives.get(id) ?? 0) + 1);
            p.apply(gm.run.stats);
          }
        }
        gm.player.lightValue = gm.run.stats.maxLight;
        gm.ui.refreshSlots?.();
      },
      /** Spawns `count` enemies in a loose ring (rMin..rMin+spread) around the bearer, optionally biased to one side. */
      ring(count, ids, rMin = 6, spread = 12, bias = 0, biasDir = -Math.PI / 2, hpMul = 1) {
        for (let i = 0; i < count; i++) {
          let a = Math.random() * Math.PI * 2;
          if (bias > 0 && Math.random() < bias) a = biasDir + (Math.random() - 0.5) * 2.2;
          const r = rMin + Math.sqrt(Math.random()) * spread;
          gm.enemies.spawn(ids[i % ids.length], gm.player.x + Math.cos(a) * r, gm.player.z + Math.sin(a) * r, hpMul !== 1 ? { hpMul } : undefined);
        }
      },
      /**
       * Advances n frames of 1/30 s WITHOUT rendering (simulation, VFX ageing, camera smoothing, UI clock) so the
       * scene reaches a natural mid-fight state cheaply; SwiftShader needs seconds per 1080p frame.
       */
      sim(n, { heal = true } = {}) {
        const dt = 1 / 30;
        for (let i = 0; i < n; i++) {
          if (gm.state === 'levelup') H.autoPick();
          if (gm.state === 'playing') {
            gm.player.invuln = 0.39;
            if (heal) gm.player.lightValue = gm.run.stats.maxLight;
            if (H.move) { gm.input.moveX = H.move[0]; gm.input.moveZ = H.move[1]; }
            gm.updateRun(dt);
          }
          gm.fx.update(dt);
          gm.updateCamera(dt);
          window.__tick(dt);
        }
      },
      /** Renders n real frames (1/30 s each) with the bearer protected. */
      frames(n, { heal = true } = {}) {
        for (let i = 0; i < n; i++) {
          if (gm.state === 'playing') {
            gm.player.invuln = 0.39;
            if (heal) gm.player.lightValue = gm.run.stats.maxLight;
          }
          window.__step(1 / 30);
        }
      },
      /** Hides / shows the DOM UI (HUD, screens). */
      ui(visible) { const el = document.getElementById('ui-root'); if (el) el.style.visibility = visible ? '' : 'hidden'; },
      /** Each night's shadow roster for staged crowds. */
      SH: {
        pines: ['shade', 'crawler', 'wisp', 'stalker', 'brute', 'shade', 'wisp'],
        marsh: ['bog_lurker', 'gloam_jelly', 'jellyling', 'spitter', 'wisp', 'shade'],
        ruins: ['knight', 'cinder_tick', 'hollow_warden', 'shade', 'stalker', 'cinder_tick'],
      },
      /** Staged stick input [x, z] applied after Input.update each rendered frame (null = real input). */
      move: null,
    });
    // WORKAROUND (reported to the lead, 2026-11-04): Player.update no longer moves the bearer model to (player.x,
    // player.z) since the sprint-1 animation refactor, so in a vigil the model stays at the world origin. Mirror the
    // missing sync here so the shots show the bearer where the game simulates her; harmless once the game does it.
    const pUpdate = gm.player.update.bind(gm.player);
    gm.player.update = (...a) => { pUpdate(...a); gm.player.group.position.set(gm.player.x, gm.player.group.position.y, gm.player.z); };
    const update = gm.input.update.bind(gm.input);
    gm.input.update = () => { update(); if (H.move) { gm.input.moveX = H.move[0]; gm.input.moveZ = H.move[1]; } };
  });
  log('booted');
  await page.evaluate(() => window.__stage.frames(2));
  log('first frames');
  return { ctx, page };
}

/** Simulates `sim` frames without rendering, then renders `render` real frames (each ~1–5 s under SwiftShader). */
async function settle(page, sim = 30, render = 2) {
  if (sim) await page.evaluate((n) => window.__stage.sim(n), sim);
  log(`sim ${sim}`);
  for (let i = 0; i < render; i++) await page.evaluate(() => window.__stage.frames(1));
  log(`render ${render}`);
}
const settleCss = (page, ms = 1200) => page.waitForTimeout(ms);

async function snap(page, name, idx) {
  // transient world banners ("An elite approaches…") would land at random in a still: hide them
  await page.addStyleTag({ content: '.fxt-big { display: none !important; }' });
  // HUD version (gameplay screenshot) then the clean plate
  if (idx != null) {
    log('screenshot…');
    await page.screenshot({ path: join(out, 'screens', `${String(idx).padStart(2, '0')}-${name}.png`) });
    console.log(`  ✔ screens/${String(idx).padStart(2, '0')}-${name}.png`);
  }
  await page.evaluate(() => window.__stage.ui(false));
  await page.screenshot({ path: join(out, 'plates', `${name}.png`) });
  await page.evaluate(() => window.__stage.ui(true));
  console.log(`  ✔ plates/${name}.png`);
}

// ---------------------------------------------------------------- shots
const S = (page, fn, arg) => page.evaluate(fn, arg);

/** Key art: a vigil in the Whispering Pines framed by the title screen's hero camera, shadows advancing out of the fog. */
async function stageKeyArt(page, spread = 1) {
  await S(page, () => window.__stage.start('biome_pines', 'char_keeper'));
  await S(page, () => window.__stage.ff(4));
  await S(page, (spread) => {
    const gm = window.__game;
    const st = window.__stage;
    // back to the clearing at the world origin, where the title screen frames the bearer
    gm.player.x = 0;
    gm.player.z = 0;
    gm.world.update(0, 0);
    st.drop('*');
    // a calm beat before the storm: only Moth Lantern's moths flutter out (weapon hits would flash the crowd)
    st.kit([['moth_lantern', 3]], []);
    gm.enemies.clear();
    const rig = gm.renderer.rig;
    gm.updateCamera = (dt) => {
      rig.menu(dt, gm.player.x, gm.player.z);
      gm.renderer.lighting.setExtent(26);
      gm.renderer.lighting.follow(gm.player.x, gm.player.z);
    };
    // the hero camera looks along (-0.3, 0, -1): pour the shadows in from that side of the bearer
    const fl = Math.hypot(0.3, 1);
    const fx = -0.3 / fl, fz = -1 / fl, rx = -fz, rz = fx;
    const ids = ['shade', 'shade', 'wisp', 'crawler', 'stalker', 'shade', 'wisp', 'shade', 'crawler', 'wisp', 'shade'];
    for (let i = 0; i < 220; i++) {
      const d = 9 + Math.pow(Math.random(), 0.8) * 28;
      const lat = (Math.random() - 0.35) * d * 1.1 * spread;
      gm.enemies.spawn(ids[i % ids.length], gm.player.x + fx * d + rx * lat, gm.player.z + fz * d + rz * lat);
    }
  }, spread);
  await settle(page, 24);
}

/** The hero shot's evolved kit (STAGE_KIT=id,id,… overrides it when auditioning weapons for a new shot). */
const HORDE_KIT = (process.env.STAGE_KIT?.split(',') ?? ['solar_crown', 'pyre_garden', 'tempest_choir', 'lunar_monarchs'])
  .map((id) => [id, 8]);
// (default kit auditioned on 2026-11-04: Solar Crown rings + Pyre Garden + Tempest Choir + Lunar Monarchs read best;
//  Sunspear Volley / Beacon Ray / Dawnbreak bloom out a still)
const SHOTS = [
  ['title', 1, async (page) => {
    // menu hero: the bearer in the glade under the moon, title + menu visible
    await settle(page, 0, 3);
    await settleCss(page, 2500);
  }, { save: { achievements: ['ach_first_vigil', 'ach_survive_5', 'ach_kills_500', 'ach_level_20', 'ach_survive_10', 'ach_kills_1000', 'ach_evolve', 'ach_elites', 'ach_relics', 'ach_chain', 'ach_dawn'] } }],
  // key-art plates (no HUD version): the menu's low hero camera, but mid-vigil, with a horde pouring out of the
  // fog towards the bearer under the moon. Capsules and the library hero are composed on these.
  ['keyart', null, (page) => stageKeyArt(page)],
  ['keyart-wide', null, (page) => stageKeyArt(page, 1.25), { viewport: { width: 3840, height: 1240 } }],
  ['horde', 2, async (page) => {
    // big fight with evolved weapons, a few minutes into the first night
    await S(page, () => window.__stage.start('biome_pines', 'char_keeper'));
    await S(page, () => window.__stage.ff(150));
    await S(page, (kit) => { const st = window.__stage; st.drop('*'); st.level(34); st.kit(kit,
      [['bellows', 5], ['clockwork', 5], ['flint', 5], ['oil', 5], ['quill', 5], ['lodestone', 3]]); }, HORDE_KIT);
    await S(page, () => { const gm = window.__game; gm.enemies.clear(); window.__stage.ring(320, ['shade', 'crawler', 'wisp', 'stalker', 'shade', 'brute', 'wisp', 'crawler'], 8, 16); });
    await settle(page, 14);
  }],
  ['night-pines', 3, async (page) => {
    await S(page, () => window.__stage.start('biome_pines', 'char_seer', { numbers: true }));
    await S(page, () => window.__stage.ff(200, { turn: 0.25 }));
    await S(page, () => { const st = window.__stage; st.drop(); st.level(14); st.kit([['spark_chain', 7], ['wick_lance', 5], ['cinder_halo', 4]], [['clockwork', 3], ['quill', 2]]); });
    await S(page, () => window.__stage.ring(140, window.__stage.SH.pines, 6, 14));
    await settle(page, 20);
  }],
  ['night-marsh', 4, async (page) => {
    await S(page, () => window.__stage.start('biome_marsh', 'char_frost'));
    await S(page, () => window.__stage.ff(220, { turn: 0.25 }));
    await S(page, () => { const st = window.__stage; st.drop('*'); st.level(22); st.kit([['frost_shards', 8], ['moth_lantern', 6], ['lantern_hook', 5], ['glacier_heart', 1]], [['tallow', 4], ['boots', 3]]); });
    await S(page, () => window.__stage.ring(170, window.__stage.SH.marsh, 6, 15));
    await settle(page, 20);
  }],
  ['night-ruins', 5, async (page) => {
    await S(page, () => window.__stage.start('biome_ruins', 'char_pyre'));
    await S(page, () => window.__stage.ff(220, { turn: 0.25 }));
    await S(page, () => { const st = window.__stage; st.drop('*'); st.level(24); st.kit([['brazier', 8], ['cinder_halo', 7], ['lantern_hook', 6], ['ember_bolt', 6], ['frost_shards', 4]], [['oil', 5], ['bellows', 3]]); });
    await S(page, () => window.__stage.ring(170, window.__stage.SH.ruins, 6, 15));
    await settle(page, 20);
  }],
  ['boss', 6, async (page) => {
    // the Hollow Stag, master of the first night
    await S(page, () => window.__stage.start('biome_pines', 'char_warden'));
    await S(page, () => window.__stage.ff(140, { turn: 0.3 }));
    await S(page, () => { const st = window.__stage; st.drop(['flare_nova', 'dawnbreak', 'gloam_beam', 'spark_chain', 'wick_lance']); st.level(27);
      st.kit([['cinder_halo', 8], ['brazier', 6], ['moth_lantern', 5], ['frost_shards', 5]], [['bellows', 4], ['clockwork', 3]]); });
    await S(page, () => {
      const gm = window.__game;
      gm.enemies.clear();
      const boss = gm.enemies.spawn(gm.world.biome.bossId, gm.player.x + 4.5, gm.player.z - 2.5);
      // a still catches the white hit-flash at random: keep the Stag's own colours for the portrait
      if (boss) Object.defineProperty(boss, 'hitFlash', { configurable: true, get: () => 0, set: () => {} });
    });
    await S(page, () => window.__stage.ring(80, ['shade', 'wisp', 'shade', 'crawler'], 7, 10));
    await settle(page, 24, 0);
    // frame the portrait: the Stag a few strides off the bearer's shoulder (it charges, so place it after the sim)
    await S(page, () => {
      const gm = window.__game;
      const b = gm.enemies.boss;
      if (b) { b.x = gm.player.x + 4.8; b.z = gm.player.z - 3.6; }
    });
    await settle(page, 0, 2);
    await settleCss(page, 1200); // the boss bar slides in
  }],
  ['levelup', 7, async (page) => {
    await S(page, () => window.__stage.start('biome_pines', 'char_keeper'));
    await S(page, () => window.__stage.ff(70));
    await S(page, () => window.__stage.drop());
    await S(page, () => window.__stage.ring(90, window.__stage.SH.pines, 6, 12));
    await settle(page, 12);
    await S(page, () => { const gm = window.__game; gm.fx.levelUp = window.__stage.levelFx; gm.openLevelUp(); });
    await settle(page, 0, 2);
    await settleCss(page, 2500);
  }],
  ['evolution', 8, async (page) => {
    // reliquary reveal of an evolution (Ember Bolt at max level + Flint → Sunspear Volley)
    await S(page, () => window.__stage.start('biome_marsh', 'char_keeper'));
    await S(page, () => window.__stage.ff(90));
    await S(page, () => { const st = window.__stage; st.drop(); st.level(16); st.kit([['ember_bolt', 8], ['cinder_halo', 5], ['frost_shards', 4]], [['flint', 2], ['wick', 2]]); });
    await S(page, () => window.__stage.ring(90, window.__stage.SH.marsh, 6, 12));
    await settle(page, 12);
    await S(page, () => window.__game.openChest());
    await settle(page, 0, 2);
    await settleCss(page, 3500);
  }],
  ['bearers', 9, async (page) => {
    // vigil setup: bearer + night select
    await S(page, () => window.__game.ui.showSetup());
    await settle(page, 0, 2);
    await settleCss(page, 2000);
  }],
  ['hearth', 10, async (page) => {
    await S(page, () => window.__game.ui.showHearth());
    await settle(page, 0, 2);
    await settleCss(page, 2000);
  }],
];

const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';

if (doCapture) {
  console.log(`capturing ${only ? only.join(',') : 'all'} shots at ${W}×${H} from ${dist} → ${out}`);
  let failed = 0;
  for (const [name, idx, setup, o = {}] of SHOTS) {
    if (only && !only.includes(name)) continue;
    const { ctx, page } = await openGame({ save: veteranSave(o.save), ...(o.viewport ? { viewport: o.viewport } : {}) });
    try {
      if (name === 'title') {
        // keep the menu's logo markup for the compositor (so key art always uses the shipping logo)
        await page.waitForFunction(() => !!document.querySelector('.screen-menu .logo'), null, { polling: 250 });
      }
      await setup(page);
      if (name === 'title') {
        const logo = await page.evaluate(() => document.querySelector('.screen-menu .logo')?.outerHTML ?? '');
        if (logo) writeFileSync(join(out, 'plates', 'logo.html'), logo);
      }
      await snap(page, name, idx);
      const info = await page.evaluate(() => { const g = window.__game; const v = g.player.group.position.clone().set(g.player.x, 1, g.player.z).project(g.camera);
        return { state: g.state, t: g.run.elapsed | 0, lv: g.run.level, enemies: g.enemies.activeCount, bearer: g.player.group.visible ? `${Math.round((v.x + 1) * 50)}%,${Math.round((1 - v.y) * 50)}%` : 'hidden', w: g.run.weapons.map((w) => w.def.id + ':' + w.level).join(' ') }; });
      console.log(`    ${secs()} ${JSON.stringify(info)}`);
    } catch (e) {
      failed++;
      console.warn(`  ! shot ${name} failed: ${String(e).split('\n')[0]}`);
    }
    await ctx.close();
  }
  if (failed) process.exitCode = 1;
}

// ---------------------------------------------------------------- compositor
/**
 * Store asset layouts. plate = which clean plate fills the frame; pos = object-position (crop focus); logo = logo
 * height as a fraction of the canvas height; at = logo centre (x, y fractions); shade = vignette side.
 */
const ASSETS = [
  // Steam (current sizes; Valve also accepts the older half sizes, generated below for itch/press use)
  { file: 'steam-header-920x430.png', w: 920, h: 430, plate: 'keyart', pos: '50% 46%', logo: 0.6, at: [0.67, 0.42], shade: 'spot' },
  { file: 'steam-small-capsule-462x174.png', w: 462, h: 174, plate: 'keyart', pos: '50% 42%', logo: 0.86, at: [0.62, 0.5], shade: 'spot', compact: true },
  { file: 'steam-main-capsule-1232x706.png', w: 1232, h: 706, plate: 'keyart', pos: '50% 50%', logo: 0.5, at: [0.68, 0.37], shade: 'spot', tag: true },
  { file: 'steam-vertical-capsule-748x896.png', w: 748, h: 896, plate: 'keyart', pos: '16% 50%', logo: 0.32, at: [0.5, 0.2], shade: 'top', tag: true },
  { file: 'steam-library-capsule-600x900.png', w: 600, h: 900, plate: 'keyart', pos: '14% 50%', logo: 0.3, at: [0.5, 0.19], shade: 'top', tag: true },
  { file: 'steam-library-hero-3840x1240.png', w: 3840, h: 1240, plate: 'keyart-wide', pos: '50% 50%', logo: 0, shade: 'none' },
  { file: 'steam-library-hero-1920x620.png', w: 1920, h: 620, plate: 'keyart-wide', pos: '50% 50%', logo: 0, shade: 'none' },
  { file: 'steam-library-logo-1280x720.png', w: 1280, h: 720, plate: null, logo: 0.86, at: [0.5, 0.5], transparent: true },
  { file: 'steam-page-background-1438x810.png', w: 1438, h: 810, plate: 'night-ruins', pos: '50% 50%', logo: 0, shade: 'page' },
  // the half sizes named in the sprint brief (older Steam spec; handy for itch/press thumbnails)
  { file: 'steam-header-460x215.png', w: 460, h: 215, plate: 'keyart', pos: '50% 46%', logo: 0.6, at: [0.67, 0.42], shade: 'spot' },
  { file: 'steam-small-capsule-231x87.png', w: 231, h: 87, plate: 'keyart', pos: '50% 42%', logo: 0.86, at: [0.62, 0.5], shade: 'spot', compact: true },
  { file: 'steam-main-capsule-616x353.png', w: 616, h: 353, plate: 'keyart', pos: '50% 50%', logo: 0.5, at: [0.68, 0.37], shade: 'spot', tag: true },
  // itch.io / web / press
  { file: 'itch-cover-630x500.png', w: 630, h: 500, plate: 'keyart', pos: '30% 50%', logo: 0.42, at: [0.62, 0.27], shade: 'top', tag: true },
  { file: 'og-image-1200x630.png', w: 1200, h: 630, plate: 'keyart', pos: '50% 50%', logo: 0.5, at: [0.68, 0.38], shade: 'spot', tag: true },
  { file: 'key-art-1920x1080.png', w: 1920, h: 1080, plate: 'keyart', pos: '50% 50%', logo: 0.46, at: [0.69, 0.36], shade: 'spot', tag: true },
  { file: 'key-art-horde-1920x1080.png', w: 1920, h: 1080, plate: 'horde', pos: '50% 50%', logo: 0.42, at: [0.5, 0.45], shade: 'center', tag: true },
  { file: 'logo-1280x720.png', w: 1280, h: 720, plate: null, logo: 0.8, at: [0.5, 0.5], transparent: true, tag: true },
];

function composePage(a, logoHtml, cssHref) {
  const shade = {
    center: 'radial-gradient(ellipse 70% 75% at 50% 50%, rgba(11,9,33,.55), rgba(11,9,33,.15) 70%, rgba(11,9,33,.35))',
    top: 'linear-gradient(180deg, rgba(11,9,33,.72) 0%, rgba(11,9,33,.25) 42%, rgba(11,9,33,0) 60%, rgba(11,9,33,.35) 100%)',
    right: 'linear-gradient(270deg, rgba(11,9,33,.6) 0%, rgba(11,9,33,.15) 45%, rgba(11,9,33,0) 60%)',
    page: 'linear-gradient(180deg, rgba(11,9,33,.25), rgba(11,9,33,.85))',
    // a soft dark pool behind the logo so it reads over any plate
    spot: `radial-gradient(ellipse ${a.compact ? '60% 90%' : '34% 46%'} at ${(a.at?.[0] ?? 0.5) * 100}% ${(a.at?.[1] ?? 0.5) * 100}%, rgba(11,9,33,.62), rgba(11,9,33,.25) 55%, rgba(11,9,33,0) 80%)`,
    none: 'none',
  }[a.shade ?? 'none'];
  // logo intrinsic height ≈ 3.7em of html font-size (emblem + two lines + tag); scale the root size to fit
  const logoPx = a.logo * a.h;
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${cssHref}">
<style>
  html, body { margin: 0; width: ${a.w}px; height: ${a.h}px; overflow: hidden; background: ${a.transparent ? 'transparent' : '#0b0921'}; }
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .stage { position: fixed; inset: 0; }
  .stage > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: ${a.pos ?? '50% 50%'}; }
  .shade { position: absolute; inset: 0; background: ${shade}; }
  .logo-wrap { position: absolute; left: ${(a.at?.[0] ?? 0.5) * 100}%; top: ${(a.at?.[1] ?? 0.5) * 100}%; transform: translate(-50%, -50%); }
  .logo-wrap .logo { transform-origin: center; }
  .logo-text > span::after { display: none !important; }
  .logo-tag { text-shadow: 0 0.12em 0 #120b2e, 0 0 0.5em #120b2e, 0 0 1.1em rgba(18, 11, 46, 0.95) !important; font-weight: 600; }
  ${a.transparent ? '.logo-glow { display: none !important; }' : ''}
  ${a.tag ? '' : '.logo-tag { display: none !important; }'}
  ${a.compact ? '.logo .emblem { display: none !important; } .logo-glow { display: none !important; }' : ''}
</style></head><body>
<div class="stage">${a.plate ? `<img src="/__art/plates/${a.plate}.png">` : ''}<div class="shade"></div>
<div class="logo-wrap" data-target="${logoPx}" data-ax="${a.at?.[0] ?? 0.5}">${a.logo ? logoHtml : ''}</div></div>
</body></html>`;
}

if (doCompose) {
  const logoFile = join(out, 'plates', 'logo.html');
  if (!existsSync(logoFile)) console.warn('  ! plates/logo.html missing — run the capture for "title" first');
  else {
    const logoHtml = readFileSync(logoFile, 'utf8');
    const index = readFileSync(join(dist, 'index.html'), 'utf8');
    const cssHref = '/' + (index.match(/href="\.?\/?(assets\/[^"]+\.css)"/)?.[1] ?? 'assets/index.css');
    console.log(`composing ${ASSETS.length} store assets → ${join(out, 'capsules')}`);
    const page = await browser.newPage({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 1 });
    for (const a of ASSETS) {
      if (a.plate && !existsSync(join(out, 'plates', `${a.plate}.png`))) { console.warn(`  ! ${a.file}: plate ${a.plate} missing`); continue; }
      composeHtml = composePage(a, logoHtml, cssHref);
      await page.setViewportSize({ width: a.w, height: a.h });
      await page.goto(`${base}/__compose.html`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState('networkidle');
      // fit the logo to its target height
      await page.evaluate(() => {
        const wrap = document.querySelector('.logo-wrap');
        const logo = wrap?.querySelector('.logo');
        if (!logo) return;
        const target = Number(wrap.dataset.target);
        document.documentElement.style.fontSize = '16px';
        const h = logo.getBoundingClientRect().height;
        const wv = logo.getBoundingClientRect().width;
        const ax = Number(wrap.dataset.ax);
        const room = Math.min(ax, 1 - ax) * 2 * innerWidth * 0.92; // stay inside the frame around the logo centre
        const k = Math.min(target / h, room / wv);
        document.documentElement.style.fontSize = `${16 * k}px`;
      });
      await page.waitForTimeout(150);
      await page.screenshot({ path: join(out, 'capsules', a.file), omitBackground: !!a.transparent });
      console.log(`  ✔ capsules/${a.file}`);
    }
    await page.close();
  }
}

// ---------------------------------------------------------------- gameplay capture (trailer / GIF)
if (doVideo) {
  const [VW, VH] = opt('--video-res', '1280x720').split('x').map(Number);
  const FPS = Number(opt('--fps', '30'));
  const SECONDS = Number(opt('--seconds', '12'));
  const frameDir = join(out, 'capture', 'frames');
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  console.log(`recording ${SECONDS}s @ ${FPS} fps (${VW}×${VH}) as fixed-step frames → ${frameDir}`);
  const { ctx, page } = await openGame({ viewport: { width: VW, height: VH } });
  await S(page, () => window.__stage.start('biome_pines', 'char_keeper'));
  await S(page, () => window.__stage.ff(150));
  // a mid-vigil kit (not the evolved hero kit, which clears the screen in seconds) against a tougher, refilled crowd
  await S(page, () => { const st = window.__stage; st.drop('*'); st.level(19); st.kit(
    [['cinder_halo', 7], ['spark_chain', 6], ['ember_bolt', 7], ['brazier', 5], ['moth_lantern', 4]],
    [['bellows', 2], ['clockwork', 2], ['flint', 2], ['lodestone', 2]]); });
  await S(page, () => { window.__game.enemies.clear(); window.__stage.ring(260, ['shade', 'crawler', 'wisp', 'stalker', 'shade', 'brute', 'wisp'], 6, 15, 0, 0, 2.5); });
  // no level-up / reliquary overlays popping up mid-clip (the clip is about the fight)
  await S(page, () => {
    const gm = window.__game;
    gm.openLevelUp = () => { gm.run.pendingLevelUps = 0; };
    gm.openChest = () => {};
  });
  await settle(page, 10, 1);
  await page.addStyleTag({ content: '.fxt-big { display: none !important; }' });
  const total = SECONDS * FPS;
  for (let f = 0; f < total; f++) {
    await page.evaluate(({ f, FPS, SECONDS }) => {
      const gm = window.__game;
      const t = f / FPS;
      // the bearer kites a lazy S-curve; reinforcements keep the crowd up; the boss steps in near the end
      const a = -Math.PI / 2 + Math.sin(t * 0.45) * 1.3;
      if (gm.state === 'levelup') window.__stage.autoPick();
      window.__stage.move = [Math.cos(a) * 0.85, Math.sin(a) * 0.85];
      if (f % 15 === 0 && gm.enemies.activeCount < 300) window.__stage.ring(26, ['shade', 'crawler', 'wisp', 'stalker', 'shade'], 11, 6, 0, 0, 2.5);
      if (f === Math.round(FPS * (SECONDS - 4.5))) gm.enemies.spawn(gm.world.biome.bossId, gm.player.x + 1, gm.player.z - 10);
      gm.player.invuln = 0.39;
      gm.player.lightValue = Math.max(gm.player.lightValue, gm.run.stats.maxLight * 0.6);
      window.__step(1 / FPS);
    }, { f, FPS, SECONDS });
    await page.screenshot({ path: join(frameDir, `f${String(f).padStart(4, '0')}.png`) });
    if (f % 60 === 0) console.log(`  frame ${f}/${total} ${secs()}`);
  }
  await ctx.close();
  const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
  if (!hasFfmpeg) console.warn('  ! ffmpeg not found: frames kept in capture/frames, assemble them manually');
  else {
    const inPat = join(frameDir, 'f%04d.png');
    const ff = (a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
    // particle-heavy footage compresses poorly: these settings keep the files upload-friendly
    // (mp4 ~10 MB master for editing, webm ~6 MB for web embeds, GIF ≤ ~5 MB for Steam/itch)
    ff(['-framerate', String(FPS), '-i', inPat, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', join(out, 'capture', 'gameplay.mp4')]);
    ff(['-framerate', String(FPS), '-i', inPat, '-c:v', 'libvpx-vp9', '-b:v', '3M', '-maxrate', '4M', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', join(out, 'capture', 'gameplay.webm')]);
    ff(['-ss', '1', '-t', '5', '-framerate', String(FPS), '-i', inPat, '-vf', 'fps=12,scale=440:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', join(out, 'capture', 'gameplay.gif')]);
    if (!flag('--keep-frames')) rmSync(frameDir, { recursive: true, force: true });
    console.log(`  ✔ capture/gameplay.mp4 · gameplay.webm · gameplay.gif (${secs()})`);
  }
}

await browser.close();
server.close();
if (errors.length) {
  console.warn(`console/page errors during capture (${errors.length}):\n  ${[...new Set(errors)].slice(0, 10).join('\n  ')}`);
}
console.log(`done in ${secs()} → ${out}`);
const list = (d) => (existsSync(join(out, d)) ? readdirSync(join(out, d)).filter((f) => f.endsWith('.png')).length : 0);
console.log(`  screens: ${list('screens')} · plates: ${list('plates')} · capsules: ${list('capsules')}`);
