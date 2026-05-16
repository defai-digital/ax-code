// OpenTUI's SolidJS transform plugin registration. bunfig.toml preloads
// this for `bun run` (source launcher), but the source-bundle distribution
// (ADR-002) runs `bun bundle/index.js` from the install dir — outside the
// package's bunfig.toml scope. Importing at the top of the source entry keeps
// source runtimes self-contained. Compiled binaries use index-compiled.ts so
// transform-time Babel dependencies are not bundled into standalone binaries.
// The preload is idempotent, so double-loading via bunfig.toml + this import
// is safe in source-launcher mode.
import "@opentui/solid/preload"

import { hooks, run } from "./cli/boot"

hooks()
await run()
