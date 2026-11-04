"""Last Lantern original adaptive score (rendered offline).

Key: D minor throughout (stingers resolve to D major on victory). One shared "Lantern motif":
    A - D - E - F ... (a rising fourth, then a hopeful step-wise climb) — heard on the music box in the
    menu, on strings/brass at the run's peak layer, darkened with a flat-2 (Eb) in the boss theme and
    finally resolved in D major in the victory stinger.

Pieces
  mus_menu        3/4 waltz, 80 BPM, 16 bars — celesta + harp + soft strings + lantern flute
  mus_run_{0..3}  4/4, 108 BPM, 16 bars, 4 sample-locked stems: base / pulse / drive / peak
  mus_boss        4/4, 144 BPM, 16 bars — taiko, gallop strings, brass motif, choir, bells
  stg_victory / stg_defeat   one-shot stingers
  amb_night       24 s seamless night ambience (wind, crickets, distant owl)
"""
from __future__ import annotations

import math
import numpy as np

import dsp
import instruments as I
from dsp import SR, ns, mtof

# ----------------------------------------------------------------------------- harmony helpers
CHORDS = {
    'Dm': (2, [0, 3, 7]), 'Bb': (10, [0, 4, 7]), 'Bbmaj7': (10, [0, 4, 7, 11]), 'C': (0, [0, 4, 7]),
    'Gm': (7, [0, 3, 7]), 'Gm9': (7, [0, 3, 7, 10, 14]), 'Gm7': (7, [0, 3, 7, 10]), 'F': (5, [0, 4, 7]),
    'A': (9, [0, 4, 7]), 'A7': (9, [0, 4, 7, 10]), 'Asus4': (9, [0, 5, 7]), 'Eb': (3, [0, 4, 7]),
    'Bb6': (10, [0, 4, 7, 9]), 'D': (2, [0, 4, 7]), 'G': (7, [0, 4, 7]), 'Fmaj7': (5, [0, 4, 7, 11]),
}


def chord_pcs(name: str) -> list[int]:
    root, ivs = CHORDS[name]
    return [(root + i) % 12 for i in ivs]


def voicing(name: str, center: int = 64, count: int = 4) -> list[int]:
    """Close voicing of `count` chord tones nearest to `center`."""
    pcs = chord_pcs(name)
    cands = [m for m in range(center - 14, center + 14) if m % 12 in pcs]
    cands.sort(key=lambda m: abs(m - center))
    return sorted(cands[:count])


def bass_note(name: str, octave_floor: int = 38) -> int:
    root = CHORDS[name][0]
    m = octave_floor + ((root - octave_floor) % 12)
    return m


# ----------------------------------------------------------------------------- score container
class Score:
    def __init__(self, bpm: float, beats: float, stems: list[str], tail: float = 6.0, loop: bool = True):
        self.bpm = bpm
        self.beat = 60.0 / bpm
        self.loop = loop
        self.loop_n = ns(beats * self.beat)
        self.n = self.loop_n + ns(tail)
        self.bufs = {s: np.zeros((2, self.n)) for s in stems}

    def at(self, beat: float) -> int:
        return ns(beat * self.beat)

    def add(self, stem: str, beat: float, audio: np.ndarray, pan: float = 0.0, gain: float = 1.0, human: float = 0.004):
        jitter = dsp.rng.normal(0, human) if human > 0 else 0.0
        pos = max(0, int((beat * self.beat + jitter) * SR))
        a = dsp.stereo(audio, pan) if audio.ndim == 1 else audio
        dsp.mix_into(self.bufs[stem], a, pos, gain)

    def render(self, fx: dict[str, dict]) -> dict[str, np.ndarray]:
        out = {}
        for s, buf in self.bufs.items():
            p = fx.get(s, {})
            y = buf
            if p.get('hp'):
                y = dsp.hp(y, p['hp'])
            if p.get('warm'):
                y = dsp.shelf_lo(y, 200, p['warm'])
            if p.get('air'):
                y = dsp.shelf_hi(y, 7000, p['air'])
            wet = p.get('wet', 0.25)
            if wet > 0:
                rt = p.get('rt', 2.6)
                w = dsp.wet_only(y, f"{p.get('ir', 'hall')}_{rt}", seconds=rt, predelay=0.02, width=1.2)
                y = dsp.pad_to(y, w.shape[1]) + w * wet
            if p.get('width'):
                # widen only above ~250 Hz so the low end stays mono-solid
                lo = dsp.lp(y, 250)
                y = lo + dsp.stereo_widen(y - lo, p['width'])
            if self.loop:
                y = dsp.wrap_loop(y, self.loop_n)
            out[s] = y
        return out


def master_stems(stems: dict[str, np.ndarray], target_lufs: float, ceiling_db: float = -1.0, loop: bool = True):
    """Scale all stems by one gain so the full mix hits target loudness; peak-limit each stem."""
    mix = sum(stems.values())
    g = dsp.db(target_lufs - dsp.lufs(mix))
    res = {}
    for k, v in stems.items():
        y = v * g
        y = dsp.loop_limiter(y, ceiling_db) if loop else dsp.limiter(y, ceiling_db)
        res[k] = y
    mix = sum(res.values())
    pk = np.max(np.abs(mix))
    if pk > dsp.db(ceiling_db + 1.5):  # keep summed stems from clipping the runtime bus
        s = dsp.db(ceiling_db + 1.5) / pk
        res = {k: v * s for k, v in res.items()}
    return res


# ----------------------------------------------------------------------------- MENU (3/4 waltz)
MENU_CHORDS = ['Dm', 'Bbmaj7', 'C', 'Gm9', 'Bb6', 'F', 'Gm7', 'A',
               'Dm', 'Bbmaj7', 'C', 'F', 'Gm', 'C', 'Gm', 'A']
# (beat, length, midi) — the Lantern motif, 3/4
MENU_MELODY = [
    (0, 1, 69), (1, 1, 74), (2, 1, 76), (3, 3, 77),
    (6, 1, 76), (7, 1, 74), (8, 1, 72), (9, 2, 74), (11, 1, 69),
    (12, 1, 70), (13, 1, 74), (14, 1, 79), (15, 2, 77), (17, 1, 76),
    (18, 1, 74), (19, 0.5, 76), (19.5, 0.5, 77), (20, 1, 76), (21, 3, 73),
    (24, 1, 69), (25, 1, 74), (26, 1, 76), (27, 2, 77), (29, 1, 81),
    (30, 1, 79), (31, 1, 77), (32, 1, 76), (33, 3, 81),
    (36, 1, 79), (37, 1, 77), (38, 1, 74), (39, 2, 76), (41, 1, 77),
    (42, 1, 74), (43, 1, 72), (44, 1, 70), (45, 3, 69),
]


def render_menu():
    dsp.reseed(101)
    sc = Score(80, 48, ['menu'], tail=7.0)
    for bar, ch in enumerate(MENU_CHORDS):
        b0 = bar * 3
        root, ivs = CHORDS[ch]
        third = ivs[1]
        fifth = ivs[2]
        bn = bass_note(ch, 38)
        # harp arpeggio, 6 eighths: R 5 8 10 12 10 (lilting)
        pat = [bn, bn + fifth, bn + 12, bn + 12 + third, bn + 12 + fifth, bn + 12 + third]
        for i, m in enumerate(pat):
            vel = 0.55 if i == 0 else 0.38 + 0.06 * (i == 3)
            sc.add('menu', b0 + i * 0.5, I.harp(mtof(m), vel), pan=-0.25 + 0.1 * (i % 3), gain=0.85, human=0.006)
        # cello-ish bass (bowed, soft) on the downbeat
        sc.add('menu', b0, I.strings(mtof(bn - 12 if bn > 45 else bn), 3 * sc.beat * 0.98, 0.45, attack=0.25,
                                     release=0.9, bright=0.35), pan=0.1, gain=0.55)
        # string pad (soft, sustained)
        for k, m in enumerate(voicing(ch, 62, 4)):
            sc.add('menu', b0, I.strings(mtof(m), 3 * sc.beat, 0.32, attack=0.6, release=1.4, bright=0.55),
                   pan=-0.5 + k * 0.33, gain=0.32, human=0.0)
    # melody: celesta (1st half, an octave up = music-box sparkle), flute (2nd half) + celesta doubling at the climax
    for beat, length, m in MENU_MELODY:
        if beat < 24:
            sc.add('menu', beat, I.celesta(mtof(m + 12), 0.75), pan=0.18, gain=0.85)
        else:
            sc.add('menu', beat, I.flute(mtof(m), length * sc.beat * 0.95, 0.62), pan=0.05, gain=0.95)
            if 30 <= beat < 42:
                sc.add('menu', beat, I.celesta(mtof(m + 12), 0.4), pan=0.35, gain=0.45)
    # celesta answer phrases (counter-melody, bars 9-16 on beat 3)
    for bar in range(8, 16):
        ch = MENU_CHORDS[bar]
        v = voicing(ch, 84, 3)
        sc.add('menu', bar * 3 + 2.5, I.celesta(mtof(v[-1]), 0.35), pan=-0.4, gain=0.5)
    stems = sc.render({'menu': {'wet': 0.55, 'rt': 3.2, 'warm': 1.5, 'hp': 35, 'width': 1.8}})
    return master_stems(stems, -16.0)


# ----------------------------------------------------------------------------- RUN (4 stems)
RUN_CHORDS = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A',
              'Dm', 'Bb', 'F', 'C', 'Gm', 'Bb', 'Asus4', 'A']
RUN_MELODY = [
    (0, 0.5, 69), (0.5, 0.5, 74), (1, 1, 76), (2, 2, 77),
    (4, 1, 76), (5, 1, 74), (6, 1, 72), (7, 1, 74),
    (8, 0.5, 69), (8.5, 0.5, 72), (9, 1, 77), (10, 2, 81),
    (12, 1, 79), (13, 1, 77), (14, 2, 76),
    (16, 0.5, 69), (16.5, 0.5, 74), (17, 1, 76), (18, 2, 77),
    (20, 1, 79), (21, 1, 77), (22, 2, 74),
    (24, 1, 74), (25, 0.5, 76), (25.5, 0.5, 77), (26, 1, 79), (27, 1, 82),
    (28, 3, 81), (31, 0.5, 76), (31.5, 0.5, 73),
    (32, 1.5, 74), (33.5, 0.5, 76), (34, 2, 77),
    (36, 1, 74), (37, 1, 77), (38, 2, 82),
    (40, 1.5, 81), (41.5, 0.5, 79), (42, 2, 77),
    (44, 1, 76), (45, 1, 79), (46, 2, 84),
    (48, 1.5, 82), (49.5, 0.5, 81), (50, 2, 79),
    (52, 1, 77), (53, 1, 74), (54, 1, 77), (55, 1, 79),
    (56, 3, 81), (59, 1, 79),
    (60, 2, 76), (62, 2, 73),
]


def render_run():
    dsp.reseed(202)
    stems = ['run_0', 'run_1', 'run_2', 'run_3']
    sc = Score(108, 64, stems, tail=6.0)
    B = sc.beat
    for bar, ch in enumerate(RUN_CHORDS):
        b0 = bar * 4
        root, ivs = CHORDS[ch]
        third, fifth = ivs[1], ivs[2]
        bn = bass_note(ch, 38)
        # ---- L0 base: pad, harp ostinato, sub bass, sparse celesta
        for k, m in enumerate(voicing(ch, 60, 4)):
            sc.add('run_0', b0, I.pad(mtof(m), 4 * B, 0.55, cutoff=1300, attack=0.5, release=1.2), gain=0.75, human=0)
        # syncopated harp ostinato (3+3+2 feel over 8 eighths)
        pat = [(0, bn + 12), (0.75, bn + 12 + fifth), (1.5, bn + 24), (2, bn + 12 + third + 12 if third else bn + 24),
               (2.75, bn + 12 + fifth), (3.5, bn + 24)]
        for i, (bt, m) in enumerate(pat):
            sc.add('run_0', b0 + bt, I.harp(mtof(m), 0.55 if i in (0, 3) else 0.4), pan=0.3 - 0.12 * (i % 3), gain=0.7,
                   human=0.005)
        sc.add('run_0', b0, I.bass_sub(mtof(bn), 4 * B * 0.96, 0.6), gain=0.7)
        if bar % 2 == 1:
            v = voicing(ch, 86, 3)
            sc.add('run_0', b0 + 2.5, I.celesta(mtof(v[1]), 0.35), pan=-0.5, gain=0.5)
        # ---- L1 pulse: soft kick, frame drum backbeat, shaker, pulsing bass
        for bt in (0, 2.5):
            sc.add('run_1', b0 + bt, I.kick(0.75 if bt == 0 else 0.55, 50, 2.2, 0.4), gain=0.85)
        for bt in (1, 3):
            sc.add('run_1', b0 + bt, I.frame_drum(0.6), pan=0.15, gain=0.7)
        for i in range(8):
            sc.add('run_1', b0 + i * 0.5, I.shaker(0.55 if i % 2 else 0.35), pan=0.45, gain=0.45, human=0.006)
        for i in range(8):
            m = bn + (12 if i % 2 else 0)
            sc.add('run_1', b0 + i * 0.5, I.bass_pluck(mtof(m), 0.6 if i % 2 == 0 else 0.45), gain=0.6)
        # ---- L2 drive: taiko, spiccato ostinato, claps, hats, tom fills
        for bt, v in ((0, 0.9), (0.75, 0.45), (1.5, 0.6), (2, 0.85), (3, 0.55), (3.5, 0.65)):
            sc.add('run_2', b0 + bt, I.taiko(v, 66), pan=-0.1, gain=0.8, human=0.003)
        for bt in (1, 3):
            sc.add('run_2', b0 + bt, I.clap(0.55), pan=0.05, gain=0.55)
        for i in range(16):
            sc.add('run_2', b0 + i * 0.25, I.hat(0.45 if i % 4 == 2 else 0.25), pan=0.4, gain=0.55, human=0.003)
        spic = [bn + 24, bn + 24 + fifth, bn + 24 + 12, bn + 24 + fifth, bn + 24 + third, bn + 24 + fifth, bn + 36,
                bn + 24 + fifth]
        for i, m in enumerate(spic):
            sc.add('run_2', b0 + i * 0.5, I.spiccato(mtof(m), 0.65 if i % 2 == 0 else 0.5), pan=-0.35, gain=0.6)
        if bar % 4 == 3:
            for i, f in enumerate((140, 120, 100, 86)):
                sc.add('run_2', b0 + 3 + i * 0.25, I.tom(0.55 + 0.08 * i, f), pan=0.4 - 0.25 * i, gain=0.6)
        # ---- L3 peak: choir chords, brass pads, crash
        for k, m in enumerate(voicing(ch, 62, 3)):
            sc.add('run_3', b0, I.choir(mtof(m), 4 * B, 0.45, 'ah'), pan=-0.4 + 0.4 * k, gain=0.6, human=0)
        if bar % 8 == 0:
            sc.add('run_3', b0, I.crash(0.55, 2.8), pan=0.3, gain=0.7)
            sc.add('run_3', b0, I.timpani(mtof(bn), 0.8), gain=0.6)
        if bar % 8 == 7:
            sc.add('run_3', b0 + 4 - 2.2 / B, I.swell(2.2, 0.5), pan=-0.2, gain=0.6, human=0)
    # lead melody on strings (octave) + brass an octave below
    for beat, length, m in RUN_MELODY:
        dur = length * B * 0.98
        sc.add('run_3', beat, I.strings(mtof(m), dur, 0.7, attack=0.05, release=0.35, voices=4, bright=1.1),
               pan=0.15, gain=1.5, human=0)
        sc.add('run_3', beat, I.brass(mtof(m - 12), dur, 0.55), pan=-0.15, gain=0.85, human=0)
    fx = {
        'run_0': {'wet': 0.45, 'rt': 2.8, 'hp': 30, 'width': 1.7},
        'run_1': {'wet': 0.15, 'rt': 1.4, 'ir': 'room', 'air': -4.0},
        'run_2': {'wet': 0.3, 'rt': 2.2, 'ir': 'hall22', 'width': 1.4},
        'run_3': {'wet': 0.4, 'rt': 2.8, 'air': 1.0, 'width': 1.7},
    }
    return master_stems(sc.render(fx), -15.0)


# ----------------------------------------------------------------------------- BOSS
BOSS_CHORDS = ['Dm', 'Dm', 'Eb', 'Eb', 'Bb', 'Bb', 'A', 'A',
               'Dm', 'Dm', 'Eb', 'Eb', 'Gm', 'Gm', 'A', 'A']
BOSS_MELODY = [
    (0, 1.5, 57), (1.5, 0.5, 62), (2, 2, 65), (4, 2, 64), (6, 2, 62),
    (8, 3, 63), (11, 1, 62), (12, 4, 58),
    (16, 1.5, 62), (17.5, 0.5, 65), (18, 2, 70), (20, 2, 69), (22, 2, 65),
    (24, 2, 73), (26, 2, 64), (28, 4, 69),
    (32, 1.5, 69), (33.5, 0.5, 74), (34, 2, 77), (36, 2, 76), (38, 2, 74),
    (40, 3, 75), (43, 1, 74), (44, 4, 70),
    (48, 1.5, 67), (49.5, 0.5, 70), (50, 2, 74), (52, 2, 72), (54, 2, 70),
    (56, 4, 69), (60, 2, 73), (62, 2, 76),
]


def render_boss():
    dsp.reseed(303)
    sc = Score(144, 64, ['boss'], tail=5.0)
    B = sc.beat
    for bar, ch in enumerate(BOSS_CHORDS):
        b0 = bar * 4
        root, ivs = CHORDS[ch]
        bn = bass_note(ch, 38)
        second_half = bar >= 8
        # gallop ostinato in low strings (accents 3+3+2)
        pat = [0, 0, 0, 12, 0, 0, 12, 10] if ch != 'Eb' else [0, 0, 0, 12, 0, 0, 11, 12]
        for i, iv in enumerate(pat):
            acc = i in (0, 3, 6)
            sc.add('boss', b0 + i * 0.5, I.spiccato(mtof(bn + iv), 0.85 if acc else 0.55), pan=-0.3, gain=0.75)
            sc.add('boss', b0 + i * 0.5, I.spiccato(mtof(bn + iv - 12), 0.7 if acc else 0.45), pan=0.2, gain=0.55)
        # taiko on the accents, kick under the downbeat
        for bt, v in ((0, 1.0), (1.5, 0.8), (3, 0.85), (3.5, 0.5 if bar % 2 else 0.0)):
            if v > 0:
                sc.add('boss', b0 + bt, I.taiko(v, 58), pan=-0.05, gain=0.85, human=0.002)
        sc.add('boss', b0, I.kick(0.9, 46, 2.6, 0.5), gain=0.7)
        for bt in (1, 3):
            sc.add('boss', b0 + bt, I.clap(0.6), gain=0.45)
        for i in range(16):
            sc.add('boss', b0 + i * 0.25, I.hat(0.4 if i % 2 else 0.2), pan=0.45, gain=0.5, human=0.002)
        # choir + tremolo strings sustain (2-bar chords)
        if bar % 2 == 0:
            for k, m in enumerate(voicing(ch, 60 if not second_half else 64, 3)):
                sc.add('boss', b0, I.choir(mtof(m), 8 * B, 0.55 if second_half else 0.4, 'ah' if second_half else 'oh'),
                       pan=-0.5 + 0.5 * k, gain=0.5, human=0)
        if bar % 4 == 3:
            for i, f in enumerate((150, 130, 110, 92, 80, 70)):
                sc.add('boss', b0 + 2.5 + i * 0.25, I.tom(0.6 + 0.06 * i, f), pan=0.5 - 0.2 * i, gain=0.65)
        if bar in (0, 8):
            sc.add('boss', b0, I.crash(0.7, 3.0), pan=0.25, gain=0.75)
            sc.add('boss', b0, I.bell(mtof(62), 0.8, 5.0), pan=-0.2, gain=0.7)
        if bar in (7, 15):
            sc.add('boss', b0 + 4 - 1.6 / B, I.swell(1.6, 0.6), gain=0.6, human=0)
    for beat, length, m in BOSS_MELODY:
        dur = length * B * 0.97
        sc.add('boss', beat, I.brass(mtof(m), dur, 0.8), pan=0.1, gain=0.8, human=0)
        sc.add('boss', beat, I.brass(mtof(m - 12), dur, 0.7), pan=-0.1, gain=0.55, human=0)
        if beat >= 32:
            sc.add('boss', beat, I.strings(mtof(m + 12), dur, 0.6, attack=0.04, release=0.3, voices=4), pan=0.25,
                   gain=0.45, human=0)
    stems = sc.render({'boss': {'wet': 0.32, 'rt': 2.4, 'hp': 28, 'width': 1.6}})
    return master_stems(stems, -13.5)


# ----------------------------------------------------------------------------- STINGERS
def render_victory():
    dsp.reseed(404)
    sc = Score(88, 14, ['v'], tail=0.0, loop=False)
    B = sc.beat
    sc.n = ns(9.5)
    sc.bufs['v'] = np.zeros((2, sc.n))
    # harp gliss up D major pentatonic
    notes = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]
    sc.add('v', 0, I.gliss([mtof(m) for m in notes], 0.07, I.harp, 0.6), pan=-0.2, gain=0.8, human=0)
    sc.add('v', 0, I.riser(1.4, 400, 7000, 0.25), gain=0.5, human=0)
    mel = [(2, 0.5, 69), (2.5, 0.5, 74), (3, 0.5, 76), (3.5, 1.5, 78), (5, 0.5, 76), (5.5, 0.5, 78), (6, 5, 81)]
    for beat, length, m in mel:
        sc.add('v', beat, I.strings(mtof(m), length * B, 0.75, attack=0.05, voices=4), pan=0.1, gain=0.8, human=0)
        sc.add('v', beat, I.flute(mtof(m), length * B, 0.6), pan=-0.1, gain=0.5, human=0)
        sc.add('v', beat, I.celesta(mtof(m + 12), 0.5), pan=0.3, gain=0.5, human=0)
    for beat, ch, dur in ((2, 'D', 3), (5, 'G', 1), (6, 'D', 6)):
        for k, m in enumerate(voicing(ch, 62, 4)):
            sc.add('v', beat, I.brass(mtof(m - 12), dur * B, 0.55), pan=-0.4 + 0.25 * k, gain=0.4, human=0)
            sc.add('v', beat, I.choir(mtof(m), dur * B, 0.45, 'ah'), pan=0.4 - 0.25 * k, gain=0.4, human=0)
        sc.add('v', beat, I.bass_sub(mtof(bass_note(ch, 38)), dur * B, 0.7), gain=0.7, human=0)
    sc.add('v', 6, I.taiko(1.0, 62), gain=0.8, human=0)
    sc.add('v', 6, I.timpani(mtof(38), 0.9), gain=0.6, human=0)
    sc.add('v', 6, I.crash(0.6, 3.5), pan=0.2, gain=0.6, human=0)
    sc.add('v', 6, I.bell(mtof(74), 0.7, 5.0), pan=-0.3, gain=0.55, human=0)
    sc.add('v', 6.02, I.bell(mtof(81), 0.5, 4.0), pan=0.3, gain=0.4, human=0)
    st = sc.render({'v': {'wet': 0.45, 'rt': 3.0, 'width': 1.6}})
    y = dsp.fade(st['v'][:, :ns(9.5)], 0, 1.5)
    return master_stems({'v': y}, -15.0, loop=False)['v']


def render_defeat():
    dsp.reseed(505)
    sc = Score(60, 10, ['d'], tail=0.0, loop=False)
    sc.n = ns(8.0)
    sc.bufs['d'] = np.zeros((2, sc.n))
    mel = [(0, 69), (0.75, 74), (1.5, 76), (2.25, 77), (3.5, 76), (4.5, 74)]
    for i, (beat, m) in enumerate(mel):
        # the music box winds down: each note slightly flatter and slower
        cents = -6 * i
        sc.add('d', beat, I.celesta(mtof(m + 12) * 2 ** (cents / 1200), 0.6 - 0.05 * i), pan=0.15, gain=0.8, human=0)
    for beat, ch, dur in ((0, 'Dm', 2.2), (2.25, 'Bb', 1.25), (3.5, 'Gm', 1.0), (4.5, 'Dm', 3.5)):
        for k, m in enumerate(voicing(ch, 57, 4)):
            sc.add('d', beat, I.strings(mtof(m), dur, 0.4, attack=0.4, release=1.5, bright=0.5), pan=-0.4 + 0.25 * k,
                   gain=0.4, human=0)
        sc.add('d', beat, I.strings(mtof(bass_note(ch, 33)), dur, 0.5, attack=0.3, release=1.8, bright=0.3), gain=0.6,
               human=0)
    sc.add('d', 4.5, I.bell(mtof(50), 0.5, 6.0), pan=0.0, gain=0.6, human=0)
    # lantern gutters out: breathy descending noise
    n = ns(1.6)
    t = dsp.tarr(n)
    gut = dsp.sweep(dsp.white(n), 'bp', 1800 * np.exp(-t * 1.6) + 150, 1.5) * np.exp(-t * 2.2) * 0.5
    sc.add('d', 4.2, gut, pan=0.0, gain=0.6, human=0)
    st = sc.render({'d': {'wet': 0.55, 'rt': 3.5, 'width': 1.6}})
    y = dsp.fade(st['d'][:, :ns(8.0)], 0, 2.0)
    return master_stems({'d': y}, -18.0, loop=False)['d']


# ----------------------------------------------------------------------------- AMBIENCE
def render_ambience():
    dsp.reseed(606)
    L = 24.0
    n = ns(L + 4)
    t = dsp.tarr(n)
    out = np.zeros((2, n))
    # wind: two decorrelated pink layers, slowly swept band
    for ch in range(2):
        w = dsp.pink(n)
        cut = 380 + 240 * np.sin(2 * np.pi * t / L * 2 + ch) + 120 * np.sin(2 * np.pi * t / L * 5 + 1.3 * ch)
        w = dsp.sweep(w, 'lp', cut, 0.9, block=512)
        out[ch] += w * (0.55 + 0.25 * np.sin(2 * np.pi * t / L * 3 + ch))
    # crickets: chirp trains (4-5 kHz carriers, 3-pulse chirps)
    for c in range(9):
        f = 4300 + dsp.rng.uniform(-400, 500)
        start = dsp.rng.uniform(0, L)
        pan = dsp.rng.uniform(-0.9, 0.9)
        nchirps = dsp.rng.integers(3, 7)
        for k in range(nchirps):
            cs = start + k * dsp.rng.uniform(0.55, 0.75)
            m = ns(0.12)
            tt = dsp.tarr(m)
            am = np.clip(np.sin(2 * np.pi * 28 * tt), 0, 1) ** 2
            chirp = np.sin(2 * np.pi * f * tt) * am * np.hanning(m) * 0.05
            dsp.mix_into(out, dsp.stereo(chirp, pan), ns(cs % L))
    # distant owl (two soft hoots) once per loop
    for k, (d, f) in enumerate(((7.0, 410), (7.55, 390), (7.9, 385))):
        m = ns(0.38)
        tt = dsp.tarr(m)
        hoot = np.sin(2 * np.pi * f * (1 - 0.06 * tt) * tt) * np.sin(np.pi * tt / tt[-1]) ** 2
        hoot = dsp.lp(hoot + 0.1 * dsp.white(m) * np.sin(np.pi * tt / tt[-1]), 900) * 0.08
        dsp.mix_into(out, dsp.stereo(hoot, -0.6), ns(d))
    w = dsp.wet_only(out, 'night', seconds=2.0, predelay=0.03, width=1.5)
    y = dsp.pad_to(out, w.shape[1]) + w * 0.4
    y = dsp.hp(y, 60)
    y = dsp.wrap_loop(y, ns(L))
    return master_stems({'a': y}, -30.0)['a']
