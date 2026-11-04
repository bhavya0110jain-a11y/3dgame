"""Last Lantern sound effects (rendered offline).

Design rules (see design/audio/mix-sheet.md):
  * frequent sounds (hit, kill, pickup, weapon fire) are short, mid-focused (centroid 1-3 kHz),
    soft-transient and quiet; variety comes from 3-4 round-robin variants + runtime pitch jitter.
  * big moments (level-up, chest, evolution, boss) are stereo, wide, long-tailed and loud; they duck music.
  * everything shares the storybook palette: bells, celesta, harp, warm noise, wood and glass.

Each entry: name -> (render_fn, variants, target momentary-max LUFS, stereo?)
"""
from __future__ import annotations

import numpy as np

import dsp
import instruments as I
from dsp import SR, ns, tarr, env_exp, white, lp, hp, bp, sine, saw, mtof, sat


def _sweep_sine(f0: float, f1: float, n: int, curve: float = 0.03) -> np.ndarray:
    t = tarr(n)
    fr = f1 + (f0 - f1) * np.exp(-t / curve)
    return np.sin(2 * np.pi * np.cumsum(fr) / SR)


def _crackle(n: int, density: float = 120.0, amp: float = 0.3, hp_hz: float = 2500) -> np.ndarray:
    out = np.zeros(n)
    k = int(density * n / SR)
    for _ in range(k):
        p = dsp.rng.integers(0, max(1, n - 200))
        L = dsp.rng.integers(20, 120)
        out[p:p + L] += white(L) * np.exp(-np.arange(L) / (L / 4)) * dsp.rng.uniform(0.3, 1.0)
    return hp(out, hp_hz) * amp


def _room(x: np.ndarray, wet: float = 0.25, rt: float = 0.7) -> np.ndarray:
    w = dsp.wet_only(x, f'sfxroom_{rt}', seconds=rt, predelay=0.006, width=1.0)
    return dsp.pad_to(dsp.stereo(x) if x.ndim == 1 else x, w.shape[1]) + w * wet


def _mono(x: np.ndarray) -> np.ndarray:
    return x.mean(axis=0) if x.ndim == 2 else x


# ============================================================================= UI
def ui_hover(v):
    n = ns(0.06)
    t = tarr(n)
    x = np.sin(2 * np.pi * 2350 * t) * env_exp(n, 0.035, 0.0008) * 0.5
    x += bp(white(n), 5000, 3) * env_exp(n, 0.006, 0.0003) * 0.25
    return x


def ui_click(v):
    n = ns(0.12)
    t = tarr(n)
    x = bp(white(n), 1500, 4) * env_exp(n, 0.03, 0.0005) * 1.2
    x += np.sin(2 * np.pi * 720 * t) * env_exp(n, 0.06, 0.0008) * 0.6
    x += _sweep_sine(260, 140, n, 0.02) * env_exp(n, 0.05) * 0.5
    return _mono(_room(x, 0.12, 0.4))


def ui_confirm(v):
    out = np.zeros(ns(1.0))
    dsp.mix_into(out, I.celesta(mtof(81), 0.8, 0.8), 0)
    dsp.mix_into(out, I.celesta(mtof(86), 0.9, 0.9), ns(0.07))
    dsp.mix_into(out, I.harp(mtof(74), 0.6, 0.8) * 0.6, 0)
    return _mono(_room(out, 0.3, 0.9))


def ui_back(v):
    out = np.zeros(ns(0.7))
    dsp.mix_into(out, lp(I.celesta(mtof(86), 0.6, 0.5), 3500), 0)
    dsp.mix_into(out, lp(I.celesta(mtof(79), 0.6, 0.6), 3000), ns(0.06))
    return _mono(_room(out, 0.25, 0.7))


def ui_deny(v):
    n = ns(0.3)
    out = np.zeros(n)
    for k in range(2):
        m = ns(0.1)
        t = tarr(m)
        b = (np.sin(2 * np.pi * 180 * t) + 0.4 * np.sin(2 * np.pi * 270 * t)) * env_exp(m, 0.09)
        b += bp(white(m), 600, 2) * env_exp(m, 0.02) * 0.6
        dsp.mix_into(out, b, ns(0.11 * k))
    return lp(out, 2500)


# ============================================================================= weapons
def fire_bolt(v):
    n = ns(0.2)
    t = tarr(n)
    cut = 900 + 2600 * np.minimum(t / 0.05, 1.0)
    whoosh = dsp.sweep(white(n), 'bp', cut, 1.4) * np.minimum(t / 0.006, 1) * np.exp(-t / 0.045)
    body = _sweep_sine(700 + 60 * v, 260, n, 0.03) * env_exp(n, 0.09, 0.001) * 0.45
    x = whoosh * 0.9 + body * 1.3 + _crackle(n, 70, 0.18, 3000) * np.exp(-t / 0.08)
    return lp(lp(x, 5200), 7000)


def fire_lance(v):
    n = ns(0.32)
    t = tarr(n)
    cut = 1800 * (3.2 ** np.minimum(t / 0.08, 1.0))
    s = dsp.sweep(white(n), 'bp', cut, 3.0) * np.minimum(t / 0.004, 1) * np.exp(-t / 0.07)
    ring = np.sin(2 * np.pi * np.cumsum(1700 + 700 * np.minimum(t / 0.05, 1)) / SR) * env_exp(n, 0.22, 0.002) * 0.25
    ring += np.sin(2 * np.pi * 3420 * t) * env_exp(n, 0.12, 0.002) * 0.08
    return lp(lp(s * 0.7 + ring, 6000), 8000)


def fire_spark(v):
    n = ns(0.22)
    t = tarr(n)
    hold = ns(0.012)
    steps = dsp.rng.uniform(300, 1700, n // hold + 1)
    fr = np.repeat(steps, hold)[:n]
    z = dsp.square(fr, n, 0.3) * 0.5 + saw(fr * 1.5, n) * 0.3
    z = bp(z, 2200, 0.8)
    env = env_exp(n, 0.16, 0.001) * (0.6 + 0.4 * (dsp.rng.random(n // hold + 1).repeat(hold)[:n] > 0.3))
    x = z * env + _crackle(n, 260, 0.35, 2500) * np.exp(-t / 0.1)
    return sat(lp(lp(x, 5500), 7000), 1.3) * 0.8


def fire_frost(v):
    n = ns(0.4)
    out = np.zeros(n)
    t = tarr(n)
    air = hp(white(n), 3500) * np.minimum(t / 0.01, 1) * np.exp(-t / 0.08) * 0.35
    out += air
    for k in range(6):
        f = dsp.rng.uniform(2200, 4400)
        m = ns(0.2)
        tt = tarr(m)
        ping = np.sin(2 * np.pi * f * tt) * env_exp(m, dsp.rng.uniform(0.06, 0.15), 0.0005) * 0.22
        dsp.mix_into(out, ping, ns(dsp.rng.uniform(0, 0.08)))
    out += _sweep_sine(1300, 800, n, 0.05) * env_exp(n, 0.1) * 0.15
    return lp(lp(out, 6500), 8000)


def fire_nova(v):
    n = ns(1.0)
    t = tarr(n)
    boom = _sweep_sine(170, 46, n, 0.07) * env_exp(n, 0.5, 0.002) * 0.9
    whoosh = dsp.sweep(white(n), 'lp', 300 + 3000 * np.exp(-t / 0.08), 0.8) * env_exp(n, 0.35, 0.004) * 0.6
    shimmer = np.zeros(n)
    for m in (74, 78, 81, 86):
        shimmer += dsp.pad_to(I.celesta(mtof(m), 0.4, 1.0), n)
    x = boom + whoosh + shimmer * 0.35
    return _room(sat(x, 1.2), 0.3, 1.0)


def fire_bell(v):
    n = ns(2.8)
    x = dsp.pad_to(I.bell(mtof(62 + (v % 2) * 0), 0.9, 2.8), n)
    thud = _sweep_sine(120, 60, n, 0.05) * env_exp(n, 0.25) * 0.4
    return _room(x + thud, 0.35, 1.8)


def fire_hook(v):
    n = ns(0.42)
    t = tarr(n)
    rate = 34 + 10 * v
    links = (np.sin(2 * np.pi * rate * t) > 0.6).astype(float)
    links = lp(links, 400)
    metal = bp(white(n), 4200, 4) * links * 1.6
    swoosh = dsp.sweep(white(n), 'bp', 600 + 1600 * np.sin(np.pi * t / t[-1]), 1.2) * np.sin(np.pi * t / t[-1]) ** 2
    shing = np.sin(2 * np.pi * 2650 * t) * env_exp(n, 0.25, 0.01) * 0.12
    return lp(lp(metal * 0.4 + swoosh * 0.7 + shing, 6000), 8000) * np.minimum(t / 0.01, 1)


def fire_moth(v):
    n = ns(0.45)
    t = tarr(n)
    am = 0.5 + 0.5 * np.sin(2 * np.pi * (22 + 4 * v) * t)
    flutter = bp(white(n), 900, 1.0) * am * np.sin(np.pi * t / t[-1]) ** 1.5 * 0.9
    chime = I.celesta(mtof(88 + 2 * v), 0.25, 0.4)
    return lp(dsp.pad_to(flutter, n) + dsp.pad_to(chime, n) * 0.6, 6000)


def fire_beam(v):
    n = ns(0.7)
    t = tarr(n)
    hum = saw(220 * (1 + 0.01 * np.sin(2 * np.pi * 6 * t)), n) + saw(331, n) * 0.5 + sine(110, n) * 0.6
    hum = dsp.sweep(hum, 'lp', 300 + 2500 * np.sin(np.pi * np.minimum(t / 0.5, 1)), 2.0)
    env = np.minimum(t / 0.06, 1) * np.exp(-np.maximum(t - 0.25, 0) / 0.12)
    air = dsp.sweep(white(n), 'bp', 2000 + 3000 * t, 1.5) * env * 0.3
    return (hum * 0.35 + air) * env


def fire_halo(v):
    n = ns(0.5)
    t = tarr(n)
    w = dsp.sweep(white(n), 'bp', 500 + 1500 * np.sin(np.pi * t / t[-1]), 0.9) * np.sin(np.pi * t / t[-1]) ** 2
    return lp(w * 0.9 + _crackle(n, 120, 0.25, 2000) * np.sin(np.pi * t / t[-1]), 5000)


def fire_brazier(v):
    n = ns(0.7)
    t = tarr(n)
    cut = 250 + 2200 * np.sin(np.pi * np.minimum(t / 0.5, 1)) ** 0.7
    w = dsp.sweep(dsp.pink(n), 'lp', cut, 1.0) * np.minimum(t / 0.03, 1) * np.exp(-t / 0.25)
    thump = _sweep_sine(110, 55, n, 0.05) * env_exp(n, 0.2) * 0.5
    return lp(w * 1.2 + thump + _crackle(n, 160, 0.25, 2200) * np.exp(-t / 0.3), 6000)


# ============================================================================= combat
def hit(v):
    n = ns(0.11)
    t = tarr(n)
    f0 = [300, 330, 280, 360][v % 4]
    body = _sweep_sine(f0 * 1.7, f0 * 0.5, n, 0.016) * env_exp(n, 0.06, 0.0006) * 0.7
    snap = bp(white(n), [1400, 1700, 1250, 1900][v % 4], 1.2) * env_exp(n, 0.028, 0.0003) * 1.6
    imp = np.zeros(n)
    imp[0:24] = np.hanning(24)
    thock = bp(imp, [880, 950, 820, 1020][v % 4], 7) * 9.0 * env_exp(n, 0.05)
    click = hp(white(n), 3000) * env_exp(n, 0.004, 0.0001) * 0.12
    return lp(sat(body + snap + thock + click, 1.4), 5500)


def crit(v):
    n = ns(0.45)
    t = tarr(n)
    base = dsp.pad_to(hit(v), n) * 1.1
    f = [2200, 2480][v % 2]
    mod = np.sin(2 * np.pi * f * 1.41 * t) * 2.2 * np.exp(-t / 0.05)
    tink = np.sin(2 * np.pi * f * t + mod) * env_exp(n, 0.3, 0.0008) * 0.35
    shard = hp(white(n), 4500) * env_exp(n, 0.04) * 0.12
    return lp(base + tink + shard, 9000)


def kill(v):
    n = ns(0.42)
    t = tarr(n)
    f0 = [620, 560, 690, 520][v % 4]
    pop = _sweep_sine(f0, f0 * 0.22, n, 0.025) * env_exp(n, 0.1, 0.0008) * 0.8
    poof = dsp.sweep(white(n), 'bp', 2200 * np.exp(-t / 0.12) + 380, 1.1) * np.minimum(t / 0.006, 1) * np.exp(-t / 0.09) * 0.9
    thump = _sweep_sine(130, 60, n, 0.03) * env_exp(n, 0.12) * 0.6
    sparkle = hp(white(n), 5000) * env_exp(n, 0.05) * 0.06
    return lp(sat(pop + poof + thump + sparkle, 1.2), 7500)


def kill_elite(v):
    n = ns(1.6)
    t = tarr(n)
    boom = _sweep_sine(140, 38, n, 0.08) * env_exp(n, 0.9, 0.002)
    out = boom + dsp.pad_to(kill(0), n) * 0.8
    for k in range(14):
        f = dsp.rng.uniform(1800, 6000)
        m = ns(0.4)
        tt = tarr(m)
        dsp.mix_into(out, np.sin(2 * np.pi * f * tt) * env_exp(m, dsp.rng.uniform(0.1, 0.35)) * 0.12,
                     ns(dsp.rng.uniform(0, 0.12)))
    out += dsp.sweep(white(n), 'lp', 400 + 5000 * np.exp(-t / 0.1), 0.7) * env_exp(n, 0.6) * 0.5
    return _room(sat(out, 1.4), 0.35, 1.4)


def explode(v):
    n = ns(0.9)
    t = tarr(n)
    boom = _sweep_sine(120, 40, n, 0.06) * env_exp(n, 0.55, 0.001)
    burst = dsp.sweep(white(n), 'lp', 300 + 4000 * np.exp(-t / 0.05), 0.7) * env_exp(n, 0.4, 0.001) * 0.8
    sizzle = lp(_crackle(n, 300, 0.2, 2000), 5000) * np.exp(-t / 0.25)
    gloom = bp(white(n), 700, 2) * np.sin(2 * np.pi * 9 * t) * env_exp(n, 0.5) * 0.3
    return _room(lp(sat(boom + burst + sizzle + gloom, 1.5), 7000), 0.25, 1.0)


# ============================================================================= player
def pickup(v):
    """XP ember chime at A5; runtime raises it along D-major-pentatonic steps for combos."""
    n = ns(0.3)
    t = tarr(n)
    f = mtof(81)
    x = np.sin(2 * np.pi * f * t) * env_exp(n, 0.22, 0.0008)
    x += 0.25 * np.sin(2 * np.pi * f * 2 * t) * env_exp(n, 0.09, 0.0008)
    x += 0.06 * np.sin(2 * np.pi * f * 3 * t + 1.2 * np.sin(2 * np.pi * f * t)) * env_exp(n, 0.05)
    return x * 0.6


def pickup_ash(v):
    n = ns(0.45)
    t = tarr(n)
    x = np.zeros(n)
    for r, a, d in ((1.0, 1.0, 0.3), (2.76, 0.35, 0.12), (5.4, 0.15, 0.06)):
        x += a * np.sin(2 * np.pi * 740 * r * t) * env_exp(n, d, 0.0005)
    x += dsp.pad_to(I.harp(mtof(62), 0.5, 0.6), n) * 0.4
    return x * 0.6


def heal(v):
    n = ns(1.4)
    out = np.zeros(n)
    for i, m in enumerate((62, 66, 69, 74, 78)):
        dsp.mix_into(out, I.harp(mtof(m), 0.55, 1.2) * 0.9, ns(0.055 * i))
        dsp.mix_into(out, I.celesta(mtof(m + 12), 0.3, 1.0) * 0.5, ns(0.055 * i + 0.02))
    t = tarr(n)
    glug = dsp.sweep(white(n), 'bp', 350 + 150 * np.sin(2 * np.pi * 9 * t), 4) * env_exp(n, 0.3) * 0.3
    return _room(out + glug, 0.4, 1.4)


def levelup(v):
    """Lantern flare fanfare: harp gliss + bell chord + swell, D major, wide."""
    n = ns(2.4)
    out = np.zeros((2, n))
    notes = [62, 66, 69, 74, 78, 81, 86]
    for i, m in enumerate(notes):
        dsp.mix_into(out, dsp.stereo(I.harp(mtof(m), 0.6 + 0.04 * i, 1.6), -0.6 + 0.2 * i), ns(0.045 * i))
    for k, m in enumerate((74, 78, 81, 86)):
        dsp.mix_into(out, dsp.stereo(I.celesta(mtof(m + 12), 0.6, 1.6), -0.4 + 0.27 * k), ns(0.32))
        dsp.mix_into(out, dsp.stereo(I.brass(mtof(m - 12), 0.7, 0.55), 0.3 - 0.2 * k) * 0.45, ns(0.32))
    dsp.mix_into(out, dsp.stereo(I.bell(mtof(86), 0.4, 2.0)), ns(0.32), 0.5)
    t = tarr(n)
    rise = dsp.sweep(white(n), 'bp', 500 * (12 ** np.minimum(t / 0.32, 1)), 2.0) * np.minimum(t / 0.32, 1) ** 2
    rise *= np.exp(-np.maximum(t - 0.32, 0) / 0.08)
    dsp.mix_into(out, dsp.stereo(rise * 0.25), 0)
    dsp.mix_into(out, dsp.stereo(_sweep_sine(110, 70, ns(0.5), 0.05) * env_exp(ns(0.5), 0.35) * 0.6), ns(0.32))
    return _room(out, 0.45, 1.8)


def chest(v):
    """Reliquary opens: latch clunk, lid creak, then a blooming shimmer."""
    n = ns(2.6)
    out = np.zeros((2, n))
    # latch
    m = ns(0.12)
    tt = tarr(m)
    latch = (bp(white(m), 900, 3) * env_exp(m, 0.04) + _sweep_sine(300, 120, m, 0.02) * env_exp(m, 0.08) * 0.8)
    dsp.mix_into(out, dsp.stereo(latch), 0)
    dsp.mix_into(out, dsp.stereo(latch * 0.6), ns(0.07))
    # creak: slow resonant sawtooth pitch wobble
    m = ns(0.45)
    tt = tarr(m)
    cf = 170 + 60 * np.sin(2 * np.pi * 3 * tt) + 40 * tt
    creak = bp(saw(cf, m), 1100, 6) * np.sin(np.pi * tt / tt[-1]) * 0.7
    dsp.mix_into(out, dsp.stereo(creak, 0.2), ns(0.12))
    # bloom: lydian shimmer cascade (D E F# G# A)
    for i, mm in enumerate((74, 76, 78, 80, 81, 86, 88, 90)):
        dsp.mix_into(out, dsp.stereo(I.celesta(mtof(mm + 12), 0.45, 1.4), -0.7 + 0.2 * i), ns(0.5 + 0.06 * i))
    for k, mm in enumerate((62, 69, 74, 78)):
        dsp.mix_into(out, dsp.stereo(I.choir(mtof(mm), 0.9, 0.35, 'ah'), -0.3 + 0.2 * k), ns(0.45))
    t = tarr(n)
    swish = dsp.sweep(white(n), 'bp', 1000 + 6000 * np.minimum(np.maximum(t - 0.4, 0) / 0.8, 1), 1.5)
    swish *= np.exp(-np.abs(t - 0.75) / 0.25) * 0.2
    dsp.mix_into(out, dsp.stereo(swish), 0)
    return _room(out, 0.45, 2.0)


def evolve(v):
    """Weapon evolution: 1 s riser, impact, D-major choir + bell cascade."""
    n = ns(3.8)
    out = np.zeros((2, n))
    hit_at = 0.95
    dsp.mix_into(out, dsp.stereo(I.riser(hit_at, 250, 8000, 0.5)), 0)
    t = tarr(n)
    m = ns(hit_at)
    tt = tarr(m)
    up = np.sin(2 * np.pi * np.cumsum(110 * 4 ** (tt / hit_at)) / SR) * (tt / hit_at) ** 2 * 0.25
    dsp.mix_into(out, dsp.stereo(up), 0)
    imp = ns(2.0)
    boom = _sweep_sine(130, 36, imp, 0.08) * env_exp(imp, 1.4, 0.001)
    dsp.mix_into(out, dsp.stereo(sat(boom, 1.4)), ns(hit_at), 0.9)
    dsp.mix_into(out, I.taiko(1.0, 60), ns(hit_at), 0.7)
    dsp.mix_into(out, dsp.stereo(I.crash(0.5, 2.5), 0.2), ns(hit_at), 0.5)
    for k, mm in enumerate((62, 66, 69, 74)):
        dsp.mix_into(out, dsp.stereo(I.choir(mtof(mm), 1.8, 0.5, 'ah'), -0.5 + 0.33 * k), ns(hit_at), 0.6)
        dsp.mix_into(out, dsp.stereo(I.brass(mtof(mm - 12), 1.4, 0.65), 0.4 - 0.25 * k), ns(hit_at), 0.35)
    for i, mm in enumerate((86, 90, 93, 98, 93, 90, 86)):
        dsp.mix_into(out, dsp.stereo(I.celesta(mtof(mm), 0.4, 1.2), -0.6 + 0.2 * i), ns(hit_at + 0.05 + 0.07 * i))
    dsp.mix_into(out, dsp.stereo(I.bell(mtof(74), 0.6, 3.0)), ns(hit_at), 0.5)
    return _room(out, 0.5, 2.4)


def hurt(v):
    """Lantern sputter: flame gutter + glass clink + body thud."""
    n = ns(0.45)
    t = tarr(n)
    am = 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * (31 + 6 * v) * t + dsp.rng.random() * 3))
    am = lp(am, 120)
    flame = dsp.sweep(white(n), 'lp', 1500 * np.exp(-t / 0.2) + 200, 1.0) * am * env_exp(n, 0.35, 0.002) * 1.1
    thud = _sweep_sine(150, 70, n, 0.025) * env_exp(n, 0.14, 0.0008) * 0.9
    f = [3150, 2900, 3400][v % 3]
    clink = (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.3 * t)) * env_exp(n, 0.14, 0.0005) * 0.12
    return sat(flame + thud + clink, 1.4)


def heartbeat(v):
    n = ns(0.7)
    out = np.zeros(n)
    for k, (d, f, a) in enumerate(((0.0, 58, 1.0), (0.2, 50, 0.7))):
        m = ns(0.22)
        tt = tarr(m)
        b = _sweep_sine(f * 1.6, f, m, 0.02) * env_exp(m, 0.18, 0.004) * a
        knock = bp(white(m), 260, 3) * env_exp(m, 0.06, 0.002) * a * 0.9
        dsp.mix_into(out, b + knock, ns(d))
    return lp(sat(out * 1.6, 2.2), 1100)


def breath(v):
    """Tense breathing (in + out) for very low light."""
    n = ns(2.3)
    t = tarr(n)
    nz = dsp.pink(n)
    inh = (t < 0.95)
    env = np.where(inh, np.sin(np.pi * np.clip(t / 0.95, 0, 1)) ** 1.5,
                   np.sin(np.pi * np.clip((t - 1.05) / 1.2, 0, 1)) ** 1.2 * (t > 1.05))
    out = np.zeros(n)
    for fc, g, q in ((550, 1.0, 3), (1100, 0.6, 4), (2600, 0.25, 5)):
        out += bp(nz, fc, q) * g
    out = hp(out, 200) * env
    return lp(out, 4000) * 0.9


# ============================================================================= boss / threat
def boss_roar(v):
    n = ns(3.2)
    t = tarr(n)
    f = 68 * (1 + 0.15 * np.sin(np.pi * np.minimum(t / 2.0, 1))) * (1 + 0.04 * dsp.rng.standard_normal(n).cumsum() / 400)
    f = lp(f, 30)
    src = saw(f, n) + saw(f * 1.5, n) * 0.4 + saw(f * 0.5, n) * 0.6
    src = sat(src * (1 + 0.5 * np.sin(2 * np.pi * 23 * t)), 2.0)
    vow = np.zeros(n)
    f1 = 450 + 300 * np.sin(np.pi * np.minimum(t / 2.6, 1))
    vow += dsp.sweep(src, 'bp', f1, 3.0, block=128) * 1.0
    vow += dsp.sweep(src, 'bp', f1 * 2.1, 4.0, block=128) * 0.5
    vow += bp(src, 2600, 5) * 0.15
    rasp = dsp.sweep(white(n), 'bp', 500 + 600 * np.sin(np.pi * np.minimum(t / 2.6, 1)), 1.2) * (0.6 + 0.4 * np.sin(2 * np.pi * 31 * t))
    env = np.minimum(t / 0.25, 1) * np.exp(-np.maximum(t - 1.6, 0) / 0.5)
    sub = _sweep_sine(62, 30, n, 1.2) * env * 0.8
    x = (vow * 0.8 + rasp * 0.4) * env + sub
    lo = lp(x, 350)
    hi = x - lo
    st = dsp.stereo(lo) + dsp.haas(hi, 11)
    return _room(st, 0.55, 2.6)


def boss_death(v):
    n = ns(4.2)
    t = tarr(n)
    out = np.zeros((2, n))
    boom = _sweep_sine(110, 28, n, 0.15) * env_exp(n, 2.5, 0.002)
    dsp.mix_into(out, dsp.stereo(sat(boom, 1.6)), 0)
    dsp.mix_into(out, dsp.stereo(dsp.sweep(white(n), 'lp', 200 + 6000 * np.exp(-t / 0.15), 0.7) * env_exp(n, 1.5) * 0.6), 0)
    dsp.mix_into(out, kill_elite(0), 0, 0.6)
    for k, mm in enumerate((62, 66, 69, 74, 78)):
        dsp.mix_into(out, dsp.stereo(I.choir(mtof(mm), 2.4, 0.5, 'ah'), -0.6 + 0.3 * k), ns(0.6), 0.5)
    dsp.mix_into(out, dsp.stereo(I.bell(mtof(62), 0.8, 4.0)), ns(0.6), 0.6)
    return _room(out, 0.5, 3.0)


def elite(v):
    n = ns(1.3)
    t = tarr(n)
    f = 95 * (1 + 0.1 * np.sin(np.pi * t / t[-1]))
    src = sat(saw(f, n) + saw(f * 1.01, n), 1.8)
    x = dsp.sweep(src, 'bp', 500 + 350 * np.sin(np.pi * t / t[-1]), 3.0) * np.sin(np.pi * t / t[-1]) ** 0.8
    x += _sweep_sine(80, 45, n, 0.5) * env_exp(n, 0.8) * 0.5
    return _room(x, 0.35, 1.5)


def warn(v):
    """Low horn call for swarm/threat warnings."""
    n = ns(2.0)
    out = np.zeros(n)
    dsp.mix_into(out, I.brass(mtof(38), 0.55, 0.8), 0)
    dsp.mix_into(out, I.brass(mtof(45), 0.9, 0.85), ns(0.6))
    dsp.mix_into(out, I.brass(mtof(33), 1.0, 0.6), ns(0.6), 0.6)
    return _room(out, 0.45, 2.0)


# name -> (fn, variants, target mmax LUFS, stereo)
SFX = {
    'ui_hover': (ui_hover, 1, -30, False),
    'ui_click': (ui_click, 1, -22, False),
    'ui_confirm': (ui_confirm, 1, -19, False),
    'ui_back': (ui_back, 1, -22, False),
    'ui_deny': (ui_deny, 1, -21, False),
    'fire_bolt': (fire_bolt, 3, -24, False),
    'fire_lance': (fire_lance, 2, -23, False),
    'fire_spark': (fire_spark, 3, -24, False),
    'fire_frost': (fire_frost, 2, -24, False),
    'fire_nova': (fire_nova, 1, -19, True),
    'fire_bell': (fire_bell, 1, -19, True),
    'fire_hook': (fire_hook, 2, -24, False),
    'fire_moth': (fire_moth, 2, -26, False),
    'fire_beam': (fire_beam, 1, -24, False),
    'fire_halo': (fire_halo, 1, -26, False),
    'fire_brazier': (fire_brazier, 1, -23, False),
    'hit': (hit, 4, -21, False),
    'crit': (crit, 2, -18, False),
    'kill': (kill, 4, -20, False),
    'kill_elite': (kill_elite, 1, -14, True),
    'explode': (explode, 2, -17, True),
    'pickup': (pickup, 1, -24, False),
    'pickup_ash': (pickup_ash, 1, -21, False),
    'heal': (heal, 1, -18, True),
    'levelup': (levelup, 1, -14, True),
    'chest': (chest, 1, -14, True),
    'evolve': (evolve, 1, -12, True),
    'hurt': (hurt, 3, -15, False),
    'heartbeat': (heartbeat, 1, -17, False),
    'breath': (breath, 1, -26, False),
    'boss_roar': (boss_roar, 1, -12, True),
    'boss_death': (boss_death, 1, -12, True),
    'elite': (elite, 1, -16, True),
    'warn': (warn, 1, -16, True),
}


def render_sfx(name: str, variant: int) -> np.ndarray:
    fn, _, target, st = SFX[name]
    dsp.reseed(sum(map(ord, name)) * 31 + variant * 7919)
    x = fn(variant)
    if st:
        x = dsp.stereo(x) if x.ndim == 1 else x
    else:
        x = _mono(x)
    x = dsp.hp(x, 30)
    x = dsp.trim_tail(x, -66)
    x = dsp.fade(x, 0.0008, 0)
    return dsp.normalize_mmax(x, target, -1.0)
