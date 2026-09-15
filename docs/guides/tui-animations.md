# TUI opening and ending animations

Status: Current
Scope: TUI opening and ending animations and rendering fallbacks
Last reviewed: 2026-09-15
Owner: AX Code TUI maintainers

Each TUI launch randomly selects one of five animation pairs with equal probability (20% each):

- Digital Code: purple/blue falling code for the opening, reverse code for the ending.
- Foliage: classic autumn leaves for the opening, golden leaves for the ending.
- Bench: Midnight Dream for the opening, Sunset Serenade for the ending.
- Fuji Mountain: daytime for the opening, night for the ending.
- Mahjong: four-seat match for the opening, final point ledger for the ending.

Fuji Mountain includes a snow-capped mountain, cherry blossoms, and a Shinkansen
travelling across the foreground. The original 74-column, 20-row artwork is centered without changing its
proportions; narrow terminals crop the text fallback. Daytime uses the supplied pale
blue sky, static clouds, golden sun behind the summit, and pale pink blossoms;
night uses a dark sky, stars, and moon. The original train artwork and both
platform rows above it are preserved. The train keeps its left-facing nose and
travels nose-first from right to left, repeating its journey with motion based on
elapsed time and clipping safely at the screen edges. Local alternate-screen
terminals with confirmed Kitty graphics support and reported pixel dimensions
use antialiased stroke glyphs with fixed proportions, fitting the complete scene
independently of the terminal font. Fuji pixel frames are bounded to 1920x1080.
Unsupported terminals, remote sessions, multiplexers, and graphics failures use
the native ASCII fallback. Ghostty uses the same capability checks; its name
alone does not enable graphics.

Bench uses an ASCII tropical shoreline with swaying palm fronds and rolling
waves. Midnight Dream has a moonlit navy sky and twinkling stars; Sunset Serenade
has warm colors and a sun descending toward the horizon. Like Fuji, it uses antialiased pixel rendering (up to 1920x1080) when local
Kitty graphics support and pixel dimensions are confirmed. The complete 70x23
scene fits independently of terminal font and line spacing. Native text remains
the fallback when graphics are unavailable; no graphics protocol is required.

The selected pair stays fixed for the lifetime of the TUI. Ending playback never
makes a separate random choice. Replaying previews or completing tasks does not
change the selected pair. Animation opt-outs do not trigger another selection.

Foliage leaves fall downward with different speeds, sizes, and gentle sideways
sway. Each frame is cleared so leaves leave no trails.

| Command                | Preview                                        |
| ---------------------- | ---------------------------------------------- |
| `/ov`                  | This launch's selected opening                 |
| `/ev`                  | The corresponding ending                       |
| `/digital-code`        | Explicit original Digital Code opening preview |
| `/digital-code-ending` | Explicit original Digital Code ending preview  |

Explicit theme previews do not change this launch's selected pair.

Press `Ctrl+P` (the default command-palette key) and search `Digital Code`,
`Foliage`, `Bench`, `Fuji Mountain`, or `Mahjong`. All ten opening/ending previews are
available independently of the launch selection. Family names remain searchable
in all thirteen interface languages.

These previews are also available in the command palette. Opening playback lasts
2.5 seconds; ending playback lasts 3 seconds. Existing animation preferences and
startup opt-out remain effective. Task-completion playback remains opt-in.

Local alternate-screen terminals with confirmed Kitty graphics support display
colored leaf silhouettes. Other terminals use colored ASCII leaf outlines. Emoji
fonts are not required. The animation resizes with the terminal. Escape or a mouse
click dismisses playback; ending playback captures input until it finishes so
keystrokes and pasted text cannot start new work during shutdown.

Mahjong uses a dark green table, concealed opponent hands, visible player tiles,
rotating discards, wall count, and turn indicator. This is a decorative match
animation, not an interactive game. Its ending shows a fixed illustrative score
ledger and never starts another round during exit. Preview with `/mahjong` or
`/mahjong-ending` (also searchable as `Mahjong` in Ctrl+P).

On confirmed local graphics terminals, Mahjong fits the complete 76x25 scene
using the reported pixel dimensions, bounded to 1920x1080. Tile faces are drawn
directly from original vector strokes; terminal emoji fonts and ambiguous glyph
widths do not affect them. Text fallback uses ASCII suit codes (`1C`, `2B`,
`RD`, `GD`, `WD`) and `##` for concealed tiles. Narrow text screens crop the
centered scene. Resize, missing graphics capability, and image cleanup follow
the same lifecycle as Fuji and Bench.
