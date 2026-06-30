import { NamedError } from "@ax-code/util/error"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { DoctorCommand } from "./cmd/doctor"
import { GenerateCommand } from "./cmd/generate"
import { fatal } from "./bootstrap/fatal"
import { init } from "./bootstrap/env"
import { migrate } from "./bootstrap/migrate"
import { FormatError } from "./error"
import { UI } from "./ui"
import { Installation } from "../installation"
import { Log } from "../util/log"
import { DiagnosticLog } from "../debug/diagnostic-log"
import { isHarmlessInterrupt } from "../util/harmless-interrupt"

const cmds = [DoctorCommand, GenerateCommand]

let forcedExitTimer: ReturnType<typeof setTimeout> | undefined
let hooksInstalled = false

function onUnhandledRejection(err: unknown) {
  if (isHarmlessInterrupt(err)) return
  DiagnosticLog.recordProcess("cli.unhandledRejection", { error: err })
  Log.Default.error("rejection", {
    e: err instanceof Error ? err.message : err,
  })
  process.exitCode = 1
}

function onUncaughtException(err: Error) {
  if (isHarmlessInterrupt(err)) return
  DiagnosticLog.recordProcess("cli.uncaughtException", { error: err })
  Log.Default.error("exception", {
    e: err instanceof Error ? err.message : err,
  })
  setTimeout(() => process.exit(1), 100)
}

export function hooks() {
  if (hooksInstalled) return
  hooksInstalled = true
  process.on("unhandledRejection", onUnhandledRejection)
  process.on("uncaughtException", onUncaughtException)
}

export function clearForcedExitTimer() {
  if (!forcedExitTimer) return
  clearTimeout(forcedExitTimer)
  forcedExitTimer = undefined
}

export function scheduleForcedExit(exit: () => void = () => process.exit()) {
  clearForcedExitTimer()
  forcedExitTimer = setTimeout(() => {
    forcedExitTimer = undefined
    exit()
  }, 500)
  forcedExitTimer.unref?.()
  return forcedExitTimer
}

export function cli(argv = hideBin(process.argv)) {
  const rawArgv = argv.slice()
  let cli = yargs(argv)
    .parserConfiguration({ "populate--": true })
    .scriptName("ax-code")
    .wrap(100)
    .help("help", "show help")
    .alias("help", "h")
    .version("version", "show version number", Installation.VERSION)
    .alias("version", "v")
    .option("print-logs", {
      describe: "print logs to stderr",
      type: "boolean",
    })
    .option("log-level", {
      describe: "log level",
      type: "string",
      choices: ["DEBUG", "INFO", "WARN", "ERROR"],
    })
    .option("sandbox", {
      describe: "isolation sandbox mode",
      type: "string",
      choices: ["read-only", "workspace-write", "full-access"],
    })
    .option("debug", {
      describe: "write local diagnostic logs to the OS temp directory",
      type: "boolean",
    })
    .option("debug-dir", {
      describe: "explicit directory for --debug diagnostic logs",
      type: "string",
    })
    .option("debug-include-content", {
      describe: "include prompt, output, and tool content in --debug logs",
      type: "boolean",
    })
    .middleware(async (opts) => {
      Object.defineProperty(opts, "__axCodeRawArgv", {
        value: rawArgv,
        enumerable: false,
      })
      await init(opts)
      // Skip database migration for commands that never touch the DB.
      const skipMigration =
        rawArgv.some((a) => a === "--help" || a === "-h" || a === "--version" || a === "-v") ||
        rawArgv[0] === "completion"
      if (!skipMigration) await migrate()
    })
    .usage("\n" + UI.logo())
    .completion("completion", "generate shell completion script")

  for (const cmd of cmds) cli = cli.command(cmd as never)

  cli = cli
    .fail((msg, err) => {
      if (
        msg?.startsWith("Unknown argument") ||
        msg?.startsWith("Not enough non-option arguments") ||
        msg?.startsWith("Invalid values:")
      ) {
        if (err) throw err
        cli.showHelp("log")
      }
      if (err) throw err
      process.exit(1)
    })
    .strict()

  return cli
}

export async function run() {
  clearForcedExitTimer()
  const cmd = cli()
  try {
    await cmd.parse()
  } catch (err) {
    fatal(err, {
      format: FormatError,
      ui: UI.error,
      file: Log.file,
      text: NamedError.message,
    })
    process.exitCode = 1
  } finally {
    scheduleForcedExit()
  }
}
