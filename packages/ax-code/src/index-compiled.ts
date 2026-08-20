// Compiled binary entrypoint.
//
// The build script applies AX Code TUI's Solid transform plugin while bundling
// TUI TSX. Keeping the source/dev preload out of this entry prevents
// transform-time Babel dependencies from being bundled into standalone
// binaries, which is required for Bun Windows ARM builds.
import { hooks, run } from "./cli/boot"
import { setAxCodeProcessTitle } from "./util/process-title"

setAxCodeProcessTitle()
hooks()
await run()
