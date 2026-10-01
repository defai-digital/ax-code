# TUI opening and ending animations

Status: Current
Scope: TUI opening and ending animations and rendering fallbacks
Last reviewed: 2026-09-30
Owner: AX Code TUI maintainers

See [Terminal rendering](terminal-rendering.md) for automatic terminal profiles,
manual overrides, and the difference between pixel graphics and text rendering.

Each TUI launch randomly selects one of thirty-five animation pairs with equal probability (1/35 each):

- Digital Code: purple/blue falling code for the opening, reverse code for the ending.
- Foliage: classic autumn leaves for the opening, golden leaves for the ending.
- Bench: Midnight Dream for the opening, Sunset Serenade for the ending.
- Fuji Mountain: daytime for the opening, night for the ending.
- Mahjong: four-seat match for the opening, final point ledger for the ending.
- City: neon night skyline for the opening, dawn skyline for the ending.
- Festival: fireworks for the opening, rising lanterns for the ending.
- Snow: pine snowfall for the opening, winter night for the ending.
- Volcano: eruption for the opening, calm crater for the ending.
- Big Ben: daytime for the opening, night for the ending.
- Taipei 101: daytime for the opening, neon night for the ending.
- Great Wall: dawn for the opening, dusk for the ending.
- Torii Gate: daytime for the opening, night for the ending.
- Taegeuk: spin for the opening, reverse spin for the ending.
- Sagrada Familia: daytime for the opening, night for the ending.
- Corcovado: daytime for the opening, golden hour for the ending.
- Eiffel Tower: daytime for the opening, night for the ending.
- Brandenburg Gate: night for the opening, dawn for the ending.
- Onion Domes: snowfall for the opening, clear sky for the ending.
- Borobudur: mist for the opening, noon for the ending.
- Balloons: night for the opening, dawn for the ending.
- Mekong: dawn for the opening, dusk for the ending.
- Colosseum: daytime for the opening, night for the ending.
- Space: rocket launch for the opening, starfield drift for the ending.
- Dungeon: torch-lit descent for the opening, treasure chamber for the ending.
- Castle: daytime for the opening, night for the ending.
- Floating Islands: daytime for the opening, dusk for the ending.
- Jungle: daytime for the opening, night for the ending.
- Coral Reef: daytime for the opening, night for the ending.
- Pyramids: daytime for the opening, night for the ending.
- Aurora: night for the opening, dawn for the ending.
- Lighthouse: daytime for the opening, night for the ending.
- Waterfall: daytime for the opening, moonlit night for the ending.
- Steppe: daytime for the opening, night for the ending.
- Canyon: daytime for the opening, night for the ending.

Fuji Mountain includes a snow-capped mountain, a reflective lake, cherry blossoms,
falling petals, and a Shinkansen travelling across the foreground. The 74-column,
20-row artwork is centered without changing its proportions; narrow terminals crop
the text fallback. Daytime uses a purple-to-amber sunset sky, a setting sun above
the summit with a horizon glow, warm snow, and sunset-pink blossoms; night uses a
dark sky, stars, and moon with moonlit water. Both platform rows above the train
are preserved. The train keeps its left-facing nose and travels nose-first from
right to left, repeating its journey with motion based on elapsed time and clipping
safely at the screen edges. Petal positions derive from elapsed time alone, so the
scene loops with the train cycle; petals stay below the static sun, star, and moon
rows. Local alternate-screen
terminals with confirmed Kitty graphics support and reported pixel dimensions
use freeform HD painting (gradient sky, shaded slopes, shimmering lake, shinkansen
livery) driven by the same scene model — palette, train phase, and petal paths —
as the text fallback, so both show the same scene for the same millisecond.
Fuji pixel frames are bounded to 1920x1080.
Unsupported terminals, remote sessions, multiplexers, and graphics failures use
the native ASCII fallback. Ghostty uses the same capability checks; its name
alone does not enable graphics.

Bench uses a tropical shoreline with swaying palm fronds and rolling waves.
Midnight Dream has a moonlit navy sky, twinkling stars plus a faint offset
star layer, and a fixed haloed moon; Sunset Serenade has warm colors,
drifting clouds, and a haloed sun that descends toward the horizon and
settles while the surf keeps moving. The sun and moon cast a shimmering
reflection on the surf, the palm carries coconuts, and the sand holds shells
above a darker wet band. Both use freeform HD painting
(gradient sky, stars, sun/moon disk, palm, surf, sand, title) driven by the
same scene model — palette, layout anchors, and elapsed-time phases — as the
text fallback, so both show the same scene for the same millisecond, bounded
to 1920x1080. The text fallback adapts the 70x23 composition to narrow
screens. Native text remains the fallback when graphics are unavailable; no
graphics protocol is required.

The selected pair stays fixed for the lifetime of the TUI. Ending playback never
makes a separate random choice. Replaying previews or completing tasks does not
change the selected pair. Animation opt-outs do not trigger another selection.

Foliage leaves fall downward with different speeds, sizes, and gentle sideways
sway. Leaf parameters derive from a fixed per-variant seed and positions from
elapsed time alone, so the text outlines and the HD silhouettes show the same
leaves for the same millisecond and the full scene loops with its cycle. Each
frame is cleared so leaves leave no trails.

| Command                | Preview                                        |
| ---------------------- | ---------------------------------------------- |
| `/ov`                  | This launch's selected opening                 |
| `/ev`                  | The corresponding ending                       |
| `/digital-code`        | Explicit original Digital Code opening preview |
| `/digital-code-ending` | Explicit original Digital Code ending preview  |

Explicit theme previews do not change this launch's selected pair.

Press `Ctrl+P` (the default command-palette key) and search `Digital Code`,
`Foliage`, `Bench`, `Fuji Mountain`, `Mahjong`, and more. All seventy opening/ending previews are
available independently of the launch selection. Family names remain searchable
in all fourteen interface languages.

These previews are also available in the command palette. Opening playback lasts
2.5 seconds; ending playback lasts 3 seconds. Existing animation preferences and
startup opt-out remain effective. Task-completion playback remains opt-in.

Local alternate-screen terminals with confirmed Kitty graphics support display
colored leaf silhouettes. Other terminals use colored ASCII leaf outlines. Emoji
fonts are not required. The animation resizes with the terminal. Escape or a mouse
click dismisses playback; ending playback captures input until it finishes so
keystrokes and pasted text cannot start new work during shutdown.

Mahjong uses a dark green table with an inner border, concealed opponent hands,
suit-colored visible tiles, rotating discards with a latest-discard marker, a
wall progress bar, and a spotlight pill on the turn seat. This is a decorative
match animation, not an interactive game. Its ending shows a fixed ranked medal
ledger between decorative rules and never starts another round during exit.
Preview with `/mahjong` or `/mahjong-ending` (also searchable as `Mahjong` in
Ctrl+P).

On confirmed local graphics terminals, Mahjong uses freeform HD painting
(felt gradient, table frame, labels, tile faces with pips, bars, and honor
plates) driven by the same scene model — palette, layout anchors, match phase,
and blink phase — as the text fallback, so both show the same scene for the
same millisecond, bounded to 1920x1080. Terminal emoji fonts and ambiguous
glyph widths do not affect it. Text fallback uses ASCII suit codes (`1C`, `2B`,
`RD`, `GD`, `WD`) and `##` for concealed tiles. Narrow text screens crop the
centered scene. Resize, missing graphics capability, and image cleanup follow
the same lifecycle as Fuji and Bench.

City uses a night skyline with a moon, twinkling stars, and twinkling
windows for the opening, and a dawn skyline with a low sun for the ending.
Rooftop beacons blink on the tallest towers while two cars cross the street
in opposite directions. Both share one scene model — palette, tower layout,
window phases, beacons, cars, and street lamps — so the text fallback and the
freeform HD painting show the same scene for the same millisecond, bounded to
1920x1080. Preview with `/city` or `/city-ending`.

Festival opens with three staggered fireworks bursts looping on a shared
cycle, each heralded by an ascending rocket and an ignition flash, and ends
with flickering capped lanterns rising past the moon. Burst positions,
particle stages, rocket paths, lantern paths, and town lights come from one
scene model shared by the text fallback and the freeform HD painting, bounded
to 1920x1080. Preview with `/festival` or `/festival-ending`.

Snow opens with pine snowfall under a pale haloed sun and ends on a starry
winter night over the same forest. Three snow-capped ridge peaks stand behind
the pines while near and far flakes fall with gusting sway and twinkle below
the static celestial rows; pine tiers alternate snow and pine edges over deep
interiors, shadows pool beneath the trunks, and the ground sparks glint. The
full sky loops with the flake cycle. Text fallback and freeform HD painting
share the scene model, bounded to 1920x1080. Preview with `/snow` or
`/snow-ending`.

Volcano opens on an eruption — breathing heat halo, pulsing crater with lit
rim lips, surging lava flow, drifting smoke, shimmering lava pool, and rising
embers — and ends on a calm crater under twinkling stars and a fixed moon.
Cone shape, crater glow, lava channel, and particle paths come from one scene
model shared by the text fallback and the freeform HD painting, bounded to
1920x1080. Preview with `/volcano` or `/volcano-ending`.
