// Full ax-code entry for the Node runtime, including the interactive TUI.
// Unlike index-node.ts (headless boot-node), this boots the complete CLI
// (boot.ts) — the OpenTUI renderer uses Node's node:ffi backend (run node with
// --experimental-ffi) and node-pty for terminals. See ADR-036 (TUI on Node).
import { setAxCodeProcessTitle } from "./util/process-title"
import { installNodeBunCompat } from "./bun/node-compat"

// Before anything else: rename the process so ps/tmux/terminal tab lists show
// "ax-code" from the first milliseconds instead of "node" (see
// util/process-title.ts).
setAxCodeProcessTitle()

installNodeBunCompat()

const { hooks, run } = await import("./cli/boot")

hooks()
await run()
