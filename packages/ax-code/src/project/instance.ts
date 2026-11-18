import { NamedError } from "@ax-code/util/error"
import { KeyedSerialQueue } from "@/util/queue"
import z from "zod"
import { GlobalBus } from "@/bus/global"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { isHarmlessInterrupt } from "@/util/harmless-interrupt"
import { RuntimeDebugSnapshot } from "@/runtime/debug-snapshot"
import { RuntimeFailureClass } from "@/runtime/failure-class"
import { ServiceManager } from "@/runtime/service-manager"
import { Filesystem } from "@/util/filesystem"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { toErrorMessage } from "@/util/error-message"
import { Context } from "../util/context"
import { ScopedFlag } from "@/flag/scoped"
import { Project } from "./project"
import { State } from "./state"
import { Database } from "../storage/db"

export interface Shape {
  directory: string
  worktree: string
  project: Project.Info
}
const context = Context.create<Shape>("instance")
// Let directory-scoped feature flags resolve against the active instance
// without a flag → instance import cycle.
ScopedFlag.setDirectoryResolver(() => context.peek()?.directory)
// Let Database resolve the ambient projectID for per-project shard routing
// (Phase 2) without a db.ts → instance.ts import cycle. Mirrors the
// ScopedFlag resolver above: the callback reads the async-local instance
// context lazily, so it returns undefined outside Instance.provide.
Database.setProjectResolver(() => context.peek()?.project.id)
const cache = new Map<string, Promise<Shape>>()
const lifecycle = {
  listeners: new Set<(event: Instance.LifecycleEvent) => void>(),
}
const runtimeLog = Log.create({ service: "runtime.snapshot" })

const disposal = {
  directories: new Set<string>(),
  all: undefined as Promise<void> | undefined,
}

function errorMetadata(error: unknown) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    }
  }
  return {
    errorName: "Error",
    errorMessage: toErrorMessage(error),
  }
}

function emitLifecycle(event: Instance.LifecycleEvent) {
  for (const listener of lifecycle.listeners) {
    try {
      listener(event)
    } catch (error) {
      Log.Default.warn("instance lifecycle listener failed", { error })
    }
  }
}

function snapshot(input: {
  trigger: RuntimeDebugSnapshot.Trigger
  directory?: string
  worktree?: string
  projectID?: string
  failureClass?: RuntimeFailureClass.Kind
}) {
  const current = context.peek()
  const currentDirectory = current?.directory
  const directory = input.directory ? Filesystem.resolve(input.directory) : currentDirectory
  const worktree = input.worktree ?? (current && currentDirectory === directory ? current.worktree : undefined)
  const projectID = input.projectID ?? (current && currentDirectory === directory ? current.project.id : undefined)
  const services = directory
    ? (ServiceManager.peek(directory)?.snapshot() ?? ServiceManager.createSnapshot())
    : ServiceManager.createSnapshot()
  const result = RuntimeDebugSnapshot.create({
    trigger: input.trigger,
    time: Date.now(),
    failureClass: input.failureClass,
    instance: directory ? { directory, worktree, projectID } : undefined,
    services: services.services,
    tasks: services.tasks,
  })

  runtimeLog.info("runtime snapshot", {
    trigger: result.trigger,
    failureClass: result.failureClass,
    directory: result.instance?.directory,
    snapshot: result,
  })
  DiagnosticLog.recordProcess("runtime.snapshot", {
    trigger: result.trigger,
    failureClass: result.failureClass,
    instance: result.instance,
    services: result.services,
    tasks: result.tasks,
    queues: result.queues,
  })
  return result
}

function emit(directory: string) {
  GlobalBus.emit("event", {
    directory,
    payload: {
      type: "server.instance.disposed",
      properties: {
        directory,
      },
    },
  })
}

function boot(input: { directory: string; init?: () => Promise<unknown>; project?: Project.Info; worktree?: string }) {
  const manager = ServiceManager.reset(input.directory)
  manager.start("Project.fromDirectory")
  emitLifecycle({
    kind: "boot.start",
    directory: input.directory,
  })
  return iife(async () => {
    try {
      const ctx =
        input.project && input.worktree
          ? {
              directory: input.directory,
              worktree: input.worktree,
              project: input.project,
            }
          : await manager.track({
              service: "Project.fromDirectory",
              label: "project discovery",
              timeoutMs: 10_000,
              task: async () =>
                Project.fromDirectory(input.directory).then(({ project, sandbox }) => ({
                  directory: input.directory,
                  worktree: sandbox,
                  project,
                })),
              onFailure: () => {
                snapshot({
                  trigger: "service_failure",
                  directory: input.directory,
                  failureClass: "service_bootstrap",
                })
              },
              onTimeout: () => {
                snapshot({
                  trigger: "timeout",
                  directory: input.directory,
                  failureClass: "service_bootstrap",
                })
              },
            })
      if (input.project && input.worktree) {
        manager.running("Project.fromDirectory")
      }
      await context.provide(ctx, async () => {
        await input.init?.()
      })
      snapshot({
        trigger: "startup",
        directory: ctx.directory,
        worktree: ctx.worktree,
        projectID: ctx.project.id,
      })
      emitLifecycle({
        kind: "boot.ready",
        directory: ctx.directory,
        worktree: ctx.worktree,
        projectID: ctx.project.id,
      })
      return ctx
    } catch (error) {
      snapshot({
        trigger: "service_failure",
        directory: input.directory,
        failureClass: "service_bootstrap",
      })
      emitLifecycle({
        kind: "boot.failed",
        directory: input.directory,
        ...errorMetadata(error),
      })
      throw error
    }
  })
}

function track(directory: string, next: Promise<Shape>) {
  const task = next.catch((error) => {
    if (cache.get(directory) === task) cache.delete(directory)
    throw error
  })
  cache.set(directory, task)
  return task
}

type InstanceInput<R> = { directory: string; init?: () => Promise<unknown>; fn: () => R }
type BootstrapInput = { directory: string; init?: () => Promise<unknown>; project?: Project.Info; worktree?: string }
type ScopeOwner = { users: number; current: Promise<Shape> }

const scopes = new WeakMap<Promise<Shape>, ScopeOwner>()
const generations = new WeakMap<Shape, Promise<Shape>>()
const closingGenerations = new WeakSet<Promise<Shape>>()
const activeDisposals = new WeakSet<Promise<Shape>>()
const changes = new KeyedSerialQueue()
const initializing = new WeakSet<Promise<Shape>>()
const cleanupContext = Context.create<string | undefined>("instance cleanup")
const ShuttingDownError = NamedError.create(
  "InstanceShuttingDownError",
  z.object({ directory: z.string(), message: z.string() }),
)
const InitializingError = NamedError.create(
  "InstanceInitializingError",
  z.object({ directory: z.string(), message: z.string() }),
)

function shuttingDownError(directory: string): InstanceType<typeof ShuttingDownError> {
  return new ShuttingDownError({
    directory,
    message: "Project instance is shutting down; wait for cleanup before entering it again.",
  })
}

function initializingError(directory: string): InstanceType<typeof InitializingError> {
  return new InitializingError({
    directory,
    message: "Project instance is still initializing; finish initialization before requesting reload or disposal.",
  })
}

/** Lifecycle mutations use the shared per-directory FIFO. */
function change<T>(directory: string, work: () => Promise<T>): Promise<T> {
  return changes.run(directory, work)
}

function create(input: BootstrapInput, scoped: boolean, inherited?: ScopeOwner, insideChange = false): Promise<Shape> {
  let owner = inherited
  let ctx: Shape | undefined
  let ready: Promise<Shape>
  const started = boot({
    ...input,
    init: async () => {
      // Install the cache identity before an initializer can reenter provide().
      await Promise.resolve()
      ctx = context.use()
      generations.set(ctx, ready) // @scan-suppress lifecycle_scan - Weak keys release metadata with instance contexts.
      await input.init?.()
    },
  })
  ready = track(
    input.directory,
    started
      .finally(() => initializing.delete(ready))
      .catch(async (error) => {
        if (ctx) {
          const failed = ctx
          const cleanup = () => disposeCurrent(failed, ready)
          await (insideChange ? cleanup() : change(input.directory, cleanup)).catch((cleanupError) => {
            Log.Default.warn("failed instance cleanup failed", { error: toErrorMessage(cleanupError) })
          })
        } else if (cache.get(input.directory) === ready) {
          ServiceManager.clear(input.directory)
        }
        throw error
      }),
  )
  initializing.add(ready)
  if (scoped && !owner) owner = { users: 0, current: ready }
  if (owner) {
    owner.current = ready
    scopes.set(ready, owner) // @scan-suppress lifecycle_scan - Weak keys release ownership metadata with boot promises.
  }
  return ready
}

async function release(directory: string, owner: ScopeOwner, insideChange = false): Promise<void> {
  if (--owner.users > 0) return
  const cleanup = async (): Promise<void> => {
    const ready = owner.current
    const current = cache.get(directory)
    if (owner.users > 0 || (current && current !== ready)) return
    const ctx = await ready.catch(() => undefined)
    const latest = cache.get(directory)
    if (!ctx || owner.users > 0 || (latest && latest !== ready)) return
    await disposeCurrent(ctx, ready)
  }
  await (insideChange ? cleanup() : change(directory, cleanup))
}

async function runInstance<R>(input: InstanceInput<R>, scoped: boolean): Promise<R> {
  const directory = Filesystem.resolve(input.directory)
  if (cleanupContext.peek() === directory) throw shuttingDownError(directory)
  const current = context.peek()
  // Initializers may use their own instance while boot is pending. Other
  // callers wait for lifecycle changes instead of entering a closing generation.
  while (changes.pending(directory)) {
    const own = current && generations.get(current)
    if (own && initializing.has(own) && cache.get(directory) === own && !closingGenerations.has(own)) break
    await changes.pending(directory)?.catch(() => undefined)
  }
  let ready = cache.get(directory)
  if (!ready) {
    Log.Default.info("creating instance", { directory })
    ready = create({ directory, init: input.init }, scoped)
  }
  if (closingGenerations.has(ready)) throw shuttingDownError(directory)
  const owner = scopes.get(ready)
  if (owner) owner.users++ // @scan-suppress race_scan - Synchronous reservation; the counter update never spans an await.
  try {
    const ctx = current && generations.get(current) === ready ? current : await ready
    return await context.provide(ctx, input.fn)
  } finally {
    if (owner) await release(directory, owner)
  }
}

async function disposeCurrent(ctx: Shape, expected: Promise<Shape>): Promise<void> {
  const current = cache.get(ctx.directory) // @scan-suppress race_scan - The directory lifecycle queue is held through cleanup.
  // Legacy callers can rebuild state in their context after explicit disposal.
  // Only a distinct cached generation belongs to an independent replacement.
  if ((current && current !== expected) || activeDisposals.has(expected)) return // @scan-suppress race_scan - The same lifecycle queue owns this disposal flag.
  activeDisposals.add(expected)
  closingGenerations.add(expected)
  return context.provide(ctx, async () => {
    const directory = ctx.directory
    Log.Default.info("disposing instance", { directory })
    snapshot({
      trigger: "shutdown",
      directory,
      worktree: Instance.worktree,
      projectID: Instance.project.id,
    })
    disposal.directories.add(directory)
    emitLifecycle({
      kind: "dispose.start",
      directory,
      worktree: Instance.worktree,
      projectID: Instance.project.id,
    })
    try {
      Instance.runtime().abortAll()
      await Promise.allSettled([cleanupContext.provide(directory, () => State.dispose(directory))])
      if (cache.get(directory) === expected) cache.delete(directory)
      emit(directory)
      ServiceManager.clear(directory)
      emitLifecycle({
        kind: "dispose.ready",
        directory,
      })
    } catch (error) {
      emitLifecycle({
        kind: "dispose.failed",
        directory,
        ...errorMetadata(error),
      })
      throw error
    } finally {
      activeDisposals.delete(expected)
      disposal.directories.delete(directory)
    }
  })
}

export const Instance = {
  ShuttingDownError,
  InitializingError,
  /** Provide a persistent instance, or borrow the lifetime of an existing scoped instance. */
  async provide<R>(input: InstanceInput<R>): Promise<R> {
    return runInstance(input, false)
  },
  /** Release an instance created by scoped callers only after its last user leaves. */
  async provideScoped<R>(input: InstanceInput<R>): Promise<R> {
    return runInstance(input, true)
  },
  /** Run maintenance against an existing context without bootstrapping a directory. */
  async withExisting<R>(directory: string, fn: () => R): Promise<R | undefined> {
    const key = Filesystem.resolve(directory)
    if (disposal.directories.has(key) || changes.pending(key)) return undefined
    const existing = cache.get(key)
    if (!existing) return undefined
    let current: Shape
    try {
      current = await existing
    } catch {
      // A failed boot is no longer an existing runtime. Do not let its
      // rejected cache entry abort maintenance after storage was committed.
      return undefined
    }
    if (disposal.directories.has(key) || changes.pending(key) || cache.get(key) !== existing) return undefined
    const owner = scopes.get(existing)
    if (owner) owner.users++ // @scan-suppress race_scan - Synchronous reservation; the counter update never spans an await.
    try {
      return await context.provide(current, fn)
    } finally {
      if (owner) await release(key, owner)
    }
  },
  get current() {
    return context.use()
  },
  list() {
    return [...cache.keys()].sort()
  },
  onLifecycle(listener: (event: Instance.LifecycleEvent) => void) {
    lifecycle.listeners.add(listener)
    return () => {
      lifecycle.listeners.delete(listener)
    }
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside Instance.directory OR Instance.worktree.
   * Paths within the worktree but outside the working directory should not trigger external_directory permission.
   */
  containsPath(filepath: string) {
    if (Filesystem.contains(Instance.directory, filepath)) return true
    // Older non-git projects used "/" as the worktree, which would match ANY
    // absolute path. Skip that legacy sentinel to preserve external_directory
    // permissions; current non-git projects use the directory as their
    // worktree, so the normal containment check remains safe.
    if (Instance.worktree === "/") return false
    return Filesystem.contains(Instance.worktree, filepath)
  },
  /**
   * Captures the current instance ALS context and returns a wrapper that
   * restores it when called. Use this for callbacks that fire outside the
   * instance async context (native addons, event emitters, timers, etc.).
   */
  bind<F extends (...args: any[]) => any>(fn: F): F {
    const ctx = context.use()
    return ((...args: any[]) => context.provide(ctx, () => fn(...args))) as F
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): State.Getter<S> {
    return State.create(() => Instance.directory, init, dispose)
  },
  runtime(directory?: string) {
    return ServiceManager.forDirectory(directory ? Filesystem.resolve(directory) : Instance.directory)
  },
  runtimeSnapshot(input: {
    trigger: RuntimeDebugSnapshot.Trigger
    directory?: string
    worktree?: string
    projectID?: string
    failureClass?: RuntimeFailureClass.Kind
  }) {
    return snapshot(input)
  },
  async reload(input: BootstrapInput): Promise<Shape> {
    const directory = Filesystem.resolve(input.directory)
    if (cleanupContext.peek() === directory) throw shuttingDownError(directory)
    const current = context.peek()
    const own = current && generations.get(current)
    if (current?.directory === directory && own && initializing.has(own)) throw initializingError(directory)
    return change(directory, async () => {
      const previous = cache.get(directory)
      const owner = previous && scopes.get(previous)
      // Reload itself holds the scoped lifetime while its initializer can
      // borrow the replacement, even if the last earlier caller leaves.
      if (owner) owner.users++ // @scan-suppress race_scan - Synchronous reservation; the counter update never spans an await.
      if (previous) closingGenerations.add(previous)
      Log.Default.info("reloading instance", { directory })
      snapshot({ trigger: "reload", directory, worktree: input.worktree, projectID: input.project?.id })
      disposal.directories.add(directory)
      emitLifecycle({ kind: "reload.start", directory })
      try {
        ServiceManager.peek(directory)?.abortAll()
        await Promise.allSettled([cleanupContext.provide(directory, () => State.dispose(directory))])
        if (cache.get(directory) === previous) cache.delete(directory)
        const next = create({ ...input, directory }, owner !== undefined, owner, true)
        emit(directory)
        const result = await next
        emitLifecycle({
          kind: "reload.ready",
          directory: result.directory,
          worktree: result.worktree,
          projectID: result.project.id,
        })
        return result
      } catch (error) {
        emitLifecycle({ kind: "reload.failed", directory, ...errorMetadata(error) })
        throw error
      } finally {
        disposal.directories.delete(directory)
        if (owner) await release(directory, owner, true)
      }
    })
  },
  async dispose(): Promise<void> {
    const ctx = context.use()
    const expected = generations.get(ctx)
    if (!expected || activeDisposals.has(expected) || cleanupContext.peek() === ctx.directory) return
    if (initializing.has(expected)) throw initializingError(ctx.directory)
    await change(ctx.directory, () => disposeCurrent(ctx, expected))
  },
  async disposeAll(): Promise<void> {
    const cleaning = cleanupContext.peek()
    const current = context.peek()
    const own = current && generations.get(current)
    if (!cleaning && current && own && initializing.has(own)) throw initializingError(current.directory)
    if (disposal.all) {
      if (cleaning) return
      return disposal.all
    }

    // Cleanup cannot wait on its enclosing lifecycle change. Schedule the
    // request after that change, while ordinary callers join the full shutdown.
    const parent = cleaning ? changes.pending(cleaning) : undefined
    disposal.all = cleanupContext.provide(undefined, () =>
      Promise.resolve()
        .then(async () => {
          emitLifecycle({ kind: "dispose_all.start" })
          await parent
          Log.Default.info("disposing all instances")
          const entries = [...cache.entries()]
          const errors: unknown[] = []
          for (const [key, value] of entries) {
            if (cache.get(key) !== value) continue

            const ctx = await value.catch((error) => {
              Log.Default.warn("instance dispose failed", { key, error })
              ServiceManager.clear(key)
              return undefined
            })

            if (!ctx) {
              if (cache.get(key) === value) cache.delete(key)
              continue
            }

            if (cache.get(key) !== value) continue
            try {
              await context
                .provide(ctx, async () => {
                  await Instance.dispose()
                })
                .catch((error) => {
                  if (isHarmlessInterrupt(error)) return
                  throw error
                })
            } catch (error) {
              errors.push(error)
            }
          }
          if (errors.length > 0) {
            throw errors[0]
          }
        })
        .catch((error) => {
          if (isHarmlessInterrupt(error)) return
          emitLifecycle({
            kind: "dispose_all.failed",
            ...errorMetadata(error),
          })
          throw error
        })
        .then((result) => {
          emitLifecycle({
            kind: "dispose_all.ready",
          })
          return result
        })
        .finally(() => {
          disposal.all = undefined
        }),
    )

    if (cleaning) {
      // The cleanup caller returns before this operation; retain reporting even
      // when no ordinary caller subsequently joins its rejection.
      void disposal.all.catch((error) => {
        Log.Default.warn("deferred instance shutdown failed", { error: toErrorMessage(error) })
      })
      return
    }
    return disposal.all
  },
}

export declare namespace Instance {
  export type LifecycleKind =
    | "boot.start"
    | "boot.ready"
    | "boot.failed"
    | "reload.start"
    | "reload.ready"
    | "reload.failed"
    | "dispose.start"
    | "dispose.ready"
    | "dispose.failed"
    | "dispose_all.start"
    | "dispose_all.ready"
    | "dispose_all.failed"

  export interface LifecycleEvent {
    kind: LifecycleKind
    directory?: string
    worktree?: string
    projectID?: string
    errorName?: string
    errorMessage?: string
  }
}
