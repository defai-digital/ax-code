import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { onCleanup, onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import { appendFile, writeFile } from "fs/promises"
import type { PromptInfo } from "./history"
import { Log } from "@/util/log"
import { scheduleDeferredStartupTask } from "@tui/util/startup-task"
import { optionalStateErrorMessage, shouldSurfaceOptionalStateError } from "@tui/util/optional-state"
import { useToast } from "../../ui/toast"

export type StashEntry = {
  id: string
  input: string
  parts: PromptInfo["parts"]
  timestamp: number
}

const MAX_STASH_ENTRIES = 50
const STASH_LOAD_DELAY_MS = 50
const log = Log.create({ service: "tui.prompt-stash" })

function serialize(entries: StashEntry[]) {
  return entries.length > 0 ? entries.map((line) => JSON.stringify(line)).join("\n") + "\n" : ""
}

export const { use: usePromptStash, provider: PromptStashProvider } = createSimpleContext({
  name: "PromptStash",
  init: () => {
    const stashPath = path.join(Global.Path.state, "prompt-stash.jsonl")
    const toast = useToast()
    let writeWarningShown = false

    const handleWriteFailure = (operation: string) => (error: unknown) => {
      if (writeWarningShown) return
      writeWarningShown = true
      log.warn("prompt stash write failed", { operation, error, stashPath })
      if (!shouldSurfaceOptionalStateError(error)) return
      toast.show({
        message: optionalStateErrorMessage(error, "Failed to save prompt stash"),
        variant: "warning",
        duration: 3000,
      })
    }

    const persistStash = (content: string, operation: string) =>
      writeFile(stashPath, content)
        .then(() => {
          writeWarningShown = false
        })
        .catch(handleWriteFailure(operation))

    onMount(() => {
      const cancel = scheduleDeferredStartupTask(
        async () => {
          const text = await Filesystem.readText(stashPath).catch((error) => {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return ""
            log.warn("failed to load prompt stash", { stashPath, error })
            if (shouldSurfaceOptionalStateError(error)) {
              toast.show({
                message: optionalStateErrorMessage(error, "Failed to load prompt stash"),
                variant: "warning",
                duration: 3000,
              })
            }
            return ""
          })
          const lines = text
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              try {
                const parsed = JSON.parse(line)
                if (!parsed || typeof parsed !== "object") return null
                return {
                  ...parsed,
                  id: typeof parsed.id === "string" ? parsed.id : crypto.randomUUID(),
                }
              } catch {
                return null
              }
            })
            .filter((line): line is StashEntry => line !== null)
            .slice(-MAX_STASH_ENTRIES)

          const merged = [...lines, ...store.entries]
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-MAX_STASH_ENTRIES)
          setStore("entries", merged)

          // Rewrite file with only valid entries to self-heal corruption
          if (merged.length > 0) {
            const content = merged.map((line) => JSON.stringify(line)).join("\n") + "\n"
            void persistStash(content, "rewrite")
          }
        },
        {
          delayMs: STASH_LOAD_DELAY_MS,
        },
      )
      onCleanup(cancel)
    })

    const [store, setStore] = createStore({
      entries: [] as StashEntry[],
    })

    return {
      list() {
        return store.entries
      },
      push(entry: Omit<StashEntry, "id" | "timestamp">) {
        const stash = structuredClone(
          unwrap({
            ...entry,
            id: crypto.randomUUID(),
            timestamp: Date.now(),
          }),
        )
        let trimmed = false
        let nextEntries: StashEntry[] = []
        setStore(
          produce((draft) => {
            draft.entries.push(stash)
            if (draft.entries.length > MAX_STASH_ENTRIES) {
              draft.entries = draft.entries.slice(-MAX_STASH_ENTRIES)
              trimmed = true
            }
            nextEntries = draft.entries.map((item) => structuredClone(unwrap(item)))
          }),
        )

        if (trimmed) {
          void persistStash(serialize(nextEntries), "trim")
          return
        }

        void appendFile(stashPath, JSON.stringify(stash) + "\n")
          .then(() => {
            writeWarningShown = false
          })
          .catch(handleWriteFailure("append"))
      },
      pop() {
        if (store.entries.length === 0) return undefined
        const entry = store.entries[store.entries.length - 1]
        let nextEntries: StashEntry[] = []
        setStore(
          produce((draft) => {
            draft.entries.pop()
            nextEntries = draft.entries.map((item) => structuredClone(unwrap(item)))
          }),
        )
        void persistStash(serialize(nextEntries), "pop")
        return entry
      },
      remove(id: string) {
        if (!id) return
        let removed = false
        let nextEntries: StashEntry[] = []
        setStore(
          produce((draft) => {
            const index = draft.entries.findIndex((entry) => entry.id === id)
            if (index < 0) return
            removed = true
            draft.entries.splice(index, 1)
            nextEntries = draft.entries.map((item) => structuredClone(unwrap(item)))
          }),
        )
        if (!removed) return
        void persistStash(serialize(nextEntries), "remove")
      },
    }
  },
})
