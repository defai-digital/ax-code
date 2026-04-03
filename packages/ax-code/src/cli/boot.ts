import { NamedError } from "@ax-code/util/error"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { AcpCommand } from "./cmd/acp"
import { AgentCommand } from "./cmd/agent"
import { ConsoleCommand } from "./cmd/account"
import { AttachCommand } from "./cmd/tui/attach"
import { ContextCommand } from "./cmd/context"
import { DbCommand } from "./cmd/db"
import { DebugCommand } from "./cmd/debug"
import { DesignCheckCommand } from "./cmd/design-check"
import { DoctorCommand } from "./cmd/doctor"
import { ExportCommand } from "./cmd/export"
import { GenerateCommand } from "./cmd/generate"
import { GithubCommand } from "./cmd/github"
import { ImportCommand } from "./cmd/import"
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
import { TuiThreadCommand } from "./cmd/tui/thread"
import { UninstallCommand } from "./cmd/uninstall"
import { UpgradeCommand } from "./cmd/upgrade"
import { WebCommand } from "./cmd/web"
import { fatal } from "./bootstrap/fatal"
import { init } from "./bootstrap/env"
import { migrate } from "./bootstrap/migrate"
import { FormatError } from "./error"
import { UI } from "./ui"
import { Installation } from "../installation"
import { Log } from "../util/log"

const cmds = [
  AcpCommand,
  McpCommand,
  TuiThreadCommand,
  AttachCommand,
  RunCommand,
  GenerateCommand,
  DebugCommand,
  DoctorCommand,
  ConsoleCommand,
  ProvidersCommand,
  AgentCommand,
  UpgradeCommand,
  UninstallCommand,
  ServeCommand,
  RestartCommand,
  WebCommand,
  ModelsCommand,
  StatsCommand,
  ExportCommand,
  ImportCommand,
  GithubCommand,
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
  })

  process.on("uncaughtException", (err) => {
    Log.Default.error("exception", {
      e: err instanceof Error ? err.message : err,
    })
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
    // Explicitly exit to avoid any hanging subprocesses.
    process.exit()
  }
}
