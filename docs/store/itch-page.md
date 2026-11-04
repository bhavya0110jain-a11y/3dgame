# itch.io page: Last Lantern (free web demo + paid desktop)

> Status: **draft v1**. Upload with `npm run package:web` → `release/last-lantern-web.zip`. The script checks
> sub-folder hosting the way itch.io serves it: `html-classic.itch.zone/html/<id>/index.html`.

## Project settings
| Field | Value |
|---|---|
| Title | Last Lantern *(working title, see the trademark check)* |
| Project URL | `<studio>.itch.io/last-lantern` |
| Short description / tagline | **Your light is your life.** A 3D survivors-like in a moonlit storybook night. |
| Classification | Games |
| Kind of project | HTML (web demo upload) **plus** downloadable files (desktop builds, paid) |
| Release status | In development (until 1.0), then Released |
| Pricing | **Free web demo** (Whispering Pines, full 15-minute run + boss). Desktop: **$4.99** minimum, "pay what you want above". |
| Viewport | **1280×720**, ✅ "Mobile friendly" (touch controls, portrait aware), ✅ "Automatically start on page load" OFF (click to launch, so audio can start), ✅ Fullscreen button, ❌ Scrollbars |
| Frame options | ✅ "SharedArrayBuffer support" **off** (not needed). Orientation: Landscape preferred |
| Genre | Action |
| Tags (max 10) | `roguelite`, `bullet-hell`, `survivors-like`, `3d`, `cute`, `fantasy`, `atmospheric`, `singleplayer`, `controller`, `stylized` |
| AI generation disclosure | **"This project contains AI-generated content"**, ticked for Graphics, Sound and Code. Use the same text as on Steam (`steam-page.md`, Content disclosures). |
| Input | Keyboard, Mouse, Xbox controller, Playstation controller, Touchscreen |
| Accessibility | Configurable UI scale, Reduce flashing, Reduce motion, Toggleable screen shake |
| Average session | About half an hour |
| Languages | English |
| Community | Comments ON; devlog ON |
| Custom noun | "vigil" (download button reads "Begin the vigil") |

## Page theme
- Background `#120b2e` (night violet) with the page-background image from the press kit, 30% opacity.
- Link / button colour `#ffb13a` (lantern amber). Text `#e9ecff`. Header: library hero art, cropped to 960×300.
- Embed the trailer (YouTube) under the game frame, then 5 screenshots.

## Page body

> ### Your light is your life.
> The sun has not risen in a hundred years. One lantern still burns, and you carry it.
>
> **Last Lantern** is a 3D action roguelite. Move, and your weapons fire on their own. Collect embers, level up and
> build something absurd before the night builds something worse.
>
> **Every hit dims your lantern.** Your pool of light shrinks and the Gloom closes in. Lamp oil pushes the dark
> back.
>
> **In this free demo:**
> - Whispering Pines: a full 15-minute night and its boss, the Hollow Stag
> - 11 weapons with evolutions, 14 relics, a level-up choice every few seconds
> - The Hearth: spend Ash on permanent upgrades (progress saves in your browser)
>
> **In the full game (Steam / desktop):**
> - 3 nights and 3 bosses, endless mode, 6 bearers, 24 achievements
> - Windows, macOS and Linux / Steam Deck. Runs offline.
>
> **Controls:** WASD / arrows / left stick / touch-drag to move. Weapons fire automatically.
> 1–4 or click to choose upgrades. Esc / Start to pause.
>
> *Best in Chrome, Edge or Firefox with hardware acceleration on. If it stutters, set Settings → Video → Graphics
> Quality to **Low**.*
>
> ⭐ **Wishlist on Steam:** `<steam store link>`. It's the single most helpful thing you can do for a small game.

## Demo build switch
The web demo has to lock nights 2–3 and show a "Get the full game" panel. That is backlog item P1-2
(`DEMO` build flag). Until it lands, the web zip is the full game. Do not publish it as a "demo" before then.

## Upload with butler (CI or local)
```bash
butler push release/last-lantern-web.zip  <studio>/last-lantern:html5        --userversion "$(node -p "require('./package.json').version")"
butler push release/desktop/win-unpacked  <studio>/last-lantern:windows      --userversion ...
butler push release/desktop/mac           <studio>/last-lantern:mac          --userversion ...
butler push release/desktop/linux-unpacked <studio>/last-lantern:linux       --userversion ...
```
butler sends only the changed blocks, and the itch app gets auto-updates. Channel names containing
`windows`/`mac`/`linux` set the platform tags automatically.

## Web portals (Poki / CrazyGames / GameDistribution)
The same zip works. Portal SDKs (ads, "gameplayStart/Stop") need a wrapper module. That is backlog item P2-4.
CrazyGames wants an initial download under 50 MB (we are ~6 MB) and no external links.
