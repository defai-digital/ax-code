# Changelog

All notable changes to ax-tui are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Breaking changes are called out explicitly when they occur.

## [Unreleased]

### Fixed

- Release removed children from a parent's pending layout set so hidden parents whose rows churn no longer retain every destroyed child.
- Free the Yoga node of an empty Solid slot placeholder when its host is destroyed recursively.

## [2.1.5] - 2026-10-20

### Fixed

- Allow typing and pasting to replace selected input text at the maximum length, counting the replaced text as available space.
- Leave input events and selected text untouched when truncation cannot fit a complete Unicode character.
- Preserve input change notifications across repeated focus calls and edits made by focus listeners.
- Report X10 button-held motion as a drag so basic-encoding terminals can extend text selections.
- Align cross-renderable selected text with the selection rectangle instead of each renderable's origin.
- Reveal equal-sized and taller partially visible children in `scrollChildIntoView()`.
- Keep scrollbars without a scrollable range from consuming paging and navigation keys.
- Detect cursor shape and color changes in the `cursorStyle` setter.
- Leave the selection index and events untouched when moving through an empty `Select`.
- Clear extmark undo snapshots when `setText`, `setTextOwned`, or `clearHistory` resets the text history.
- Normalize HSV hues outside `[0, 360)` instead of returning black for negative rotations.
- Apply an explicit palette timeout to the OSC support probe.
- Keep ASCII font letterspacing consistent for glyphs missing from the font.
- Locate single-character chunks in link detection so later links stay aligned.
- Keep auto-height text measured at its full line count and wrap sub-column widths at one column.
- Auto-select the musl native target on musl Linux hosts and report a missing bundled library clearly.

## [2.1.4] - 2026-10-20

### Changed

- Distribute `@defai-digital/ax-tui` through public GitHub Packages.
  Use scoped imports or an npm alias for existing consumers.
- Remove retired registry manifests, publishing tools, type annotations, and CI checks.
- Bundle every supported native library and license in the npm package for offline loading.
- Verify the npm payload, export targets, native hashes, and excluded development/private files before publication.

- Split-footer mode writes far less output: committing rows above the footer
  moves the footer with terminal line insertion instead of repainting it,
  redundant SGR resets are gone, and a burst of resizes applies once with
  pending rows held until the final geometry is known. A 200x60 footer with
  20 commits fell from about 58 KB to about 2.6 KB written.

## [2.1.3] - 2026-10-19

### Fixed

- Harden split-footer mode for inline transcripts: resize no longer scrubs
  transcript rows above the footer, failed surface paints cannot commit stale
  buffers, destroyed renderers cannot recapture stdout or leave settlement
  waits pending, and scrollback commits reject invalid columns while keeping
  CJK, grapheme, tab, and CRLF content intact.

### Tests

- Qualify split-footer and scrollback surfaces with tests adapted from
  upstream OpenTUI plus POSIX PTY regressions (1,000 appended rows, resize
  storms, teardown, SIGTERM); tmux variants run where tmux is installed.

## [2.1.2] - 2026-10-18

### Fixed

- Accept OSC 66 width and scaling support only from the corresponding pending
  probe, ignoring startup cursor positions and unrelated cursor reports.
- Select UTF-8 for native Windows console output and restore the original code
  page when the last stdout backend closes, preserving redirected output and
  subsequent external code-page changes.

- Preserve requests started by autocomplete abort callbacks, prevent superseded
  work from starting, and honor disposal during cancellation.
- Apply completion caret positions before input notifications, preserving newer
  edits and cursor movements performed by input callbacks.
- Bound select, tab-select, slider, and image options, and preserve constructor
  focusability and selection offsets when updating text.
- Clean up native event subscriptions and empty diff panes, and resolve Solid
  text anchors by identity when inserting children.

- Release editor-view storage when overlapping inputs and command palettes are
  destroyed out of creation order, instead of retaining it in the process arena.
- Decode Alt/Option-prefixed non-ASCII input as one key event instead of
  splitting the UTF-8 codepoint after its lead byte.
- Consume parameterized SS3 sequences such as Ctrl+Up through their final byte
  instead of emitting the prefix and modifier bytes as separate keys.
- Follow runtime Kitty keyboard enable/disable changes when decoding input.
- Preserve supplementary-plane characters in modifyOtherKeys sequences instead
  of truncating them to 16 bits.
- Reject a native span drain whose requested span count exceeds the output
  buffer capacity, preventing a native write past the supplied view.
- Keep Tab contained in an active modal focus scope even when it has no
  focusable candidates, isolate throwing `enabled` predicates, and select the
  innermost modal scope by tree depth rather than registration order.
- Require the PTY fixture to confirm clean shutdown over its control channel,
  so tmux's client exit status cannot hide a crashing application.
- Keep keymap dispatch alive when an `enabled` predicate throws, disabling only
  that layer instead of aborting all key routing, and ignore key release events.
- Decode Kitty F3 functional keys (`CSI 1;modifier:event R`).
- Restore extmark type and metadata indexes after undo, keep no-op edits from
  consuming a later text undo, follow native cursor deletion when a selection
  exists, and remove the content-change listener on destroy.
- Keep `stickyScroll` anchored without an explicit `stickyStart` when content
  grows.
- Rebuild custom `renderNode` blocks on forced Markdown refreshes, preserve link
  targets through nested inline styles, and apply table options to tables nested
  inside list items.
- Re-clamp text-buffer scroll offsets after resize and wrap-mode changes.
- Give table columns a grapheme-aware minimum width so a wide character cannot
  overwrite the adjacent border or cell.

### Added

- Add xterm.js screen validation over real PTY/ConPTY transport, a tmux CI lane,
  seeded application soak checks, and isolated paired OpenTUI performance comparisons.

## [2.1.1] - 2026-10-18

### Fixed

- Release adopted overlay content and restore application focus when an overlay
  focus callback throws before a handle can be returned.
- Preserve application focus selected by blur callbacks when an overlay closes,
  and stop layout work when callbacks close the overlay during hiding.
- Complete overlay hiding when focus restoration throws, and update every
  overlay on resize before reporting callback failures.

## [2.1.0] - 2026-10-18

### Added

- Add opt-in tree-order focus navigation, explicit ordering and modal Tab scopes,
  with scoped keymap precedence and Solid owner cleanup.
- Add renderer-owned commands, immutable Unicode search metadata, explicit async
  execution results, and a searchable virtualized command palette.
- Add PNG/RGBA image previews with bounded decoding, abortable source loaders,
  native-cell fallback and Kitty Unicode-placeholder graphics.
- Add a bounded native terminal-control FIFO that preserves upload byte progress
  under feed backpressure and orders image controls before cell frames.

### Changed

- Advance the native ABI to 3 for the terminal-control queue entrypoint and
  rebuild all supported native targets together with the TypeScript interface.

### Fixed

- Copy PNG Buffer inputs before deferred decoding so caller mutations cannot
  corrupt an image, and avoid starting loaders after replacement or destruction.
- Require complete OSC 99 notification capability responses, keep matching
  within one escape sequence, and scan repeated prefixes in linear time.
- Harden terminal capability matching and chart coordinate indexing against
  pathological input identified by security analysis.

## [2.0.1] - 2026-10-17

### Fixed

- Preserve render requests queued by post-frame layout microtasks, preventing
  blank virtual-list rows after scrolling in on-demand rendering mode, and keep
  `idle()` waiting until the resulting follow-up repaint completes.
- Report unexpected Node worker exits so pending operations can fail promptly;
  emit the original failure only once when Node sends both error and exit events.
- Keep virtual text spans atomic during right-arrow movement after wide Unicode
  characters, clamp backward jumps before leading spans, and adjust delete-line
  extmarks using native display offsets.
- Preserve other held mouse buttons when one SGR button is released.
- Interpret distortion, cloud, flame, and rainbow animation deltas consistently
  as milliseconds, preserving configured durations and speeds.
- Recreate Solid portal content when changing its mount and preserve renderable
  internal children when reconciling JSX children.
- Resolve release-note entry paths on Windows and paths containing spaces, and
  use the final verdict marker in the optional review script.

### Added

- Add real POSIX terminal regressions for wheel input, parked-marker stability
  during tail updates, bounded repaints, resize anchoring, and clean shutdown.

## [2.0.0] - 2026-10-17

### Breaking changes

- Require Node.js 26+ for development and Node consumers. Upgrade Node before
  installing this version and keep `--experimental-ffi` enabled for native rendering.

### Added

- Add display-only shortcut help with searchable metadata, chord formatting,
  native text wrapping, a reactive Solid component, and a runnable example.
- Add renderer-owned keymaps with focus scopes, priority layers, multi-key
  sequences, binding discovery, and Solid owner cleanup through `useKeymap`.
- Add stable-key variable-height virtual lists, bounded row mounting, scroll
  anchoring, a standalone height index, and a reactive Solid `VirtualList` component.
- Add a runnable 10,000-record example and native regressions for input routing,
  variable-height layout, resizing, data updates, scrolling, and owner cleanup.

### Changed

- Require Node.js 26+ for development and Node consumers, select Node 26 through
  `.nvmrc`, and use Node 26 in every validation and publication job.
- Upgrade the pinned Node.js type definitions to the 26.x line.

### Fixed

- Preserve Node EventEmitter lifecycle, symbol, and error semantics for non-input
  events while keeping keyboard and paste priority routing compatible with Node 26 types.

## [1.1.0] - 2026-10-17

### Added

- Add slash-command and file-path autocomplete providers, cancellable requests,
  explicit replacement ranges, and an undo-preserving native editor adapter.
- Add positioned, clipped overlays with reversible visibility, focus restoration,
  and Solid owner-scoped cleanup through `useOverlay`.

### Fixed

- Size native text-range output by actual UTF-8 bytes rather than display-width
  offsets, preserving CJK, combining characters, and emoji sequences.
- Position single-line input cursors at the native line end for Unicode values,
  and retain single-line/length constraints during undoable replacement.
- Stop installing input handlers or accessing destroyed editors when synchronous
  focus listeners redirect focus or close the focused renderable.
- Build Solid declarations against the current staged core exports.

## [1.0.6] - 2026-10-17

### Fixed

- Honor interval cancellation from inside a ManualClock callback, allowing
  self-cancelling intervals to stop and runAll to finish.
- Keep ManualClock time monotonic when pending zero-delay intervals fire
  during a later advance.
- Handle Zig's multi-argument SDK queries and patch every macOS SDK symbol
  section in an independent SDK copy.
- Replace native build artifacts atomically so rebuilding a loaded macOS
  library does not invalidate mapped code-signature pages.

### Changed

- Upgrade compatible dependency releases, including Babel 7, Solid 1.9,
  Marked 17, Vitest 4, and pnpm 10. Keep npm and JSR dependency pins aligned.
- Refresh vulnerable transitive dependencies; the release dependency audit
  reports no known vulnerabilities.
- Run the pinned Zig suite in Linux, macOS, and Windows CI, and verify all
  22 TypeScript FFI struct layouts against their native definitions.
- Rebuild all eight native targets with the updated source provenance.

Version 1.0.5 was tagged but not published because release preflight failed.

## [1.0.4] - 2026-10-09

### Fixed

- Normalize ASCIIFont selections into reading order, so a reverse drag selects
  the same cells as a forward drag.
- Count trimmed console lines before splicing, so the scroll index follows the
  deletion, and clamp the console wrap width to at least 1.
- Skip a full-height footer scroll when it frees zero lines.
- Honor an explicit timeline duration of 0, accept numeric-string start times,
  and fire loop callbacks for every cycle the clock crosses.
- Wrap glitch shifts with a positive modulo, and ignore non-finite rolling-bar
  positions. An empty ASCII ramp returns without throwing.
- Drop the merged syntax-style cache when a style name is registered again.
- Read edit-buffer text from the buffer's byte size instead of stopping at 1MB.
- Collapse a reverse selection on Right, and clamp rightward scroll the same
  way as the other directions.
- Clear scrollbar arrow auto-repeat timers when the scrollbar is destroyed.
- Keep code conceal ranges through the newline at their end offset.
- Render nullish Solid text and content as empty strings. Destroy a portal's
  container on unmount. Unset props removed from a spread, and restore layout
  styles removed from a later style object.
- Treat a non-finite pulse speed as stopped, and map a fractional symbol height
  below one level to the empty glyph.
- Emit undo and redo cursor updates as `cursor-changed`, matching every other
  cursor update.

### Changed

- Share text measurement, Kitty key parsing, markdown block updates, and
  post-process color helpers internally. The public API is unchanged.
- Skip the table wrap-measure pass when a cell's widest line already fits its
  column.

## [1.0.3] - 2026-09-20

### Fixed

- Preserve overflow direction when clamping infinite renderer values, while
  safely handling `NaN` and invalid numeric table widths.

### Changed

- Consolidate internal numeric bounds, table fitting, and keyboard modifier
  decoding without changing the public API.

## [1.0.2] - 2026-09-18

### Fixed

- Move existing inline Solid text nodes without duplicating them during keyed
  reordering or reparenting.
- Preserve completed child animations when resuming a parent timeline, and
  complete finite animations without waiting through a final loop delay when
  no completion callback is registered.
- Honor one-shot keyboard and paste listeners, including reentrant dispatch,
  and preserve the event emitter as the listener receiver.
- Emit empty syntax-highlight responses after edits and resets so consumers
  can clear highlights when the final highlighted token is removed.

## [1.0.1] - 2026-09-18

### Fixed

- Replace and remove reactive Solid text styles without retaining stale colors
  or attributes; preserve intrinsic tag styles. Append nodes when an insertion
  anchor has disappeared, including within inline text.
- Keep paused timelines from advancing children, reject cyclic synchronization,
  bound child progress to the parent duration, and refresh live rendering when
  attaching the engine or synchronizing a running child.
- Fold edits into pending parser resets using the latest content, discard
  superseded queued edits, and retire failed workers so initialization can retry.

- Make native buffer resize atomic on allocation failure and report failure to
  TypeScript. Reject overflowing dimensions and undersized grayscale/border
  arrays before native access. Native ABI 2 is required for checked resize.
- Preserve Unicode grapheme clusters, color intent, and row endings in captured
  frames, including wide characters at the right edge.
- Keep tree-sitter timers and queued edits isolated per client; cancel removed
  buffers before disposal, clear acknowledged timeouts, and ignore stale parser
  initialization responses. Cancelled debounce promises reject with AbortError.
- Reject malformed percentages, non-finite layout values, and invalid frame
  rates. Preserve large overlapping objects during viewport culling.
- Key parser caches by SHA-256 of the full source URL, commit downloads
  atomically, and bound network downloads to 64 MiB and 30 seconds.

### Performance

- Allocate captured colors once per span and use an ASCII capture fast path.
  A fixed 120 by 40 ASCII frame benchmark on macOS arm64 / Node 26.5.0 improved
  from 1.75 ms to 0.088 ms median per capture. This measures span capture only;
  it is not an application-wide rendering benchmark.

### Validation

- Add Linux, macOS, and Windows CI for source checking, artifact freshness,
  native runtime integration, and regressions. Release asset publication now
  waits for these gates. Keep checkout and compiler line endings deterministic.

### Changed

- Move the remaining inline widget-build and release-validation JavaScript
  into TypeScript maintenance scripts checked by TypeScript 7.

- Complete native interface separation: AX-owned library filenames, ABI
  version verification, native Yoga creation, notifications, diagnostics,
  and debug tool names. No OpenTUI native library is loaded or accepted.
- Move the former `OPENTUI_*` terminal overrides to `AX_CODE_TUI_*` names.
  Existing AX settings remain unchanged. Two deprecated TypeScript Yoga
  methods forward to AX TUI for application compatibility.
- Verify source, generated runtime, package dependencies, and native build
  configuration for accidental upstream coupling with `check:independence`.
  Historical MIT source attribution remains intact.

Version 1.0.1 supplies the matching ABI 2 native assets; published v1.0.0 assets remain immutable.

## [1.0.0] - 2026-09-18

### Changed

- Absorb the OpenTUI 0.4.1 renderer, Solid reconciler, and Zig/C source into an
  independently maintained AX TUI source fork, preserving MIT attribution.
  TypeScript 7 now checks and builds every JavaScript runtime entry from owned
  TypeScript/TSX. Generated artifacts remain committed for package consumers.
- Build all eight native targets from local source with Zig 0.15.2, recording
  source hashes and compiler configuration instead of downloading OpenTUI
  npm platform packages. Native ABI names remain compatible.
- Default configuration and data paths now use the `ax-tui` namespace instead
  of `opentui`. Applications can retain an explicit custom name; existing
  default-path files are not moved automatically.

### Fixed

- Prevent chart rasterization from hanging or overflowing when finite axis
  bounds approach JavaScript's numeric limits; reject invalid pixel endpoints.
- Apply individual X/Y axis colors to their corresponding chart lines.
- Include `stdinParserTimeoutMs` in the generated renderer configuration type.

### Validation

- Add FFI and terminal-input regressions, local native build verification,
  and end-to-end Solid reactivity, disposal, highlighting, and cache checks.

## [0.1.6] - 2026-09-17

### Fixed

- Raise the stdin parser's pending-escape-sequence timeout from 20ms to
  100ms (configurable via `CliRendererConfig.stdinParserTimeoutMs`).
  Under real load, a terminal reply (cursor position report, palette query,
  Kitty keyboard negotiation) can arrive across two separate stdin reads
  more than 20ms apart. When the old timeout fired mid-sequence, the parser
  forgot it was mid-sequence and re-parsed the second half's bytes as
  literal printable keystrokes into whatever had focus -- visible as stray
  fragments like `29H` or `[0;0;0m` landing in the chat input or
  transcript. 100ms matches vim's `ttimeoutlen` default for the same class
  of problem.
- Narrow `ChartRenderable.datasets` getter to return `readonly Dataset[]`
  instead of `readonly Dataset[] | undefined`. The constructor and setter
  already coerce `undefined` to `[]`, so the runtime value is always an
  array; the previous type leaked the input shape and forced downstream
  consumers to add non-null assertions.

## [0.1.5] - 2026-09-14

### Changed

- Upgrade development type checking and spinner/chart builds to the official
  Go-based TypeScript 7.0.2 compiler. The generated JavaScript and declarations
  remain unchanged; the Solid transform still uses Babel and the native
  renderer ABI is unchanged. No Go toolchain is required for installation.

## [0.1.4] - 2026-09-12

### Fixed

- Chart renderables (sparkline, gauge, bar chart, cartesian chart) recompute
  their layout on every frame again. The 0.1.3 memoization served stale frames
  when data was mutated in place through the live `data`/`datasets`
  references without a `requestRender` — despite the 0.1.3 notes claiming no
  behavior change. The single-pass auto-bounds computation stays.
- Add the missing chart update accessors (`barColor`; gauge
  `labelColor`/`backgroundColor`; `showValues`/`showLabels` and bar chart
  `backgroundColor`; `hiddenLegendConstraints` and chart `backgroundColor`).
  The Solid reconciler assigns props directly, so without a setter these
  updates were silently dropped into inert own-properties and never rendered.

## [0.1.3] - 2026-09-07

### Performance

- Memoize chart layouts in the sparkline, gauge, bar chart, and cartesian chart
  renderables and compute auto-bounds in a single pass. A static chart no
  longer re-layouts or re-parses cell colors on every frame while unrelated
  renderables elsewhere in the tree animate. No behavior change.

## [0.1.2] - 2026-09-05

### Documentation

- Publish a real JSR overview page: the package readme is the JSR readme source
  and the entrypoints carry `@module` documentation.
- Record the chart widgets PRD, ADR, and tech spec in the AX Code monorepo.

## [0.1.1] - 2026-09-05

### Added

- Chart widgets: `ax-tui/chart` and `ax-tui/chart/solid` (TypeScript sources
  plus committed dist output) with JSR documentation and types.
- Verified native asset delivery: the JSR package ships JavaScript and type
  declarations only; native renderer libraries are published as version-pinned
  GitHub release assets and verified against `vendor/manifest.json` before the
  JSR package goes out.

### Fixed

- JSR self imports now map to local exports instead of falling back to npm
  lookups.
- Hardened maintenance scripts and spinner interval validation.

## [0.1.0] - 2026-09-05

Initial standalone release of the ax-tui package on JSR. The 0.1.0 registry
build was unusable and is superseded by 0.1.1.
