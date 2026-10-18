import { NamedError } from "@ax-code/util/error"
import { hideBin } from "yargs/helpers"
import { AskCommand } from "./cmd/ask"
import { AcpCommand } from "./cmd/acp"
import { AuditCommand } from "./cmd/audit"
import { AgentCommand } from "./cmd/agent"
import { ConsoleCommand } from "./cmd/account"
import { AttachCommand } from "./tui/attach"
import { ContextCommand } from "./cmd/context"
import { DbCommand } from "./cmd/db"
import { SnapshotCommand } from "./cmd/snapshot"
import { DebugCommand } from "./cmd/debug"
import { DesignCheckCommand } from "./cmd/design-check"
import { DoctorCommand } from "./cmd/doctor"
import { CapabilityCommand } from "./cmd/capability"
import { GenerateCommand } from "./cmd/generate"
import { GithubCommand } from "./cmd/github"
import { GraphCommand } from "./cmd/graph"
import { HeadlessRunCommand } from "./cmd/headless-run"
import { RiskCommand } from "./cmd/risk"
import { RunReportCommand } from "./cmd/run-report"
import { IndexCommand } from "./cmd/index-graph"
import { InitCommand } from "./cmd/init"
import { LoginCommand } from "./cmd/login"
import { LogoutCommand } from "./cmd/logout"
import { McpCommand } from "./cmd/mcp"
import { MemoryCommand } from "./cmd/memory"
import { WikiCommand } from "./cmd/wiki"
import { ModelsCommand } from "./cmd/models"
import { ReleaseCommand } from "./cmd/release"
import { ReleaseNotesCommand } from "./cmd/release-notes"
import { ProvidersCommand } from "./cmd/providers"
import { RunCommand } from "./cmd/run"
import {
  cliFailureShowsFullHelp,
  commandTokenFromArgv,
  isCliUsageFailureMessage,
  runArgvUsesEventStream,
  runUsageFailureHint,
} from "./cmd/run-usage"
import { buildRunEarlyErrorEvent } from "./cmd/run-output"
import { writeJsonUsageError } from "./cmd/json-output"
import { ServeCommand } from "./cmd/serve"
import { RuntimeCommand } from "./cmd/runtime"
import { SessionCommand } from "./cmd/session"
import { SkillCommand } from "./cmd/skill"
import { StatsCommand } from "./cmd/stats"
import { TuiBackendCommand } from "./tui/backend"
import { TuiThreadCommand } from "./tui/thread"
import { UninstallCommand } from "./cmd/uninstall"
import { UpgradeCommand } from "./cmd/upgrade"
import { WatchCommand } from "./cmd/watch"
import { WebUiCommand } from "./cmd/webui"
import { WorkflowCommand } from "./cmd/workflow"
import { TaskCommand } from "./cmd/task"
import { ScheduleCommand } from "./cmd/schedule"
import { GoalCommand } from "./cmd/goal-impl"
import { fatal } from "./bootstrap/fatal"
import { setKnownCommands } from "./tui/project-arg"
import { ensureWindowsUtf8Console } from "./bootstrap/windows-console"
import { UI } from "./ui"
import { Log } from "../util/log"
import { setAxCodeProcessTitle } from "../util/process-title"
import { clearForcedExitTimer } from "./boot-lifecycle"
import { createAxCodeCli, runAxCodeCli } from "./boot-shared"

export function commandName(command: { command?: string | readonly string[] }) {
  const signature = typeof command.command === "string" ? command.command : command.command?.[0]
  return signature?.split(" ")[0] ?? ""
}

// Registration and help use the same sections so new commands cannot drift.
export const commandSections = [
  {
    title: "Core:",
    commands: [RunCommand, AskCommand, AttachCommand, LoginCommand, LogoutCommand, ModelsCommand, ProvidersCommand],
  },
  {
    title: "Sessions & evidence:",
    commands: [
      SessionCommand,
      AuditCommand,
      StatsCommand,
      ContextCommand,
      RiskCommand,
      GraphCommand,
      RunReportCommand,
      GoalCommand,
    ],
  },
  {
    title: "Customize:",
    commands: [AgentCommand, SkillCommand, CapabilityCommand, MemoryCommand, WikiCommand, McpCommand],
  },
  {
    title: "Project:",
    commands: [InitCommand, IndexCommand, DesignCheckCommand, GithubCommand, WorkflowCommand, WatchCommand],
  },
  { title: "Servers & runtime:", commands: [ServeCommand, RuntimeCommand, AcpCommand] },
  {
    title: "Maintenance:",
    commands: [
      TaskCommand,
      ScheduleCommand,
      DbCommand,
      SnapshotCommand,
      DoctorCommand,
      DebugCommand,
      UpgradeCommand,
      UninstallCommand,
      ReleaseCommand,
      ReleaseNotesCommand,
    ],
  },
] as const

const cmds = [
  ...commandSections.flatMap((section) => [...section.commands]),
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

// yargs groups options only; regroup the rendered command rows by metadata.
const commandGroups: ReadonlyArray<readonly [string, readonly string[]]> = commandSections.map((section) => [
  section.title,
  [
    ...section.commands.map((command) => commandName(command)),
    ...(section.title === "Maintenance:" ? ["completion"] : []),
  ],
])

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

export { clearForcedExitTimer, FORCED_EXIT_GRACE_MS, hooks, scheduleForcedExit } from "./boot-lifecycle"

export function cli(argv = hideBin(process.argv)) {
  const { cli, rawArgv } = createAxCodeCli(argv, cmds)

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

  return cli
    .fail((msg, err) => {
      if (err && !(cli.parsed && cli.parsed.error)) throw err
      // Stream consumers (`run --format json|jsonl|ndjson`) get one
      // structured error line on stdout before any stderr prose, so a
      // yargs-level usage failure (e.g. a mistyped flag) is still machine-
      // parsable instead of stdout-silent.
      if (runArgvUsesEventStream(rawArgv) && msg) {
        process.stdout.write(JSON.stringify(buildRunEarlyErrorEvent("usage", msg)) + "\n")
      }
      const jsonUsageError = writeJsonUsageError(cli.parsed, msg)
      if (msg && !jsonUsageError) process.stderr.write(`${msg}\n`)
      if (isCliUsageFailureMessage(msg)) {
        const command = commandTokenFromArgv(rawArgv)
        const hint = runUsageFailureHint(msg, command)
        if (hint) process.stderr.write(`${hint}\n`)
        // Scripted `run` callers get the one-line error plus the hint only —
        // never the full help dump; every other command keeps the full help.
        // Usage-failure help goes to stderr so a mistyped command keeps stdout
        // empty (a scripted caller must not see 60 lines of help on stdout).
        if (!jsonUsageError && cliFailureShowsFullHelp(msg, command))
          cli.showHelp((text) => process.stderr.write(text + "\n"))
      }
      process.exit(1)
    })
    .strict()
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
      // Provider, Config, and MCP stay off the --help graph: this module
      // formats those domain errors, and it is only needed once parse throws.
      const { FormatError } = await import("./error")
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
  await runAxCodeCli(cli())
}
