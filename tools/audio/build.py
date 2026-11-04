"""Render + encode + analyse every Last Lantern audio asset.

Usage:
    python tools/audio/build.py [--only sfx|music] [--preview DIR]

Needs numpy + scipy (+ Pillow for --preview spectrograms) and ffmpeg with libvorbis.
Outputs:
    public/audio/*.ogg                Ogg Vorbis, 48 kHz (music loops carry wrap-around padding)
    src/audio/audioManifest.ts        generated: file list, variants, loop points
    tools/audio/report.json           per-file stats (peak, RMS, LUFS, centroid, seam, size)
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dsp  # noqa: E402
import music  # noqa: E402
import sfx  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'audio')
LOOP_PAD = 2048  # wrap-around samples on each side of a loop (protects the seam from resampler edges)


def encode(x: np.ndarray, path: str, q: float) -> None:
    x = np.clip(x, -1, 1)
    ch = 2 if x.ndim == 2 else 1
    pcm = (x.T if ch == 2 else x).astype('<f4').tobytes()
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(dsp.SR), '-ac', str(ch),
           '-i', '-', '-c:a', 'libvorbis', '-q:a', str(q), path]
    subprocess.run(cmd, input=pcm, check=True)


def decode(path: str) -> np.ndarray:
    p = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '2',
                        '-ar', str(dsp.SR), '-'], capture_output=True, check=True)
    a = np.frombuffer(p.stdout, dtype='<f4').reshape(-1, 2).T.astype(np.float64)
    return a


def spectrogram_png(x: np.ndarray, path: str, title: str = '') -> None:
    from PIL import Image, ImageDraw
    mono = x.mean(axis=0) if x.ndim == 2 else x
    W, H = 900, 260
    hop = max(1, len(mono) // W)
    win = 2048
    pad = np.pad(mono, (win, win))
    cols = []
    hann = np.hanning(win)
    for i in range(W):
        s = i * hop + win // 2
        seg = pad[s:s + win] * hann
        cols.append(np.abs(np.fft.rfft(seg)))
    S = np.array(cols).T  # freq x time
    freqs = np.fft.rfftfreq(win, 1 / dsp.SR)
    # log-frequency rows 40 Hz .. 16 kHz
    rows = np.geomspace(40, 16000, H)
    idx = np.searchsorted(freqs, rows).clip(0, len(freqs) - 1)
    img = 20 * np.log10(S[idx] + 1e-9)
    img = np.clip((img - (img.max() - 80)) / 80, 0, 1)[::-1]
    rgb = np.stack([img ** 0.6 * 255, img ** 1.2 * 200, (1 - img) * 60 + img * 255 * 0.3], axis=-1).astype(np.uint8)
    im = Image.fromarray(rgb, 'RGB')
    # waveform strip
    wave = Image.new('RGB', (W, 80), (12, 12, 20))
    d = ImageDraw.Draw(wave)
    blk = max(1, len(mono) // W)
    for i in range(W):
        seg = mono[i * blk:(i + 1) * blk]
        if len(seg) == 0:
            continue
        a, b = float(seg.min()), float(seg.max())
        d.line([(i, 40 - b * 38), (i, 40 - a * 38)], fill=(240, 190, 90))
    full = Image.new('RGB', (W, H + 100), (0, 0, 0))
    full.paste(im, (0, 20))
    full.paste(wave, (0, H + 20))
    ImageDraw.Draw(full).text((6, 4), title, fill=(255, 255, 255))
    full.save(path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', choices=['sfx', 'music'])
    ap.add_argument('--preview', help='directory for spectrogram PNGs')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    if args.preview:
        os.makedirs(args.preview, exist_ok=True)
    report_path = os.path.join(HERE, 'report.json')
    report = json.load(open(report_path)) if os.path.exists(report_path) else {}
    manifest_path = os.path.join(HERE, 'manifest.json')
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {'sfx': {}, 'music': {}}

    def emit(key: str, x: np.ndarray, q: float, loop: bool = False):
        fname = f'{key}.ogg'
        path = os.path.join(OUT, fname)
        st = dsp.stats(x)
        if loop:
            body = np.concatenate([x[..., -LOOP_PAD:], x, x[..., :LOOP_PAD]], axis=-1)
        else:
            # trailing silence: libvorbis may drop the last ~128 samples of short mono files
            body = np.concatenate([x, np.zeros(x.shape[:-1] + (1024,))], axis=-1)
        encode(body, path, q)
        dec = decode(path)
        st['decoded_peak_dbfs'] = round(20 * np.log10(np.max(np.abs(dec)) + 1e-12), 2)
        st['decoded_clipped'] = int(np.sum(np.abs(dec) >= 0.999))
        st['decoded_len_samples'] = int(dec.shape[1])
        st['expected_len_samples'] = int(body.shape[-1] if loop else x.shape[-1])
        st['loop'] = loop
        st['bytes'] = os.path.getsize(path)
        report[key] = st
        if args.preview:
            spectrogram_png(x, os.path.join(args.preview, f'{key}.png'), f'{key}  {st}')
        print(f'{key:18s} {st["len_s"]:6.2f}s peak {st["peak_dbfs"]:6.1f} lufs {st["lufs"]:6.1f} '
              f'mmax {st["mmax_lufs"]:6.1f} cen {st["centroid_hz"]:5d} seam {st["seam_ratio"]:5.2f} '
              f'{st["bytes"] / 1024:7.1f} KB', flush=True)
        return fname

    t0 = time.time()
    if args.only in (None, 'sfx'):
        manifest['sfx'] = {}
        for name, (fn, variants, target, stereo) in sfx.SFX.items():
            files = []
            for v in range(variants):
                x = sfx.render_sfx(name, v)
                files.append(emit(f'sfx_{name}_{v}' if variants > 1 else f'sfx_{name}', x, 4 if not stereo else 3))
            manifest['sfx'][name] = files

    if args.only in (None, 'music'):
        manifest['music'] = {}
        LP = LOOP_PAD / dsp.SR

        def loop_entry(fname, x):
            return {'file': fname, 'loopStart': LP, 'loopEnd': LP + x.shape[-1] / dsp.SR, 'loop': True}

        m = music.render_menu()['menu']
        manifest['music']['menu'] = [loop_entry(emit('mus_menu', m, 3, True), m)]
        run = music.render_run()
        manifest['music']['run'] = [loop_entry(emit(f'mus_{k}', v, 2, True), v) for k, v in run.items()]
        run_mix = sum(run.values())
        report['mus_run_fullmix'] = dsp.stats(run_mix)
        print('run full mix', report['mus_run_fullmix'])
        b = music.render_boss()['boss']
        manifest['music']['boss'] = [loop_entry(emit('mus_boss', b, 3, True), b)]
        a = music.render_ambience()
        manifest['music']['ambience'] = [loop_entry(emit('amb_night', a, 0, True), a)]
        v = music.render_victory()
        manifest['music']['victory'] = [{'file': emit('stg_victory', v, 3), 'loop': False}]
        d = music.render_defeat()
        manifest['music']['defeat'] = [{'file': emit('stg_defeat', d, 3), 'loop': False}]

    json.dump(report, open(report_path, 'w'), indent=1, sort_keys=True)
    json.dump(manifest, open(manifest_path, 'w'), indent=1, sort_keys=True)
    write_ts_manifest(manifest)
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith('.ogg'))
    print(f'done in {time.time() - t0:.1f}s, public/audio total {total / 1024 / 1024:.2f} MB')


def write_ts_manifest(manifest: dict) -> None:
    lines = [
        '// GENERATED by tools/audio/build.py — do not edit by hand.',
        '/** Sample files per SFX name (round-robin variants). */',
        'export const SFX_FILES: Record<string, string[]> = ' + json.dumps(manifest['sfx'], indent=2, sort_keys=True) + ';',
        '',
        'export interface MusicFile { file: string; loop: boolean; loopStart?: number; loopEnd?: number }',
        '/** Music cues: menu, run (4 sample-locked stems), boss, ambience, victory, defeat. */',
        'export const MUSIC_FILES: Record<string, MusicFile[]> = ' + json.dumps(manifest['music'], indent=2, sort_keys=True) + ';',
        '',
    ]
    open(os.path.join(ROOT, 'src', 'audio', 'audioManifest.ts'), 'w').write('\n'.join(lines))


if __name__ == '__main__':
    main()
