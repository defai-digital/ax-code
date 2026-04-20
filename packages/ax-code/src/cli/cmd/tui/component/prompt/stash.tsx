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

export type StashEntry = {
  input: string
  parts: PromptInfo["parts"]
  timestamp: number
}

const MAX_STASH_ENTRIES = 50
const STASH_LOAD_DELAY_MS = 50
const log = Log.create({ service: "tui.prompt-stash" })

function logStashWriteFailure(operation: string) {
  return (error: unknown) => {
    log.warn("prompt stash write failed", { operation, error })
  }
}

function serialize(entries: StashEntry[]) {
  return entries.length > 0 ? entries.map((line) => JSON.stringify(line)).join("\n") + "\n" : ""
}

export const { use: usePromptStash, provider: PromptStashProvider } = createSimpleContext({
  name: "PromptStash",
  init: () => {
    const stashPath = path.join(Global.Path.state, "prompt-stash.jsonl")
    onMount(() => {
      const cancel = scheduleDeferredStartupTask(
        async () => {
          const text = await Filesystem.readText(stashPath).catch(() => "")
          const lines = text
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              try {
                return JSON.parse(line)
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
            writeFile(stashPath, content).catch(logStashWriteFailure("rewrite"))
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
      push(entry: Omit<StashEntry, "timestamp">) {
        const stash = structuredClone(unwrap({ ...entry, timestamp: Date.now() }))
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
          writeFile(stashPath, serialize(nextEntries)).catch(logStashWriteFailure("trim"))
          return
        }

        appendFile(stashPath, JSON.stringify(stash) + "\n").catch(logStashWriteFailure("append"))
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
        writeFile(stashPath, serialize(nextEntries)).catch(logStashWriteFailure("pop"))
        return entry
      },
      remove(index: number) {
        if (index < 0 || index >= store.entries.length) return
        let nextEntries: StashEntry[] = []
        setStore(
          produce((draft) => {
            draft.entries.splice(index, 1)
            nextEntries = draft.entries.map((item) => structuredClone(unwrap(item)))
          }),
        )
        writeFile(stashPath, serialize(nextEntries)).catch(logStashWriteFailure("remove"))
      },
    }
  },
})
