import "../lsp-glue"
import "../dre-glue"
import { NamedError } from "@ax-code/util/error"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { AskCommand } from "./cmd/ask"
import { AcpCommand } from "./cmd/acp"
import { AuditCommand } from "./cmd/audit"
import { AgentCommand } from "./cmd/agent"
import { ConsoleCommand } from "./cmd/account"
import { AttachCommand } from "./tui/attach"
import { ContextCommand } from "./cmd/context"
import { DbCommand } from "./cmd/db"
import { DebugCommand } from "./cmd/debug"
import { DesignCheckCommand } from "./cmd/design-check"
import { DoctorCommand } from "./cmd/doctor"
import { CapabilityCommand } from "./cmd/capability"
import { GenerateCommand } from "./cmd/generate"
import { GithubCommand } from "./cmd/github"
import { GraphCommand } from "./cmd/graph"
import { HeadlessRunCommand } from "./cmd/headless-run"
import { RiskCommand } from "./cmd/risk"
import { DreGraphCommand } from "./cmd/dre-graph"
import { IndexCommand } from "./cmd/index-graph"
import { InitCommand } from "./cmd/init"
import { LoginCommand } from "./cmd/login"
import { LogoutCommand } from "./cmd/logout"
import { McpCommand } from "./cmd/mcp"
import { MemoryCommand } from "./cmd/memory"
import { WikiCommand } from "./cmd/wiki"
import { ModelsCommand } from "./cmd/models"
import { ReleaseCommand } from "./cmd/release"
import { ProvidersCommand } from "./cmd/providers"
import { RunCommand } from "./cmd/run"
import { ServeCommand } from "./cmd/serve"
import { RuntimeCommand } from "./cmd/runtime"
import { SessionCommand } from "./cmd/session"
import { SkillCommand } from "./cmd/skill"
import { StatsCommand } from "./cmd/stats"
import { TuiBackendCommand } from "./tui/backend"
import { TuiThreadCommand } from "./tui/thread"
import { UninstallCommand } from "./cmd/uninstall"
import { UpgradeCommand } from "./cmd/upgrade"
import { WebUiCommand } from "./cmd/webui"
import { WorkflowCommand } from "./cmd/workflow"
import { TaskCommand } from "./cmd/task"
import { ScheduleCommand } from "./cmd/schedule"
import { fatal } from "./bootstrap/fatal"
import { setKnownCommands } from "./tui/project-arg"
import { init } from "./bootstrap/env"
import { ensureWindowsUtf8Console } from "./bootstrap/windows-console"
import { migrate } from "./bootstrap/migrate"
import { cancelShellEnvLoad } from "../runtime/shell-env"
import { FormatError } from "./error"
import { UI } from "./ui"
import { Installation } from "../installation"
import { Log } from "../util/log"
import { setAxCodeProcessTitle } from "../util/process-title"
import { DiagnosticLog } from "../debug/diagnostic-log"
import { isHarmlessInterrupt } from "../util/harmless-interrupt"

const cmds = [
  // Core
  RunCommand,
  AskCommand,
  AttachCommand,
  LoginCommand,
  LogoutCommand,
  ModelsCommand,
  ProvidersCommand,
  // Sessions & evidence
  SessionCommand,
  AuditCommand,
  StatsCommand,
  ContextCommand,
  RiskCommand,
  GraphCommand,
  DreGraphCommand,
  // Customize
  AgentCommand,
  SkillCommand,
  CapabilityCommand,
  MemoryCommand,
  WikiCommand,
  McpCommand,
  // Project
  InitCommand,
  IndexCommand,
  DesignCheckCommand,
  GithubCommand,
  WorkflowCommand,
  // Servers & runtime
  ServeCommand,
  RuntimeCommand,
  AcpCommand,
  // Maintenance
  TaskCommand,
  ScheduleCommand,
  DbCommand,
  DoctorCommand,
  DebugCommand,
  UpgradeCommand,
  UninstallCommand,
  ReleaseCommand,
  // Hidden / internal commands (registered, never listed)
  TuiBackendCommand,
  TuiThreadCommand,
  HeadlessRunCommand,
  ConsoleCommand,
  GenerateCommand,
  WebUiCommand,
]

// Issue #414: names for the unknown-command error emitted by the default
// `[project]` command. Derived from the registered command table so the list
// stays in sync as commands are added or removed; hidden/internal commands
// (describe: false) and the default command itself are excluded. "completion"
// is registered by yargs rather than the table, so it is added explicitly.
setKnownCommands([
  "completion",
  ...cmds.flatMap((command) => {
    const first = Array.isArray(command.command) ? command.command[0] : command.command
    const name = first.split(" ")[0]
    const hidden = (command as { describe?: unknown }).describe === false
    if (name === "$0" || hidden) return []
    return [name]
  }),
])

// Top-level help sections (ADR-132). yargs .group() only groups options,
// never commands, so the root help text is regrouped after rendering.
// Command names must match the first token of a registered command string;
// anything visible but unlisted (including the default `$0` command) falls
// back into the plain "Commands:" section.
const commandGroups: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Core:", ["run", "ask", "attach", "login", "logout", "models", "providers"]],
  ["Sessions & evidence:", ["session", "audit", "stats", "context", "risk", "graph", "dre-graph"]],
  ["Customize:", ["agent", "skill", "capability", "memory", "wiki", "mcp"]],
  ["Project:", ["init", "index", "design-check", "github", "workflow"]],
  ["Servers & runtime:", ["serve", "runtime", "acp"]],
  ["Maintenance:", ["task", "schedule", "db", "doctor", "debug", "upgrade", "uninstall", "release", "completion"]],
]

type UsageCommand = [string, string, boolean, string[] | undefined, string | boolean | undefined]
type UsageLike = {
  help: () => string
  getCommands: () => UsageCommand[]
}

function renderUsageCommandRows(entries: UsageCommand[]): string[] {
  const labels = entries.map(([command]) => `  ax-code ${command.replace(/^\$0 ?/, "")}`)
  const width = Math.max(...labels.map((label) => label.length)) + 2
  return entries.map((entry, index) => {
    const hints = [entry[2] ? "[default]" : "", entry[3]?.length ? `[aliases: ${entry[3].join(", ")}]` : ""].filter(
      Boolean,
    )
    const describe = [entry[1], ...hints].filter(Boolean).join(" ")
    return describe ? labels[index]!.padEnd(width) + describe : labels[index]!
  })
}

function groupUsageCommandHelp(text: string, usage: UsageLike): string {
  const marker = "Commands:\n"
  const start = text.indexOf(marker)
  if (start === -1) return text
  const rest = text.slice(start + marker.length)
  const end = rest.indexOf("\n\n")
  if (end === -1) return text

  const commands = usage.getCommands()
  const byName = new Map<string, UsageCommand>(
    commands.map((command) => [command[0].split(" ")[0] ?? command[0], command]),
  )

  const grouped = new Set<string>()
  const sections: string[] = []
  for (const [group, names] of commandGroups) {
    const entries = names.flatMap((name) => {
      const entry = byName.get(name)
      return entry ? [entry] : []
    })
    if (entries.length === 0) continue
    for (const entry of entries) grouped.add(entry[0].split(" ")[0] ?? entry[0])
    sections.push([group, ...renderUsageCommandRows(entries)].join("\n"))
  }

  const leftovers = commands.filter((command) => !grouped.has(command[0].split(" ")[0] ?? command[0]))
  const lines: string[] = ["Commands:", ...renderUsageCommandRows(leftovers)]
  for (const section of sections) lines.push("", section)
  return text.slice(0, start) + lines.join("\n") + rest.slice(end)
}

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
  // Process state is unreliable after uncaught exception; keep this timer
  // referenced so diagnostic logs have a chance to flush before exit.
  setTimeout(() => process.exit(1), 100)
}

export function clearForcedExitTimer() {
  if (!forcedExitTimer) return
  clearTimeout(forcedExitTimer)
  forcedExitTimer = undefined
}

/** Grace period for WAL checkpoint / log flush before forced process exit (STAB-13). */
export const FORCED_EXIT_GRACE_MS = 2_000

export function scheduleForcedExit(exit: () => void = () => process.exit()) {
  clearForcedExitTimer()
  forcedExitTimer = setTimeout(() => {
    forcedExitTimer = undefined
    exit()
  }, FORCED_EXIT_GRACE_MS)
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
      describe: "isolation sandbox mode (default: full-access / sandbox off)",
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
      // This avoids loading the SQLite module for --help, --version, etc.
      const skipMigration =
        rawArgv.some((a) => a === "--help" || a === "-h" || a === "--version" || a === "-v") ||
        rawArgv[0] === "completion"
      if (!skipMigration) await migrate()
    })
    .usage(
      "\n" +
        UI.logo() +
        '\n\n  Interactive TUI:  ax-code\n  Headless task:   ax-code run --model <provider/model> -- "prompt"',
    )
    .completion("completion", "generate shell completion script")

  for (const cmd of cmds) cli = cli.command(cmd as never)

  {
    // Wrap the root usage renderer so `--help` lists commands under the named
    // sections above; subcommand help keeps yargs's own rendering.
    const internal = (cli as unknown as { getInternalMethods(): unknown }).getInternalMethods() as {
      getContext: () => { commands: string[] }
      getUsageInstance: () => UsageLike
    }
    const usage = internal.getUsageInstance()
    const originalHelp = usage.help.bind(usage)
    usage.help = () => {
      const text = originalHelp()
      if (internal.getContext().commands.length > 0) return text
      return groupUsageCommandHelp(text, usage)
    }
  }

  cli = cli
    .fail((msg, err) => {
      if (err) throw err
      if (msg) process.stderr.write(`${msg}\n`)
      if (
        msg?.startsWith("Unknown argument") ||
        msg?.startsWith("Not enough non-option arguments") ||
        msg?.startsWith("Invalid values:") ||
        msg?.startsWith("Missing required argument")
      ) {
        cli.showHelp("log")
      }
      process.exit(1)
    })
    .strict()

  return cli
}

export async function run() {
  clearForcedExitTimer()
  setAxCodeProcessTitle()
  // Must happen before any TUI output: the native renderer writes raw UTF-8
  // bytes to the console handle, which mojibake under legacy Windows code
  // pages (#307, #315, #338).
  ensureWindowsUtf8Console()
  const argv = hideBin(process.argv)
  // Match only the command position, not any token anywhere: `ax-code run -- --uninstall`
  // must not be hijacked into running the (destructive) uninstall flow.
  if (argv[0] === "--uninstall" || argv[0] === "-uninstall") {
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
    // Stop the background shell-env child so a finished one-shot command can
    // exit immediately instead of waiting for the login shell to finish.
    await cancelShellEnvLoad()
    // Some subprocesses don't react properly to SIGTERM and similar signals.
    // Most notably, some docker-container-based MCP servers don't handle such signals unless
    // run using `docker run --init`.
    // Allow a brief window for async cleanup (DB WAL flush, MCP disconnect)
    // before forcing exit to avoid hanging subprocesses.
    scheduleForcedExit()
  }
}
