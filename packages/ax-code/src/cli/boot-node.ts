import "../lsp-glue"
import { hideBin } from "yargs/helpers"
import { DoctorCommand } from "./cmd/doctor"
import { GenerateCommand } from "./cmd/generate"
import { setAxCodeProcessTitle } from "../util/process-title"
import { clearForcedExitTimer } from "./boot-lifecycle"
import { createAxCodeCli, runAxCodeCli } from "./boot-shared"

const cmds = [DoctorCommand, GenerateCommand]

// Process-lifecycle machinery (forced-exit timer, process error hooks) is
// shared with the full CLI via boot-lifecycle.ts.
export { clearForcedExitTimer, FORCED_EXIT_GRACE_MS, hooks, scheduleForcedExit } from "./boot-lifecycle"

export function cli(argv = hideBin(process.argv)) {
  const { cli: base } = createAxCodeCli(argv, cmds)

  return base
    .fail((msg, err) => {
      if (err) throw err
      if (msg) process.stderr.write(`${msg}\n`)
      if (
        msg?.startsWith("Unknown argument") ||
        msg?.startsWith("Not enough non-option arguments") ||
        msg?.startsWith("Invalid values:") ||
        msg?.startsWith("Missing required argument")
      ) {
        base.showHelp("log")
      }
      process.exit(1)
    })
    .strict()
}

export async function run() {
  clearForcedExitTimer()
  setAxCodeProcessTitle()
  await runAxCodeCli(cli())
}
