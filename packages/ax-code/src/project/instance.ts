import { GlobalBus } from "@/bus/global"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { disposeInstance } from "@/effect/instance-registry"
import { isHarmlessEffectInterrupt } from "@/effect/interrupt"
import { RuntimeDebugSnapshot } from "@/runtime/debug-snapshot"
import { RuntimeFailureClass } from "@/runtime/failure-class"
import { ServiceManager } from "@/runtime/service-manager"
import { Filesystem } from "@/util/filesystem"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"

export interface Shape {
  directory: string
  worktree: string
  project: Project.Info
}
const context = Context.create<Shape>("instance")
const cache = new Map<string, Promise<Shape>>()
const lifecycle = {
  listeners: new Set<(event: Instance.LifecycleEvent) => void>(),
}
const runtimeLog = Log.create({ service: "runtime.snapshot" })

const disposal = {
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
    errorMessage: String(error),
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
  const services = directory ? (ServiceManager.peek(directory)?.snapshot() ?? ServiceManager.createSnapshot()) : ServiceManager.createSnapshot()
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

function boot(input: { directory: string; init?: () => Promise<any>; project?: Project.Info; worktree?: string }) {
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

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R }): Promise<R> {
    const directory = Filesystem.resolve(input.directory)
    let existing = cache.get(directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory })
      existing = track(
        directory,
        boot({
          directory,
          init: input.init,
        }),
      )
    }
    const ctx = await existing
    return context.provide(ctx, async () => {
      return input.fn()
    })
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
    // Non-git projects set worktree to "/" which would match ANY absolute path.
    // Skip worktree check in this case to preserve external_directory permissions.
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
  async reload(input: { directory: string; init?: () => Promise<any>; project?: Project.Info; worktree?: string }) {
    const directory = Filesystem.resolve(input.directory)
    Log.Default.info("reloading instance", { directory })
    snapshot({
      trigger: "reload",
      directory,
      worktree: input.worktree,
      projectID: input.project?.id,
    })
    emitLifecycle({
      kind: "reload.start",
      directory,
    })
    try {
      await Promise.allSettled([State.dispose(directory), disposeInstance(directory)])
      cache.delete(directory)
      const next = track(directory, boot({ ...input, directory }))
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
      emitLifecycle({
        kind: "reload.failed",
        directory,
        ...errorMetadata(error),
      })
      throw error
    }
  },
  async dispose() {
    const directory = Instance.directory
    Log.Default.info("disposing instance", { directory })
    snapshot({
      trigger: "shutdown",
      directory,
      worktree: Instance.worktree,
      projectID: Instance.project.id,
    })
    emitLifecycle({
      kind: "dispose.start",
      directory,
      worktree: Instance.worktree,
      projectID: Instance.project.id,
    })
    try {
      await Promise.allSettled([State.dispose(directory), disposeInstance(directory)])
      cache.delete(directory)
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
    }
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    emitLifecycle({
      kind: "dispose_all.start",
    })
    disposal.all = iife(async () => {
      Log.Default.info("disposing all instances")
      const entries = [...cache.entries()]
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

        await context
          .provide(ctx, async () => {
            await Instance.dispose()
          })
          .catch((error) => {
            if (isHarmlessEffectInterrupt(error)) return
            throw error
          })
      }
    })
      .catch((error) => {
        if (isHarmlessEffectInterrupt(error)) return
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
      })

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
