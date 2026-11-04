# Last Lantern: Audio Direction and Mix Sheet

Owner: audio-director / sound-designer · Runtime: `src/audio/Audio.ts` · Assets: `public/audio/*.ogg`
Renderer: `tools/audio/` (numpy/scipy, all original synthesis, nothing sampled or licensed)

## 1. Sonic identity: "moonlit storybook"
- **Palette.** Mostly acoustic and warm: music box / celesta, Karplus-Strong harp, a bowed string section, a breathy
  "lantern flute", soft brass, a formant choir, church bells with a minor-third tierce, and taiko and frame drums.
  For effects: glass, wood, embers, chain and air. No harsh synth leads, no white-noise blasts.
- **Key.** D minor throughout. The level-up, chest, evolution and victory cues use D major/Lydian, so every reward
  sounds like the lantern flaring.
- **Lantern motif.** `A–D–E–F` (a rising fourth, then a hopeful stepwise climb). It appears in four places:
  - on the music box in the menu waltz
  - on strings and brass in the run's peak layer
  - darkened with a ♭2 (E♭) in the boss theme
  - resolved in D major in the victory stinger
- **Pillar mapping.**
  - *Light vs. Gloom.* At low light the heartbeat and breathing come in and a low-pass closes the music (the world
    closes in). Healing restores it.
  - *Juicy, legible chaos.* Hit, crit and kill sounds are short, have mid-band transients and are round-robin
    variants, so a dense fight stays readable and doesn't wear the player out.
  - *Builds that break the game.* Each weapon family has its own fire sound. Evolved weapons play it lower and
    louder. The evolution cue is the loudest SFX in the game.

## 2. Music system
| Cue | Form | Tempo | Length | Notes |
|---|---|---|---|---|
| `mus_menu` | 3/4 waltz, 16 bars | 80 | 36.0 s loop | celesta motif, then the flute answers; harp arpeggios, cello, string pad |
| `mus_run_0` base | 4/4, 16 bars | 108 | 35.56 s loop | pad, syncopated harp ostinato, sub bass, celesta sparkles |
| `mus_run_1` pulse | ″ | ″ | ″ | soft kick, frame-drum backbeat, shaker, 8th-note bass |
| `mus_run_2` drive | ″ | ″ | ″ | taiko, spiccato ostinato, claps, hats, tom fills |
| `mus_run_3` peak | ″ | ″ | ″ | motif on strings + brass, choir, crash/timpani, swells |
| `mus_boss` | 4/4, 16 bars | 144 | 26.67 s loop | 3+3+2 string gallop, taiko, brass motif with ♭2, choir, bell |
| `amb_night` | texture | – | 24 s loop | wind, crickets, a distant owl. Plays under menu and run music |
| `stg_victory` | stinger | 88 | 9.5 s | harp glissando, motif in D major, choir, bells, taiko |
| `stg_defeat` | stinger | 60 | 8.0 s | music box winding down flat, the lantern gutters out, low bell |

**Adaptive layering.**
- The four run stems start on the same `AudioContext` time, so they stay sample-locked.
- The layer gains follow `setIntensity` (enemies/200), smoothed with τ = 2 s rising and 7 s falling:
  - L0 always on
  - L1 = smoothstep(0.06–0.24)
  - L2 = smoothstep(0.32–0.55)
  - L3 = smoothstep(0.62–0.85)

**Transitions.**
- Menu → run: crossfade (run fades in over 1.2 s, the old cue fades out over 1.6 s).
- Run → boss: the first `play('boss')` during a run switches to the boss theme (0.4 s in, 0.8 s out).
- `bossDefeated()` crossfades back to the run music.
- `stopMusic()` fades out over 0.9 s. The stinger starts 0.35 s later.

**Seamless loops.**
- Each piece is rendered with its reverb and release tails folded back onto the loop start.
- Files carry 2048 wrap-around samples on each side, and playback uses `loopStart`/`loopEnd`.
- The AudioContext runs at 48 kHz, the same rate as the assets.
- Seam discontinuity is under 0.3× the typical sample-to-sample delta (`seam` column, section 5).

**Paused, level-up and chest screens.** The music goes through a 750 Hz low-pass at −4.4 dB while gameplay is
frozen. The pause state comes from `audio.attach(events, isPaused)` (polled at 10 Hz) or `audio.setPaused(bool)`;
until Game calls one of them the audio layer attaches itself to `window.__game` (state `paused`/`levelup`). Only
with neither available does it fall back to "no `setIntensity` call for 1.5 s" (was 0.5 s: slow machines misfired).

**Memory (Sprint 2).** Decoded PCM is float32, so a 36 s stereo cue at 48 kHz is ~14 MB. Policy:
- Music decodes at 32 kHz (`MUSIC_RATE`) and ambience at 24 kHz (`AMB_RATE`) through an `OfflineAudioContext`
  (`decodeAudioData` always resamples to its context's rate). SFX stay at 48 kHz (short, mostly mono).
- Only the playing cue is decoded: the boss theme on `boss:warning` / `boss:spawned` (the roar's duck covers the
  ~0.2 s decode), run stems are released 2.5 s into the boss fight and re-decoded from the cached Ogg bytes when it
  ends, menu ↔ run release each other, stingers decode on demand and are released after playing.
- Budget: run ≈ 36 MB stems + 4.6 MB ambience + 16.7 MB SFX ≈ 58 MB (was ≈ 98 MB with boss + stingers + 48 kHz).
  `audio.decodedMB` reports the live figure. A hidden tab suspends the context.

## 3. Bus structure and gain staging
```
voices ─▶ sfxBus (sfx² × 2.4) ──┐
ui     ─▶ uiBus  (sfx² × 2.16) ─┤
cues   ─▶ musicIn ▶ LPF ▶ duck ▶ musicBus (music² × 2.2) ─┤──▶ master (master²) ▶ glue comp (−10 dB, 2:1, knee 12) ▶ limiter (−1.5 dB, 20:1) ▶ out
amb    ─▶ ambGain (0.75) ▶ LPF ┘           stingers ─▶ musicBus
```
- **Slider law.** Volume is the square of the slider value (perceptual).
- **Trims.** The bus trims are calibrated with `tools/audio/mixsim.py`. At the default sliders (master 0.8,
  music 0.6, sfx 0.8) the results are:

| Scenario (20 s sim) | Mix LUFS | Peak dBFS (pre-dynamics) | Music LUFS | SFX LUFS | SFX − music |
|---|---|---|---|---|---|
| Calm: base layer, light combat | −22.7 | −5.1 | −25.3 | −25.6 | −0.3 |
| Mid: 3 layers, steady combat | −18.6 | −1.3 | −22.7 | −20.8 | +1.9 |
| Peak: all layers, 300+ enemies, level-up + chest | −15.6 | −1.0 | −21.8 | −16.9 | +4.9 |

- **Targets.**
  - Integrated level in heavy combat: about −16 LUFS (web-game norm).
  - SFX sit 2–5 LU above the music once combat gets busy.
  - Calm moments let the score breathe.

## 4. SFX rules
- **Loudness normalisation.** Every SFX is normalised to a target **max-momentary loudness** (400 ms window, K-weighted),
  then peak-limited to −1 dBFS. The runtime `db` gain is a small per-sound trim on top of that.
- **High-rate sounds** (hit, kill, pickup, weapon fire) use these controls:
  - **3–4 round-robin variants**, with no immediate repeats
  - **random pitch** of ±60–180 cents
  - **random pan** of ±0.15–0.5
  - **a minimum retrigger gap** of 18–70 ms
  - **a per-sound voice cap** of 3–6 (the oldest voice is stolen with a 15 ms fade)
  - **a global cap** of 40 voices
- **Density attenuation.** An exponential trigger-rate estimate (τ 0.35 s) lowers dense sounds by
  4.5 dB × log2(rate/2), capped at −9 dB. When hundreds of hits pile up, they blend into texture instead of getting louder.
- **XP combo.** Each consecutive ember pickup within 0.8 s steps up an A-minor-pentatonic ladder:
  0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24 semitones. The gain drops 0.35 dB per step so the ladder sounds even.
- **Ducking.** Big moments duck the music (attack about 20 ms, hold 150 ms, then release). A shallower duck never
  overrides a deeper one that is still active.

| Sound (`play` name) | File(s) | Target max-mom. LUFS | Runtime dB | Gap s | Voices | Pitch ± cents | Duck dB / release s |
|---|---|---|---|---|---|---|---|
| hover | ui_hover | −30 | −2 | 0.045 | 2 | 25 | – |
| click | ui_click | −22 | −2 | 0.03 | 3 | 20 | – |
| confirm / back / deny | ui_confirm / ui_back / ui_deny | −19 / −22 / −21 | −2 | 0.08–0.12 | 1–2 | – | – |
| fire_bolt (shoot) | ×3 | −24 | −3 | 0.045 | 4 | 120 | – |
| fire_lance | ×2 | −23 | −3 | 0.06 | 3 | 90 | – |
| fire_spark (zap) | ×3 | −24 | −3 | 0.07 | 3 | 150 | – |
| fire_frost | ×2 | −24 | −3 | 0.06 | 3 | 120 | – |
| fire_hook / fire_moth | ×2 each | −24 / −26 | −3 / −2 | 0.08 | 3 | 100 / 150 | – |
| fire_beam / fire_halo / fire_brazier | ×1 | −24 / −26 / −23 | −3 | 0.12–0.15 | 2 | 60–80 | – |
| fire_nova (nova) | ×1 stereo | −19 | −2 | 0.12 | 2 | 60 | −2.5 / 0.5 |
| fire_bell | ×1 stereo | −19 | −2 | 0.2 | 2 | 30 | −2 / 0.8 |
| hit | ×4 | −21 | −4 | 0.022 | 6 | 160 | – |
| crit | ×2 | −18 | −3 | 0.04 | 4 | 100 | – |
| kill | ×4 | −20 | −4 | 0.02 | 6 | 180 | – |
| kill_elite | stereo | −14 | −1 | 0.2 | 2 | – | −4 / 0.8 |
| explode (exploder enemies) | ×2 stereo | −17 | −3 | 0.06 | 3 | 120 | – |
| pickup (XP, combo ladder) | ×1 | −24 | −3 (−0.35/step) | 0.018 | 5 | ladder | – |
| pickup_ash | ×1 | −21 | −3 | 0.05 | 3 | 40 | – |
| heal | stereo | −18 | −2 | 0.25 | 1 | – | −2 / 0.6 |
| levelup | stereo | −14 | −1 | 0.3 | 1 | – | −7 / 1.4 |
| chest | stereo | −14 | −1 | 0.3 | 1 | – | −7 / 1.6 |
| evolve | stereo | −12 | 0 | 0.5 | 1 | – | −9 / 2.2 |
| hurt (lantern sputter) | ×3 | −15 | −1 | 0.09 | 2 | 80 | −3 / 0.35 |
| heartbeat (low light, auto) | ×1 | −17 | −2 × danger | scheduled | 1 | +0–6 % | – |
| breath (very low light, auto) | ×1 | −26 | −2 × danger | scheduled | 1 | – | – |
| boss / boss_roar | stereo | −12 | 0 | 1.0 | 1 | – | −9 / 2.5 |
| boss_death | stereo | −12 | 0 | 1.0 | 1 | – | −10 / 3.0 |
| elite (spawn growl) | stereo | −16 | −2 | 0.6 | 1 | – | −3 / 1.0 |
| warn (swarm horn) | stereo | −16 | −2 | 1.0 | 1 | – | −4 / 1.5 |
| victory / gameover | stg_victory / stg_defeat | −15 / −18 LUFS integrated | +1.6 | – | 1 | – | music bus |

**Low-light warning.**
- danger = clamp((0.35 − light) / 0.3, 0, 1).
- The heartbeat interval runs from 1.0 s down to 0.55 s, with gain 0.35 + 0.65 × danger.
- Breathing starts once danger > 0.55.
- The music low-pass slides from 20 kHz down to about 3 kHz.

## 5. Measured asset stats (from `tools/audio/report.json`)
Peaks are measured before encoding. Every file decodes in Chromium with no clipping. Loops decode sample-exact
(checked by `tools/audio/verify.mjs`).

| File | Len s | Peak dBFS | LUFS | Max-mom. LUFS | Centroid Hz | L/R corr | Seam |
|---|---|---|---|---|---|---|---|
| mus_menu | 36.0 | −3.8 | −16.0 | −12.6 | 2082 | 0.83 | 0.11 |
| mus_run_0 | 35.56 | −7.4 | −19.3 | −17.4 | 1339 | 0.61 | 0.25 |
| mus_run_1 | 35.56 | −8.6 | −27.1 | −22.4 | 5229 | 0.99 | 0.10 |
| mus_run_2 | 35.56 | −7.3 | −20.9 | −16.7 | 1981 | 0.97 | 0.04 |
| mus_run_3 | 35.56 | −9.4 | −20.1 | −18.8 | 2677 | 0.84 | 0.10 |
| run full mix | 35.56 | −1.7 | −15.0 | −13.1 | 2613 | 0.81 | 0.18 |
| mus_boss | 26.67 | −1.0 | −13.6 | −9.8 | 2317 | 0.93 | 0.26 |
| amb_night | 24.0 | −14.0 | −30.0 | −23.9 | 734 | 0.01 | 0.16 |
| stg_victory | 9.5 | −1.0 | −15.1 | −10.5 | 2703 | 0.91 | – |
| stg_defeat | 8.0 | −4.5 | −18.0 | −14.0 | 2780 | 0.88 | – |
| sfx_hit_* | 0.08 | −1.0…−1.5 | −21 | −21 | 860–1140 | mono | – |
| sfx_kill_* | 0.42 | −3.8…−4.8 | −20 | −20 | 3175–3267 | mono | – |
| sfx_fire_bolt_* | 0.20 | −7.2…−7.9 | −24 | −24 | ~3600 | mono | – |
| sfx_pickup | 0.24 | −9.2 | −24 | −24 | 932 | mono | – |
| sfx_levelup | 2.58 | −1.2 | −17.4 | −14 | 2836 | 0.89 | – |
| sfx_evolve | 4.79 | −1.5 | −18.1 | −12 | 2711 | 0.92 | – |
| sfx_boss_roar | 4.92 | −3.0 | −14.5 | −12 | 1701 | 0.79 | – |

All 61 files are in `report.json`. High-rate sounds have spectral centroids of 0.9–3.6 kHz. They were low-passed
at 5–6 kHz to avoid fatigue, and hits gained a resonant 900 Hz "thock" so they read on laptop speakers. Stereo
cues keep positive L/R correlation: the boss roar was fixed from −0.79 by keeping the lows mono and the
Haas-widening only above 350 Hz.

**Budget.**
- 61 Ogg Vorbis files, 3.2 MB in total, against a 5 MB budget.
  - Music stems: Vorbis q2–3.
  - Ambience: q0.
  - SFX: q3–4.
- Decoded music is managed per cue:
  - In the menu, the run and boss stems are released.
  - During a run, the menu is released and the boss theme is pre-decoded.
  - Peak decoded PCM is about 80 MB.

## 6. Pipeline
```
python -m venv .venv && .venv/bin/pip install -r tools/audio/requirements.txt   # + ffmpeg with libvorbis
.venv/bin/python tools/audio/build.py [--only sfx|music] [--preview DIR]       # render, encode, report, manifest
.venv/bin/python tools/audio/mixsim.py                                         # runtime mix simulation
DIST=<build dir> node tools/audio/verify.mjs                                    # Chromium decode + runtime checks
```
- Renders are deterministic (seeded).
- `build.py` regenerates `src/audio/audioManifest.ts`. Do not edit that file by hand.
- With `--preview`, `build.py` also writes a spectrogram and waveform PNG for each file.

## 7. Integration contract for other systems
- `audio.play(name)`: any `SfxName`. Unknown names are ignored and legacy names are aliased:
  - `shoot` → `fire_bolt`
  - `zap` → `fire_spark`
  - `nova` → `fire_nova`
  - `boss` → `boss_roar`
- `audio.playWeapon(weaponId)`: per-family fire sound. Evolutions play their family sound lower and louder.
- `audio.startMusic('menu'|'run'|'boss')`, `audio.stopMusic()`, and `audio.bossDefeated()`.
- `audio.setIntensity(0..1)`: call it every gameplay frame. It is also the pause detector.
- `audio.setLight(0..1)`: call it every gameplay frame. It drives the low-light warning.
- `audio.attach(events, isPaused?)`: the audio layer's own event subscriptions (call once from Game):
  - `elite:spawned` → `elite`; `achievement:unlocked` → soft `confirm` chime
  - `boss:warning` (requested from the Director, ~20 s before the boss) → `warn` + boss theme pre-decode
  - `boss:spawned` → boss theme decode; `run:ended` → release run/boss PCM
- `audio.setPaused(bool)`: explicit pause muffle (alternative to the `isPaused` getter).
- Game already triggers: kills, hits, crits, hurt, heal, pickups, weapon fire, evolve, boss roar/enrage/death,
  level-up, chest, victory/defeat stingers. UI uses `hover`, `click`, `confirm`, `back`, `deny`.
