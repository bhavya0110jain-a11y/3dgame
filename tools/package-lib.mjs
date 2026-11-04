// Shared helpers for the tools/package-*.mjs release scripts: a minimal, dependency-free ZIP writer + reader.
// Deflate via node:zlib, deterministic timestamps (reproducible archives), UTF-8 names, forward slashes.
import { deflateRawSync, inflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Recursively lists files under `dir` as posix-style relative paths, sorted for determinism. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out;
}

// Already-compressed formats are stored, not deflated (faster, no size gain from deflate).
const STORE_EXT = /\.(png|jpe?g|webp|ogg|mp3|woff2?|glb|zip|gz|ktx2)$/i;
// 2026-01-01 00:00 in DOS time — fixed so identical inputs give byte-identical zips.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** Builds a zip Buffer from [{ name, data }]. */
export function zipEntries(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const store = STORE_EXT.test(name) || data.length < 64;
    let body = store ? data : deflateRawSync(data, { level: 9 });
    let method = store ? 0 : 8;
    if (!store && body.length >= data.length) { body = data; method = 0; }
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by: unix, v3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Zips every file under `dir` (paths relative to dir, so index.html sits at the zip root). */
export function zipDirectory(dir, filter = () => true, extra = []) {
  const names = listFiles(dir).filter(filter).filter((n) => !extra.some((e) => e.name === n));
  const entries = [...names.map((name) => ({ name, data: readFileSync(join(dir, name)) })), ...extra];
  return { names: entries.map((e) => e.name), buffer: zipEntries(entries) };
}

/** Reads a zip produced by zipEntries (or any non-zip64 archive) into Map<name, Buffer>; verifies CRCs. */
export function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const dataStart = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch: ${name}`);
    files.set(name, data);
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

/**
 * Builds THIRD_PARTY_NOTICES.txt for everything that ships inside the game bundle (runtime
 * `dependencies` of package.json: three.js, N8AO, Fontsource fonts). MIT/ISC/OFL all require the
 * licence text to travel with redistributed copies — the web zip and the desktop app both include it.
 * Electron's own notices (LICENSE.electron.txt, LICENSES.chromium.html) are added by electron-builder.
 */
export function thirdPartyNotices(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const parts = [
    'Last Lantern — third-party notices',
    '==================================',
    '',
    'Last Lantern bundles the following open-source software and fonts. Full credits: CREDITS.md / in-game Credits.',
    '',
  ];
  for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
    const dir = join(root, 'node_modules', name);
    let meta;
    try { meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { continue; }
    const licFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
    const text = licFile ? readFileSync(join(dir, licFile), 'utf8').trim() : `(${meta.license ?? 'see package'})`;
    parts.push('-'.repeat(78), `${name} ${meta.version} — ${meta.license ?? 'unknown licence'}`,
      meta.homepage ? `Homepage: ${meta.homepage}` : '', '', text, '');
  }
  return parts.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') + '\n';
}
