// Full ax-code entry for the Node runtime, including the interactive TUI.
// Unlike index-node.ts (headless boot-node), this boots the complete CLI
// (boot.ts) — the OpenTUI renderer uses Node's node:ffi backend (run node with
// --experimental-ffi) and node-pty for terminals. See ADR-036 (TUI on Node).
import { installNodeBunCompat } from "./bun/node-compat"

installNodeBunCompat()

const { hooks, run } = await import("./cli/boot")

hooks()
await run()
