import { Cause, Effect, Layer, Scope, ServiceMap } from "effect"
// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import { readdir, stat } from "fs/promises"
import path from "path"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { Flag } from "@/flag/flag"
import { NativePerf } from "@/perf/native"
import { Instance } from "@/project/instance"
import { git } from "@/util/git"
import { lazy } from "@/util/lazy"
import { Config } from "../config/config"
import { FileIgnore } from "./ignore"
import { Protected } from "./protected"
import { Log } from "../util/log"
import { NativeAddon } from "@/native/addon"

declare const AX_CODE_LIBC: string | undefined

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })
  const SUBSCRIBE_TIMEOUT_MS = 10_000
  const POLL_MS = 500

  export const Event = {
    Updated: BusEvent.define(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  const watcher = lazy((): typeof import("@parcel/watcher") | undefined => {
    try {
      const binding = require(
        `@parcel/watcher-${process.platform}-${process.arch}${process.platform === "linux" ? `-${AX_CODE_LIBC || "glibc"}` : ""}`,
      )
      return createWrapper(binding) as typeof import("@parcel/watcher")
    } catch (error) {
      log.error("failed to load watcher binding", { error })
      return
    }
  })

  function protecteds(dir: string) {
    return Protected.paths().filter((item) => {
      const rel = path.relative(dir, item)
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
    })
  }

  function ignored(dir: string, ignore: string[], file: string) {
    const rel = path.relative(dir, file)
    if (rel === "") return false

    for (const item of ignore) {
      if (path.isAbsolute(item)) {
        const target = path.resolve(item)
        if (file === target || file.startsWith(target + path.sep)) return true
        continue
      }
      if (rel === item || rel.startsWith(item + path.sep)) return true
    }

    return FileIgnore.match(rel, {
      extra: ignore.filter((item) => !path.isAbsolute(item)),
    })
  }

  async function snapshot(dir: string, ignore: string[], root = dir, result = new Map<string, string>()) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const file = path.join(dir, entry.name)
      if (ignored(root, ignore, file)) continue
      if (entry.isDirectory()) {
        await snapshot(file, ignore, root, result)
        continue
      }
      if (!entry.isFile()) continue
      const info = await stat(file).catch(() => undefined)
      if (!info?.isFile()) continue
      result.set(file, `${info.mtimeMs}:${info.size}`)
    }
    return result
  }

  export const hasNativeBinding = () => !!watcher()

  export interface Interface {
    readonly init: () => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@ax-code/FileWatcher") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* InstanceState.make(
        Effect.fn("FileWatcher.state")(
          function* () {
            if (yield* Flag.AX_CODE_EXPERIMENTAL_DISABLE_FILEWATCHER) return

            log.info("init", { directory: Instance.directory })

            const subs: Array<() => Promise<unknown>> = []
            yield* Effect.addFinalizer(() => Effect.promise(() => Promise.allSettled(subs.map((close) => close()))))

            // Native watcher: OS-level events via Rust addon (fsevents/inotify)
            const subscribeNative = (dir: string, ignore: string[]) => {
              return Effect.tryPromise(async () => {
                const native = NativeAddon.fs()
                if (!native) throw new Error("native FS addon not available")
                const watcher = new native.NativeWatcher(dir, JSON.stringify(ignore))

                let pollErrorCount = 0
                const pollInterval = setInterval(
                  Instance.bind(() => {
                    try {
                      const eventsJson = NativePerf.run("fs.NativeWatcher.poll", dir, () => watcher.poll())
                      const events = JSON.parse(eventsJson) as Array<{ eventType: string; path: string }>
                      pollErrorCount = 0 // reset on success
                      for (const evt of events) {
                        const file = path.resolve(dir, evt.path)
                        Bus.publish(Event.Updated, { file, event: evt.eventType as "add" | "change" | "unlink" })
                      }
                    } catch (e) {
                      pollErrorCount++
                      if (pollErrorCount === 1 || pollErrorCount % 100 === 0) {
                        log.warn("native watcher poll error", { error: e, count: pollErrorCount })
                      }
                    }
                  }),
                  50,
                ) // Poll native event queue every 50ms (lightweight — no filesystem scan)

                subs.push(async () => {
                  clearInterval(pollInterval)
                  watcher.stop()
                })
              }).pipe(Effect.timeout(SUBSCRIBE_TIMEOUT_MS))
            }

            const subscribePoll = (dir: string, ignore: string[]) => {
              return Effect.tryPromise(async () => {
                let prev = await snapshot(dir, ignore)
                let busy = false
                const tick = Instance.bind(async () => {
                  if (busy) return
                  busy = true
                  try {
                    const next = await snapshot(dir, ignore)
                    for (const [file, hash] of next) {
                      const last = prev.get(file)
                      if (!last) Bus.publish(Event.Updated, { file, event: "add" })
                      else if (last !== hash) Bus.publish(Event.Updated, { file, event: "change" })
                    }
                    for (const file of prev.keys()) {
                      if (!next.has(file)) Bus.publish(Event.Updated, { file, event: "unlink" })
                    }
                    prev = next
                  } finally {
                    busy = false
                  }
                })

                const id = setInterval(() => {
                  void tick()
                }, POLL_MS)

                subs.push(async () => {
                  clearInterval(id)
                })
              }).pipe(
                Effect.timeout(SUBSCRIBE_TIMEOUT_MS),
                Effect.catchCause((cause) => {
                  log.error("failed to subscribe", {
                    dir,
                    cause: Cause.pretty(cause),
                    native: false,
                  })
                  return Effect.void
                }),
              )
            }

            // Try native watcher first, fall back to polling on failure
            const subscribe = (dir: string, ignore: string[]) => {
              return subscribeNative(dir, ignore).pipe(
                Effect.catchCause((cause) => {
                  log.warn("native watcher unavailable, falling back to polling (reduced performance)", {
                    dir,
                    pollMs: POLL_MS,
                    cause: Cause.pretty(cause),
                  })
                  return subscribePoll(dir, ignore)
                }),
              )
            }

            const cfg = yield* Effect.promise(() => Config.get())
            const cfgIgnores = cfg.watcher?.ignore ?? []

            if (yield* Flag.AX_CODE_EXPERIMENTAL_FILEWATCHER) {
              yield* subscribe(Instance.directory, [
                ...FileIgnore.PATTERNS,
                ...cfgIgnores,
                ...protecteds(Instance.directory),
              ])
            }

            if (Instance.project.vcs === "git") {
              const result = yield* Effect.promise(() =>
                git(["rev-parse", "--git-dir"], {
                  cwd: Instance.project.worktree,
                }),
              )
              const vcsDir =
                result.exitCode === 0 ? path.resolve(Instance.project.worktree, result.text().trim()) : undefined
              if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
                const ignore = (yield* Effect.promise(() => readdir(vcsDir).catch(() => []))).filter(
                  (entry) => entry !== "HEAD",
                )
                yield* subscribe(vcsDir, ignore)
              }
            }
          },
          Effect.catchCause((cause) => {
            log.error("failed to init watcher service", { cause: Cause.pretty(cause) })
            return Effect.void
          }),
        ),
      )

      return Service.of({
        init: Effect.fn("FileWatcher.init")(function* () {
          yield* InstanceState.get(state)
        }),
      })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export function init() {
    return runPromise((svc) => svc.init())
  }
}
