"""Last Lantern offline audio DSP toolkit (numpy + scipy).

Everything the game hears is rendered by these primitives into public/audio/*.ogg.
Conventions: mono signals are 1-D float64 arrays, stereo signals are (2, n) arrays, SR = 48000
(the runtime AudioContext is created at 48 kHz too, so loops are never resampled at their seam).
All randomness goes through `rng` (seeded) so renders are reproducible.
"""
from __future__ import annotations

import math
import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
rng = np.random.default_rng(1337)


def reseed(seed: int) -> None:
    global rng
    rng = np.random.default_rng(seed)


# ----------------------------------------------------------------------------- basics
def ns(sec: float) -> int:
    return max(1, int(round(sec * SR)))


def mtof(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def db(x: float) -> float:
    return 10 ** (x / 20.0)


def tarr(n: int) -> np.ndarray:
    return np.arange(n) / SR


def stereo(x: np.ndarray, pan: float = 0.0, width: float = 0.0) -> np.ndarray:
    """Constant-power pan a mono signal into stereo. pan -1..1."""
    if x.ndim == 2:
        return x
    a = (pan + 1) * math.pi / 4
    return np.vstack([x * math.cos(a), x * math.sin(a)]) * math.sqrt(2)


def mix_into(dst: np.ndarray, src: np.ndarray, at: int, gain: float = 1.0) -> None:
    """Add src into dst at sample offset (clipped to dst length). Both mono or both stereo."""
    if at >= dst.shape[-1]:
        return
    if src.ndim == 1 and dst.ndim == 2:
        src = stereo(src)
    n = min(src.shape[-1], dst.shape[-1] - at)
    if n <= 0:
        return
    if dst.ndim == 2:
        dst[:, at:at + n] += src[:, :n] * gain
    else:
        dst[at:at + n] += src[:n] * gain


def pad_to(x: np.ndarray, n: int) -> np.ndarray:
    if x.shape[-1] >= n:
        return x[..., :n]
    padw = [(0, 0)] * (x.ndim - 1) + [(0, n - x.shape[-1])]
    return np.pad(x, padw)


# ----------------------------------------------------------------------------- envelopes
def env_exp(n: int, decay: float, attack: float = 0.002) -> np.ndarray:
    """Fast attack, exponential decay (decay = seconds to -60 dB)."""
    t = tarr(n)
    e = np.exp(-6.9078 * t / max(decay, 1e-4))
    a = ns(attack)
    if a > 1:
        e[:a] *= np.linspace(0, 1, a) ** 1.5
    return e


def env_adsr(n: int, a: float, d: float, s: float, r: float, gate: float | None = None) -> np.ndarray:
    """ADSR with exponential-ish curves. gate = seconds before release (defaults to n - r)."""
    total = n / SR
    g = total - r if gate is None else gate
    g = max(g, 0.0)
    t = tarr(n)
    e = np.zeros(n)
    att = t < a
    e[att] = (t[att] / max(a, 1e-5)) ** 0.8
    dec = (t >= a) & (t < g)
    e[dec] = s + (1 - s) * np.exp(-(t[dec] - a) / max(d / 4, 1e-5))
    rel = t >= g
    lvl = s + (1 - s) * math.exp(-max(g - a, 0) / max(d / 4, 1e-5)) if g > a else min(g / max(a, 1e-5), 1)
    e[rel] = lvl * np.exp(-(t[rel] - g) * 6.9 / max(r, 1e-4))
    # declick tail
    k = min(n, ns(0.004))
    e[-k:] *= np.linspace(1, 0, k)
    return e


def fade(x: np.ndarray, fin: float = 0.0, fout: float = 0.0) -> np.ndarray:
    x = x.copy()
    n = x.shape[-1]
    if fin > 0:
        k = min(n, ns(fin))
        x[..., :k] *= np.linspace(0, 1, k)
    if fout > 0:
        k = min(n, ns(fout))
        x[..., -k:] *= np.linspace(1, 0, k) ** 2
    return x


# ----------------------------------------------------------------------------- oscillators
def phase_from_freq(freq, n: int) -> np.ndarray:
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    return np.cumsum(f) / SR


def sine(freq, n: int, ph0: float = 0.0) -> np.ndarray:
    return np.sin(2 * np.pi * (phase_from_freq(freq, n) + ph0))


def _polyblep(p: np.ndarray, dt: np.ndarray) -> np.ndarray:
    out = np.zeros_like(p)
    m = p < dt
    x = p[m] / dt[m]
    out[m] = x + x - x * x - 1
    m2 = p > 1 - dt
    x = (p[m2] - 1) / dt[m2]
    out[m2] = x * x + x + x + 1
    return out


def saw(freq, n: int, ph0: float | None = None) -> np.ndarray:
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    ph = (phase_from_freq(f, n) + (rng.random() if ph0 is None else ph0)) % 1.0
    dt = np.clip(f / SR, 1e-6, 0.5)
    return 2 * ph - 1 - _polyblep(ph, dt)


def square(freq, n: int, pw: float = 0.5) -> np.ndarray:
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    ph = (phase_from_freq(f, n) + rng.random()) % 1.0
    dt = np.clip(f / SR, 1e-6, 0.5)
    s = np.where(ph < pw, 1.0, -1.0)
    s += _polyblep(ph, dt)
    s -= _polyblep((ph + 1 - pw) % 1.0, dt)
    return s


def triangle(freq, n: int) -> np.ndarray:
    sq = square(freq, n)
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    tri = np.cumsum(sq * 4 * f / SR)
    tri = signal.lfilter([1, -1], [1, -0.9995], tri)  # DC block the leaky integrator
    return tri / (np.max(np.abs(tri)) + 1e-9)


def white(n: int) -> np.ndarray:
    return rng.uniform(-1, 1, n)


def pink(n: int) -> np.ndarray:
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    p = signal.lfilter(b, a, rng.standard_normal(n + 2000))[2000:]
    return p / (np.max(np.abs(p)) + 1e-9)


def brown(n: int) -> np.ndarray:
    b = signal.lfilter([1], [1, -0.995], rng.standard_normal(n + 4000))[4000:]
    b = hp(b, 20)
    return b / (np.max(np.abs(b)) + 1e-9)


def vibrato(base: float, n: int, rate: float = 5.5, depth_cents: float = 12, delay: float = 0.25) -> np.ndarray:
    t = tarr(n)
    dep = np.clip((t - delay) / 0.4, 0, 1) * depth_cents
    return base * 2 ** (dep * np.sin(2 * np.pi * rate * t + rng.random() * 6.28) / 1200)


# ----------------------------------------------------------------------------- filters (RBJ biquads)
def _biquad(kind: str, f0: float, q: float = 0.707, gain_db: float = 0.0):
    f0 = min(max(f0, 10.0), SR * 0.49)
    w = 2 * math.pi * f0 / SR
    cw, sw = math.cos(w), math.sin(w)
    alpha = sw / (2 * q)
    A = 10 ** (gain_db / 40)
    if kind == 'lp':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'hp':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'bp':
        b = [alpha, 0, -alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'peak':
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == 'lowshelf':
        sq = 2 * math.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + sq), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sq)]
        a = [(A + 1) + (A - 1) * cw + sq, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sq]
    elif kind == 'highshelf':
        sq = 2 * math.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + sq), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sq)]
        a = [(A + 1) - (A - 1) * cw + sq, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sq]
    else:
        raise ValueError(kind)
    b = np.array(b) / a[0]
    a = np.array(a) / a[0]
    return b, a


def biquad(x: np.ndarray, kind: str, f0: float, q: float = 0.707, gain_db: float = 0.0) -> np.ndarray:
    b, a = _biquad(kind, f0, q, gain_db)
    return signal.lfilter(b, a, x, axis=-1)


def lp(x, f, q=0.707):
    return biquad(x, 'lp', f, q)


def hp(x, f, q=0.707):
    return biquad(x, 'hp', f, q)


def bp(x, f, q=1.0):
    return biquad(x, 'bp', f, q)


def peq(x, f, gain_db, q=1.0):
    return biquad(x, 'peak', f, q, gain_db)


def shelf_lo(x, f, gain_db):
    return biquad(x, 'lowshelf', f, 0.707, gain_db)


def shelf_hi(x, f, gain_db):
    return biquad(x, 'highshelf', f, 0.707, gain_db)


def sweep(x: np.ndarray, kind: str, freqs, q: float = 0.707, block: int = 64) -> np.ndarray:
    """Time-varying biquad (coefficients updated every `block` samples, state carried)."""
    n = x.shape[-1]
    f = np.broadcast_to(np.asarray(freqs, dtype=np.float64), (n,))
    out = np.empty_like(x)
    zi = np.zeros(2) if x.ndim == 1 else np.zeros((x.shape[0], 2))
    for s in range(0, n, block):
        e = min(n, s + block)
        b, a = _biquad(kind, float(f[s]), q)
        if x.ndim == 1:
            out[s:e], zi = signal.lfilter(b, a, x[s:e], zi=zi)
        else:
            out[:, s:e], zi = signal.lfilter(b, a, x[:, s:e], axis=-1, zi=zi)
    return out


def onepole_lp(x, f):
    a = math.exp(-2 * math.pi * f / SR)
    return signal.lfilter([1 - a], [1, -a], x, axis=-1)


def dc_block(x):
    return signal.lfilter([1, -1], [1, -0.995], x, axis=-1)


# ----------------------------------------------------------------------------- nonlinear / dynamics
def sat(x: np.ndarray, drive: float = 1.0) -> np.ndarray:
    return np.tanh(x * drive) / math.tanh(drive)


def limiter(x: np.ndarray, ceiling_db: float = -1.0, look_ms: float = 3.0, release_ms: float = 60.0) -> np.ndarray:
    """Look-ahead brickwall-ish peak limiter (linked stereo). Zero-latency (centered windows)."""
    thr = db(ceiling_db)
    peak = np.max(np.abs(x), axis=0) if x.ndim == 2 else np.abs(x)
    g = np.minimum(1.0, thr / (peak + 1e-12))
    L = max(3, int(look_ms * SR / 1000) | 1)
    g = minimum_filter1d(g, L * 2 + 1, mode='nearest')
    g = uniform_filter1d(g, L, mode='nearest')
    # release smoothing: only lets gain recover slowly (backward-safe min with smoothed version)
    rel = math.exp(-1.0 / (release_ms * SR / 1000))
    sm = signal.lfilter([1 - rel], [1, -rel], g - 1.0) + 1.0
    g = np.minimum(g, sm)
    y = x * g
    return np.clip(y, -thr, thr)


def compress(x: np.ndarray, thr_db=-18.0, ratio=3.0, att_ms=5.0, rel_ms=120.0, makeup_db=0.0) -> np.ndarray:
    mono = np.max(np.abs(x), axis=0) if x.ndim == 2 else np.abs(x)
    a = math.exp(-1 / (att_ms * SR / 1000))
    r = math.exp(-1 / (rel_ms * SR / 1000))
    # approximate envelope follower: attack/release via two one-poles combined with max
    env_a = signal.lfilter([1 - a], [1, -a], mono)
    env_r = signal.lfilter([1 - r], [1, -r], mono)
    env = np.maximum(env_a, env_r) + 1e-9
    lvl = 20 * np.log10(env)
    over = np.maximum(0, lvl - thr_db)
    gdb = -over * (1 - 1 / ratio) + makeup_db
    return x * (10 ** (gdb / 20))


# ----------------------------------------------------------------------------- spatial / time effects
def make_ir(seconds: float = 2.4, predelay: float = 0.012, damp_hz: float = 5500.0, lo_rt_mult: float = 1.25,
            er: int = 14, seed: int = 7, width: float = 1.0) -> np.ndarray:
    """Stereo hall impulse response: early reflections + frequency-dependent exponential tail."""
    r = np.random.default_rng(seed)
    n = ns(seconds + predelay + 0.05)
    t = tarr(n)
    ir = np.zeros((2, n))
    pd = ns(predelay)
    for ch in range(2):
        nz = r.standard_normal(n)
        lo = lp(nz, 900)
        mid = bp(nz, 2500, 0.6)
        hi = hp(nz, 4000)
        rt_lo = seconds * lo_rt_mult
        rt_mid = seconds
        rt_hi = seconds * 0.45
        tail = (lo * np.exp(-6.9 * t / rt_lo) * 1.0 + mid * np.exp(-6.9 * t / rt_mid) * 0.8
                + hi * np.exp(-6.9 * t / rt_hi) * 0.35)
        tail = lp(tail, damp_hz)
        # soft onset of the diffuse tail
        onset = np.clip(t / 0.06, 0, 1) ** 2
        tail *= onset
        ir[ch, pd:] = tail[:n - pd]
        # early reflections
        for k in range(er):
            d = pd + int(r.uniform(0.004, 0.07) * SR)
            if d < n:
                ir[ch, d] += r.uniform(-1, 1) * 2.2 * (1 - k / er)
    # mid/side width control
    m = (ir[0] + ir[1]) / 2
    s = (ir[0] - ir[1]) / 2 * width
    ir = np.vstack([m + s, m - s])
    ir /= np.sqrt(np.sum(ir ** 2) / 2) + 1e-9
    return ir


_IR_CACHE: dict = {}


def reverb(x: np.ndarray, wet: float = 0.25, ir_key: str = 'hall', **ir_kw) -> np.ndarray:
    """Convolution reverb, returns dry+wet (stereo). Output length = input + IR length."""
    if ir_key not in _IR_CACHE:
        _IR_CACHE[ir_key] = make_ir(**ir_kw)
    ir = _IR_CACHE[ir_key]
    xs = stereo(x) if x.ndim == 1 else x
    n = xs.shape[1] + ir.shape[1]
    out = np.zeros((2, n))
    # true-stereo-lite: L->L, R->R with decorrelated IR channels
    out[0, :n - 1] = signal.fftconvolve(xs[0], ir[0])
    out[1, :n - 1] = signal.fftconvolve(xs[1], ir[1])
    dry = pad_to(xs, n)
    return dry * (1 - wet * 0.35) + out * wet * 0.12


def wet_only(x: np.ndarray, ir_key: str = 'hall', **ir_kw) -> np.ndarray:
    if ir_key not in _IR_CACHE:
        _IR_CACHE[ir_key] = make_ir(**ir_kw)
    ir = _IR_CACHE[ir_key]
    xs = stereo(x) if x.ndim == 1 else x
    n = xs.shape[1] + ir.shape[1]
    out = np.zeros((2, n))
    out[0, :n - 1] = signal.fftconvolve(xs[0], ir[0])
    out[1, :n - 1] = signal.fftconvolve(xs[1], ir[1])
    return out * 0.12


def delay_pingpong(x: np.ndarray, time_s: float, fb: float = 0.35, taps: int = 6, lp_hz: float = 3500) -> np.ndarray:
    xs = stereo(x) if x.ndim == 1 else x
    d = ns(time_s)
    n = xs.shape[1] + d * taps
    out = np.zeros((2, n))
    cur = (xs[0] + xs[1]) / 2
    g = fb
    for k in range(1, taps + 1):
        cur = lp(cur, lp_hz)
        ch = k % 2
        out[ch, d * k:d * k + cur.shape[0]] += cur * g
        g *= fb
    return out


def chorus(x: np.ndarray, depth_ms: float = 6.0, rate: float = 0.35, mix: float = 0.5) -> np.ndarray:
    """Stereo chorus via modulated fractional delay."""
    xm = x if x.ndim == 1 else x.mean(axis=0)
    n = xm.shape[0]
    idx = np.arange(n, dtype=np.float64)
    out = np.zeros((2, n))
    for ch, ph in ((0, 0.0), (1, math.pi / 2)):
        dly = (depth_ms * 0.5 * (1 + np.sin(2 * math.pi * rate * idx / SR + ph)) + 8.0) * SR / 1000
        out[ch] = np.interp(idx - dly, idx, xm, left=0.0)
    dry = stereo(xm)
    return dry * (1 - mix * 0.5) + out * mix


def resample_pitch(x: np.ndarray, ratio: float) -> np.ndarray:
    """Play x at `ratio` speed (ratio>1 = higher & shorter) via linear interpolation."""
    n = x.shape[-1]
    m = int(n / ratio)
    src = np.arange(m) * ratio
    idx = np.arange(n)
    if x.ndim == 1:
        return np.interp(src, idx, x)
    return np.vstack([np.interp(src, idx, c) for c in x])


def stereo_widen(x: np.ndarray, amount: float = 1.3) -> np.ndarray:
    m = (x[0] + x[1]) / 2
    s = (x[0] - x[1]) / 2 * amount
    return np.vstack([m + s, m - s])


def haas(x: np.ndarray, ms: float = 9.0, side: int = 1) -> np.ndarray:
    d = int(ms * SR / 1000)
    y = np.vstack([x, x]) if x.ndim == 1 else x.copy()
    y[side] = np.concatenate([np.zeros(d), y[side][:-d]])
    return y


# ----------------------------------------------------------------------------- loop helpers
def wrap_loop(x: np.ndarray, loop_n: int) -> np.ndarray:
    """Fold everything after loop_n back onto the start so the loop is sample-seamless."""
    out = x[..., :loop_n].copy()
    rest = x[..., loop_n:]
    k = 0
    while rest.shape[-1] > 0:
        m = min(loop_n, rest.shape[-1])
        out[..., :m] += rest[..., :m]
        rest = rest[..., m:]
        k += 1
    return out


def loop_limiter(x: np.ndarray, ceiling_db: float = -1.0) -> np.ndarray:
    """Limiter that respects the wrap-around of a loop."""
    pad = ns(0.2)
    ext = np.concatenate([x[..., -pad:], x, x[..., :pad]], axis=-1)
    y = limiter(ext, ceiling_db)
    return y[..., pad:pad + x.shape[-1]]


# ----------------------------------------------------------------------------- analysis
def k_weight(x: np.ndarray) -> np.ndarray:
    y = biquad(x, 'highshelf', 1681.97, 0.707, 3.99984)
    y = biquad(y, 'hp', 38.135, 0.5003)
    return y


def lufs(x: np.ndarray) -> float:
    """Integrated loudness approximation (BS.1770 gating, 400 ms blocks)."""
    xs = stereo(x) if x.ndim == 1 else x
    y = k_weight(xs)
    blk = ns(0.4)
    hop = ns(0.1)
    if y.shape[1] < blk:
        y = pad_to(y, blk)
    pw = []
    for s in range(0, y.shape[1] - blk + 1, hop):
        seg = y[:, s:s + blk]
        pw.append(np.sum(np.mean(seg ** 2, axis=1)))
    pw = np.array(pw) + 1e-12
    L = -0.691 + 10 * np.log10(pw)
    pw = pw[L > -70]
    if len(pw) == 0:
        return -70.0
    rel = -0.691 + 10 * np.log10(np.mean(pw)) - 10
    L = -0.691 + 10 * np.log10(pw)
    g = pw[L > rel]
    return float(-0.691 + 10 * np.log10(np.mean(g if len(g) else pw)))


def momentary_max(x: np.ndarray) -> float:
    """Max momentary loudness (400 ms window), LUFS-ish — good loudness proxy for short SFX."""
    xs = stereo(x) if x.ndim == 1 else x
    y = k_weight(xs)
    blk = ns(0.4)
    if y.shape[1] < blk:
        y = pad_to(y, blk)
    p = np.sum(y ** 2, axis=0)
    c = np.cumsum(np.concatenate([[0], p]))
    win = (c[blk:] - c[:-blk]) / blk
    return float(-0.691 + 10 * np.log10(np.max(win) + 1e-12))


def stats(x: np.ndarray) -> dict:
    xs = stereo(x) if x.ndim == 1 else x
    mono = xs.mean(axis=0)
    peak = float(np.max(np.abs(xs)))
    rms = float(np.sqrt(np.mean(xs ** 2)))
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), 1 / SR)
    centroid = float(np.sum(freqs * spec) / (np.sum(spec) + 1e-12))
    clip = int(np.sum(np.abs(xs) >= 0.999))
    # seam: discontinuity between last and first sample relative to typical sample-to-sample delta
    d = np.abs(np.diff(xs, axis=1))
    seam = float(np.max(np.abs(xs[:, 0] - xs[:, -1])) / (np.percentile(d, 99.5) + 1e-9))
    corr = float(np.corrcoef(xs[0], xs[1])[0, 1]) if np.std(xs[0]) > 0 and np.std(xs[1]) > 0 else 1.0
    return {
        'len_s': round(xs.shape[1] / SR, 3),
        'peak_dbfs': round(20 * math.log10(peak + 1e-12), 2),
        'rms_dbfs': round(20 * math.log10(rms + 1e-12), 2),
        'lufs': round(lufs(xs), 2),
        'mmax_lufs': round(momentary_max(xs), 2),
        'centroid_hz': round(centroid),
        'clipped': clip,
        'seam_ratio': round(seam, 2),
        'lr_corr': round(corr, 2),
    }


def normalize_mmax(x: np.ndarray, target_lufs: float, ceiling_db: float = -1.0) -> np.ndarray:
    """Normalize an SFX so its max momentary loudness hits target, then peak-limit."""
    cur = momentary_max(x)
    y = x * db(target_lufs - cur)
    return limiter(y, ceiling_db)


def trim_tail(x: np.ndarray, thresh_db: float = -70.0, min_s: float = 0.05) -> np.ndarray:
    a = np.max(np.abs(x), axis=0) if x.ndim == 2 else np.abs(x)
    idx = np.where(a > db(thresh_db))[0]
    end = max(ns(min_s), (idx[-1] + 1) if len(idx) else ns(min_s))
    end = min(end + ns(0.01), x.shape[-1])
    return fade(x[..., :end], 0, min(0.02, end / SR / 4))
