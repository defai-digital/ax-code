# AX TUI

SolidJS terminal UI framework with a native renderer. It lives in the
[AX Code](https://github.com/defai-digital/ax-code) monorepo at `packages/ax-tui`.
It combines:

- a native terminal renderer (Zig shared libraries, vendored per platform) with
  a Yoga-layout-based renderable tree;
- a SolidJS reconciler and JSX runtime for declarative terminal UIs
  (`@defai-digital/ax-tui/solid`);
- headless test utilities for rendering and asserting on frames without a real
  terminal (`@defai-digital/ax-tui/testing`, plus `testRender` from `@defai-digital/ax-tui/solid`);
- a spinner component (`@defai-digital/ax-tui/spinner`, `@defai-digital/ax-tui/spinner/solid`);
- ratatui-style chart widgets (`@defai-digital/ax-tui/chart`, `@defai-digital/ax-tui/chart/solid`).

AX TUI owns its TypeScript renderer, SolidJS reconciler, and Zig/C native source.
It began as a source fork of [OpenTUI](https://github.com/anomalyco/opentui) 0.4.1
and is maintained in this repository, with MIT attribution preserved. See
[UPSTREAM.md](./UPSTREAM.md), [DIVERGENCES.md](./DIVERGENCES.md),
[MAINTENANCE.md](./MAINTENANCE.md), and [LICENSE](./LICENSE).

## Develop

From the AX Code repository root:

```sh
pnpm install
pnpm --dir packages/ax-tui run typecheck
pnpm --dir packages/ax-tui run check
pnpm --dir packages/ax-tui test
```

AX Code depends on the package with `workspace:@defai-digital/ax-tui@*`.
Application code keeps importing `ax-tui`
and `ax-tui/solid`. The public package name remains `@defai-digital/ax-tui`.

Node.js 26+ is required; native rendering additionally requires `--experimental-ffi`.
Headless rendering uses the same native backend and does not require a TTY.

The package includes manifest-verified native libraries and licenses for every supported platform.
Normal installations load the bundled library without a network download, including with
`AX_CODE_TUI_NATIVE_OFFLINE=1`. Custom distributions that omit the bundled libraries can
still prepare the version-matched verified cache through `@defai-digital/ax-tui/native`.

## Quick start

Render a SolidJS component tree to the terminal:

```tsx
import { render, useKeyboard } from "@defai-digital/ax-tui/solid"

function App() {
  useKeyboard((key) => {
    if (key.name === "q") process.exit(0)
  })
  return (
    <box width="100%" height="100%" justifyContent="center" alignItems="center">
      <text fg="#7ee787">Hello from ax-tui — press q to quit</text>
    </box>
  )
}

await render(() => <App />)
```

Headless-test the same component without a terminal:

```tsx
import { testRender } from "@defai-digital/ax-tui/solid"

const { captureCharFrame, waitForVisualIdle } = await testRender(() => <App />)
await waitForVisualIdle()
console.log(captureCharFrame())
```

## Imports

Application code should use only the documented package exports. Do not import
files from the package directory directly.

```ts
import { RGBA, TextRenderable } from "@defai-digital/ax-tui"
import { render, useKeyboard } from "@defai-digital/ax-tui/solid"
import { SpinnerRenderable } from "@defai-digital/ax-tui/spinner"
import "@defai-digital/ax-tui/spinner/solid"
import { ChartRenderable, SparklineRenderable } from "@defai-digital/ax-tui/chart"
import "@defai-digital/ax-tui/chart/solid"
```

### Autocomplete

The root export provides reusable completion providers and an editor adapter:

```ts
import {
  AutocompleteController,
  combineAutocompleteProviders,
  createSlashCommandProvider,
  createFilePathProvider,
  getEditorAutocompleteRequest,
  applyEditorAutocomplete,
} from "@defai-digital/ax-tui"

const completions = new AutocompleteController(combineAutocompleteProviders(
  createSlashCommandProvider([{ name: "help", description: "Show available commands" }]),
  createFilePathProvider({ cwd: process.cwd(), maxResults: 50 }),
))

// editor is an attached TextareaRenderable or InputRenderable.
// Call again after each input/cursor change; handle provider errors in the caller.
const result = await completions.request(getEditorAutocompleteRequest(editor))
// Render result.items in your suggestion UI, then accept the user's selected item:
if (result?.items[0]) applyEditorAutocomplete(editor, result, result.items[0])

// Cancel when dismissing suggestions; dispose when the owning UI is destroyed.
completions.cancel()
completions.dispose()
```

Requests and replacement ranges use JavaScript UTF-16 indices. An item's optional
`cursorOffset` positions the caret inside its inserted text; quoted directory
completion uses it to keep subsequent typing inside the quotes. The adapter
converts through AX's native display-width rules, preserves undo, rejects stale
text/cursor snapshots, and declines edits while text is selected. Input replacement
retains its single-line and maximum-length constraints. Custom providers receive
an `AbortSignal`; superseded results are ignored even if the provider ignores it.
Cancellation suppresses errors from cancelled work; other provider errors reject
the request promise and should be handled by the application.

Slash completion applies to the first token at the beginning of the input.
Providers run in order; the first non-null result wins, including an empty list.
With slash completion first, leading `/` belongs to commands; use the path provider
alone for absolute POSIX paths, or `./`, `../`, `~/`, and `@` paths in a combined
provider. File completion reads one directory asynchronously, supports double-quoted
paths with spaces, and bounds the number of returned suggestions. It is not a shell
parser: backslashes are literal characters or Windows separators, and quotes/control
characters in filenames are excluded. Matching symlinks in the bounded result set
are checked for directory targets without recursively traversing them.

### Overlays

```ts
import { InputRenderable, getOverlayManager } from "@defai-digital/ax-tui"

const input = new InputRenderable(renderer, { id: "dialog-input", width: "100%" })
const dialog = getOverlayManager(renderer).show(input, {
  width: "60%",
  height: 3,
  anchor: "center",
  margin: 1,
  visible: (width) => width >= 20,
})

dialog.setHidden(true)  // Keep the content alive and release its focus.
dialog.setHidden(false)
dialog.focus()          // Re-showing alone does not steal focus.
dialog.close()          // Permanently remove and destroy owned content; safe to repeat.
```

Each renderer has one shared manager. Content must be unattached and belong to
that renderer; showing it transfers ownership to the manager. A wrapper clips the
content and positions it above existing ordinary root children when shown or
focused. Dimensions can be cell
counts or percentages of the viewport remaining after margins. Anchors support
center, corners, and edge centers; offsets are clamped to the available area.
Responsive visibility is evaluated on show and renderer resize.

For a container with an embedded input, pass that input as `focus`. A focusable
content root is the default target. `nonCapturing: true` leaves keyboard focus in
the editor, which is useful for suggestion lists. This controls initial keyboard
focus, not mouse click-through. Overlays do not implement a modal focus trap,
Escape handling, or list navigation; those policies belong to the application.
Closing or hiding restores previous eligible focus only when focus remains inside
the overlay. Nested overlays support out-of-order closure and skip hidden or
destroyed restoration targets. Renderer destruction cleans up all overlays.

In Solid components, `useOverlay()` from `@defai-digital/ax-tui/solid` returns a scoped `show`
method with the same arguments. Its handles close automatically when that owner
is disposed, without closing sibling owners' overlays. Use imperative renderables
as content; already mounted JSX/Portal nodes must not be reparented into overlays.

### Scoped keymaps

`getKeymap(renderer)` shares an opt-in dispatcher across one renderer. Layers
can target a focused renderable, its focused descendants (the default), or the
whole renderer when `target` is omitted:

```ts
import { getKeymap } from "@defai-digital/ax-tui"

const keys = getKeymap(renderer)
const unregister = keys.register({
  target: panel,
  scope: "focus-within",
  priority: 10,
  enabled: () => !busy,
  bindings: [
    { id: "save", keys: "ctrl+s", description: "Save", handler: save },
    { id: "top", keys: ["g", "g"], description: "First row", handler: () => list.scrollToIndex(0) },
  ],
})

const help = keys.getActiveBindings() // Eligible bindings in dispatch order, including shadowed entries.
unregister()                         // Idempotent; does not destroy the target.
```

Higher priority wins, then the nearest focus scope, then the newest registration.
Hidden, detached, destroyed, and disabled scopes do not handle input. A matching
layer consumes the key before focused editor handlers. Earlier global input
listeners can still cancel it. Chords use exact modifier matching with `ctrl`,
`shift`, `alt`/`meta`, `super`, and `hyper`; `enter`, `esc`, `space`, and `plus`
are accepted aliases. Names match parsed key events, not physical keyboard codes.

The first matching layer owns a sequence. If an exact binding also prefixes a
longer binding, it waits up to 750 ms; configure `sequenceTimeoutMs` on the first
`getKeymap` call to change this. Escape, paste, focus change, terminal blur,
registration changes, and disposal cancel pending input. A mismatch discards the
old prefix and retries only the current key. Prefixes are never replayed into
editors. Held-key repeats do not advance pending sequences; single-key bindings
can repeat. `pendingKeys` and `cancelSequence()` support application hints.

In Solid, `useKeymap()` exposes `register`, `getActiveBindings`, `pendingKeys`,
and `cancelSequence`. Owner cleanup removes only that owner's registrations.
Keep `enabled` predicates pure. The shared dispatcher is disposed with the renderer.

### Shortcut help

`KeymapHelpRenderable` displays an explicit binding snapshot and supports
case-insensitive substring search over IDs, descriptions, and raw/formatted keys:

```ts
import { getKeymap, KeymapHelpRenderable } from "@defai-digital/ax-tui"

const keys = getKeymap(renderer)
const help = new KeymapHelpRenderable(renderer, {
  bindings: keys.getActiveBindings(),
  width: "100%",
  emptyText: "No matching shortcuts.",
})
renderer.root.add(help)
help.query = "save"
console.log(help.matchCount)

// Refresh when opening help or when the application's context changes.
help.bindings = keys.getActiveBindings()
```

The component owns no keymap, refresh timer, keyboard listener, or focus. It
copies display metadata without retaining renderable targets or command handlers.
Updates are explicit; `getActiveBindings()` is not a reactive subscription.
Entries preserve input order and duplicates, including shadowed eligible
registrations. This is an eligible-binding reference, not a list of guaranteed
dispatch winners or an executable command palette. For large help collections,
put it in a ScrollBox or use the pure entry helper with `VirtualListRenderable`.

`formatKeymapKeys("shift+ctrl+s")` returns `"Ctrl+Shift+s"`;
`formatKeymapKeys(["ctrl+k", "ctrl+c"])` returns `"Ctrl+k Ctrl+c"`.
Letters remain lowercase so the display does not imply an extra Shift modifier.
AX's `alt` and `meta` both display as `Alt`; these are textual terminal labels,
not platform-specific Command symbols. Formatting does not register or validate
chords. ANSI escapes are removed from metadata and control characters are
flattened to spaces; Unicode text is preserved and native Text handles wrapping.

`createKeymapHelpEntries(bindings, query?)` returns independent
`{ id, shortcut, description }` records for custom footers or help layouts.
Blank descriptions fall back to the binding ID. A whitespace-only query shows
all entries. These helpers can be imported without constructing a renderer.

Solid's `KeymapHelp` component from `@defai-digital/ax-tui/solid` accepts the same options:

```tsx
<KeymapHelp bindings={bindingSnapshot()} query={search()} width="100%" />
```

Bindings, query, empty text, and layout props update reactively. Owner cleanup
destroys the component; external destruction stops its reactive updates too.
`undefined` bindings/query reset to an empty snapshot/unfiltered search.
The caller-provided `emptyText` is ordinary Text content and can be localized.
See [the searchable example](./examples/keymap-help.mjs), runnable with
`node --experimental-ffi examples/keymap-help.mjs` on Node 26+.
Add `--smoke` to inspect wide and narrow headless frames.

### Focus navigation

Focus navigation is opt-in and follows the current render tree, including
reordered children. Register a scope to enable Tab and Shift+Tab:

```ts
import { getFocusManager } from "@defai-digital/ax-tui"

const focus = getFocusManager(renderer)
const removeScope = focus.registerScope(renderer.root)
focus.focusNext()
focus.focusPrevious()
removeScope()
```

Hidden, detached, destroyed, and nonfocusable nodes are skipped. An optional
`order: [first, second]` moves those descendants before the remaining tree-order
nodes; it never admits nodes outside the scope. Ordinary nested scopes yield at
their boundary to enclosing registered scopes. The renderer root wraps.
`{ modal: true }` contains Tab navigation in a visible scope, including a scope
with one input. Explicit application calls to `focus()` are never redirected.
Existing keymap bindings have first refusal, and unhandled Tab is not consumed.
Removing a scope changes navigation only; OverlayManager continues to own focus
restoration. Scope destruction removes registration automatically.

Solid's `useFocusManager()` has the same navigation and registration methods;
owner cleanup removes only its own scopes. Register after the scope's children
exist, for example in `onMount`.

### Commands and command palette

Commands have their own registry, independent of eligible shortcut-help entries:

```ts
import { getCommandRegistry, getKeymap, showCommandPalette } from "@defai-digital/ax-tui"

const commands = getCommandRegistry(renderer)
const remove = commands.register({
  id: "document.save",
  title: "Save document",
  keywords: ["write", "file"],
  enabled: ({ focused }) => focused !== null,
  async run({ focused }) { await saveDocument(focused) },
})
getKeymap(renderer).register({ bindings: [
  { id: "save", keys: "ctrl+s", handler: () => { void commands.execute("document.save") } },
  { id: "commands", keys: "ctrl+p", handler: () => {
    const palette = showCommandPalette(renderer)
    void palette.result.then(result => {
      if (result?.status === "error") console.error(result.error)
    })
  } },
] })
```

IDs are unique per renderer; duplicate registration throws. `register(command,
target?)` optionally ties availability and lifetime to an attached renderable.
`search(query, context?)` returns frozen metadata without handlers, using Unicode
normalization, case-insensitive subsequence matching, and deterministic ranking.
`enabled` predicates must be synchronous and pure. A throwing predicate marks its
search entry unavailable; execution returns an explicit error result.

`execute(id, context?)` rechecks the current registration and availability, catches
sync throws and async rejection, and returns a promise that never rejects. Its
`status` is `executed`, `disabled`, `not-found`, `stale-context`, `disposed`, or
`error` (with `error`). Callers must inspect the result to surface application
failures. A captured focused renderable must remain visible and attached.

The palette captures context before opening, supports Up/Down, Enter, Escape,
mouse selection, live registry changes, and virtualized result rows. It restores
focus through OverlayManager before executing. Its `result` resolves after the
selected command completes, or to `null` when closed without execution.
`setQuery()`, `refresh()`, `executeSelected()`, and `close()` support application
control. Call `refresh()` when external enabled conditions change.

Solid's `useCommands()` removes its registrations on owner cleanup;
`useCommandPalette().show()` closes its owned palettes on cleanup.

### Images and Kitty graphics

```ts
import { readFile } from "node:fs/promises"
import { ImageRenderable } from "@defai-digital/ax-tui"

const preview = new ImageRenderable(renderer, {
  width: 60, height: 20, alt: "Document preview", protocol: "auto",
  source: await readFile("preview.png"),
})
renderer.root.add(preview)
await preview.loadPromise
```

Sources are PNG bytes, `{ width, height, data }` RGBA pixels, or an asynchronous
`(signal: AbortSignal) => Promise<PNG bytes | RGBA pixels>` loader. Applications
own filesystem/network access. Inputs are copied; replacement and destruction
abort pending loaders and discard stale results. Decode/load failure sets
`loadError`, calls optional `onError`, rejects `loadPromise`, and displays `alt`.
The promise is internally observed so using the callback alone does not create
an unhandled rejection.

PNG decoding supports noninterlaced 8-bit grayscale, RGB, indexed, grayscale-alpha,
and RGBA images, including palette/simple transparency. Encoded data is capped at
16 MiB and decoded images at 4,194,304 pixels; CRC, chunk order and inflated size
are checked. Other PNG depths/interlacing fail explicitly. Color-management
metadata and animation are not applied; use predecoded RGBA when required.

`protocol: "auto"` uses Kitty Unicode placeholders on positively identified Kitty
0.28+ with RGB graphics capability and direct transport. Explicit `"kitty"` may
opt in another compatible terminal, but still requires RGB/graphics capability.
Every placeholder contains explicit row/column coordinates and the full image ID,
so clipping and overlapping widgets use the normal native cell composition.
Uploads and virtual placements enter a Zig-owned bounded FIFO before cell frames;
backpressured feeds retain byte progress without replaying partial APC payloads.
Replacement/destruction deletes only owned IDs. Resume reuploads under a new ID.
The native interface is ABI 3; use the matching rebuilt bundled libraries.
Each renderer owns at most 256 active Kitty image IDs; additional images use
block output until earlier resources retire.

Other terminals, multiplexers, nonopaque ancestors, postprocessing, unsupported
placeholder sizes (over 297 cells per axis), and `cover`/`fill` use colored
half-block cells. `protocol: "blocks"` forces that portable path. `fit` accepts
`contain` (default), `cover`, or `fill`; `cellAspectRatio` defaults to 2 and can be
adjusted to the terminal's cell proportions. The background defaults to black;
block output flattens each pixel's alpha independently onto the configured RGB
background, while Kitty retains per-pixel alpha. The `alt` text is configurable.
Kitty output requires the terminal to retain transmitted image data;
quiet uploads do not constitute a terminal acknowledgement.

Solid supports `<image source={pixels()} width={40} height={12} alt="Preview" />`.
See [the application example](./examples/application.mjs); run
`node --experimental-ffi examples/application.mjs --smoke` for a headless frame.

### Virtual lists

`VirtualListRenderable<T>` extends the vertical ScrollBox with stable keys,
variable row heights, and viewport-sized mounting:

```ts
import { TextRenderable, VirtualListRenderable } from "@defai-digital/ax-tui"

const list = new VirtualListRenderable(renderer, {
  width: "100%",
  height: 20,
  items: records,
  getKey: record => record.id,
  estimateHeight: 2,
  overscan: 3,
  renderItem: (record, index, context) => new TextRenderable(context, {
    content: record.text, width: "100%", wrapMode: "word",
  }),
})
renderer.root.add(list)
list.scrollToIndex(500, "start") // Also supports center/end; settles after native layout.
list.items = nextRecords        // Immutable updates; preserves the first visible key and row offset.
```

Keys must be unique strings or finite numbers. Heights are terminal cell counts;
`overscan` is extra cells above and below the viewport, not an item count. Rows
are measured after native layout; unmounted rows retain estimated or cached
heights. Width changes invalidate measurements. Updating data is O(n), while
height updates and offset lookups are O(log n). `VirtualListModel` exports this
height index separately for custom views, without constructing a renderer.

`renderItem` must return an unattached renderable from the supplied context.
The list owns and destroys mounted rows; row factories should have no unrelated
side effects. Use intrinsic row heights and widths relative to the viewport.
The item identity and index determine whether an existing row is reused: changed
items or indices remount, so keep persistent edit state in application data.
An offscreen focused row stays mounted while unchanged; removing or remounting
it moves focus to the list. `mountedCount` includes this possible extra row.
Empty lists release all rows. The virtual content container is managed internally;
use `items` rather than inherited child insertion or content-layout mutation.

Solid's `VirtualList` component from `@defai-digital/ax-tui/solid` accepts the same options and
a `ref` callback. `items` and layout props are reactive; `getKey`, `renderItem`,
`estimateHeight`, and `overscan` are constructor options. Its owner destroys the
list on cleanup. Row factories return imperative renderables, not mounted JSX:

```tsx
<VirtualList items={records()} getKey={record => record.id} height={20}
  renderItem={(record, index, context) => new TextRenderable(context, { content: record.text })} />
```

See [the runnable example](./examples/virtual-list.mjs). From a source checkout,
run `node --experimental-ffi examples/virtual-list.mjs` on Node 26+; arrows and
the wheel scroll, `g g` jumps to the first record, Shift+G to the last, and Q quits.
Add `--smoke` for a headless frame and mount-count report.

### Subpath exports

| Export                     | Contents                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `@defai-digital/ax-tui`                   | Native renderer, renderables, RGBA, Yoga helpers                                                                      |
| `@defai-digital/ax-tui/solid`             | SolidJS reconciler, `render`, `testRender`, JSX runtime                                                               |
| `@defai-digital/ax-tui/solid/jsx-runtime` | JSX runtime for `"jsxImportSource": "@defai-digital/ax-tui/solid"`                                                                   |
| `@defai-digital/ax-tui/solid/transform`   | Build-time JSX/Solid transform (Babel)                                                                                |
| `@defai-digital/ax-tui/spinner`           | `SpinnerRenderable` and presets                                                                                       |
| `@defai-digital/ax-tui/spinner/solid`     | Solid `<spinner>` intrinsic registration                                                                              |
| `@defai-digital/ax-tui/chart`             | Ratatui-style charts: `ChartRenderable`, `SparklineRenderable`, `BarChartRenderable`, `GaugeRenderable`, braille grid |
| `@defai-digital/ax-tui/chart/solid`       | Solid `<chart>`, `<sparkline>`, `<barchart>`, `<gauge>` intrinsic registration                                        |
| `@defai-digital/ax-tui/testing`           | Headless test renderer, mock input, frame capture                                                                     |
| `@defai-digital/ax-tui/yoga`              | Direct Yoga layout bindings                                                                                           |
| `@defai-digital/ax-tui/runtime-plugin`    | Runtime plugin glue (Bun/Node)                                                                                        |

## Provenance and maintenance

Edit `src/`, `solid/source/`, and `native/source/` for TypeScript changes.
TypeScript 7 checks these modules and generates the committed JavaScript and
declarations. Edit `native/renderer/` for Zig/C changes; Zig 0.15.2 builds all
eight supported native targets. No OpenTUI package is needed for these builds.

The behavior ledger is in [DIVERGENCES.md](./DIVERGENCES.md), the build and
release workflow is in [MAINTENANCE.md](./MAINTENANCE.md), and source/binary
hashes are recorded in [`vendor/manifest.json`](./vendor/manifest.json).

```sh
pnpm run build
pnpm run typecheck
pnpm run check
pnpm test
pnpm run test:native        # requires Zig 0.15.2
pnpm run build:native --all # macOS targets also require an Apple SDK
```

## Design influences

Beyond OpenTUI, the framework's ergonomics and feature direction are informed
by studying other coding-agent CLIs as read-only design input — in particular
[Kimi Code](https://github.com/MoonshotAI/kimi-code) and
[Grok Build](https://github.com/xai-org/grok-build) — alongside the AX Code TUI
that ax-tui was extracted from. These projects influence design choices only;
no code is extracted from them, and their respective licenses and terms apply
to their own distributions.
