# AkiTTY terminal SDK

`@ax-code/akitty-sdk` is a dependency-free TypeScript/JavaScript client for programs
running **inside** a terminal, including AX Code TUI. It emits standard OSC 2/1
titles and AkiTTY's existing OSC 771 program chrome protocol. It does not load the
native library, create sessions, decode video, or render a terminal.

The C ABI remains the interface for hosts embedding the native terminal. AkiTTY
Web is a separate implementation; its identity alone does not establish OSC 771
support. Kitty graphics and ASCII/text animations in the terminal grid remain
with the application's existing renderer and graphics capability probes.

## Use

```ts
import { createSprite, createTerminalClient, detectCapabilities } from "@ax-code/akitty-sdk"

const client = createTerminalClient({
  capabilities: detectCapabilities(process.env, process.stdout.isTTY === true),
  write(sequence) {
    // In a TUI, enqueue this whole string through its renderer's serialized writer.
    // Node's false return means queued backpressure, not rejection.
    process.stdout.write(sequence)
    return true
  },
  reduceMotion: false,
})

client.setTitle("AX Code")
client.setStatus({ text: "Working", tone: "info" })
client.setProgress("indeterminate")
const sprite = createSprite(1, 1, [
  new Uint8Array([255, 0, 0, 255]),
  new Uint8Array([0, 0, 255, 255]),
])
client.playSprite({ sprite, intervalMs: 150 })
// On component teardown or normal exit:
client.dispose()
```

The injected writer returns **true if accepted**, false if rejected, and may
throw. The host owns serialization, stream health, backpressure and drain; the
SDK creates no output queue. Failed writes do not commit client state. There is
no terminal acknowledgement: accepted bytes do not prove the host displayed them.
Capability detection conservatively disables output on pipes, SSH and multiplexers.
For an explicitly supported host, inject capabilities rather than relying on an
inherited environment marker. It never grants Kitty graphics capability.

## State and bounds

- `setStatus`, `setProgress`, `setMark`, `setSprite` and `updateChrome` merge into
  one immutable document and emit the complete replacement. Omitted patch fields
  preserve state; `null` removes a field. `clearChrome` clears the whole document.
- Status is at most 128 Unicode scalars, with control characters removed. Title
  controls become spaces and titles are capped at 128 scalars. Status tones are
  `info`, `warn`, `error`; optional `expires` is Unix milliseconds.
- Progress is 0..1 or `indeterminate`. Marks are `idle`, `busy`, `error`, or a
  frame index 0..3. Sprite edges are 1..32 pixels, with 1..4 inline base64 RGBA8
  frames. Paths, URLs, unknown fields and malformed payloads are rejected.
- `playSprite` selects frame 0 immediately and cycles at an integer interval of
  50..60000 ms. Reduce motion and one-frame sprites never start a timer. Timers
  are unreferenced in Node. This is SDK-managed playback, not a native timeline.
- `stopSprite` leaves the last frame visible. Manual mark/sprite updates stop
  playback. Status/progress updates preserve playback. Replacement, clear and
  disposal invalidate already queued ticks. A failed animation write stops the
  timer; thrown errors go to `onError`, or rethrow if no handler was provided.
- `dispose` is idempotent, stops playback and attempts to clear owned chrome and
  title. Afterwards the client cannot emit again. It does not restore a prior
  application's title or status. Hosts need a separate best-effort crash reset.

Invalid inputs throw `RangeError` before writing. Public state and nested values
are frozen. The package exports compiled ESM and explicit `.d.ts` declarations;
there are no runtime dependencies or native binaries.

## Build and verify

```sh
npm ci --ignore-scripts
npm test
npm pack
```

Tests include an isolated packed consumer with declaration checks. The repository's
`scripts/verify.sh` also feeds actual SDK output through the native C ABI/parser,
checks snapshots and cleanup, and verifies that OSC payloads never enter the grid.
See [the protocol contract](../../docs/ABI.md).
