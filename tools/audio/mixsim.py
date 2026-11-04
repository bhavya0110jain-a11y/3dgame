"""Offline simulation of the runtime mix (pre master-dynamics) for the mix sheet.

Reads the encoded OGGs, applies the gains/limits/density law from src/audio/Audio.ts (parsed from the
source so the numbers cannot drift) and renders three 20 s scenarios at default volume settings.
Usage: python tools/audio/mixsim.py [out_dir_for_wavs]
"""
from __future__ import annotations

import math
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dsp  # noqa: E402
from build import decode  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
AUD = os.path.join(ROOT, 'public', 'audio')
TS = open(os.path.join(ROOT, 'src', 'audio', 'Audio.ts')).read()

DEFS = {}
for m in re.finditer(r"(\w+): D\('(\w+)', (-?[\d.]+)(?:, \{([^}]*)\})?\)", TS):
    name, sample, dbv, opts = m.group(1), m.group(2), float(m.group(3)), m.group(4) or ''
    o = dict(re.findall(r'(\w+): (-?[\d.]+)', opts))
    DEFS[name] = {'sample': sample, 'db': dbv, 'gap': float(o.get('gap', 0)), 'voices': int(float(o.get('voices', 4))),
                  'dense': 'dense: true' in opts, 'duck': float(o.get('duck', 0)), 'rel': float(o.get('duckRelease', 0.8)),
                  'cents': float(o.get('cents', 0))}
MUSIC_TRIM = float(re.search(r'MUSIC_TRIM = ([\d.]+)', TS).group(1))
AMB_TRIM = float(re.search(r'AMB_TRIM = ([\d.]+)', TS).group(1))
SFX_TRIM = float(re.search(r'SFX_TRIM = ([\d.]+)', TS).group(1))
VOL = {'master': 0.8, 'music': 0.6, 'sfx': 0.8}
SR = dsp.SR
_cache: dict[str, np.ndarray] = {}


def load(f: str) -> np.ndarray:
    if f not in _cache:
        _cache[f] = decode(os.path.join(AUD, f))
    return _cache[f]


def files_for(sample: str) -> list[str]:
    fs = sorted(f for f in os.listdir(AUD) if re.fullmatch(rf'sfx_{sample}(_\d+)?\.ogg', f))
    return fs


def scenario(seconds: float, rates: dict[str, float], layers: list[float], light_events=(), seed=1):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    music = np.zeros((2, n))
    for i, g in enumerate(layers):
        if g <= 0:
            continue
        x = load(f'mus_run_{i}.ogg')[:, 2048:]
        reps = int(math.ceil(n / x.shape[1]))
        music += np.tile(x, reps)[:, :n] * g
    amb = load('amb_night.ogg')[:, 2048:]
    amb = np.tile(amb, int(math.ceil(n / amb.shape[1])))[:, :n] * AMB_TRIM
    sfx = np.zeros((2, n + SR * 6))
    duck = np.ones(n)
    events = []
    for name, rate in rates.items():
        t = 0.0
        while True:
            t += rng.exponential(1 / rate)
            if t >= seconds:
                break
            events.append((t, name))
    events += list(light_events)
    events.sort()
    last, dens, dens_t, combo, combo_t = {}, {}, {}, 0, -9.0
    active: dict[str, list[float]] = {}
    for t, name in events:
        d = DEFS[name]
        if t - last.get(name, -9) < d['gap']:
            continue
        last[name] = t
        act = [e for e in active.get(d['sample'], []) if e > t]
        if len(act) >= d['voices']:
            act.pop(0)
        gdb = d['db']
        rate = 2 ** (rng.uniform(-1, 1) * d['cents'] / 1200)
        if name == 'pickup':
            if t - combo_t > 0.8:
                combo = 0
            combo_t = t
            step = min(combo, 10)
            combo += 1
            rate *= 2 ** ([0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24][step] / 12)
            gdb -= step * 0.35
        if d['dense']:
            dd = dens.get(d['sample'], 0) * math.exp(-(t - dens_t.get(d['sample'], t)) / 0.35) + 1
            dens[d['sample']] = dd
            dens_t[d['sample']] = t
            if dd > 2:
                gdb -= min(9, 4.5 * math.log2(dd / 2))
        fs = files_for(d['sample'])
        x = load(fs[rng.integers(0, len(fs))])
        if rate != 1:
            x = dsp.resample_pitch(x, rate)
        pan = rng.uniform(-0.4, 0.4)
        x = x * np.array([[math.cos((pan + 1) * math.pi / 4)], [math.sin((pan + 1) * math.pi / 4)]]) * math.sqrt(2)
        dsp.mix_into(sfx, x, int(t * SR), dsp.db(gdb))
        act.append(t + x.shape[1] / SR)
        active[d['sample']] = act
        if d['duck']:
            a = int(t * SR)
            k = np.arange(n - a) / SR
            env = 1 - (1 - dsp.db(d['duck'])) * np.exp(-np.maximum(k - 0.15, 0) / (d['rel'] / 3))
            duck[a:] = np.minimum(duck[a:], env)
    sfx = sfx[:, :n] * VOL['sfx'] ** 2 * SFX_TRIM
    mus = (music * duck + amb) * MUSIC_TRIM * VOL['music'] ** 2
    mix = (sfx + mus) * VOL['master'] ** 2
    return mix, mus * VOL['master'] ** 2, sfx * VOL['master'] ** 2


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else None
    scen = {
        'calm (base layer, light combat)': dict(rates={'hit': 2, 'kill': 0.8, 'pickup': 1.5, 'fire_bolt': 1.6}, layers=[1, 0, 0, 0]),
        'mid (3 layers, steady combat)': dict(rates={'hit': 10, 'kill': 4, 'pickup': 6, 'fire_bolt': 2, 'fire_spark': 1,
                                                      'fire_frost': 1, 'crit': 1.5, 'hurt': 0.25}, layers=[1, 1, 1, 0]),
        'peak (all layers, 300+ enemies)': dict(rates={'hit': 40, 'kill': 15, 'pickup': 20, 'fire_bolt': 3, 'fire_spark': 1.5,
                                                        'fire_frost': 1.5, 'fire_hook': 1, 'fire_moth': 2, 'crit': 6,
                                                        'explode': 1, 'hurt': 0.5, 'fire_nova': 0.3},
                                                 layers=[1, 1, 1, 1], light_events=[(8.0, 'levelup'), (14.0, 'chest')]),
    }
    print(f'{"scenario":34s} {"mix LUFS":>8s} {"peak":>6s} {"music":>7s} {"sfx":>7s} {"sfx-mus":>7s}')
    for k, s in scen.items():
        mix, mus, sfx = scenario(20.0, **s)
        lm, ls = dsp.lufs(mus), dsp.lufs(sfx)
        print(f'{k:34s} {dsp.lufs(mix):8.1f} {20 * np.log10(np.max(np.abs(mix))):6.1f} {lm:7.1f} {ls:7.1f} {ls - lm:7.1f}')
        if out:
            import wave
            y = (np.clip(mix, -1, 1).T * 32767).astype('<i2')
            w = wave.open(os.path.join(out, re.sub(r'\W+', '_', k.split(' ')[0]) + '.wav'), 'wb')
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(y.tobytes())
            w.close()


if __name__ == '__main__':
    main()
