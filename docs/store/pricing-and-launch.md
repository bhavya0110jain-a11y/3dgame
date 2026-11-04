# Last Lantern: pricing & launch strategy

> Status: **decided (autonomous mode) v1**, owner: producer + release-manager. Re-check the dates against the
> Steamworks calendar (Next Fest and seasonal sales move every year) and against the v1.0 milestone burn-down.

## 1. Price

| Store | Price | Notes |
|---|---|---|
| Steam (USD) | **$4.99** | Use Valve's suggested regional pricing matrix as-is (≈ €4.99, £4.29, R$ 19.99, ¥ 600 JPY). |
| itch.io desktop | **$4.99 minimum**, pay-what-you-want above | Same build. itch's revenue share is set to 10%. |
| Web demo (itch.io, CrazyGames / Poki) | **Free** | First night only (Whispering Pines), see §3. Portals pay via ad revenue share. |
| Soundtrack DLC | $1.99 (post-launch, optional) | The OST is original and synthesised by us. Low effort, small add-on revenue. |

**Why $4.99:** the survivors-like price anchor is $2.99–$6.99, and the best-known entries sit at $4.99. At that
price players impulse-buy, it gets recommended in "under $5" lists, and the 20% launch discount lands at $3.99.
Our content (3 nights, 11 weapons + evolutions, 6 bearers, ~10–20 hours to finish the Hearth) is comparable to
genre peers at launch. We go to **$5.99** only if 1.0 ships with a 4th night or a second mode. Never price-raise
after launch; add value through free updates instead.

## 2. Timeline (target)

| When | Milestone | Key actions |
|---|---|---|
| **Nov 2026** | Store groundwork | Pay the Steam Direct fee ($100, which starts Valve's 30-day new-app waiting period). Trademark/name check. Capsule art + 5 screenshots. |
| **Dec 2026** | **Coming Soon page live** | Steam page + itch.io page + press kit. Announcement trailer (30 s). Post on r/roguelites, r/IndieGaming, r/WebGames (for the web demo), Bluesky/X, TikTok vertical cut. Discord opens. |
| **Jan 2027** | **Free web demo public** | itch.io + CrazyGames/Poki (biome 1). Every end-of-run screen in the demo links to the Steam wishlist. Devlog #1 ("an AI studio built this"). |
| **Feb 2027** | **Steam Next Fest (February edition)** | Steam demo (same content as the web demo) uploaded and reviewed ≥ 2 weeks before. Livestream on the fest page daily. Email 50–100 survivors-like streamers/YouTubers with demo keys. |
| **Mar 2027** | Polish from demo feedback | Fix the top 10 demo issues. Balance pass. Achievements on Steam. Steam Deck verification request. |
| **Apr 2027** | **1.0 launch** (target: a Tuesday or Thursday, 10:00 PT, outside the seasonal sales and big AAA launches) | Launch discount 20% for 7 days. Launch trailer. Press embargo lifts at launch. itch.io + Steam the same day. |
| **May–Jun 2027** | Post-launch | Patch 1.0.x within 72 h if needed. Content update #1 ("4th night") roadmap. Join Steam Summer Sale (≥ 30 days after the launch discount ends, per Valve's discount cooldown). |

**The launch date is gated by the wishlist goal, not the calendar.** If the page has fewer than **7,000 wishlists**
one week before launch, slip by 4–6 weeks and run another outreach push. Being on Steam's "Popular Upcoming" list
roughly needs that number, and launching below it wastes the one-time visibility boost.

## 3. Demo strategy: free web version of biome 1
- **Content:** Whispering Pines only, the full 15-minute run, the Hollow Stag, the first 6 achievements' worth of
  unlocks, and Hearth ranks 1–2 only. Nights 2–3, the other bearers and endless mode show as **locked teasers**
  ("Full game"), so players see what they'd be buying.
- **Same build, flag-gated:** `VITE_DEMO=1` (backlog P1-2) strips nothing at build time. It just locks content and
  adds the wishlist panel. One codebase, no fork.
- **Progress carries over:** the web demo saves in localStorage. The desktop build offers "Import demo save"
  (paste a code, backlog P2-3), so demo players don't lose their Hearth.
- **Funnel on every surface:** title screen button "Wishlist on Steam", game-over screen panel after the 2nd
  run, and the boss-defeat screen "The night isn't over. 2 more nights in the full game". On Electron, the link opens
  via `lanternDesktop.openExternal()`. On the web it's a normal link with `target=_blank`.
- **Web portals** (CrazyGames, Poki, GameDistribution) are the top of the funnel: millions of browser players
  who would never browse Steam. Their SDKs (ads between runs, never mid-run) pay for marketing. Keep the "Wishlist"
  link wherever the portal allows external links. If it doesn't (CrazyGames), mention the game name on the
  end screen instead.

## 4. Wishlist funnel & targets

| Source | Tactic | Target wishlists by launch |
|---|---|---|
| Steam page organic | Strong capsule + first 4 screenshots + GIFs; tags tuned to "Action Roguelike / Bullet Heaven" | 1,500 |
| Next Fest Feb 2027 | Demo + daily streams + fest-specific trailer | 3,000 |
| Web demo (itch + portals) | End-screen funnel; aim for 200k plays × 1% conversion | 2,000 |
| Streamers / YouTube | Keys to 100 small-to-mid survivors-like creators (5k–200k subs). Personal emails, no mass mailers | 1,500 |
| Social (TikTok/Shorts/Bluesky/Reddit) | 3 clips/week: the swarm, the light-shrinks moment, evolution reveals | 1,000 |
| **Total** | | **≈ 9,000** (go/no-go floor 7,000) |

Track weekly in Steamworks → Wishlists. Report in `production/release/launch-checklist.md` §6.

## 5. Launch discount & sales calendar
- **Launch:** 20% off for 7 days ($3.99). Steam emails every wishlister when the game launches *and* when it's
  discounted, and the launch discount triggers both together. That is the single biggest sales spike we'll get.
- **Next discounts:** respect Valve's cooldown (~30 days between discounts on the same item). Summer Sale 2027 at
  25%, Autumn Sale at 30%, Winter Sale at 35%, never deeper than 50% in year 1.
- **Bundles:** after 6 months, a "Lantern + OST" bundle, and cross-bundles with other survivors-likes if their devs
  are open to it.

## 6. Festivals & events to apply to
- **Steam Next Fest** (February 2027 edition): the main demo moment. Sign up as soon as Steamworks opens
  registration.
- **Steam themed fests:** "Roguelike/Roguelite Fest" (with demo or at launch discount), "Cozy/Storybook" style
  fests if they run.
- **Day of the Devs / Wholesome Direct / Future of Play** submissions (low odds, free to apply).
- **itch.io:** a featured slot is more likely with a polished HTML5 demo. Apply via itch's "Request feature" once
  ratings exist.
- **CrazyGames / Poki:** apply for featuring with the web demo (they want ≥ 60 fps on mid devices and < 50 MB).

## 7. Risks
| Risk | Mitigation |
|---|---|
| Crowded genre ("yet another survivors-like") | Lead every asset with the unique hook: **light = health = vision radius**. Never show generic swarm footage without the shrinking pool. |
| AI-made backlash | Disclose up front on every store page and in devlogs. Show the human direction, curation and QA process, and make the craft visible. Never hide it. |
| Name conflict ("Last Lantern" or similar titles exist) | Trademark + Steam name search before the Coming Soon page (checklist §0). Fallback names below. |
| Electron size (~305 MB installed for a ~7 MB game) | Acceptable on Steam. Document it in requirements. Revisit Tauri/WebView only if players complain. |
| WebGL driver issues on old Windows iGPUs | Low preset + auto-downgrade exist. Add a `--use-angle=d3d11` / `gl` fallback launch option on Steam (backlog P1-9). |

## 8. Name: needs a trademark / store-name check before launch
"Last Lantern" is a generic, evocative phrase. Other games, books or apps with "Lantern" titles may already use
it. Before the Coming Soon page goes live: search USPTO TESS / EUIPO eSearch (class 9 and 41), Steam, itch.io,
the App Store and Google Play, and check that a .com/.game domain and social handles are free.

**Alternates, if it's taken:**
1. **Lanternfall**: keeps the brand and the hook, and it's easy to own as a single word.
2. **Keep the Light**: matches the in-game voice ("Thank you for keeping the light").
3. **Gloomward**: the enemy-side angle, distinctive and very searchable.
