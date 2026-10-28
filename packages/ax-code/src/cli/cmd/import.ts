import { EOL } from "os"
import path from "path"
import type { Argv } from "yargs"
import { CompatibilityImport } from "../../import/compatibility"
import { ClaudeSessions } from "../../import/claude-sessions"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { ImportCommand as StorageImportCommand } from "./storage/import"

export function formatCompatibilityImportReport(report: CompatibilityImport.Report) {
  const lines = [
    `Import ${report.source}: ${report.dryRun ? "dry-run" : "written"}`,
    `Candidates: ${report.total}, copy: ${report.copy}, skipped: ${report.skipped}`,
  ]
  for (const item of report.candidates) {
    const warning = item.warnings?.length ? ` warnings=${item.warnings.join(",")}` : ""
    const reason = item.reason ? ` reason=${item.reason}` : ""
    lines.push(`  ${item.action} ${item.kind} ${item.sourcePath} -> ${item.targetPath}${reason}${warning}`)
  }
  return lines.join(EOL).concat(EOL)
}

export function formatClaudeSessionsReport(report: ClaudeSessions.Report) {
  const lines = [
    `Import claude sessions: ${report.dryRun ? "dry-run" : "written"}`,
    `Project: ${report.directory}`,
    `Transcripts: ${report.transcripts.length}`,
  ]
  if (report.missing) lines.push(`  no transcripts found under ${report.projectDirectory}`)
  for (const transcript of report.transcripts) {
    lines.push(`  ${transcript.name} (${transcript.summary.length} chars) <- ${transcript.sourcePath}`)
  }
  return lines.join(EOL).concat(EOL)
}

export const ImportSessionsCommand = cmd({
  command: "sessions",
  describe: "import Claude Code session history as summary sessions (dry-run by default)",
  builder: (yargs: Argv) =>
    yargs
      .option("from", {
        type: "string",
        describe: "source agent history to import",
        choices: ["claude"] as const,
        default: "claude" as const,
      })
      .option("user", {
        type: "boolean",
        describe:
          "read ~/.claude/projects transcripts for the current project; nothing outside the project is read without this flag",
      })
      .option("write", {
        type: "boolean",
        describe: "create one AX Code session per transcript; dry-run is the default",
      })
      .option("root", {
        type: "string",
        describe: "override the ~/.claude/projects root (primarily for tests)",
      })
      .option("json", {
        type: "boolean",
        describe: "output machine-readable JSON",
      }),
  async handler(args) {
    const directory = process.cwd()
    const root = args.root ?? ClaudeSessions.defaultRoot()
    const projectDirectory = ClaudeSessions.projectDirectory({ root, projectPath: directory })

    await bootstrap(directory, async () => {
      const report = await ClaudeSessions.run({
        projectPath: directory,
        projectDirectory,
        write: args.write === true,
        createSession: args.write
          ? async (transcript) => {
              const { Session } = await import("../../session")
              const { createUserMessage } = await import("../../session/prompt/prompt-user-message")
              const session = await Session.create({ title: `Claude import: ${transcript.name}` })
              await createUserMessage({
                sessionID: session.id,
                agentRouting: "preserve",
                parts: [{ type: "text", text: transcript.summary }],
              })
            }
          : undefined,
      })
      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + EOL)
        return
      }
      process.stdout.write(formatClaudeSessionsReport(report))
    })
  },
})

export const ImportCommand = cmd({
  // `[file]`, not `<file>`: a required parent positional fails yargs'
  // validation before the `sessions` subcommand can run.
  command: "import [file]",
  describe: "import session data, or dry-run import opencode/claude/codex/cursor/windsurf compatibility files",
  builder: (yargs: Argv) =>
    yargs
      .command(ImportSessionsCommand)
      .positional("file", {
        describe: "path to JSON file, or one of: opencode, claude, codex, cursor, windsurf",
        type: "string",
      })
      .option("write", {
        type: "boolean",
        describe: "write compatibility import candidates; dry-run is the default",
      })
      .option("user", {
        type: "boolean",
        describe:
          "also read user-level files (~/.claude.json, ~/.codex/config.toml). Nothing outside the project is read without this flag. Codex config.toml MCP tables are reported but not imported (no TOML parser).",
      })
      .option("json", {
        type: "boolean",
        describe: "output machine-readable JSON for compatibility imports",
      }),
  async handler(args) {
    if (!args.file) {
      UI.error("Missing required argument: file")
      process.exitCode = 1
      return
    }
    const source = CompatibilityImport.Source.safeParse(args.file)
    if (!source.success) {
      await StorageImportCommand.handler?.(args as never)
      return
    }

    await bootstrap(process.cwd(), async () => {
      const report = await CompatibilityImport.run({
        source: source.data,
        directory: process.cwd(),
        write: args.write === true,
        user: args.user === true,
      })
      if (args.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + EOL)
        return
      }
      process.stdout.write(formatCompatibilityImportReport(report))
    })
  },
})
