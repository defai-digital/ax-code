import z from "zod"
import { and, Database, eq } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { which } from "../util/which"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"
import { git as runGit } from "../util/git"
import { ProjectID } from "./schema"
import { Effect, Layer, Path, Scope, ServiceMap, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { AppFileSystem } from "@/filesystem"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import path from "path"

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
      if (next.success) return next.data
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

  // ---------------------------------------------------------------------------
  // Effect service
  // ---------------------------------------------------------------------------

  export interface Interface {
    readonly fromDirectory: (directory: string) => Effect.Effect<{ project: Info; sandbox: string }>
    readonly discover: (input: Info) => Effect.Effect<void>
    readonly list: () => Effect.Effect<Info[]>
    readonly get: (id: ProjectID) => Effect.Effect<Info | undefined>
    readonly update: (input: UpdateInput) => Effect.Effect<Info>
    readonly initGit: (input: { directory: string; project: Info }) => Effect.Effect<Info>
    readonly setInitialized: (id: ProjectID) => Effect.Effect<void>
    readonly sandboxes: (id: ProjectID) => Effect.Effect<string[]>
    readonly addSandbox: (id: ProjectID, directory: string) => Effect.Effect<void>
    readonly removeSandbox: (id: ProjectID, directory: string) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@ax-code/Project") {}

  type GitResult = { code: number; text: string; stderr: string }

  export const layer: Layer.Layer<
    Service,
    never,
    AppFileSystem.Service | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  > = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fsys = yield* AppFileSystem.Service
      const pathSvc = yield* Path.Path
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const git = Effect.fnUntraced(
        function* (args: string[], opts?: { cwd?: string }) {
          const handle = yield* spawner.spawn(
            ChildProcess.make("git", args, { cwd: opts?.cwd, extendEnv: true, stdin: "ignore" }),
          )
          const [text, stderr] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
            { concurrency: 2 },
          )
          const code = yield* handle.exitCode
          return { code, text, stderr } satisfies GitResult
        },
        Effect.scoped,
        Effect.catch(() => Effect.succeed({ code: 1, text: "", stderr: "" } satisfies GitResult)),
      )

      const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
        Effect.sync(() => Database.use(fn))

      const emitUpdated = (data: Info) =>
        Effect.sync(() =>
          GlobalBus.emit("event", {
            payload: { type: Event.Updated.type, properties: data },
          }),
        )

      const fakeVcs = Info.shape.vcs.parse(Flag.AX_CODE_FAKE_VCS)

      const resolveGitPath = (cwd: string, name: string) => {
        if (!name) return cwd
        name = name.replace(/[\r\n]+$/, "")
        if (!name) return cwd
        name = AppFileSystem.windowsPath(name)
        if (pathSvc.isAbsolute(name)) return pathSvc.normalize(name)
        return pathSvc.resolve(cwd, name)
      }

      const scope = yield* Scope.Scope

      const readCachedProjectId = Effect.fnUntraced(function* (dir: string) {
        return yield* fsys.readFileString(pathSvc.join(dir, "ax-code")).pipe(
          Effect.map((x) => x.trim()),
          Effect.map(ProjectID.make),
          Effect.catch(() => Effect.void),
        )
      })

      const fromDirectory = Effect.fn("Project.fromDirectory")(function* (directory: string) {
        log.info("fromDirectory", { directory })

        // Phase 1: discover git info
        type DiscoveryResult = { id: ProjectID; worktree: string; sandbox: string; vcs: Info["vcs"] }

        const data: DiscoveryResult = yield* Effect.gen(function* () {
          const dotgitMatches = yield* fsys.up({ targets: [".git"], start: directory }).pipe(Effect.orDie)
          const dotgit = dotgitMatches[0]

          if (!dotgit) {
            return {
              id: ProjectID.global,
              worktree: "/",
              sandbox: "/",
              vcs: fakeVcs,
            }
          }

          let sandbox = pathSvc.dirname(dotgit)
          const gitBinary = yield* Effect.sync(() => which("git"))
          let id = yield* readCachedProjectId(dotgit)

          if (!gitBinary) {
            return {
              id: id ?? ProjectID.global,
              worktree: sandbox,
              sandbox,
              vcs: fakeVcs,
            }
          }

          const commonDir = yield* git(["rev-parse", "--git-common-dir"], { cwd: sandbox })
          if (commonDir.code !== 0) {
            return {
              id: id ?? ProjectID.global,
              worktree: sandbox,
              sandbox,
              vcs: fakeVcs,
            }
          }
          const worktree = (() => {
            const common = resolveGitPath(sandbox, commonDir.text.trim())
            return common === sandbox ? sandbox : pathSvc.dirname(common)
          })()

          if (id == null) {
            id = yield* readCachedProjectId(pathSvc.join(worktree, ".git"))
          }

          if (!id) {
            const revList = yield* git(["rev-list", "--max-parents=0", "HEAD"], { cwd: sandbox })
            const roots = revList.text
              .split("\n")
              .filter(Boolean)
              .map((x) => x.trim())
              .toSorted()

            id = roots[0] ? ProjectID.make(roots[0]) : undefined
            if (id) {
              yield* fsys.writeFileString(pathSvc.join(worktree, ".git", "ax-code"), id).pipe(Effect.ignore)
            }
          }

          if (!id) {
            return { id: ProjectID.global, worktree: sandbox, sandbox, vcs: "git" as const }
          }

          const topLevel = yield* git(["rev-parse", "--show-toplevel"], { cwd: sandbox })
          if (topLevel.code !== 0) {
            return {
              id,
              worktree: sandbox,
              sandbox,
              vcs: fakeVcs,
            }
          }
          sandbox = resolveGitPath(sandbox, topLevel.text.trim())

          return { id, sandbox, worktree, vcs: "git" as const }
        })

        // Phase 2: upsert
        const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get())
        const existing = row ? safe(row) : undefined
        const prev =
          existing ?? {
            id: data.id,
            worktree: data.worktree,
            vcs: data.vcs,
            sandboxes: [] as string[],
            time: { created: Date.now(), updated: Date.now() },
          }

        if (Flag.AX_CODE_EXPERIMENTAL_ICON_DISCOVERY)
          yield* discover(prev).pipe(Effect.ignore, Effect.forkIn(scope))

        const result: Info = {
          ...prev,
          worktree: data.worktree,
          vcs: data.vcs,
          time: { ...prev.time, updated: Date.now() },
        }
        if (data.sandbox !== result.worktree && !result.sandboxes.includes(data.sandbox))
          result.sandboxes.push(data.sandbox)
        result.sandboxes = yield* Effect.forEach(
          result.sandboxes,
          (s) =>
            fsys.exists(s).pipe(
              Effect.orDie,
              Effect.map((exists) => (exists ? s : undefined)),
            ),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))

        try {
          yield* db((d) =>
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
            yield* db((d) =>
              d
                .update(SessionTable)
                .set({ project_id: data.id })
                .where(and(eq(SessionTable.project_id, ProjectID.global), eq(SessionTable.directory, data.worktree)))
                .run(),
            )
          }
        } catch (error) {
          log.warn("failed to persist discovered project", {
            projectID: result.id,
            error,
          })
        }

        yield* emitUpdated(result)
        return { project: result, sandbox: data.sandbox }
      })

      const discover = Effect.fn("Project.discover")(function* (input: Info) {
        if (input.vcs !== "git") return
        if (input.icon?.override) return
        if (input.icon?.url) return

        const matches = yield* fsys
          .glob("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
            cwd: input.worktree,
            absolute: true,
            include: "file",
          })
          .pipe(Effect.orDie)
        const shortest = matches.sort((a, b) => a.length - b.length)[0]
        if (!shortest) return

        const buffer = yield* fsys.readFile(shortest).pipe(Effect.orDie)
        const base64 = Buffer.from(buffer).toString("base64")
        const mime = AppFileSystem.mimeType(shortest)
        const url = `data:${mime};base64,${base64}`
        yield* update({ projectID: input.id, icon: { url } })
      })

      const list = Effect.fn("Project.list")(function* () {
        return yield* db((d) =>
          d
            .select()
            .from(ProjectTable)
            .all()
            .flatMap((row) => {
              const next = safe(row)
              return next ? [next] : []
            }),
        )
      })

      const get = Effect.fn("Project.get")(function* (id: ProjectID) {
        const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
        if (!row) return
        return safe(row)
      })

      const update = Effect.fn("Project.update")(function* (input: UpdateInput) {
        const result = yield* db((d) =>
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
        yield* emitUpdated(data)
        return data
      })

      const initGit = Effect.fn("Project.initGit")(function* (input: { directory: string; project: Info }) {
        if (input.project.vcs === "git") return input.project
        if (!(yield* Effect.sync(() => which("git")))) throw new Error("Git is not installed")
        const result = yield* git(["init", "--quiet"], { cwd: input.directory })
        if (result.code !== 0) {
          throw new Error(result.stderr.trim() || result.text.trim() || "Failed to initialize git repository")
        }
        const { project } = yield* fromDirectory(input.directory)
        return project
      })

      const setInitialized = Effect.fn("Project.setInitialized")(function* (id: ProjectID) {
        yield* db((d) =>
          d.update(ProjectTable).set({ time_initialized: Date.now() }).where(eq(ProjectTable.id, id)).run(),
        )
      })

      const sandboxes = Effect.fn("Project.sandboxes")(function* (id: ProjectID) {
        const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
        if (!row) return []
        const data = safe(row)
        if (!data) return []
        return yield* Effect.forEach(
          data.sandboxes,
          (dir) =>
            fsys.isDir(dir).pipe(
              Effect.orDie,
              Effect.map((ok) => (ok ? dir : undefined)),
            ),
          { concurrency: "unbounded" },
        ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))
      })

      const addSandbox = Effect.fn("Project.addSandbox")(function* (id: ProjectID, directory: string) {
        const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
        if (!row) throw new Error(`Project not found: ${id}`)
        const sboxes = [...(safe(row)?.sandboxes ?? [])]
        if (!sboxes.includes(directory)) sboxes.push(directory)
        const result = yield* db((d) =>
          d
            .update(ProjectTable)
            .set({ sandboxes: sboxes, time_updated: Date.now() })
            .where(eq(ProjectTable.id, id))
            .returning()
            .get(),
        )
        if (!result) throw new Error(`Project not found: ${id}`)
        yield* emitUpdated(fromRow(result))
      })

      const removeSandbox = Effect.fn("Project.removeSandbox")(function* (id: ProjectID, directory: string) {
        const row = yield* db((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
        if (!row) throw new Error(`Project not found: ${id}`)
        const sboxes = (safe(row)?.sandboxes ?? []).filter((s) => s !== directory)
        const result = yield* db((d) =>
          d
            .update(ProjectTable)
            .set({ sandboxes: sboxes, time_updated: Date.now() })
            .where(eq(ProjectTable.id, id))
            .returning()
            .get(),
        )
        if (!result) throw new Error(`Project not found: ${id}`)
        yield* emitUpdated(fromRow(result))
      })

      return Service.of({
        fromDirectory,
        discover,
        list,
        get,
        update,
        initGit,
        setInitialized,
        sandboxes,
        addSandbox,
        removeSandbox,
      })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(CrossSpawnSpawner.layer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodePath.layer),
  )

  // ---------------------------------------------------------------------------
  // Promise-based API
  // ---------------------------------------------------------------------------

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
      .then((text) => ProjectID.make(text.trim()))
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
          id: ProjectID.global,
          worktree: "/",
          sandbox: "/",
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
    const prev =
      existing ?? {
        id: data.id,
        worktree: data.worktree,
        vcs: data.vcs,
        sandboxes: [] as string[],
        time: { created: Date.now(), updated: Date.now() },
      }

    if (Flag.AX_CODE_EXPERIMENTAL_ICON_DISCOVERY) {
      void discover(prev).catch(() => undefined)
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
      await Promise.all(result.sandboxes.map(async (sandbox) => ((await Filesystem.exists(sandbox)) ? sandbox : undefined)))
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
        Database.use((d) =>
          d
            .update(SessionTable)
            .set({ project_id: data.id })
            .where(and(eq(SessionTable.project_id, ProjectID.global), eq(SessionTable.directory, data.worktree)))
            .run(),
        )
      }
    } catch (error) {
      log.warn("failed to persist discovered project", {
        projectID: result.id,
        error,
      })
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
    return (
      await Promise.all(data.sandboxes.map(async (directory) => ((await Filesystem.isDir(directory)) ? directory : undefined)))
    ).filter((directory): directory is string => directory !== undefined)
  }

  async function addSandboxPromise(id: ProjectID, directory: string) {
    const row = Database.use((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const sandboxes = [...(safe(row)?.sandboxes ?? [])]
    if (!sandboxes.includes(directory)) sandboxes.push(directory)
    const result = Database.use((d) =>
      d
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)
    emitUpdated(fromRow(result))
  }

  async function removeSandboxPromise(id: ProjectID, directory: string) {
    const row = Database.use((d) => d.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const sandboxes = (safe(row)?.sandboxes ?? []).filter((sandbox) => sandbox !== directory)
    const result = Database.use((d) =>
      d
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
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
        throw new Error(result.stderr.toString().trim() || result.text().trim() || "Failed to initialize git repository")
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
