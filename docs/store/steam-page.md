# Steam store page: Last Lantern

> Status: **draft v1** for the Coming Soon page. Owner: release-manager + community-manager.
> The name **"Last Lantern" is a working title** until the trademark and store-name check in
> `production/release/launch-checklist.md` §0 is done. Every content number below was counted from `src/data/*` on
> 2026-11-04. Re-count before you submit (see "Fact check" at the bottom).

---

## Short description (shown under the capsule, max 300 characters)

> Carry the last lantern through a moonlit night that wants it out. Every hit dims your light and lets the Gloom creep
> closer. Auto-firing weapons, builds that break the game, hundreds of shadows at once, and a boss waiting at 15:00.

*(231 characters including spaces; the limit is 300. Checked with `node -e "console.log(process.argv[1].length)" "<text>"`.)*

**Alternate (A/B for the itch page / social bio):**
> A cozy-looking, hard-hitting 3D survivors-like where your light is your life. Take a hit and the world gets
> smaller. Heal and you push the dark back. Fifteen minutes, one lantern, a few hundred shadows.

---

## About This Game (long description)

Steam's long description takes BBCode-lite (`[h2]`, `[list]`, `[b]`, `[img]`). It is written here as Markdown and
converted on upload. The `[img]` slots are GIFs from the capture plan in `press-kit.md` §6.

### Your light is your life.

The sun has not risen in a hundred years. One lantern still burns, and you carry it.

**Last Lantern** is a 3D action roguelite in the "survivors" style. You move and your weapons fire on their own.
You collect embers, level up, and build something absurd before the night builds something worse. Your health *is*
your light. Each hit dims the lantern, so the warm pool around you shrinks and the violet Gloom closes in. Lamp oil
pushes the darkness back. You feel every hit as a number and also as a world that gets smaller.

`[GIF 1: light pool shrinking as the bearer takes hits, then flaring back on a lamp-oil pickup]`

### Build a lantern that breaks the night
- **11 weapons, each with its own evolution.** Ember Bolts, a Cinder Halo, Spark Chains, a Vesper Bell that tolls
  on the thickest pack, a Lighthouse Beam that sweeps the field… Pair one with the right relic and open a
  reliquary to evolve it into something like the Solar Crown or the Cathedral Toll.
- **14 relics** that bend every weapon you carry: Twin Flame, Moon Mirror, Dusk Hourglass, Lodestone and more.
- **Reroll, skip and banish** to steer your build. By minute 12, a good build should feel unfair (to the shadows).

`[GIF 2: an evolution reveal in a reliquary, then the evolved weapon clearing a 300-enemy swarm]`

### Hundreds of shadows, never a muddy screen
- 300+ enemies on screen at once, and every hit gets a flash, a sound and a burst of light.
- **12 enemy types** with distinct silhouettes and behaviours: splitting Gloam Jellies, exploding Cinder Ticks,
  shield-bearing Hollow Wardens, armoured Ashen Knights. Elites and swarm events arrive on a director's schedule.
- A boss for every night: **the Hollow Stag**, **the Mire Mother** and **the Ashen King**. Beat one, then greet the
  dawn or stay for the **endless night**.

`[GIF 3: boss arrival at 15:00, with the camera pulling back and the boss roar]`

### Three nights, one storybook world
- **Whispering Pines**, **Sunken Marsh** and **Ashen Ruins**: three moonlit biomes, each tougher than the last.
- A hand-crafted "moonlit storybook" look: chunky, rounded shapes, saturated blue-violet nights, a warm amber
  lantern, real-time soft shadows, ambient occlusion, wind-blown grass, fireflies and bloom.
- An original synthesised score and soundscape that swells as the night escalates.

### One more run
- **6 bearers** to unlock, each with a starting weapon and a twist: Wren the Lamplighter, Osric the Warden,
  Isolde the Storm Seer, Brannoc the Pyre Monk, Maelis the Rime Pilgrim and Pell the Bellwright.
- Spend **Ash** at **the Hearth** on **13 permanent upgrades**, including extra rerolls, banishes, a fourth
  level-up choice and a second spark on death.
- **24 achievements** that unlock new weapons, relics and bearers as you play.

### Play it your way
- 15-minute runs, pause any time.
- Full keyboard, mouse and **gamepad** support with on-screen button prompts.
- Graphics presets from Low to High, with automatic resolution scaling to hold 60 fps on modest laptops.
- Accessibility: UI scale, reduce flashing, reduce motion, screen-shake and damage-number toggles.

---

## Tags (Steam allows up to 20; order = weight)

1. Action Roguelike
2. Bullet Heaven
3. Roguelite
4. Survival
5. 3D
6. Stylized
7. Cute
8. Fantasy
9. Dark Fantasy
10. Atmospheric
11. Replay Value
12. Singleplayer
13. Casual
14. Arcade
15. Top-Down
16. Character Customization *(bearers + Hearth)*
17. Controller
18. Colorful
19. Indie
20. Great Soundtrack *(use only after reviews agree; until then, use "Procedural Generation")*

**Genre:** Action, Indie, Casual. **Categories:** Single-player, Steam Achievements, Full controller support,
Steam Cloud *(only after the cloud-save item in the v1.0 milestone ships)*, Family Sharing.

---

## System requirements

> Targets come from the renderer quality tiers (`src/render/Renderer.ts`). They must be confirmed on the
> real-hardware perf pass (milestone v1.0, item P0-7) before the page goes live. The installed size is measured
> from the Linux unpacked build (~305 MB: Electron runtime ~295 MB + game ~7 MB).

| | Minimum (Low preset, 1080p, 60 fps) | Recommended (High preset, 1080p, 60 fps) |
|---|---|---|
| **OS** | Windows 10 64-bit · macOS 12 Monterey · Ubuntu 22.04 / SteamOS 3 | Windows 11 64-bit · macOS 13+ · Ubuntu 24.04 |
| **Processor** | Dual-core 2.0 GHz (Intel Core i3 8th gen / AMD Ryzen 3 2200U) | Quad-core 2.8 GHz (Intel Core i5 9th gen / AMD Ryzen 5 3600) |
| **Memory** | 4 GB RAM | 8 GB RAM |
| **Graphics** | WebGL 2 / OpenGL 4.1 class iGPU: Intel UHD 620, AMD Vega 8, Apple M1 | NVIDIA GTX 1050 Ti / AMD RX 570 / Apple M1 Pro, 2 GB VRAM |
| **Storage** | 500 MB available space | 500 MB available space |
| **Additional** | Keyboard or gamepad. No internet connection required. | Gamepad recommended |

**Steam Deck:** target **Verified**. The game starts fullscreen at native 1280×800, has full gamepad support with
pad glyphs, the UI Scale setting, and no launcher. To check: the default text size at 800p and the "Medium" preset
holding 60 fps on the Deck.

---

## Store assets checklist (Steamworks → Store Page → Graphical Assets)

| Asset | Size (px) | Content | Source |
|---|---|---|---|
| Header capsule | 920×430 | Logo + bearer with lantern + swarm silhouette | key art, `press-kit.md` §5 |
| Small capsule | 462×174 | Logo only, high contrast (must read at 120 px wide) | key art crop |
| Main capsule | 1232×706 | Full key art + logo | key art |
| Vertical capsule | 748×896 | Bearer + lantern pool, logo top | key art |
| Page background | 1438×810 | Soft moonlit field, low contrast, no text | gameplay capture, blurred |
| Library capsule | 600×900 | Vertical key art + logo | key art |
| Library hero | 3840×1240 | Wide key art, **no logo** | key art |
| Library logo | 1280×720 (transparent PNG) | "Last Lantern" wordmark | logo file |
| Event cover / header | 800×450 / 1920×622 | Per announcement | — |
| Screenshots | ≥ 1920×1080, 5 minimum (aim for 10) | `press-kit.md` §6 capture plan | in-game capture |
| Trailer | 1080p60 MP4, ≤ 2 min | `trailer-script.md` | capture + edit |

Capsule rules (Valve, 2026): capsules show only the game's name and artwork. No review quotes, award laurels, "sale"
or "new" text, and no discount badges.

---

## Content disclosures (mandatory)

- **AI-generated content (Content Survey → "AI Generated Content")**: this game's code, 3D models, textures, VFX,
  music and sound were generated with AI tools (Claude Code) under human direction. Nothing is generated live at
  runtime. Suggested public disclosure text:
  > *"Last Lantern was built with the help of AI tools. Its code, 3D models, music and sound effects were generated
  > with Claude Code under human direction and curation, then reviewed and tuned by hand. No AI generation happens
  > while you play."*
- **Mature content:** none. Fantasy violence against shadow creatures, no blood, no gore. Expected ratings:
  PEGI 7 / ESRB E10+ (IARC questionnaire in Steamworks).
- **Photosensitivity:** the game has flashing lights. Mention the "Reduce Flashing" option in the description. A
  first-boot photosensitivity notice is backlog item P1-6 in `production/milestones/v1.0.md`.

---

## Fact check before submitting (numbers drift as content lands)

```bash
grep -c "evolvesInto" src/data/weapons.ts src/data/weaponsNew.ts     # weapons with an evolution (11)
grep -cE "^\s+\{ id: '" src/data/passives.ts                         # relics (14)
grep -cE "id: 'char_" src/data/meta.ts                               # bearers (6)
grep -cE "id: 'm_" src/data/meta.ts                                  # Hearth upgrades (13)
grep -cE "id: 'ach_" src/data/achievements.ts                        # achievements (24)
grep -cE "id: '[a-z_]+', name:" src/data/enemies.ts                  # enemies incl. 3 bosses (15)
```
