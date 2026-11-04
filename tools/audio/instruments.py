"""Synthesised instruments for Last Lantern ("moonlit storybook" palette).

Each function returns a mono (or stereo) numpy array for ONE note, already enveloped.
Palette: celesta / music box, harp, warm string section, lantern flute, soft brass, choir,
church bells, taiko + frame drums + shakers. Acoustic-leaning, warm, never harsh.
"""
from __future__ import annotations

import math
import numpy as np
from scipy import signal

import dsp
from dsp import SR, ns, tarr, env_exp, env_adsr, sine, saw, white, lp, hp, bp, peq, sat


# ----------------------------------------------------------------------------- tuned percussion
def celesta(f: float, vel: float = 0.8, ring: float = 2.6) -> np.ndarray:
    n = ns(ring)
    t = tarr(n)
    out = np.zeros(n)
    partials = [(1.0, 1.0, ring), (2.0, 0.28, ring * 0.38), (3.0, 0.09, ring * 0.2), (4.02, 0.08, ring * 0.12),
                (5.43, 0.035, 0.12)]
    for ratio, amp, dec in partials:
        if f * ratio > SR * 0.45:
            continue
        out += amp * np.sin(2 * np.pi * f * ratio * t + dsp.rng.random()) * env_exp(n, dec, 0.0015)
    # FM shimmer on the attack (hammer brightness)
    idx = 1.4 * vel * np.exp(-t / 0.035)
    out += 0.35 * np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * 4 * t)) * env_exp(n, 0.25, 0.001)
    click = hp(white(ns(0.004)), 3000) * 0.08 * vel
    out[:click.shape[0]] += click
    return out * vel * 0.5


def music_box(f: float, vel: float = 0.8) -> np.ndarray:
    n = ns(2.2)
    t = tarr(n)
    out = (np.sin(2 * np.pi * f * t) * env_exp(n, 2.0, 0.001)
           + 0.22 * np.sin(2 * np.pi * f * 3.01 * t) * env_exp(n, 0.5, 0.001)
           + 0.08 * np.sin(2 * np.pi * f * 5.97 * t) * env_exp(n, 0.18, 0.001))
    tick = hp(white(ns(0.003)), 4000) * 0.12
    out[:tick.shape[0]] += tick
    return out * vel * 0.45


def bell(f: float, vel: float = 0.8, ring: float = 4.5) -> np.ndarray:
    """Church/vesper bell with minor-third tierce (f = strike/nominal pitch)."""
    n = ns(ring)
    t = tarr(n)
    parts = [(0.5, 0.55, 1.0), (1.0, 0.7, 0.75), (1.2, 0.5, 0.6), (1.5, 0.3, 0.45), (2.0, 0.6, 0.38),
             (2.5, 0.2, 0.25), (3.0, 0.18, 0.2), (4.18, 0.1, 0.12), (5.43, 0.06, 0.08)]
    out = np.zeros(n)
    for r, a, d in parts:
        fr = f * r
        if fr > SR * 0.45:
            continue
        beat = 1 + 0.002 * dsp.rng.standard_normal()
        out += a * (np.sin(2 * np.pi * fr * t) + 0.5 * np.sin(2 * np.pi * fr * beat * t + 1.0)) * env_exp(n, ring * d, 0.001)
    strike = bp(white(ns(0.02)), f * 3, 1.5) * env_exp(ns(0.02), 0.02) * 0.6
    out[:strike.shape[0]] += strike
    return out * vel * 0.32


def timpani(f: float, vel: float = 0.8) -> np.ndarray:
    n = ns(2.0)
    t = tarr(n)
    fr = f * (1 + 0.04 * np.exp(-t / 0.05))
    out = (np.sin(2 * np.pi * np.cumsum(fr) / SR) * env_exp(n, 1.8, 0.002)
           + 0.5 * np.sin(2 * np.pi * np.cumsum(fr * 1.505) / SR) * env_exp(n, 0.9, 0.002)
           + 0.25 * np.sin(2 * np.pi * np.cumsum(fr * 1.98) / SR) * env_exp(n, 0.6, 0.002))
    mallet = lp(white(ns(0.03)), 1500) * env_exp(ns(0.03), 0.03) * 0.6
    out[:mallet.shape[0]] += mallet
    return sat(out * vel * 0.6, 1.3) * 0.8


# ----------------------------------------------------------------------------- plucked
def harp(f: float, vel: float = 0.7, ring: float | None = None) -> np.ndarray:
    """Karplus-Strong harp with body resonance; exact tuning via resampling."""
    ring = ring or (3.6 if f < 200 else 2.6 if f < 500 else 1.8)
    N = max(2, int(SR / f - 0.5))
    f_act = SR / (N + 0.5)
    n = ns(ring) + N
    g = 0.001 ** (1.0 / (f_act * ring))
    exc = white(N)
    exc = lp(exc, 1200 + 5000 * vel)
    exc -= exc.mean()
    x = np.zeros(n)
    x[:N] = exc
    a = np.zeros(N + 2)
    a[0] = 1.0
    a[N] = -g * 0.5
    a[N + 1] = -g * 0.5
    y = signal.lfilter([1.0], a, x)
    y = dsp.resample_pitch(y, f / f_act)
    y = hp(y, 70)
    y = peq(y, 250, 2.5, 0.8)
    y = lp(y, 7000)
    m = y.shape[0]
    y *= env_exp(m, ring * 1.1, 0.0005)
    k = ns(0.02)
    y[-k:] *= np.linspace(1, 0, k)
    return y / (np.max(np.abs(y)) + 1e-9) * vel * 0.5


def pluck_synth(f: float, vel: float = 0.7, dec: float = 0.35, bright: float = 2500) -> np.ndarray:
    n = ns(dec * 2.2)
    t = tarr(n)
    o = saw(f * 1.003, n) + saw(f * 0.997, n) * 0.8
    cut = 200 + bright * vel * np.exp(-t / (dec * 0.35))
    y = dsp.sweep(o, 'lp', cut, 1.2)
    return y * env_exp(n, dec * 2, 0.002) * vel * 0.35


# ----------------------------------------------------------------------------- sustained
def strings(f: float, dur: float, vel: float = 0.7, attack: float = 0.18, release: float = 0.6,
            voices: int = 3, bright: float = 1.0) -> np.ndarray:
    n = ns(dur + release)
    out = np.zeros(n)
    det = [-7, 0, 7, -14, 14][:voices]
    for c in det:
        fr = dsp.vibrato(f * 2 ** (c / 1200), n, rate=5.2 + dsp.rng.random() * 0.8, depth_cents=9, delay=0.2)
        out += saw(fr, n)
    out /= voices
    cutoff = min(SR * 0.4, (1500 + 2200 * vel) * bright + f * 2)
    out = lp(out, cutoff, 0.6)
    out = lp(out, cutoff * 1.4)
    out = hp(out, 90)
    out = peq(out, 2800, 2.0, 1.2)
    bow = bp(white(n), min(f * 3, 9000), 2.0) * 0.04
    out += bow
    return out * env_adsr(n, attack, 0.3, 0.85, release, gate=dur) * vel * 0.55


def spiccato(f: float, vel: float = 0.7) -> np.ndarray:
    n = ns(0.32)
    t = tarr(n)
    o = (saw(f * 1.004, n) + saw(f * 0.996, n)) * 0.5
    cut = 900 + 3500 * vel * np.exp(-t / 0.05)
    o = dsp.sweep(o, 'lp', cut, 0.9)
    o = hp(o, 110)
    scrape = bp(white(n), 3000, 1.0) * np.exp(-t / 0.012) * 0.25
    return (o + scrape) * env_exp(n, 0.22, 0.003) * vel * 0.6


def pad(f: float, dur: float, vel: float = 0.6, cutoff: float = 1500, attack: float = 0.9, release: float = 2.0) -> np.ndarray:
    n = ns(dur + release)
    t = tarr(n)
    out = np.zeros((2, n))
    for i, c in enumerate([-11, -4, 4, 11]):
        v = saw(f * 2 ** (c / 1200), n)
        pan = -0.6 if i % 2 == 0 else 0.6
        out += dsp.stereo(v, pan * (0.5 + 0.5 * (i // 2)))
    out += dsp.stereo(sine(f * 0.5, n) * 0.6)
    lfo = 1 + 0.25 * np.sin(2 * np.pi * 0.11 * t + dsp.rng.random() * 6)
    out = dsp.sweep(out, 'lp', cutoff * lfo, 0.8, block=256)
    out = hp(out, 80)
    return out * env_adsr(n, attack, 1.0, 0.9, release, gate=dur) * vel * 0.18


def flute(f: float, dur: float, vel: float = 0.7) -> np.ndarray:
    n = ns(dur + 0.35)
    fr = dsp.vibrato(f, n, rate=5.0, depth_cents=14, delay=0.28)
    body = sine(fr, n) + 0.16 * sine(fr * 2, n) + 0.05 * sine(fr * 3, n)
    breath = bp(white(n), min(f * 2.2, 9000), 1.6) * 0.09
    t = tarr(n)
    chiff = bp(white(n), min(f * 4, 10000), 3) * np.exp(-t / 0.025) * 0.25
    env = env_adsr(n, 0.07, 0.25, 0.82, 0.3, gate=dur)
    return (body + breath + chiff) * env * vel * 0.42


def brass(f: float, dur: float, vel: float = 0.7, attack: float = 0.04) -> np.ndarray:
    n = ns(dur + 0.35)
    t = tarr(n)
    scoop = 2 ** ((-35 * np.exp(-t / 0.04)) / 1200)
    fr = dsp.vibrato(f, n, rate=5.0, depth_cents=6, delay=0.35) * scoop
    o = saw(fr * 1.002, n) + saw(fr * 0.998, n)
    cut = f * (2.5 + (3 + 5 * vel) * np.exp(-t / 0.12)) + 500 * vel
    o = dsp.sweep(o, 'lp', np.minimum(cut, 12000), 0.9)
    o = hp(o, 70)
    o = sat(o * 0.6, 1.6)
    return o * env_adsr(n, attack, 0.25, 0.8, 0.3, gate=dur) * vel * 0.42


FORMANTS = {
    'ah': [(800, 1.0, 6), (1150, 0.5, 8), (2900, 0.18, 10), (3900, 0.08, 12)],
    'oo': [(330, 1.0, 6), (870, 0.35, 8), (2240, 0.08, 10)],
    'oh': [(500, 1.0, 6), (900, 0.5, 8), (2600, 0.12, 10)],
}


def choir(f: float, dur: float, vel: float = 0.6, vowel: str = 'ah', voices: int = 4) -> np.ndarray:
    n = ns(dur + 1.2)
    src = np.zeros(n)
    for c in np.linspace(-14, 14, voices):
        fr = dsp.vibrato(f * 2 ** (c / 1200), n, rate=4.6 + dsp.rng.random(), depth_cents=16, delay=0.15)
        src += saw(fr, n)
    src /= voices
    src += white(n) * 0.03
    out = np.zeros(n)
    for fc, g, q in FORMANTS[vowel]:
        out += bp(src, fc, q) * g
    out = hp(out, 120)
    return out * env_adsr(n, 0.45, 0.6, 0.9, 1.1, gate=dur) * vel * 1.6


def bass_sub(f: float, dur: float, vel: float = 0.7) -> np.ndarray:
    n = ns(dur + 0.3)
    t = tarr(n)
    o = sine(f, n) + 0.25 * sat(saw(f, n) * 0.5, 1.0)
    o = lp(o, 420)
    return o * env_adsr(n, 0.02, 0.2, 0.85, 0.25, gate=dur) * vel * 0.55


def bass_pluck(f: float, vel: float = 0.7, dec: float = 0.28) -> np.ndarray:
    n = ns(dec * 2.5)
    t = tarr(n)
    o = sine(f, n) * 0.9 + saw(f, n) * 0.5
    o = dsp.sweep(o, 'lp', 120 + 1100 * vel * np.exp(-t / 0.06), 1.0)
    o = sat(o, 1.5)
    return o * env_exp(n, dec * 2.4, 0.003) * vel * 0.5


# ----------------------------------------------------------------------------- drums
def kick(vel: float = 0.8, f0: float = 52, punch: float = 2.4, dec: float = 0.45) -> np.ndarray:
    n = ns(dec + 0.05)
    t = tarr(n)
    fr = f0 * (1 + (punch - 1) * np.exp(-t / 0.035))
    body = np.sin(2 * np.pi * np.cumsum(fr) / SR) * env_exp(n, dec, 0.001)
    click = lp(white(ns(0.006)), 4000) * 0.25
    body[:click.shape[0]] += click
    return sat(body * vel, 1.2)


def taiko(vel: float = 0.8, f0: float = 68, dec: float = 0.9) -> np.ndarray:
    n = ns(dec + 0.1)
    t = tarr(n)
    fr = f0 * (1 + 0.9 * np.exp(-t / 0.03))
    body = np.sin(2 * np.pi * np.cumsum(fr) / SR) * env_exp(n, dec, 0.001)
    body += 0.35 * np.sin(2 * np.pi * np.cumsum(fr * 1.58) / SR) * env_exp(n, dec * 0.45, 0.001)
    skin = lp(white(n), 900) * env_exp(n, 0.18, 0.001) * 0.8
    stick = bp(white(n), 2200, 1.2) * env_exp(n, 0.02, 0.0005) * 0.35
    return sat((body + skin + stick) * vel, 1.6) * 0.85


def frame_drum(vel: float = 0.7, f0: float = 115) -> np.ndarray:
    n = ns(0.4)
    t = tarr(n)
    fr = f0 * (1 + 0.35 * np.exp(-t / 0.02))
    body = np.sin(2 * np.pi * np.cumsum(fr) / SR) * env_exp(n, 0.28, 0.001)
    skin = bp(white(n), 520, 0.9) * env_exp(n, 0.09, 0.001) * 0.6
    jingle = hp(white(n), 7000) * env_exp(n, 0.12, 0.002) * 0.08
    return (body + skin + jingle) * vel * 0.8


def tom(vel: float = 0.7, f0: float = 100) -> np.ndarray:
    n = ns(0.6)
    t = tarr(n)
    fr = f0 * (1 + 0.5 * np.exp(-t / 0.04))
    body = np.sin(2 * np.pi * np.cumsum(fr) / SR) * env_exp(n, 0.5, 0.001)
    skin = lp(white(n), 1600) * env_exp(n, 0.08, 0.001) * 0.4
    return sat((body + skin) * vel, 1.3) * 0.8


def shaker(vel: float = 0.5, length: float = 0.09) -> np.ndarray:
    n = ns(length)
    t = tarr(n)
    e = np.minimum(t / 0.012, 1) * np.exp(-np.maximum(t - 0.012, 0) / (length * 0.35))
    s = hp(white(n), 5200) * e
    s = peq(s, 9000, 3, 1)
    return s * vel * 0.35


def hat(vel: float = 0.5, open_: bool = False) -> np.ndarray:
    n = ns(0.35 if open_ else 0.06)
    t = tarr(n)
    metal = np.zeros(n)
    for r in (2.0, 3.0, 4.16, 5.43, 6.79, 8.21):
        metal += np.sign(np.sin(2 * np.pi * 330 * r * t))
    s = hp(metal * 0.15 + white(n) * 0.6, 7500)
    return s * env_exp(n, 0.3 if open_ else 0.045, 0.0005) * vel * 0.3


def rim(vel: float = 0.6) -> np.ndarray:
    n = ns(0.08)
    t = tarr(n)
    s = bp(white(n), 1900, 6) * 2.0 + np.sin(2 * np.pi * 820 * t) * 0.6
    return s * env_exp(n, 0.045, 0.0005) * vel * 0.5


def clap(vel: float = 0.6) -> np.ndarray:
    n = ns(0.3)
    t = tarr(n)
    nz = bp(white(n), 1300, 1.1)
    e = np.zeros(n)
    for k, d in enumerate((0.0, 0.009, 0.019, 0.028)):
        m = t >= d
        e[m] += np.exp(-(t[m] - d) / (0.006 if k < 3 else 0.08)) * (0.8 if k < 3 else 1.0)
    return nz * e * vel * 0.6


def crash(vel: float = 0.6, dec: float = 2.5) -> np.ndarray:
    n = ns(dec)
    t = tarr(n)
    metal = np.zeros(n)
    for r in (1.0, 1.47, 1.83, 2.37, 2.91, 3.6, 4.4):
        metal += np.sin(2 * np.pi * 410 * r * t + 3 * np.sin(2 * np.pi * 410 * r * 1.4 * t))
    s = hp(white(n) * 0.8 + metal * 0.05, 3500)
    s = lp(s, 12000)
    return s * env_exp(n, dec, 0.002) * vel * 0.35


def swell(dur: float = 2.0, vel: float = 0.6) -> np.ndarray:
    """Reverse-cymbal style swell that peaks at the end (place so it ends on the downbeat)."""
    c = crash(1.0, dur)[::-1].copy()
    k = ns(0.01)
    c[-k:] *= np.linspace(1, 0, k)
    return c * vel


def riser(dur: float = 1.0, f0: float = 300, f1: float = 6000, vel: float = 0.6) -> np.ndarray:
    n = ns(dur)
    t = tarr(n)
    cut = f0 * (f1 / f0) ** (t / dur)
    s = dsp.sweep(white(n), 'bp', cut, 2.5)
    return s * (t / dur) ** 2 * vel


def gliss(notes: list[float], step: float, inst=harp, vel: float = 0.6) -> np.ndarray:
    """Harp-style glissando through a list of frequencies."""
    total = ns(step * len(notes) + 3.0)
    out = np.zeros(total)
    for i, f in enumerate(notes):
        v = inst(f, vel * (0.7 + 0.3 * i / max(1, len(notes) - 1)))
        dsp.mix_into(out, v, ns(step * i))
    return out
