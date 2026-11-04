// Offline audio check: boots the production build in headless Chromium, renders every sfx and each biome's music
// (at low and high flight intensity) through an OfflineAudioContext, writes WAVs and prints level stats.
// Usage: npm run build && node tools/audio/render.mjs [outDir]
// Fails (exit 1) on NaN, silence or hard clipping, so it doubles as an audio regression check.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? join(here, '..', '..', 'audio-out'));
mkdirSync(outDir, { recursive: true });
const dist = resolve(join(here, '..', '..', 'dist'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = join(dist, url === '/' ? 'index.html' : url);
  try { const b = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => !!window.__game, null, { timeout: 120_000 });
await page.evaluate(() => { window.__game.manual = true; });

/** Renders one clip in the page; returns {stats, b64} (16-bit stereo PCM, base64). */
async function clip(name, spec) {
  const r = await page.evaluate(async ({ spec }) => {
    const SR = 44100;
    const G = window.__game;
    const AudioCls = G.audio.constructor;
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * spec.dur), SR);
    const Real = window.AudioContext;
    window.AudioContext = function () { return ctx; };
    const a = new AudioCls();
    a.unlock();
    window.AudioContext = Real;
    a.setVolumes(0.8, 0.55, 0.8);
    if (spec.kind === 'sfx') {
      for (const ev of spec.events) ctx.suspend(ev.t).then(() => { a.sfx(ev.name, ev.arg ?? 0, ev.pan ?? 0); return ctx.resume(); });
      // keep the wind bed quiet for isolated sfx
      a.setFlight(0, false, 0, 1, 0, false);
    } else if (spec.kind === 'flight') {
      for (let t = 0.05; t < spec.dur; t += 0.05) {
        ctx.suspend(t).then(() => {
          // fixed profile: cruise → dive (speed builds, bank sweep) → hazard pass-by → updraft → calm
          const dive = t > 2 && t < 4.5;
          const speed = t < 2 ? 0.15 : t < 4.5 ? Math.min(1, 0.15 + (t - 2) * 0.4) : Math.max(0.2, 1 - (t - 4.5) * 0.5);
          const near = t > 5 && t < 6.2 ? 1 + Math.abs(t - 5.6) * 8 : 99;
          a.lastFlight = -1;
          a.setFlight(speed, dive, Math.sin(t * 1.3) * 0.8, 1, 0, true, near, t > 6.5 && t < 8);
          return ctx.resume();
        });
      }
    } else {
      a.startMusic(spec.menu ? 'menu' : 'run');
      if (a.musicTimer !== null) { clearInterval(a.musicTimer); a.musicTimer = null; }
      a.setMusicMood(spec.mood);
      a.mood = a.pendingMood ?? a.mood;
      a.pendingMood = null;
      a.nextEighth = 0.05;
      a.setFlight(0, false, 0, 1, 0, false); // silence wind for music clips
      for (let t = 0.02; t < spec.dur; t += 0.1) {
        ctx.suspend(t).then(() => {
          a.targetIntensity = spec.intensity;
          a.intensity = spec.intensity;
          a.lowLift = spec.lowLift ?? 0;
          a.schedule();
          return ctx.resume();
        });
      }
    }
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let peak = 0, sum = 0, nan = 0, clipN = 0;
    for (let i = 0; i < L.length; i++) {
      const l = L[i], r = R[i];
      if (!Number.isFinite(l) || !Number.isFinite(r)) { nan++; continue; }
      const m = Math.max(Math.abs(l), Math.abs(r));
      if (m > peak) peak = m;
      if (m >= 0.999) clipN++;
      sum += l * l + r * r;
    }
    const rms = Math.sqrt(sum / (2 * L.length));
    const pcm = new Int16Array(L.length * 2);
    for (let i = 0; i < L.length; i++) {
      pcm[i * 2] = Math.max(-1, Math.min(1, L[i] || 0)) * 32767;
      pcm[i * 2 + 1] = Math.max(-1, Math.min(1, R[i] || 0)) * 32767;
    }
    let bin = '';
    const u8 = new Uint8Array(pcm.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { stats: { peak: +peak.toFixed(3), rmsDb: +(20 * Math.log10(rms + 1e-9)).toFixed(1), nan, clip: clipN }, b64: btoa(bin) };
  }, { spec });
  const pcm = Buffer.from(r.b64, 'base64');
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(44100, 24);
  hdr.writeUInt32LE(44100 * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
  await writeFile(join(outDir, `${name}.wav`), Buffer.concat([hdr, pcm]));
  console.log(name.padEnd(22), JSON.stringify(r.stats));
  return r.stats;
}

const failures = [];
const check = (name, s, minDb = -60) => {
  if (s.nan) failures.push(`${name}: NaN samples`);
  if (s.clip > 20) failures.push(`${name}: clipping (${s.clip} samples)`);
  if (s.rmsDb < minDb) failures.push(`${name}: silent (${s.rmsDb} dB)`);
};

const SFX = ['ring', 'perfect', 'glimmer', 'whisker', 'whisker_out', 'crash', 'splash', 'shield', 'shrine', 'boon', 'dive', 'lightning', 'gust', 'arch', 'updraft', 'lowlift', 'click', 'buy', 'deny', 'biome', 'combo_lost', 'achievement', 'start'];
for (const n of SFX) check(n, await clip(`sfx-${n}`, { kind: 'sfx', dur: n === 'biome' ? 3.5 : 2.5, events: [{ t: 0.05, name: n, arg: 1 }] }), n === 'hover' ? -80 : -62);
// a 12-ring combo chain: the ladder should climb
check('combo-chain', await clip('sfx-combo-chain', { kind: 'sfx', dur: 6.5, events: Array.from({ length: 12 }, (_, i) => ({ t: 0.05 + i * 0.45, name: i % 4 === 3 ? 'perfect' : 'ring', arg: i + 1, pan: Math.sin(i) * 0.6 })) }));
// a glimmer line (sparkle ticks walking up)
check('glimmer-line', await clip('sfx-glimmer-line', { kind: 'sfx', dur: 2.5, events: Array.from({ length: 10 }, (_, i) => ({ t: 0.05 + i * 0.12, name: 'glimmer', arg: 0 })) }));
// music: every biome at calm and full intensity, plus the menu
for (let m = 0; m < 4; m++) {
  check(`music-${m}-calm`, await clip(`music-${m}-calm`, { kind: 'music', mood: m, intensity: 0.25, dur: 12 }));
  check(`music-${m}-full`, await clip(`music-${m}-full`, { kind: 'music', mood: m, intensity: 0.95, dur: 12 }));
}
check('music-0-lowlift', await clip('music-0-lowlift', { kind: 'music', mood: 0, intensity: 0.6, lowLift: 1, dur: 8 }));
check('music-menu', await clip('music-menu', { kind: 'music', menu: true, mood: 0, intensity: 0.2, dur: 10 }));
// wind bed: cruise → dive → near-miss → updraft
check('wind-flight', await clip('wind-flight', { kind: 'flight', dur: 9 }));

console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
if (errors.length) failures.push(...errors);
await browser.close();
server.close();
if (failures.length) {
  console.log('FAIL\n' + failures.join('\n'));
  process.exit(1);
}
console.log('audio OK →', outDir);
