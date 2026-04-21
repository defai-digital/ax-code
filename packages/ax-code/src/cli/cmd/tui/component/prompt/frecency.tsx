import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import { appendFile, writeFile } from "fs/promises"
import { scheduleDeferredStartupTask } from "@tui/util/startup-task"
import { useToast } from "../../ui/toast"
import { Log } from "@/util/log"

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

    const persistFrecency = (content: string) =>
      writeFile(frecencyPath, content)
        .then(() => {
          writeWarningShown = false
        })
        .catch((error) => {
          log.warn("failed to persist frecency data", { frecencyPath, error })
          if (writeWarningShown) return
          writeWarningShown = true
          toast.show({
            message: error instanceof Error ? error.message : "Failed to save file frecency",
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
      const content =
        sorted.map(([entryPath, entry]) => JSON.stringify({ path: entryPath, ...entry })).join("\n") + "\n"
      void persistFrecency(content)
    }

    onMount(() => {
      const cancel = scheduleDeferredStartupTask(
        async () => {
          const text = await Filesystem.readText(frecencyPath).catch((error) => {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return ""
            log.warn("failed to load frecency data", { frecencyPath, error })
            toast.show({
              message: error instanceof Error ? error.message : "Failed to load file frecency",
              variant: "warning",
              duration: 3000,
            })
            return ""
          })
          const lines = text
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              try {
                return JSON.parse(line) as { path: string; frequency: number; lastOpen: number }
              } catch {
                return null
              }
            })
            .filter((line): line is { path: string; frequency: number; lastOpen: number } => line !== null)

          const latest = lines.reduce(
            (acc, entry) => {
              acc[entry.path] = entry
              return acc
            },
            {} as Record<string, { path: string; frequency: number; lastOpen: number }>,
          )

          for (const [entryPath, entry] of Object.entries(store.data)) {
            const current = latest[entryPath]
            if (!current || entry.lastOpen >= current.lastOpen) {
              latest[entryPath] = {
                path: entryPath,
                frequency: entry.frequency,
                lastOpen: entry.lastOpen,
              }
            }
          }

          const merged = Object.values(latest)
            .sort((a, b) => b.lastOpen - a.lastOpen)
            .slice(0, MAX_FRECENCY_ENTRIES)

          setStore(
            "data",
            Object.fromEntries(
              merged.map((entry) => [entry.path, { frequency: entry.frequency, lastOpen: entry.lastOpen }]),
            ),
          )
          writesSinceCompact = 0

          if (merged.length > 0) {
            const content = merged.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
            void persistFrecency(content)
          }
        },
        {
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
      void appendFile(frecencyPath, JSON.stringify({ path: absolutePath, ...newEntry }) + "\n")
        .then(() => {
          writeWarningShown = false
        })
        .catch((error) => {
          log.warn("failed to append frecency data", { frecencyPath, error })
          if (writeWarningShown) return
          writeWarningShown = true
          toast.show({
            message: error instanceof Error ? error.message : "Failed to save file frecency",
            variant: "warning",
            duration: 3000,
          })
        })

      if (
        Object.keys(store.data).length > MAX_FRECENCY_ENTRIES ||
        writesSinceCompact >= FRECENCY_COMPACT_WRITE_THRESHOLD
      ) {
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
