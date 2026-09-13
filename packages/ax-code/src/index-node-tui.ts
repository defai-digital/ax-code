// Full ax-code entry for the Node runtime, including the interactive TUI.
// Unlike index-node.ts (headless boot-node), this boots the complete CLI
// (boot.ts) — the AX Code TUI renderer uses Node's node:ffi backend (run node with
// --experimental-ffi) and node-pty for terminals. See ADR-036 (TUI on Node).
import { fileURLToPath } from "node:url"
import { setAxCodeProcessTitle } from "./util/process-title"
import { claimAxCodeTerminalTitle, shouldClaimAxCodeTerminalTitleAtEntry } from "./util/terminal-title"
import { claimAxCodeForegroundTtyJob } from "./util/tty-job"
import { restoreAxCodeLaunchNodeOptions } from "./util/node-options"
import { installNodeBunCompat } from "./bun/node-compat"

// Before anything else: drop the launcher's boot chain from NODE_OPTIONS so
// Node children spawned by the CLI graph never re-import this entry (see
// util/node-options.ts). Record the real entry path in the same breath: the
// launchers keep argv at "AX-Code /dev/null …" for short macOS job titles, so
// argv[1] can no longer identify the CLI entrypoint for the TUI backend spawn
// (cli/cmd/tui/thread.ts reads AX_CODE_CLI_ENTRY first).
restoreAxCodeLaunchNodeOptions()
process.env.AX_CODE_CLI_ENTRY = fileURLToPath(import.meta.url)

// Next: rename the process so ps/tmux/terminal tab lists show
// "ax-code" from the first milliseconds instead of "node" (see
// util/process-title.ts). Claim the OSC tab title in the same breath so the
// window does not sit on "node" or the long Node argv while the CLI graph loads.
// `npm run dev` / pnpm still leave a Node wrapper as the TTY process-group
// leader; steal the foreground job so Apple Terminal / iTerm name us AX-Code.
setAxCodeProcessTitle()
if (shouldClaimAxCodeTerminalTitleAtEntry()) {
  claimAxCodeTerminalTitle()
  claimAxCodeForegroundTtyJob()
}

installNodeBunCompat()

const { hooks, run } = await import("./cli/boot")

hooks()
await run()
