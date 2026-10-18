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

function mergeProjectHistory(persisted: PromptInfo[], local: PromptInfo[]) {
  const key = (entry: PromptInfo) => JSON.stringify([entry.input, entry.mode ?? null, entry.parts])
  const persistedKeys = persisted.map(key)
  const localKeys = local.map(key)
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

    async function refreshProjectHistory(directory: string | undefined) {
      const generation = ++loadGeneration
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
        return store.history.at(nextIndex)
      },
      append(item: PromptInfo) {
        const entry = structuredClone(unwrap(item))
        const directory = sdk.directory
        let trimmed = false
        setStore(
          produce((draft) => {
            draft.history.push(entry)
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

        void appendProjectHistory(entry, directory)
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
