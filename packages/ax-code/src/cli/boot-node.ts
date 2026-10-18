import "../lsp-glue"
import { hideBin } from "yargs/helpers"
import { DoctorCommand } from "./cmd/doctor"
import { GenerateCommand } from "./cmd/generate"
import { setAxCodeProcessTitle } from "../util/process-title"
import { clearForcedExitTimer } from "./boot-lifecycle"
import { createAxCodeCli, runAxCodeCli } from "./boot-shared"
import { writeJsonUsageError } from "./cmd/json-output"

const cmds = [DoctorCommand, GenerateCommand]

// Process-lifecycle machinery (forced-exit timer, process error hooks) is
// shared with the full CLI via boot-lifecycle.ts.
export { clearForcedExitTimer, FORCED_EXIT_GRACE_MS, hooks, scheduleForcedExit } from "./boot-lifecycle"

export function cli(argv = hideBin(process.argv)) {
  const { cli: base } = createAxCodeCli(argv, cmds)

  return base
    .fail((msg, err) => {
      if (err && !(base.parsed && base.parsed.error)) throw err
      const jsonUsageError = writeJsonUsageError(base.parsed, msg)
      if (msg && !jsonUsageError) process.stderr.write(`${msg}\n`)
      if (
        !jsonUsageError &&
        (msg?.startsWith("Unknown argument") ||
          msg?.startsWith("Not enough non-option arguments") ||
          msg?.startsWith("Invalid values:") ||
          msg?.startsWith("Missing required argument"))
      ) {
        base.showHelp((text) => process.stderr.write(text + "\n"))
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
