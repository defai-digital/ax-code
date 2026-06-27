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

export type { PromptInfo } from "./prompt-info"

const MAX_HISTORY_ENTRIES = 50
const HISTORY_LOAD_DELAY_MS = 100
const log = Log.create({ service: "tui.prompt-history" })

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

    async function refreshProjectHistory(options: { directory: string | undefined; mergeLocal: boolean }) {
      const generation = ++loadGeneration
      const lines = await loadProjectHistory(options.directory).catch((error) => {
        log.warn("failed to load prompt history", { directory: options.directory, error })
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
          const local = options.mergeLocal ? draft.history : []
          draft.history = [...lines, ...local].slice(-MAX_HISTORY_ENTRIES)
          draft.index = 0
        }),
      )
    }

    onMount(() => {
      const cancel = scheduleDeferredStartupTask(
        async () => {
          await refreshProjectHistory({ directory: sdk.directory, mergeLocal: true })
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
          void refreshProjectHistory({ directory, mergeLocal: false })
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
        const current = store.history.at(store.index)
        if (!current) return undefined
        if (current.input !== input && input.length) return
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
