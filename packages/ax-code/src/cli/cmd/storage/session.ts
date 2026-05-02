import type { Argv } from "yargs"
import { cmd } from "../cmd"
import { Session } from "../../../session"
import { SessionID } from "../../../session/schema"
import { bootstrap } from "../../bootstrap"
import { UI } from "../../ui"
import { Locale } from "../../../util/locale"
import { Flag } from "../../../flag/flag"
import { Filesystem } from "../../../util/filesystem"
import { Process } from "../../../util/process"
import { EOL } from "os"
import path from "path"
import { which } from "../../../util/which"
import { Instance } from "../../../project/instance"
import { Global } from "../../../global"
import { EventQuery } from "../../../replay/query"
import { buildTransfer } from "./transfer"
import { ProjectIdentity } from "../../../project/project-identity"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = which("less")
  if (lessOnPath) {
    if (Filesystem.stat(lessOnPath)?.size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.AX_CODE_GIT_BASH_PATH) {
    const less = path.join(Flag.AX_CODE_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  const git = which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) =>
    yargs
      .command(SessionListCommand)
      .command(SessionDeleteCommand)
      .command(SessionPruneCommand)
      .command(SessionBackupProjectCommand)
      .command(SessionClearProjectCommand)
      .command(SessionProjectStatusCommand)
      .demandCommand(),
  async handler() {},
})

function cleanupStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

type DuplicateProjectIdentity = {
  id: string
  sessionCount: number
  current: boolean
}

function formatDuplicateProjectIdentities(identities: DuplicateProjectIdentity[]) {
  return identities.map((project) => `${project.id}${project.current ? " (current)" : ""}: ${project.sessionCount}`).join(", ")
}

function printWarning(message: string) {
  UI.println(`Warning: ${message}`)
}

async function backupSessions(input: {
  sessions: Session.Info[]
  deletionRoots: Session.Info[]
  duplicateProjectIdentities: DuplicateProjectIdentity[]
  backupDir?: string
}) {
  const backupDir = input.backupDir ?? path.join(Global.Path.data, "cleanup-backups")
  const backupPath = path.join(backupDir, `session-project-${cleanupStamp()}.json`)
  const transfers = []
  for (const session of input.sessions) {
    const messages = await Session.messages({ sessionID: session.id })
    transfers.push(
      buildTransfer({
        info: session,
        messages: messages.map((msg) => ({
          info: msg.info,
          parts: msg.parts,
        })),
        events: EventQuery.bySessionLog(session.id),
      }),
    )
  }
  await Filesystem.writeJson(backupPath, {
    type: "ax-code.project-session-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: "current-project-id-only",
    worktree: Instance.worktree,
    directory: Instance.directory,
    projectID: Instance.project.id,
    deletionPlan: {
      sessionCount: input.sessions.length,
      rootSessionCount: input.deletionRoots.length,
      rootSessionIDs: input.deletionRoots.map((session) => session.id),
    },
    duplicateProjectIdentities: input.duplicateProjectIdentities,
    restoreHint:
      "This backup is a safety archive for project cleanup. To restore, choose the target project first, then import individual entries from sessions[].",
    count: input.sessions.length,
    sessions: transfers,
  })
  return backupPath
}

export function sessionProjectStatusPayload(input: {
  projectID: string
  worktree: string
  directory: string
  sessions: Session.Info[]
  duplicateProjectIdentities?: Array<{ id: string; sessionCount: number; current: boolean }>
}) {
  const roots = input.sessions.filter((session) => !session.parentID).length
  const children = input.sessions.length - roots
  return {
    projectID: input.projectID,
    worktree: input.worktree,
    directory: input.directory,
    sessions: input.sessions.length,
    rootSessions: roots,
    childSessions: children,
    latest: input.sessions
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .slice(0, 5)
      .map((session) => ({
        id: session.id,
        title: session.title,
        directory: session.directory,
        updated: session.time.updated,
      })),
    duplicateProjectIdentities: input.duplicateProjectIdentities ?? [],
  }
}

async function getDuplicateProjectIdentities() {
  return ProjectIdentity.listDuplicateWorktreeIdentities({
    worktree: Instance.worktree,
    currentProjectID: Instance.project.id,
  })
}

export const SessionClearProjectCommand = cmd({
  command: "clear-project",
  describe: "delete all sessions for the current project after writing a backup",
  builder: (yargs: Argv) => {
    return yargs
      .option("yes", {
        describe: "confirm deletion",
        type: "boolean",
      })
      .option("backup-dir", {
        describe: "directory for the JSON backup (default: ax-code cleanup-backups data directory)",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = [...Session.list()]
      const duplicateProjectIdentities = await getDuplicateProjectIdentities()
      const deletionRoots = sessions.filter((session) => !session.parentID)

      if (sessions.length === 0) {
        UI.println(`No sessions found for current project: ${Instance.worktree}`)
        if (duplicateProjectIdentities.length > 0) {
          printWarning(
            `This worktree also has duplicate project identities: ${formatDuplicateProjectIdentities(duplicateProjectIdentities)}`,
          )
        }
        return
      }

      const backupPath = await backupSessions({
        sessions,
        deletionRoots,
        duplicateProjectIdentities,
        backupDir: args.backupDir,
      })
      UI.println(`Backed up ${sessions.length} session${sessions.length === 1 ? "" : "s"} to ${backupPath}`)
      UI.println(`Backup scope: current project id only (${Instance.project.id})`)
      if (duplicateProjectIdentities.length > 0) {
        printWarning(
          `Only sessions for the current project id will be deleted. Duplicate identities remain: ${formatDuplicateProjectIdentities(
            duplicateProjectIdentities,
          )}`,
        )
      }

      if (!args.yes) {
        UI.println("Dry run only. Re-run with --yes to delete these sessions.")
        return
      }

      for (const session of deletionRoots.length > 0 ? deletionRoots : sessions) {
        await Session.remove(session.id)
      }

      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD +
          `Deleted ${sessions.length} session${sessions.length === 1 ? "" : "s"} for ${Instance.worktree}` +
          UI.Style.TEXT_NORMAL,
      )
    })
  },
})

export const SessionBackupProjectCommand = cmd({
  command: "backup-project",
  describe: "back up all sessions for the current project without deleting them",
  builder: (yargs: Argv) => {
    return yargs.option("backup-dir", {
      describe: "directory for the JSON backup (default: ax-code cleanup-backups data directory)",
      type: "string",
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = [...Session.list()]
      const duplicateProjectIdentities = await getDuplicateProjectIdentities()
      const deletionRoots = sessions.filter((session) => !session.parentID)

      if (sessions.length === 0) {
        UI.println(`No sessions found for current project: ${Instance.worktree}`)
        if (duplicateProjectIdentities.length > 0) {
          printWarning(
            `This worktree also has duplicate project identities: ${formatDuplicateProjectIdentities(duplicateProjectIdentities)}`,
          )
        }
        return
      }

      const backupPath = await backupSessions({
        sessions,
        deletionRoots,
        duplicateProjectIdentities,
        backupDir: args.backupDir,
      })
      UI.println(`Backed up ${sessions.length} session${sessions.length === 1 ? "" : "s"} to ${backupPath}`)
      UI.println(`Backup scope: current project id only (${Instance.project.id})`)
      if (duplicateProjectIdentities.length > 0) {
        printWarning(`Duplicate project identities detected: ${formatDuplicateProjectIdentities(duplicateProjectIdentities)}`)
      }
    })
  },
})

export const SessionProjectStatusCommand = cmd({
  command: "project-status",
  describe: "show current project session storage status",
  builder: (yargs: Argv) => {
    return yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["text", "json"],
      default: "text",
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = [...Session.list()]
      const payload = sessionProjectStatusPayload({
        projectID: Instance.project.id,
        worktree: Instance.worktree,
        directory: Instance.directory,
        sessions,
        duplicateProjectIdentities: await getDuplicateProjectIdentities(),
      })

      if (args.format === "json") {
        UI.println(JSON.stringify(payload, null, 2))
        return
      }

      UI.println(`Project: ${payload.projectID}`)
      UI.println(`Worktree: ${payload.worktree}`)
      UI.println(`Directory: ${payload.directory}`)
      UI.println(`Sessions: ${payload.sessions} (${payload.rootSessions} root, ${payload.childSessions} child)`)
      if (payload.duplicateProjectIdentities.length > 0) {
        printWarning(
          `Duplicate project identities detected: ${formatDuplicateProjectIdentities(payload.duplicateProjectIdentities)}`,
        )
      }
      if (payload.latest.length > 0) {
        UI.println("Latest:")
        for (const session of payload.latest) {
          UI.println(`  ${session.id}  ${Locale.truncate(session.title, 60)}`)
        }
      }
    })
  },
})

export const SessionPruneCommand = cmd({
  command: "prune",
  describe: "delete sessions older than N days (default: config session.ttl_days or 30)",
  builder: (yargs: Argv) => {
    return yargs.option("days", {
      describe: "delete sessions older than this many days (default: config session.ttl_days or 30)",
      type: "number",
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const { Config } = await import("../../../config/config")
      const cfg = await Config.get()
      const days = args.days ?? cfg.session?.ttl_days ?? 30
      const pruned = await Session.pruneExpired(days)

      if (pruned === 0) {
        UI.println(`No sessions older than ${days} days`)
        return
      }

      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD +
          `Pruned ${pruned} session${pruned === 1 ? "" : "s"} older than ${days} days` +
          UI.Style.TEXT_NORMAL,
      )
    })
  },
})

export const SessionDeleteCommand = cmd({
  command: "delete <sessionID>",
  describe: "delete a session",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionID = SessionID.make(args.sessionID)
      try {
        await Session.get(sessionID)
      } catch {
        UI.error(`Session not found: ${args.sessionID}`)
        process.exit(1)
      }
      await Session.remove(sessionID)
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
    })
  },
})

export const SessionListCommand = cmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs: Argv) => {
    return yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = [...Session.list({ roots: true, limit: args.maxCount })]

      if (sessions.length === 0) {
        return
      }

      let output: string
      if (args.format === "json") {
        output = formatSessionJSON(sessions)
      } else {
        output = formatSessionTable(sessions)
      }

      const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

      if (shouldPaginate) {
        const proc = Process.spawn(pagerCmd(), {
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        if (!proc.stdin) {
          console.log(output)
          return
        }

        const kill = () => {
          try {
            proc.kill()
          } catch {}
        }
        process.on("SIGINT", kill)
        process.on("SIGTERM", kill)
        try {
          proc.stdin.write(output)
          proc.stdin.end()
          await proc.exited
        } finally {
          process.off("SIGINT", kill)
          process.off("SIGTERM", kill)
        }
      } else {
        console.log(output)
      }
    })
  },
})

function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}
