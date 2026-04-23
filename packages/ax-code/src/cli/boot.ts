import { NamedError } from "@ax-code/util/error"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
// Eager imports: only the default TUI command and run (used 99% of the time)
import { TuiThreadCommand } from "./cmd/tui/thread"
import { RunCommand } from "./cmd/run"
import { fatal } from "./bootstrap/fatal"
import { init } from "./bootstrap/env"
import { migrate } from "./bootstrap/migrate"
import { FormatError } from "./error"
import { UI } from "./ui"
import { Installation } from "../installation"
import { Log } from "../util/log"
import { DiagnosticLog } from "../debug/diagnostic-log"
import { isHarmlessEffectInterrupt } from "../effect/interrupt"

// Lazy-loaded commands: only imported when the specific command is invoked.
// This saves ~100-200ms on startup by deferring 35 module loads.
const lazy = (load: () => Promise<{ default: any }>) => {
  let cached: any
  return {
    get command() { return cached?.command },
    get describe() { return cached?.describe },
    get aliases() { return cached?.aliases },
    get builder() { return cached?.builder },
    async handler(args: any) {
      if (!cached) cached = (await load()).default
      return cached.handler(args)
    },
  }
}

const eagerCmds = [TuiThreadCommand, RunCommand]

const lazyCmds = [
  { command: "completion", describe: "generate shell completion script" },
  { command: "acp", describe: "start ACP (Agent Client Protocol) server", handler: async (a: any) => (await import("./cmd/acp")).AcpCommand.handler(a) },
  { command: "audit", describe: "audit trail tools", handler: async (a: any) => (await import("./cmd/audit")).AuditCommand.handler(a) },
  { command: "replay <sessionID>", describe: "inspect a recorded session event log", handler: async (a: any) => (await import("./cmd/replay")).ReplayCommand.handler(a) },
  { command: "mcp", describe: "manage MCP (Model Context Protocol) servers", handler: async (a: any) => (await import("./cmd/mcp")).McpCommand.handler(a), builder: (y: any) => import("./cmd/mcp").then(m => m.McpCommand.builder?.(y) ?? y) },
  { command: "attach <url>", describe: "attach to a running ax-code server", handler: async (a: any) => (await import("./cmd/tui/attach")).AttachCommand.handler(a) },
  { command: "debug", describe: "debugging and troubleshooting tools", handler: async (a: any) => (await import("./cmd/debug")).DebugCommand.handler(a), builder: (y: any) => import("./cmd/debug").then(m => m.DebugCommand.builder?.(y) ?? y) },
  { command: "doctor", describe: "check system health and diagnose issues", handler: async (a: any) => (await import("./cmd/doctor")).DoctorCommand.handler(a) },
  { command: "trace [sessionID]", describe: "analyze execution trace from structured logs", handler: async (a: any) => (await import("./cmd/trace")).TraceCommand.handler(a) },
  { command: "compare <session1> <session2>", describe: "compare two session executions", handler: async (a: any) => (await import("./cmd/compare")).CompareCommand.handler(a) },
  { command: "rollback <sessionID>", describe: "rollback file changes from a session", handler: async (a: any) => (await import("./cmd/rollback")).RollbackCommand.handler(a) },
  { command: "branch <sessionID>", describe: "create an execution branch from a session", handler: async (a: any) => (await import("./cmd/branch")).BranchCommand.handler(a) },
  { command: "providers", describe: "manage AI providers and credentials", aliases: ["auth"], handler: async (a: any) => (await import("./cmd/providers")).ProvidersCommand.handler(a), builder: (y: any) => import("./cmd/providers").then(m => m.ProvidersCommand.builder?.(y) ?? y) },
  { command: "agent", describe: "manage agents", handler: async (a: any) => (await import("./cmd/agent")).AgentCommand.handler(a), builder: (y: any) => import("./cmd/agent").then(m => m.AgentCommand.builder?.(y) ?? y) },
  { command: "upgrade [target]", describe: "upgrade ax-code to the latest or a specific version", handler: async (a: any) => (await import("./cmd/upgrade")).UpgradeCommand.handler(a) },
  { command: "uninstall", describe: "uninstall ax-code and remove all related files", handler: async (a: any) => (await import("./cmd/uninstall")).UninstallCommand.handler(a) },
  { command: "serve", describe: "starts a headless ax-code server", handler: async (a: any) => (await import("./cmd/serve")).ServeCommand.handler(a) },
  { command: "restart", describe: "restart the running ax-code server instance", handler: async (a: any) => (await import("./cmd/restart")).RestartCommand.handler(a) },
  { command: "models [provider]", describe: "list all available models", handler: async (a: any) => (await import("./cmd/models")).ModelsCommand.handler(a) },
  { command: "stats", describe: "show token usage statistics", handler: async (a: any) => (await import("./cmd/stats")).StatsCommand.handler(a) },
  { command: "export [sessionID]", describe: "export session data as JSON", handler: async (a: any) => (await import("./cmd/export")).ExportCommand.handler(a) },
  { command: "import <file>", describe: "import session data from JSON file or URL", handler: async (a: any) => (await import("./cmd/import")).ImportCommand.handler(a) },
  { command: "index", describe: "populate the Code Intelligence graph for this project", handler: async (a: any) => (await import("./cmd/index-graph")).IndexCommand.handler(a) },
  { command: "github", describe: "manage GitHub agent", handler: async (a: any) => (await import("./cmd/github")).GithubCommand.handler(a), builder: (y: any) => import("./cmd/github").then(m => m.GithubCommand.builder?.(y) ?? y) },
  { command: "graph [sessionID]", describe: "visualize session execution as a structured graph", handler: async (a: any) => (await import("./cmd/graph")).GraphCommand.handler(a) },
  { command: "risk <sessionID>", describe: "inspect explainable risk detail for a session", handler: async (a: any) => (await import("./cmd/risk")).RiskCommand.handler(a) },
  { command: "dre-graph [sessionID]", describe: "open a browser DRE graph view", handler: async (a: any) => (await import("./cmd/dre-graph")).DreGraphCommand.handler(a) },
  { command: "pr <number>", describe: "fetch and checkout a GitHub PR branch, then run ax-code", handler: async (a: any) => (await import("./cmd/pr")).PrCommand.handler(a) },
  { command: "init", describe: "Generate AGENTS.md project context for AI comprehension", handler: async (a: any) => (await import("./cmd/init")).InitCommand.handler(a) },
  { command: "session", describe: "manage sessions", handler: async (a: any) => (await import("./cmd/session")).SessionCommand.handler(a), builder: (y: any) => import("./cmd/session").then(m => m.SessionCommand.builder?.(y) ?? y) },
  { command: "generate", describe: "generate code from templates", handler: async (a: any) => (await import("./cmd/generate")).GenerateCommand.handler(a), builder: (y: any) => import("./cmd/generate").then(m => m.GenerateCommand.builder?.(y) ?? y) },
  { command: "account", describe: "manage account", handler: async (a: any) => (await import("./cmd/account")).ConsoleCommand.handler(a) },
  { command: "context", describe: "manage project context", handler: async (a: any) => (await import("./cmd/context")).ContextCommand.handler(a), builder: (y: any) => import("./cmd/context").then(m => m.ContextCommand.builder?.(y) ?? y) },
  { command: "memory", describe: "manage memory", handler: async (a: any) => (await import("./cmd/memory")).MemoryCommand.handler(a), builder: (y: any) => import("./cmd/memory").then(m => m.MemoryCommand.builder?.(y) ?? y) },
  { command: "release", describe: "manage releases", handler: async (a: any) => (await import("./cmd/release")).ReleaseCommand.handler(a), builder: (y: any) => import("./cmd/release").then(m => m.ReleaseCommand.builder?.(y) ?? y) },
  { command: "design-check", describe: "run design checks", handler: async (a: any) => (await import("./cmd/design-check")).DesignCheckCommand.handler(a) },
  { command: "db", describe: "database tools", handler: async (a: any) => (await import("./cmd/db")).DbCommand.handler(a), builder: (y: any) => import("./cmd/db").then(m => m.DbCommand.builder?.(y) ?? y) },
]

const cmds = [...eagerCmds, ...lazyCmds]

export function hooks() {
  process.on("unhandledRejection", (err) => {
    if (isHarmlessEffectInterrupt(err)) return
    DiagnosticLog.recordProcess("cli.unhandledRejection", { error: err })
    Log.Default.error("rejection", {
      e: err instanceof Error ? err.message : err,
    })
    process.exitCode = 1
  })

  process.on("uncaughtException", (err) => {
    if (isHarmlessEffectInterrupt(err)) return
    DiagnosticLog.recordProcess("cli.uncaughtException", { error: err })
    Log.Default.error("exception", {
      e: err instanceof Error ? err.message : err,
    })
    // Process state is unreliable after uncaught exception — exit after flushing
    setTimeout(() => process.exit(1), 100).unref()
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
    setTimeout(() => process.exit(), 500).unref()
  }
}
