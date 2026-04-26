// OpenTUI's SolidJS transform plugin registration. bunfig.toml preloads
// this for `bun run` (source launcher) and bun-compile auto-bundles it,
// but the source-bundle distribution (ADR-002) runs `bun bundle/index.js`
// from the install dir — outside the package's bunfig.toml scope. Importing
// at the top of the entry ensures the plugin is registered for every
// distribution mode. The preload is idempotent (the underlying call is
// `ensureSolidTransformPlugin`), so double-loading via bunfig.toml + this
// import is safe in source-launcher and compiled-binary modes.
import "@opentui/solid/preload"

import { hooks, run } from "./cli/boot"

hooks()
await run()
