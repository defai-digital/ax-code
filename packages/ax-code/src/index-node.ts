import { setAxCodeProcessTitle } from "./util/process-title"
import { installNodeBunCompat } from "./bun/node-compat"

// Before anything else: rename the process so ps/tmux/terminal tab lists show
// "ax-code" from the first milliseconds instead of "node" (see
// util/process-title.ts).
setAxCodeProcessTitle()

installNodeBunCompat()

const { hooks, run } = await import("./cli/boot-node")

hooks()
await run()
