import { NamedError } from "@ax-code/util/error"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { AcpCommand } from "./cmd/acp"
import { AuditCommand } from "./cmd/audit"
import { ReplayCommand } from "./cmd/replay"
import { AgentCommand } from "./cmd/agent"
import { ConsoleCommand } from "./cmd/account"
import { AttachCommand } from "./cmd/tui/attach"
import { ContextCommand } from "./cmd/context"
import { DbCommand } from "./cmd/db"
import { DebugCommand } from "./cmd/debug"
import { DesignCheckCommand } from "./cmd/design-check"
import { DoctorCommand } from "./cmd/doctor"
import { TraceCommand } from "./cmd/trace"
import { CompareCommand } from "./cmd/compare"
import { RollbackCommand } from "./cmd/rollback"
import { BranchCommand } from "./cmd/branch"
import { ExportCommand } from "./cmd/export"
import { GenerateCommand } from "./cmd/generate"
import { GithubCommand } from "./cmd/github"
import { GraphCommand } from "./cmd/graph"
import { RiskCommand } from "./cmd/risk"
import { DreGraphCommand } from "./cmd/dre-graph"
import { ImportCommand } from "./cmd/import"
import { IndexCommand } from "./cmd/index-graph"
import { InitCommand } from "./cmd/init"
import { McpCommand } from "./cmd/mcp"
import { MemoryCommand } from "./cmd/memory"
import { ModelsCommand } from "./cmd/models"
import { PrCommand } from "./cmd/pr"
import { ReleaseCommand } from "./cmd/release"
import { ProvidersCommand } from "./cmd/providers"
import { RestartCommand } from "./cmd/restart"
import { RunCommand } from "./cmd/run"
import { ServeCommand } from "./cmd/serve"
import { SessionCommand } from "./cmd/session"
import { StatsCommand } from "./cmd/stats"
import { TuiBackendCommand } from "./cmd/tui/backend"
import { TuiThreadCommand } from "./cmd/tui/thread"
import { UninstallCommand } from "./cmd/uninstall"
import { UpgradeCommand } from "./cmd/upgrade"
import { fatal } from "./bootstrap/fatal"
import { init } from "./bootstrap/env"
import { migrate } from "./bootstrap/migrate"
import { FormatError } from "./error"
import { UI } from "./ui"
import { Installation } from "../installation"
import { Log } from "../util/log"
import { DiagnosticLog } from "../debug/diagnostic-log"
import { isHarmlessEffectInterrupt } from "../effect/interrupt"

const cmds = [
  AcpCommand,
  AuditCommand,
  ReplayCommand,
  McpCommand,
  TuiBackendCommand,
  TuiThreadCommand,
  AttachCommand,
  RunCommand,
  GenerateCommand,
  DebugCommand,
  DoctorCommand,
  TraceCommand,
  CompareCommand,
  RollbackCommand,
  BranchCommand,
  ConsoleCommand,
  ProvidersCommand,
  AgentCommand,
  UpgradeCommand,
  UninstallCommand,
  ServeCommand,
  RestartCommand,
  ModelsCommand,
  StatsCommand,
  ExportCommand,
  ImportCommand,
  IndexCommand,
  GithubCommand,
  GraphCommand,
  RiskCommand,
  DreGraphCommand,
  PrCommand,
  InitCommand,
  ReleaseCommand,
  SessionCommand,
  DbCommand,
  MemoryCommand,
  DesignCheckCommand,
  ContextCommand,
]

let forcedExitTimer: ReturnType<typeof setTimeout> | undefined
let hooksInstalled = false

function onUnhandledRejection(err: unknown) {
  if (isHarmlessEffectInterrupt(err)) return
  DiagnosticLog.recordProcess("cli.unhandledRejection", { error: err })
  Log.Default.error("rejection", {
    e: err instanceof Error ? err.message : err,
  })
  process.exitCode = 1
}

function onUncaughtException(err: Error) {
  if (isHarmlessEffectInterrupt(err)) return
  DiagnosticLog.recordProcess("cli.uncaughtException", { error: err })
  Log.Default.error("exception", {
    e: err instanceof Error ? err.message : err,
  })
  // Process state is unreliable after uncaught exception — exit after flushing
  setTimeout(() => process.exit(1), 100).unref()
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

export function hooks() {
  if (hooksInstalled) return
  hooksInstalled = true
  process.on("unhandledRejection", onUnhandledRejection)
  process.on("uncaughtException", onUncaughtException)
}

export function cli(argv = hideBin(process.argv)) {
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
      await init(opts)
      await migrate()
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
  const argv = hideBin(process.argv)
  if (argv.includes("--uninstall") || argv.includes("-uninstall")) {
    const cmd = cli(["uninstall"])
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
    }
    return
  }
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
    // Some subprocesses don't react properly to SIGTERM and similar signals.
    // Most notably, some docker-container-based MCP servers don't handle such signals unless
    // run using `docker run --init`.
    // Allow a brief window for async cleanup (DB WAL flush, MCP disconnect)
    // before forcing exit to avoid hanging subprocesses.
    scheduleForcedExit()
  }
}
