# Settlers of Catan ⬢

A board generator, opening-placement helper, dice roller, house-rules
reference — and a full online game — for Settlers of Catan.

This is a rebuild of the Catan section of [martin-he543/archived-site][archive]
(`_pages/catan.html`, `_pages/catan.md` and `assets/settlers`) on React 19,
TypeScript and Vite, deployable to GitHub Pages.

[archive]: https://github.com/martin-he543/archived-site

## What it does

- **Three generators.** *Spiral* shuffles the tiles and deals the numbers in the
  classic counter-clockwise A–R order; *Balanced* randomises the numbers but
  never lets two red tiles (6 or 8) touch; *Chaos* shuffles everything.
- **Opening placement.** Click the eight settlements in snake-draft order. The
  distance rule is enforced — corners within one edge of a settlement are shown
  greyed out and cannot be taken.
- **Corner analysis.** Every corner is shaded by its pip value, and hovering one
  spotlights the tiles and port it draws from and breaks down its production by
  resource. A running pip total per player sits in the sidebar.
- **Share links.** The board and the placements are encoded into the URL.
- **Dice roller**, with the original roll sound and a short roll history.
- **House variants and the leaderboard**, carried over from the old site.
- **Play online.** Full games with friends or bots, in the spirit of
  [TwoSheep](https://twosheep.io): see below.

## Playing online

The **Play online** tab runs complete games — rolling, trading, building,
development cards, the robber, longest road and largest army — for:

| Mode | Details |
| --- | --- |
| Classic | 2–4 players on the standard island |
| 1v1 Duel | TwoSheep's duel rules: 15 points, discard at 9, friendly robber, balanced dice and balanced 7s |
| 5–6 and 7–8 players | 30- and 37-hex boards, with TwoSheep's *second settler* turn or the official special build phase |
| Seafarers | Heading for New Shores, The Four Islands, Through the Desert, Fog Island and The New World: ships, the pirate, gold fields, fog and island bonuses |
| Cities & Knights | Commodities, city improvements and metropolises, knights, the barbarian fleet and all 54 progress cards — also on a Seafarers archipelago |
| Fishermen | The lake, fishing grounds, fish tokens and the old boot |
| Custom modes | Dust Bowl, blind placement, numbers only; plus house rules for points, the discard limit, timers and more |

A game can start from a random board, or from the board on the **board
generator** (opening settlements included), **Import Catan**, or **Position**
(mid-game, with everyone's pieces, knights and victory cards). Each of those
pages has a button that carries its board straight to a new table. Games can
be played online, or on one device against bots or pass-and-play, and every
game can be replayed move by move.

Online play uses a Firebase project of your own (free on the Spark plan).
[**FIREBASE_SETUP.md**](FIREBASE_SETUP.md) walks through it step by step, and
also covers the optional Cloud Functions referee that keeps every hand secret.

The rules engine is plain TypeScript in [`src/game/engine/`](src/game/engine/),
shared by the browser, the Cloud Functions and the tests. The tests include
bots playing every mode to a finish, and `npm run test:emulators` plays real
online games through the Firebase emulators.

## Share-link compatibility

The URL encoding is bit-for-bit identical to the original site's, so old
`?game=`/`?moves=` links still open the same board:

| Part | Encoding |
| --- | --- |
| `game` | 19 tiles × 7 bits (3 type + 4 number), then 9 ports × 3 bits, base64 |
| `moves` | 8 slots × 6 bits of corner index, `63` meaning unplaced, base64 |

Corner indices `0–53` must therefore match the original numbering. They do,
because the geometry is derived rather than transcribed — see below.

## How the board is built

The original positioned every hex, port and corner with hand-tuned pixel
offsets in `catan.css`. Those are gone. [`src/lib/geometry.ts`](src/lib/geometry.ts)
derives the whole layout from one constant — a pointy-top hexagon of width 1 —
and everything scales from there, so the board is responsive at any size.

Corner indices fall out of sorting the deduplicated hex vertices by `(y, x)`,
which reproduces the original left-to-right, top-to-bottom numbering. The tile
adjacency map the original hard-coded is likewise derived, and the test suite
asserts the derived version matches it exactly.

The nine port positions were recovered from the original stylesheet's absolute
offsets and re-expressed as `(tile, edge)` pairs.

## Running it

```bash
npm install
npm run dev              # dev server
npm test                 # unit tests, including whole bot games in every mode
npm run lint
npm run build            # production build into dist/
npm run emulators        # Firebase emulators for online play (see FIREBASE_SETUP.md)
npm run test:emulators   # online play end to end, against the emulators
```

## Deploying to GitHub Pages

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds and
publishes on every push to `main`. Enable it once, under
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

The workflow sets the Vite base path from the repository name, so it works both
for a project site (`user.github.io/repo/`) and a user site
(`user.github.io`) with no edit.

Because GitHub Pages has no SPA rewrite rule, the build also emits a `404.html`
that bounces deep links back through the app root — see
[`github-pages-assets.ts`](github-pages-assets.ts).

## Assets

Tile, port, dice and favicon art comes from the original repository. The tile
and port images were resized and converted to WebP (6.2 MB → 150 KB).

The expansion tiles — gold, fog and the lake — are made from those tiles by
[`scripts/make-tiles.sh`](scripts/make-tiles.sh), and the player pieces in all
eight colours by [`scripts/make-pieces.sh`](scripts/make-pieces.sh), so they
match the base art. Ships, knights, walls and the pirate are drawn in SVG.

## Credits

The board generator was originally forked from [Alex Beals][alex]. Catan is a
trademark of its respective owners; this is a fan-made helper.

[alex]: https://github.com/dado3212
