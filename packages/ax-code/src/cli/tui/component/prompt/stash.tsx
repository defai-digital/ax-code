import path from "path"
import { createHash } from "crypto"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { FileLock } from "@/util/filelock"
import { onCleanup, onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import { appendFile, writeFile } from "fs/promises"
import { parseStashLine, type StashEntry } from "./stash-util"
import { Log } from "@/util/log"
import { scheduleDeferredStartupTask } from "@tui/util/startup-task"
import { optionalStateErrorMessage, shouldSurfaceOptionalStateError } from "@tui/util/optional-state"
import { useToast } from "../../ui/toast"

export type { StashEntry } from "./stash-util"

const MAX_STASH_ENTRIES = 50
const STASH_LOAD_DELAY_MS = 50
const log = Log.create({ service: "tui.prompt-stash" })

function serialize(entries: StashEntry[]) {
  return entries.length > 0 ? entries.map((line) => JSON.stringify(line)).join("\n") + "\n" : ""
}

/** Merge by id (later wins), oldest first, bounded to the stash limit. */
function mergeStashEntries(base: StashEntry[], extra: StashEntry[]): StashEntry[] {
  const byID = new Map<string, StashEntry>()
  for (const entry of [...base, ...extra]) byID.set(entry.id, entry)
  return [...byID.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-MAX_STASH_ENTRIES)
}

export const { use: usePromptStash, provider: PromptStashProvider } = createSimpleContext({
  name: "PromptStash",
  init: () => {
    const stashPath = path.join(Global.Path.state, "prompt-stash.jsonl")
    const toast = useToast()
    let writeWarningShown = false
    // Reads and writes share one queue: fs operations may complete out of
    // issuance order, and a pop/remove rewrite landing before an earlier push
    // append would resurrect the removed entry on the next load.
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
        using _guard = await FileLock.acquire(stashPath)
        return await fn()
      })
    }

    async function readStashEntries(): Promise<StashEntry[]> {
      const text = await Filesystem.readText(stashPath).catch((error) => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return ""
        throw error
      })
      return (
        text
          .split("\n")
          .filter(Boolean)
          // Id-less legacy lines get a stable content-derived id so repeated
          // reads (load + rewrite) merge them as one entry instead of doubling.
          .map((line) => parseStashLine(line, () => createHash("sha1").update(line).digest("hex")))
          .filter((line): line is StashEntry => line !== undefined)
      )
    }

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

    // Rewrites apply their mutation to the freshest disk state under the lock
    // instead of overwriting the file with this window's in-memory snapshot.
    const persistStash = (mutate: (entries: StashEntry[]) => StashEntry[], operation: string) =>
      locked(async () => {
        const fresh = await readStashEntries()
        await writeFile(stashPath, serialize(mutate(fresh)))
      })
        .then(() => {
          writeWarningShown = false
        })
        .catch(handleWriteFailure(operation))

    onMount(() => {
      const cancel = scheduleDeferredStartupTask(
        async () => {
          const lines = await locked(() => readStashEntries()).catch((error) => {
            log.warn("failed to load prompt stash", { stashPath, error })
            if (shouldSurfaceOptionalStateError(error)) {
              toast.show({
                message: optionalStateErrorMessage(error, "Failed to load prompt stash"),
                variant: "warning",
                duration: 3000,
              })
            }
            return [] as StashEntry[]
          })

          const merged = mergeStashEntries(lines, store.entries)
          setStore("entries", merged)

          // Normalize the freshest disk state (drop invalid lines, heal ids).
          // Never union the load-time snapshot back in: it would resurrect
          // entries another window removed after our read.
          if (merged.length > 0) {
            void persistStash((fresh) => fresh, "rewrite")
          }
        },
        {
          name: "prompt-stash-load",
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
        setStore(
          produce((draft) => {
            draft.entries.push(stash)
            if (draft.entries.length > MAX_STASH_ENTRIES) {
              draft.entries = draft.entries.slice(-MAX_STASH_ENTRIES)
              trimmed = true
            }
          }),
        )

        if (trimmed) {
          // The trim rewrite must carry the new entry: the append below is
          // skipped on this path, so mutating only the disk state would lose
          // every push made while the list is full.
          void persistStash((fresh) => mergeStashEntries(fresh, [stash]), "trim")
          return
        }

        void locked(() => appendFile(stashPath, JSON.stringify(stash) + "\n"))
          .then(() => {
            writeWarningShown = false
          })
          .catch(handleWriteFailure("append"))
      },
      pop() {
        if (store.entries.length === 0) return undefined
        const entry = store.entries[store.entries.length - 1]
        setStore(
          produce((draft) => {
            draft.entries.pop()
          }),
        )
        void persistStash((entries) => entries.filter((item) => item.id !== entry.id), "pop")
        return entry
      },
      remove(id: string) {
        if (!id) return
        let removed = false
        setStore(
          produce((draft) => {
            const index = draft.entries.findIndex((entry) => entry.id === id)
            if (index < 0) return
            removed = true
            draft.entries.splice(index, 1)
          }),
        )
        if (!removed) return
        void persistStash((entries) => entries.filter((item) => item.id !== id), "remove")
      },
    }
  },
})
