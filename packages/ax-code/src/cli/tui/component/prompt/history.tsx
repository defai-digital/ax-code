import { createEffect, on, onCleanup, onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import { scheduleDeferredStartupTask } from "@tui/util/startup-task"
import { optionalStateErrorMessage, shouldSurfaceOptionalStateError } from "@tui/util/optional-state"
import { useToast } from "../../ui/toast"
import { Log } from "@/util/log"
import { useSDK } from "@tui/context/sdk"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { parsePromptInfoList, type PromptInfo } from "./prompt-info"
import { promptHistoryNavigationAllowed } from "./prompt-helpers"

export type { PromptInfo } from "./prompt-info"

const MAX_HISTORY_ENTRIES = 50
const HISTORY_LOAD_DELAY_MS = 100
const log = Log.create({ service: "tui.prompt-history" })

function entryKey(entry: PromptInfo) {
  return JSON.stringify([entry.input, entry.mode ?? null, entry.parts])
}

function mergeProjectHistory(persisted: PromptInfo[], local: PromptInfo[]) {
  const persistedKeys = persisted.map(entryKey)
  const localKeys = local.map(entryKey)
  // A GET can already include the first local POSTs. Keep the local suffix
  // once, in order, including entries appended while the GET was pending.
  let overlap = Math.min(persisted.length, local.length)
  while (overlap > 0) {
    if (
      localKeys.slice(0, overlap).every((value, index) => value === persistedKeys[persisted.length - overlap + index])
    )
      break
    overlap--
  }
  return [...persisted.slice(0, persisted.length - overlap), ...local].slice(-MAX_HISTORY_ENTRIES)
}

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const sdk = useSDK()
    const toast = useToast()
    let writeWarningShown = false
    let loadGeneration = 0
    const pendingWrites = new Map<string | undefined, Promise<void>>()

    function historyHeaders(input: { directory?: string; contentType?: string } = {}) {
      return directoryRequestHeaders({
        directory: input.directory,
        accept: "application/json",
        contentType: input.contentType,
      })
    }

    async function loadProjectHistory(directory: string | undefined) {
      const response = await sdk.fetch(`${sdk.url}/prompt-history?limit=${MAX_HISTORY_ENTRIES}`, {
        headers: historyHeaders({ directory }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
      const body = await response.json()
      return parsePromptInfoList(body)
    }

    async function appendProjectHistory(entry: PromptInfo, directory: string | undefined) {
      const response = await sdk.fetch(`${sdk.url}/prompt-history`, {
        method: "POST",
        headers: historyHeaders({ directory, contentType: "application/json" }),
        body: JSON.stringify(entry),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
    }

    function queueProjectHistory(entry: PromptInfo, directory: string | undefined) {
      // Requests may reach the server out of order when sent concurrently.
      // Sequence each workspace independently, including across directory switches.
      const previous = pendingWrites.get(directory)
      const write = previous
        ? previous.catch(() => undefined).then(() => appendProjectHistory(entry, directory))
        : appendProjectHistory(entry, directory)
      pendingWrites.set(directory, write)
      const release = () => {
        if (pendingWrites.get(directory) === write) pendingWrites.delete(directory)
      }
      void write.then(release, release)
      return write
    }

    async function refreshProjectHistory(directory: string | undefined) {
      const generation = ++loadGeneration
      // A workspace switch clears the local store and reloads while a save may
      // still be in flight. If the GET is answered before the POST commits, the
      // refreshed history drops the just-submitted prompt. Let pending saves
      // settle first so the reload reads the committed rows; a failed save must
      // not block the reload.
      await Promise.all([...pendingWrites.values()].map((write) => write.catch(() => undefined)))
      const lines = await loadProjectHistory(directory).catch((error) => {
        log.warn("failed to load prompt history", { directory, error })
        if (shouldSurfaceOptionalStateError(error)) {
          toast.show({
            message: optionalStateErrorMessage(error, "Failed to load prompt history"),
            variant: "warning",
            duration: 3000,
          })
        }
        return []
      })
      if (generation !== loadGeneration) return
      setStore(
        produce((draft) => {
          // Existing local entries remain the suffix, so negative navigation
          // offsets still name the same prompt after the load completes.
          draft.history = mergeProjectHistory(lines, draft.history)
        }),
      )
    }

    onMount(() => {
      const cancel = scheduleDeferredStartupTask(
        async () => {
          // A directory change may already have started the current load. A
          // second GET would merge previously loaded rows as local submissions.
          if (loadGeneration !== 0) return
          await refreshProjectHistory(sdk.directory)
        },
        {
          name: "prompt-history-load",
          delayMs: HISTORY_LOAD_DELAY_MS,
        },
      )
      onCleanup(cancel)
    })

    createEffect(
      on(
        () => sdk.directory,
        (directory) => {
          setStore("history", [])
          setStore("index", 0)
          void refreshProjectHistory(directory)
        },
        { defer: true },
      ),
    )

    const [store, setStore] = createStore({
      index: 0,
      history: [] as PromptInfo[],
    })

    return {
      move(direction: 1 | -1, input: string) {
        if (!store.history.length) return undefined
        // Clearing a recalled draft (Escape/Ctrl+C), deleting its text, or
        // mounting another session starts a fresh traversal at the newest row.
        if (!input.length) setStore("index", 0)
        // Index 0 is the live-draft position — history.at(0) would be the
        // *oldest* entry, so the guard must not compare the draft against it.
        if (!promptHistoryNavigationAllowed({ index: store.index, draft: input, history: store.history })) return
        let nextIndex = store.index
        setStore(
          produce((draft) => {
            const next = draft.index + direction
            if (Math.abs(next) > store.history.length) return
            if (next > 0) return
            draft.index = next
            nextIndex = draft.index
          }),
        )
        if (nextIndex === 0)
          return {
            input: "",
            parts: [],
          }
        const recalled = store.history.at(nextIndex)
        // The composer edits its own store. Never share the saved entry or its
        // attachment parts with that mutable draft.
        return recalled ? structuredClone(unwrap(recalled)) : undefined
      },
      append(item: PromptInfo) {
        const entry = structuredClone(unwrap(item))
        const directory = sdk.directory
        let trimmed = false
        setStore(
          produce((draft) => {
            // Match the server's consecutive-entry deduplication while still
            // posting each submission so a failed earlier save can be retried.
            const last = draft.history.at(-1)
            if (!last || entryKey(last) !== entryKey(entry)) draft.history.push(entry)
            if (draft.history.length > MAX_HISTORY_ENTRIES) {
              draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
              trimmed = true
            }
            draft.index = 0
          }),
        )

        if (trimmed) {
          writeWarningShown = false
        }

        void queueProjectHistory(entry, directory)
          .then(() => {
            writeWarningShown = false
          })
          .catch((error) => {
            if (writeWarningShown) return
            writeWarningShown = true
            log.warn("failed to append prompt history", { error })
            if (!shouldSurfaceOptionalStateError(error)) return
            toast.show({
              message: optionalStateErrorMessage(error, "Failed to save prompt history"),
              variant: "warning",
              duration: 3000,
            })
          })
      },
    }
  },
})
