import z from "zod"
import { and, Database, eq } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import { Log } from "../util/log"
import { uniqueStrings } from "../util/string-list"
import { Flag } from "@/flag/flag"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { which } from "../util/which"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"
import { git as runGit } from "../util/git"
import { ProjectID } from "./schema"
import path from "path"
import { createHash } from "node:crypto"

export namespace Project {
  const log = Log.create({ service: "project" })

  export const Info = z
    .object({
      id: ProjectID.zod,
      worktree: z.string(),
      vcs: z.literal("git").optional(),
      name: z.string().optional(),
      icon: z
        .object({
          url: z.string().optional(),
          override: z.string().optional(),
          color: z.string().optional(),
        })
        .optional(),
      commands: z
        .object({
          start: z.string().optional().describe("Startup script to run when creating a new workspace (worktree)"),
        })
        .optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        initialized: z.number().optional(),
      }),
      sandboxes: z.array(z.string()),
    })
    .meta({
      ref: "Project",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define("project.updated", Info),
  }

  type Row = typeof ProjectTable.$inferSelect

  function parseRow(row: Row) {
    const icon =
      row.icon_url || row.icon_color
        ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined }
        : undefined
    const vcs = (() => {
      const next = Info.shape.vcs.safeParse(row.vcs ?? undefined)
      if (next.success) return next.data
      log.warn("invalid project vcs", { projectID: row.id })
    })()
    const sandboxes = (() => {
      const next = z.array(z.string()).safeParse(row.sandboxes)
      if (next.success) return uniqueStrings(next.data.map(normalizeSandboxDirectory))
      log.warn("invalid project sandboxes", { projectID: row.id })
      return []
    })()
    const commands = (() => {
      const next = Info.shape.commands.safeParse(row.commands ?? undefined)
      if (next.success) return next.data
      log.warn("invalid project commands", { projectID: row.id })
    })()
    const next = Info.safeParse({
      id: row.id,
      worktree: row.worktree,
      vcs,
      name: row.name ?? undefined,
      icon,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        initialized: row.time_initialized ?? undefined,
      },
      sandboxes,
      commands,
    })
    if (next.success) return next.data
    log.warn("invalid project row", {
      projectID: row.id,
      issue: next.error.issues.length,
    })
  }

  export function fromRow(row: Row): Info {
    const next = parseRow(row)
    if (next) return next
    throw new Error(`Invalid project row: ${row.id}`)
  }

  export function safe(row: Row) {
    return parseRow(row)
  }

  export const UpdateInput = z.object({
    projectID: ProjectID.zod,
    name: z.string().optional(),
    icon: Info.shape.icon.optional(),
    commands: Info.shape.commands.optional(),
  })
  export type UpdateInput = z.infer<typeof UpdateInput>

  function normalizeSandboxDirectory(directory: string) {
    try {
      return Filesystem.resolve(directory)
    } catch {
      return path.resolve(Filesystem.windowsPath(directory))
    }
  }

  function directoryProjectID(directory: string) {
    const normalized = path.resolve(directory)
    const hash = createHash("sha1").update(normalized).digest("hex")
    return ProjectID.make(`dir-${hash}`)
  }

  function shouldClaimGlobalSessionDirectory(worktree: string, directory: string) {
    if (!directory) return false
    return Filesystem.contains(worktree, directory)
  }

  function migrateGlobalSessionsToProject(db: Database.TxOrDb, projectID: ProjectID, worktree: string) {
    const rows = db
      .select({ id: SessionTable.id, directory: SessionTable.directory })
      .from(SessionTable)
      .where(eq(SessionTable.project_id, ProjectID.global))
      .all()

    for (const row of rows) {
      if (!shouldClaimGlobalSessionDirectory(worktree, row.directory)) continue
      db.update(SessionTable)
        .set({ project_id: projectID })
        .where(and(eq(SessionTable.project_id, ProjectID.global), eq(SessionTable.id, row.id)))
        .run()
    }
  }

  const fakeVcs = Info.shape.vcs.parse(Flag.AX_CODE_FAKE_VCS)

  function emitUpdated(data: Info) {
    GlobalBus.emit("event", {
      payload: { type: Event.Updated.type, properties: data },
    })
  }

  function resolveGitPath(cwd: string, name: string) {
    if (!name) return cwd
    const trimmed = name.replace(/[\r\n]+$/, "")
    if (!trimmed) return cwd
    const normalized = Filesystem.windowsPath(trimmed)
    if (path.isAbsolute(normalized)) return path.normalize(normalized)
    return path.resolve(cwd, normalized)
  }

  async function readCachedProjectId(dir: string) {
    return Filesystem.readText(path.join(dir, "ax-code"))
      .then((text) => {
        const id = text.trim()
        return id ? ProjectID.make(id) : undefined
      })
      .catch(() => undefined)
  }

  async function fromDirectoryPromise(directory: string) {
    log.info("fromDirectory", { directory })

    type DiscoveryResult = { id: ProjectID; worktree: string; sandbox: string; vcs: Info["vcs"] }

    const data: DiscoveryResult = await (async () => {
      let dotgit: string | undefined
      for await (const match of Filesystem.up({ targets: [".git"], start: directory })) {
        dotgit = match
        break
      }

      if (!dotgit) {
        return {
          id: directoryProjectID(directory),
          worktree: directory,
          sandbox: directory,
          vcs: fakeVcs,
        } satisfies DiscoveryResult
      }

      let sandbox = path.dirname(dotgit)
      const gitBinary = which("git")
      let id = await readCachedProjectId(dotgit)

      if (!gitBinary) {
        return {
          id: id ?? ProjectID.global,
          worktree: sandbox,
          sandbox,
          vcs: fakeVcs,
        } satisfies DiscoveryResult
      }

      const commonDir = await runGit(["rev-parse", "--git-common-dir"], { cwd: sandbox })
      if (commonDir.exitCode !== 0) {
        return {
          id: id ?? ProjectID.global,
          worktree: sandbox,
          sandbox,
          vcs: fakeVcs,
        } satisfies DiscoveryResult
      }

      const worktree = (() => {
        const common = resolveGitPath(sandbox, commonDir.text().trim())
        return common === sandbox ? sandbox : path.dirname(common)
      })()

      if (id == null) {
        id = await readCachedProjectId(path.join(worktree, ".git"))
      }

      if (!id) {
        const revList = await runGit(["rev-list", "--max-parents=0", "HEAD"], { cwd: sandbox })
        const roots = revList
          .text()
          .split("\n")
          .filter(Boolean)
          .map((x) => x.trim())
          .toSorted()

        id = roots[0] ? ProjectID.make(roots[0]) : undefined
        if (id) {
          await Filesystem.write(path.join(worktree, ".git", "ax-code"), id).catch(() => undefined)
        }
      }

      if (!id) {
        return { id: ProjectID.global, worktree: sandbox, sandbox, vcs: "git" as const }
      }

      const topLevel = await runGit(["rev-parse", "--show-toplevel"], { cwd: sandbox })
      if (topLevel.exitCode !== 0) {
        return {
          id,
          worktree: sandbox,
          sandbox,
          vcs: fakeVcs,
        } satisfies DiscoveryResult
      }
      sandbox = resolveGitPath(sandbox, topLevel.text().trim())

      return { id, sandbox, worktree, vcs: "git" as const } satisfies DiscoveryResult
    })()

    const row = Database.use((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get())
    const existing = row ? safe(row) : undefined
    const prev = existing ?? {
      id: data.id,
      worktree: data.worktree,
      vcs: data.vcs,
      sandboxes: [] as string[],
      time: { created: Date.now(), updated: Date.now() },
    }

    if (Flag.AX_CODE_EXPERIMENTAL_ICON_DISCOVERY) {
      void discover(prev).catch((error) => {
        log.warn("project icon discovery failed", {
          projectID: prev.id,
          error,
        })
      })
    }

    const result: Info = {
      ...prev,
      worktree: data.worktree,
      vcs: data.vcs,
      time: { ...prev.time, updated: Date.now() },
    }
    if (data.sandbox !== result.worktree && !result.sandboxes.includes(data.sandbox)) {
      result.sandboxes.push(data.sandbox)
    }
    result.sandboxes = (
      await Promise.all(
        result.sandboxes.map(async (sandbox) => ((await Filesystem.exists(sandbox)) ? sandbox : undefined)),
      )
    ).filter((sandbox): sandbox is string => sandbox !== undefined)

    try {
      Database.use((d) =>
        d
          .insert(ProjectTable)
          .values({
            id: result.id,
            worktree: result.worktree,
            vcs: result.vcs ?? null,
            name: result.name,
            icon_url: result.icon?.url,
            icon_color: result.icon?.color,
            time_created: result.time.created,
            time_updated: result.time.updated,
            time_initialized: result.time.initialized,
            sandboxes: result.sandboxes,
            commands: result.commands,
          })
          .onConflictDoUpdate({
            target: ProjectTable.id,
            set: {
              worktree: result.worktree,
              vcs: result.vcs ?? null,
              name: result.name,
              icon_url: result.icon?.url,
              icon_color: result.icon?.color,
              time_updated: result.time.updated,
              time_initialized: result.time.initialized,
              sandboxes: result.sandboxes,
              commands: result.commands,
            },
          })
          .run(),
      )

      if (data.id !== ProjectID.global) {
        Database.use((d) => migrateGlobalSessionsToProject(d, data.id, data.worktree))
      }
    } catch (error) {
      log.warn("failed to persist discovered project", {
        projectID: result.id,
        error,
      })
      throw error
    }

    emitUpdated(result)
    return { project: result, sandbox: data.sandbox }
  }

  async function discoverPromise(input: Info) {
    if (input.vcs !== "git") return
    if (input.icon?.override) return
    if (input.icon?.url) return

    const matches = await Glob.scan("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
      cwd: input.worktree,
      absolute: true,
      include: "file",
    })
    const shortest = matches.sort((a, b) => a.length - b.length)[0]
    if (!shortest) return

    const buffer = await Filesystem.readBytes(shortest)
    const base64 = Buffer.from(buffer).toString("base64")
    const mime = Filesystem.mimeType(shortest)
    const url = `data:${mime};base64,${base64}`
    await updatePromise({ projectID: input.id, icon: { url } })
  }

  async function updatePromise(input: UpdateInput) {
    const result = Database.use((d) =>
      d
        .update(ProjectTable)
        .set({
          name: input.name,
          icon_url: input.icon?.url,
          icon_color: input.icon?.color,
          commands: input.commands,
          time_updated: Date.now(),
        })
        .where(eq(ProjectTable.id, input.projectID))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${input.projectID}`)
    const data = fromRow(result)
    emitUpdated(data)
    return data
  }

  async function sandboxesPromise(id: ProjectID) {
    const row = Database.use((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return []
    const data = safe(row)
    if (!data) return []
    const seen = new Set<string>()
    const result: string[] = []
    for (const raw of data.sandboxes) {
      const directory = normalizeSandboxDirectory(raw)
      if (seen.has(directory)) continue
      if (!(await Filesystem.isDir(directory))) continue
      seen.add(directory)
      result.push(directory)
    }
    return result
  }

  async function addSandboxPromise(id: ProjectID, directory: string) {
    const normalized = normalizeSandboxDirectory(directory)
    const result = Database.transaction((d) => {
      const row = d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get()
      if (!row) throw new Error(`Project not found: ${id}`)
      const sandboxes = uniqueStrings((safe(row)?.sandboxes ?? []).map(normalizeSandboxDirectory))
      if (!sandboxes.includes(normalized)) sandboxes.push(normalized)
      return d
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get()
    })
    if (!result) throw new Error(`Project not found: ${id}`)
    emitUpdated(fromRow(result))
  }

  async function removeSandboxPromise(id: ProjectID, directory: string) {
    const normalized = normalizeSandboxDirectory(directory)
    const result = Database.transaction((d) => {
      const row = d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get()
      if (!row) throw new Error(`Project not found: ${id}`)
      const sandboxes = (safe(row)?.sandboxes ?? [])
        .map(normalizeSandboxDirectory)
        .filter((sandbox) => sandbox !== normalized)
      return d
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get()
    })
    if (!result) throw new Error(`Project not found: ${id}`)
    emitUpdated(fromRow(result))
  }

  export function fromDirectory(directory: string) {
    return fromDirectoryPromise(directory)
  }

  export function discover(input: Info) {
    return discoverPromise(input)
  }

  export function list() {
    return Database.use((db) =>
      db
        .select()
        .from(ProjectTable)
        .all()
        .flatMap((row) => {
          const next = safe(row)
          return next ? [next] : []
        }),
    )
  }

  export function get(id: ProjectID): Info | undefined {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return undefined
    return safe(row)
  }

  export function setInitialized(id: ProjectID) {
    Database.use((db) =>
      db.update(ProjectTable).set({ time_initialized: Date.now() }).where(eq(ProjectTable.id, id)).run(),
    )
  }

  export function initGit(input: { directory: string; project: Info }) {
    if (input.project.vcs === "git") return Promise.resolve(input.project)
    if (!which("git")) return Promise.reject(new Error("Git is not installed"))
    return runGit(["init", "--quiet"], { cwd: input.directory }).then(async (result) => {
      if (result.exitCode !== 0) {
        throw new Error(
          result.stderr.toString().trim() || result.text().trim() || "Failed to initialize git repository",
        )
      }
      const { project } = await fromDirectoryPromise(input.directory)
      return project
    })
  }

  export function update(input: UpdateInput) {
    return updatePromise(input)
  }

  export function sandboxes(id: ProjectID) {
    return sandboxesPromise(id)
  }

  export function addSandbox(id: ProjectID, directory: string) {
    return addSandboxPromise(id, directory)
  }

  export function removeSandbox(id: ProjectID, directory: string) {
    return removeSandboxPromise(id, directory)
  }
}
