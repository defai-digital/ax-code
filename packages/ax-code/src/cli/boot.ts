import { NamedError } from "@ax-code/util/error"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { AcpCommand } from "./cmd/acp"
import { AuditCommand } from "./cmd/audit"
import { AutoSelectCommand } from "./cmd/auto-select"
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
import { DiffCommand } from "./cmd/diff"
import { RollbackCommand } from "./cmd/rollback"
import { RiskCommand } from "./cmd/risk"
import { BranchCommand } from "./cmd/branch"
import { ExportCommand } from "./cmd/export"
import { GenerateCommand } from "./cmd/generate"
import { GithubCommand } from "./cmd/github"
import { GraphCommand } from "./cmd/graph"
import { ImportCommand } from "./cmd/import"
import { IndexCommand } from "./cmd/index-graph"
import { InitCommand } from "./cmd/init"
import { McpCommand } from "./cmd/mcp"
import { MemoryCommand } from "./cmd/memory"
import { ModelsCommand } from "./cmd/models"
import { PrCommand } from "./cmd/pr"
import { ProvidersCommand } from "./cmd/providers"
import { RestartCommand } from "./cmd/restart"
import { RunCommand } from "./cmd/run"
import { ServeCommand } from "./cmd/serve"
import { SessionCommand } from "./cmd/session"
import { StatsCommand } from "./cmd/stats"
import { DreGraphCommand } from "./cmd/dre-graph"
import { TuiThreadCommand } from "./cmd/tui/thread"
import { UninstallCommand } from "./cmd/uninstall"
import { UpgradeCommand } from "./cmd/upgrade"
import { fatal } from "./bootstrap/fatal"
import { init } from "./bootstrap/env"
import { migrate } from "./bootstrap/migrate"
import { FormatError } from "./error"
import { UI } from "./ui"
import { Installation } from "../installation"
import { Instance } from "../project/instance"
import { Telemetry } from "../telemetry"
import { Log } from "../util/log"

type EndInput = {
  timeout: number
  later: typeof setTimeout
  exit: (code?: number) => never
  warn: (msg: string, extra?: Record<string, unknown>) => void
  stop: Array<() => Promise<unknown>>
}

export function createEnd(input: Partial<EndInput> = {}) {
  let task: Promise<void> | undefined
  return (code = process.exitCode ?? 0, reason = "shutdown") => {
    if (task) return task

    const later = input.later ?? setTimeout
    const exit = input.exit ?? process.exit
    const warn = input.warn ?? ((msg: string, extra?: Record<string, unknown>) => Log.Default.warn(msg, extra))
    const stop = input.stop ?? [() => Instance.disposeAll(), () => Telemetry.shutdown()]
    const timer = later(() => {
      warn("forcing process exit after cleanup timeout", { code, reason })
      exit(code)
    }, input.timeout ?? 5_000)

    if (typeof timer === "object" && "unref" in timer) timer.unref()

    task = Promise.allSettled(stop.map((fn) => fn())).then(() => undefined)
    return task
  }
}

const end = createEnd()

const cmds = [
  AcpCommand,
  AuditCommand,
  AutoSelectCommand,
  ReplayCommand,
  McpCommand,
  TuiThreadCommand,
  AttachCommand,
  RunCommand,
  GenerateCommand,
  DebugCommand,
  DoctorCommand,
  TraceCommand,
  CompareCommand,
  DiffCommand,
  RollbackCommand,
  RiskCommand,
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
  DreGraphCommand,
  ExportCommand,
  ImportCommand,
  IndexCommand,
  GithubCommand,
  GraphCommand,
  PrCommand,
  InitCommand,
  SessionCommand,
  DbCommand,
  MemoryCommand,
  DesignCheckCommand,
  ContextCommand,
]

export function hooks() {
  process.on("unhandledRejection", (err) => {
    Log.Default.error("rejection", {
      e: err instanceof Error ? err.message : err,
    })
    process.exitCode = 1
  })

  process.on("uncaughtException", (err) => {
    Log.Default.error("exception", {
      e: err instanceof Error ? err.message : err,
    })
    process.exitCode = 1
    void end(1, "uncaughtException")
  })
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
    await end(process.exitCode ?? 0, "run")
  }
}
