import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { FileLock } from "@/util/filelock"
import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import { appendFile, rename, writeFile } from "fs/promises"
import { scheduleDeferredStartupTask } from "@tui/util/startup-task"
import { optionalStateErrorMessage, shouldSurfaceOptionalStateError } from "@tui/util/optional-state"
import { useToast } from "../../ui/toast"
import { Log } from "@/util/log"
import { recordCount } from "@/util/record"
import { parseFrecencyLine, type FrecencyEntry } from "./frecency-util"

function calculateFrecency(entry?: { frequency: number; lastOpen: number }): number {
  if (!entry) return 0
  const daysSince = (Date.now() - entry.lastOpen) / 86400000 // ms per day
  const weight = 1 / (1 + daysSince)
  return entry.frequency * weight
}

const MAX_FRECENCY_ENTRIES = 1000
const FRECENCY_LOAD_DELAY_MS = 75
const FRECENCY_COMPACT_WRITE_THRESHOLD = 100
const log = Log.create({ service: "tui.frecency" })

type FrecencyCount = { frequency: number; lastOpen: number }

/**
 * Counters are written as absolute session totals, so a line appended from a
 * stale base must never regress the merged count: keep the max of each field.
 */
function mergeFrecencyCount(a: FrecencyCount, b: FrecencyCount): FrecencyCount {
  return { frequency: Math.max(a.frequency, b.frequency), lastOpen: Math.max(a.lastOpen, b.lastOpen) }
}

export const { use: useFrecency, provider: FrecencyProvider } = createSimpleContext({
  name: "Frecency",
  init: () => {
    const frecencyPath = path.join(Global.Path.state, "frecency.jsonl")
    const toast = useToast()
    const [store, setStore] = createStore({
      data: {} as Record<string, { frequency: number; lastOpen: number }>,
    })
    let writesSinceCompact = 0
    let writeWarningShown = false
    // Reads and writes share one queue: fs operations may complete out of
    // issuance order, and a compact rewrite landing after a newer append
    // would drop that entry from disk until its next open.
    let writeChain: Promise<unknown> = Promise.resolve()
    function nextWrite<T>(write: () => Promise<T>): Promise<T> {
      const run = writeChain.then(write, write)
      writeChain = run.catch(() => undefined)
      return run
    }
    // Every read and write takes the cross-process lock: another TUI window
    // shares this file, rewrites merge into the freshest disk state, and a
    // load must not observe a truncated mid-rewrite file.
    function locked<T>(fn: () => Promise<T>): Promise<T> {
      return nextWrite(async () => {
        using _guard = await FileLock.acquire(frecencyPath)
        return await fn()
      })
    }

    async function readFrecencyEntries(): Promise<FrecencyEntry[]> {
      const text = await Filesystem.readText(frecencyPath).catch((error) => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return ""
        throw error
      })
      const byPath = new Map<string, FrecencyEntry>()
      for (const line of text.split("\n").filter(Boolean)) {
        const entry = parseFrecencyLine(line)
        if (!entry) continue
        const current = byPath.get(entry.path)
        byPath.set(entry.path, current ? { path: entry.path, ...mergeFrecencyCount(current, entry) } : entry)
      }
      return [...byPath.values()]
    }

    // Rewrites merge their snapshot into the freshest disk state under the
    // lock instead of overwriting the file with this window's in-memory copy.
    const persistFrecency = (entries: Record<string, FrecencyCount>) =>
      locked(async () => {
        const merged = new Map<string, FrecencyEntry>()
        for (const entry of await readFrecencyEntries()) merged.set(entry.path, entry)
        for (const [entryPath, entry] of Object.entries(entries)) {
          const current = merged.get(entryPath)
          merged.set(
            entryPath,
            current ? { path: entryPath, ...mergeFrecencyCount(current, entry) } : { path: entryPath, ...entry },
          )
        }
        const sorted = [...merged.values()].sort((a, b) => b.lastOpen - a.lastOpen).slice(0, MAX_FRECENCY_ENTRIES)
        // Atomic replace: a crash mid-write must not truncate the live file.
        // The cross-process lock makes the fixed temp name safe.
        const tempPath = `${frecencyPath}.tmp`
        const content = sorted.length > 0 ? sorted.map((entry) => JSON.stringify(entry)).join("\n") + "\n" : ""
        await writeFile(tempPath, content)
        await rename(tempPath, frecencyPath)
      })
        .then(() => {
          writeWarningShown = false
        })
        .catch((error) => {
          if (writeWarningShown) return
          writeWarningShown = true
          log.warn("failed to persist frecency data", { frecencyPath, error })
          if (!shouldSurfaceOptionalStateError(error)) return
          toast.show({
            message: optionalStateErrorMessage(error, "Failed to save file frecency"),
            variant: "warning",
            duration: 3000,
          })
        })

    function compact(entries = store.data) {
      const sorted = Object.entries(entries)
        .sort(([, a], [, b]) => b.lastOpen - a.lastOpen)
        .slice(0, MAX_FRECENCY_ENTRIES)
      setStore("data", Object.fromEntries(sorted))
      writesSinceCompact = 0
      // Enqueue the rewrite now: the write chain runs it after every pending
      // append, and any later append lands after it instead of being clobbered.
      void persistFrecency(Object.fromEntries(sorted))
    }

    onMount(() => {
      const cancel = scheduleDeferredStartupTask(
        async () => {
          const latest = await locked(() => readFrecencyEntries()).catch((error) => {
            log.warn("failed to load frecency data", { frecencyPath, error })
            if (shouldSurfaceOptionalStateError(error)) {
              toast.show({
                message: optionalStateErrorMessage(error, "Failed to load file frecency"),
                variant: "warning",
                duration: 3000,
              })
            }
            return [] as FrecencyEntry[]
          })

          const merged = new Map<string, FrecencyEntry>()
          for (const entry of latest) merged.set(entry.path, entry)
          for (const [entryPath, entry] of Object.entries(store.data)) {
            const current = merged.get(entryPath)
            merged.set(
              entryPath,
              current ? { path: entryPath, ...mergeFrecencyCount(current, entry) } : { path: entryPath, ...entry },
            )
          }

          const trimmed = [...merged.values()].sort((a, b) => b.lastOpen - a.lastOpen).slice(0, MAX_FRECENCY_ENTRIES)

          setStore(
            "data",
            Object.fromEntries(
              trimmed.map((entry) => [entry.path, { frequency: entry.frequency, lastOpen: entry.lastOpen }]),
            ),
          )
          writesSinceCompact = 0

          // Merge back under the lock even when nothing parsed so a fully
          // corrupt file is cleared and concurrent appends are preserved.
          void persistFrecency(
            Object.fromEntries(
              trimmed.map((entry) => [entry.path, { frequency: entry.frequency, lastOpen: entry.lastOpen }]),
            ),
          )
        },
        {
          name: "file-frecency-load",
          delayMs: FRECENCY_LOAD_DELAY_MS,
        },
      )
      onCleanup(cancel)
    })

    function updateFrecency(filePath: string) {
      const absolutePath = path.resolve(process.cwd(), filePath)
      const newEntry = {
        frequency: (store.data[absolutePath]?.frequency || 0) + 1,
        lastOpen: Date.now(),
      }
      setStore("data", absolutePath, newEntry)
      writesSinceCompact += 1
      // The write chain keeps this append ordered against compact rewrites.
      void locked(() => appendFile(frecencyPath, JSON.stringify({ path: absolutePath, ...newEntry }) + "\n"))
        .then(() => {
          writeWarningShown = false
        })
        .catch((error) => {
          if (writeWarningShown) return
          writeWarningShown = true
          log.warn("failed to append frecency data", { frecencyPath, error })
          if (!shouldSurfaceOptionalStateError(error)) return
          toast.show({
            message: optionalStateErrorMessage(error, "Failed to save file frecency"),
            variant: "warning",
            duration: 3000,
          })
        })

      if (recordCount(store.data) > MAX_FRECENCY_ENTRIES || writesSinceCompact >= FRECENCY_COMPACT_WRITE_THRESHOLD) {
        compact()
      }
    }

    return {
      getFrecency: (filePath: string) => calculateFrecency(store.data[path.resolve(process.cwd(), filePath)]),
      updateFrecency,
      data: () => store.data,
    }
  },
})
