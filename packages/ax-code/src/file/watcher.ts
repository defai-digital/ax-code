// @ts-ignore
import { createWrapper } from "@parcel/watcher/wrapper"
import { readdir, stat } from "fs/promises"
import path from "path"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Flag } from "@/flag/flag"
import { NativeAddon } from "@/native/addon"
import { NativePerf } from "@/perf/native"
import { Instance } from "@/project/instance"
import { git } from "@/util/git"
import { lazy } from "@/util/lazy"
import { withTimeout } from "@/util/timeout"
import { Config } from "../config/config"
import { FileIgnore } from "./ignore"
import { Protected } from "./protected"
import { Log } from "../util/log"

declare const AX_CODE_LIBC: string | undefined

export namespace FileWatcher {
  const log = Log.create({ service: "file.watcher" })
  const SUBSCRIBE_TIMEOUT_MS = 10_000
  const POLL_MS = 100

  type CloseHandle = () => Promise<unknown> | unknown

  interface State {
    directory: string
    override: InitOptions | undefined
    dispose: () => Promise<void>
  }

  export interface InitOptions {
    enabled?: boolean
    disabled?: boolean
  }

  export const Event = {
    Updated: BusEvent.define(
      "file.watcher.updated",
      z.object({
        file: z.string(),
        event: z.union([z.literal("add"), z.literal("change"), z.literal("unlink")]),
      }),
    ),
  }

  const overrides = new Map<string, InitOptions>()

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

  function flagBoolean(name: string, defaultValue: boolean) {
    const value = process.env[name]?.toLowerCase()
    if (value === "true" || value === "1") return true
    if (value === "false" || value === "0") return false
    return defaultValue
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

  function clearOverride(directory: string, override: InitOptions | undefined) {
    if (!override) return
    if (overrides.get(directory) !== override) return
    overrides.delete(directory)
  }

  async function disposeState(directory: string, handles: CloseHandle[], override: InitOptions | undefined) {
    clearOverride(directory, override)
    await Promise.allSettled(handles.map((close) => Promise.resolve().then(() => close())))
  }

  export const hasNativeBinding = () => !!watcher()

  const state = Instance.state(
    async () => {
      const directory = Instance.directory
      const override = overrides.get(directory)
      const disabled = override?.disabled ?? flagBoolean("AX_CODE_EXPERIMENTAL_DISABLE_FILEWATCHER", false)
      const enabled = override?.enabled ?? flagBoolean("AX_CODE_EXPERIMENTAL_FILEWATCHER", false)

      if (disabled || !enabled) {
        return {
          directory,
          override,
          dispose: async () => {
            clearOverride(directory, override)
          },
        } satisfies State
      }

      log.info("init", { directory })
      const handles: CloseHandle[] = []

      const subscribeNative = async (dir: string, ignore: string[]) => {
        const native = NativeAddon.fs()
        if (!native) throw new Error("@ax-code/fs native addon unavailable")
        const watcher = new native.NativeWatcher(dir, JSON.stringify(ignore))

        let pollErrorCount = 0
        const pollInterval = setInterval(
          Instance.bind(() => {
            try {
              const eventsJson = NativePerf.run("fs.NativeWatcher.poll", dir, () => watcher.poll())
              const events = JSON.parse(eventsJson) as Array<{ eventType: string; path: string }>
              pollErrorCount = 0
              for (const evt of events) {
                const file = path.resolve(dir, evt.path)
                void Bus.publish(Event.Updated, { file, event: evt.eventType as "add" | "change" | "unlink" })
              }
            } catch (error) {
              pollErrorCount++
              if (pollErrorCount === 1 || pollErrorCount % 100 === 0) {
                log.warn("native watcher poll error", { error, count: pollErrorCount })
              }
            }
          }),
          50,
        )

        handles.push(async () => {
          clearInterval(pollInterval)
          watcher.stop()
        })
      }

      const subscribePoll = async (dir: string, ignore: string[]) => {
        try {
          let prev = await withTimeout(
            snapshot(dir, ignore),
            SUBSCRIBE_TIMEOUT_MS,
            `Timed out after ${SUBSCRIBE_TIMEOUT_MS}ms`,
          )
          let busy = false
          const tick = Instance.bind(async () => {
            if (busy) return
            busy = true
            try {
              const next = await snapshot(dir, ignore)
              for (const [file, hash] of next) {
                const last = prev.get(file)
                if (!last) await Bus.publish(Event.Updated, { file, event: "add" })
                else if (last !== hash) await Bus.publish(Event.Updated, { file, event: "change" })
              }
              for (const file of prev.keys()) {
                if (!next.has(file)) await Bus.publish(Event.Updated, { file, event: "unlink" })
              }
              prev = next
            } finally {
              busy = false
            }
          })

          const id = setInterval(() => {
            void tick()
          }, POLL_MS)

          handles.push(async () => {
            clearInterval(id)
          })
        } catch (error) {
          log.error("failed to subscribe", {
            dir,
            error,
            native: false,
          })
        }
      }

      const subscribe = async (dir: string, ignore: string[]) => {
        if (Flag.AX_CODE_NATIVE_FS) {
          try {
            await withTimeout(
              subscribeNative(dir, ignore),
              SUBSCRIBE_TIMEOUT_MS,
              `Timed out after ${SUBSCRIBE_TIMEOUT_MS}ms`,
            )
            return
          } catch {
            await subscribePoll(dir, ignore)
            return
          }
        }

        await subscribePoll(dir, ignore)
      }

      const cfg = await Config.get()
      const cfgIgnores = cfg.watcher?.ignore ?? []

      await subscribe(directory, [...FileIgnore.PATTERNS, ...cfgIgnores, ...protecteds(directory)])

      if (Instance.project.vcs === "git") {
        const result = await git(["rev-parse", "--git-dir"], {
          cwd: Instance.project.worktree,
        })
        const vcsDir =
          result.exitCode === 0 ? path.resolve(Instance.project.worktree, result.text().trim()) : undefined
        if (vcsDir && !cfgIgnores.includes(".git") && !cfgIgnores.includes(vcsDir)) {
          const ignore = (await readdir(vcsDir).catch(() => [])).filter((entry) => entry !== "HEAD")
          await subscribe(vcsDir, ignore)
        }
      }

      return {
        directory,
        override,
        dispose: () => disposeState(directory, handles, override),
      } satisfies State
    },
    async (entry) => {
      await entry.dispose()
    },
  )

  export async function init(options?: InitOptions) {
    let shouldInvalidate = false
    if (options) {
      const current = overrides.get(Instance.directory)
      const next = {
        ...current,
        ...options,
      }
      shouldInvalidate = !current || current.enabled !== next.enabled || current.disabled !== next.disabled
      if (shouldInvalidate) overrides.set(Instance.directory, next)
    }
    if (shouldInvalidate) {
      await state.invalidate()
    }
    await state()
  }
}
