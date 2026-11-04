# Last Lantern: 30-second trailer script (announcement / Steam page top video)

> Goal: in 30 seconds, a scrolling viewer gets **(1) the hook (light = life), (2) the spectacle (hundreds of
> enemies, absurd builds), (3) the style (moonlit storybook), and (4) the call to action (wishlist)**.
> Steam autoplays muted, so the story has to read with sound off. Text cards carry the meaning and the music
> carries the feeling.
>
> Format: 1920×1080, 60 fps, H.264 high profile, 20–30 Mbps, AAC 320 kbps. Also export a 1080×1920 vertical cut
> (TikTok / Shorts / Reels) with the action centred. Capture on a real GPU at the High preset with damage numbers
> on. Use `debug.timeScale = 1` only. Speed-ups look wrong on camera.
>
> Music: `public/audio/mus_run_2.ogg` (mid-run intensity) cross-faded to `mus_boss.ogg` at 0:18, then
> `stg_victory.ogg`'s final chord under the end card. Everything is original, so there are no licensing questions.

| Time | Picture | Text on screen | Sound |
|---|---|---|---|
| **0:00–0:03** | Black. A single lantern flame flickers on in the centre. Pull back to reveal Wren holding it on a hill under a huge moon (title-screen hero angle, no UI). | *"The sun hasn't risen in a hundred years."* | Low drone (`amb_night`), one soft bell |
| **0:03–0:06** | Gameplay, HUD on. Shades creep out of the violet fog into the amber pool around Wren. Ember Bolts fire automatically and the first hits flash. | *"One lantern still burns."* | `mus_run_2` kicks in on the first hit |
| **0:06–0:09** | Wren takes three hits. **The light pool visibly shrinks** and the Gloom vignette thickens. | **"YOUR LIGHT IS YOUR LIFE."** *(big, amber)* | Hurt SFX, heartbeat under music |
| **0:09–0:11** | She grabs lamp oil and the pool **flares back out**, pushing the fog away. | — | Heal SFX (`sfx_heal`), music lifts |
| **0:11–0:13** | Quick cut: level-up overlay, cursor picks **Spark Chain**. Snap back to gameplay as lightning leaps through a pack. | *"Build something absurd."* | UI confirm + lightning crackle |
| **0:13–0:17** | Montage, 1 s each: Cinder Halo orbiting → Vesper Bell tolling on a pack → Lighthouse Beam sweeping → **reliquary opens: EVOLVED: Solar Crown**. | — | Each weapon's SFX on the beat; evolve sting |
| **0:17–0:20** | Top-down pull-back over **300+ shadows** in a ring, all burning, while every hit sparkles. Damage numbers rain. | *"Hundreds of shadows."* | Music peaks, kill SFX layered |
| **0:20–0:23** | Timer hits **15:00**. The camera lurches and **the Hollow Stag** steps out of the fog, antlers glowing, and roars. | — | `sfx_boss_roar`, cut to `mus_boss` |
| **0:23–0:25** | Two flash cuts: the Sunken Marsh with the Mire Mother rising from a pool, then the Ashen Ruins with the Ashen King among ember cracks. | *"Three nights. Three masters."* | Boss music continues |
| **0:25–0:27** | Wren alone in the middle of the field, lantern blazing, enemies dissolving around her into embers. | — | Music resolves, a breath |
| **0:27–0:30** | **End card:** logo over key art, the moon behind. Platforms row: Steam · Windows · macOS · Linux · Steam Deck. | **LAST LANTERN** · *"Wishlist now on Steam"* · *"Free demo: play in your browser"* | `stg_victory` final chord, lantern "whoomp" on the logo |

## Rules
- **Gameplay only, no pre-rendered cinematics.** Every shot is captured in the engine, and the store page says so.
- **No reviews, laurels or "Game of the Year" claims** until we actually have them.
- **Lead with the hook.** By 0:09 the viewer has to understand *light = health = radius*. If test viewers miss
  it, slow the shrink and add an arrow.
- Text cards: Lilita One, amber `#ffb13a` with a `#1a1040` outline, on screen ≥ 1.5 s, in the centre 80% safe area.
- Keep the HUD on in gameplay shots (light bar, timer). Steam players want to see the real game.
- First 3 seconds = the most striking frame of the trailer for the autoplay thumbnail. If the black opener tests
  badly, swap it for the 0:17 swarm shot.

## Capture list (by priority)
1. The light shrinking/recovering pair (0:06–0:11). Set up with `node tools/package-screens.mjs --only 4` and then
   play by hand.
2. 300-enemy swarm with 4 weapons (shot #3 setup), top-down camera. Needs the camera-zoom debug key (backlog
   P2-7) or a bigger FOV.
3. Evolution reveal: Ember Bolt Lv 8 + Flint, open a reliquary.
4. Boss arrival at a real 15:00 (play a seeded run, or set `run.elapsed = 895`).
5. Marsh + Ruins boss cameos.
6. Clean title plate with `--clean`.

## Launch trailer (60–75 s) delta
Add a bearer-select beat (6 bearers, 2 s), the Hearth (2 s), the endless night "after the boss" tease, and
"Out now, 20% off in launch week" in place of "Wishlist".
