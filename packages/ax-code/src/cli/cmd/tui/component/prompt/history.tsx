import { onCleanup, onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import type { AgentPart, FilePart, TextPart } from "@ax-code/sdk/v2"
import { scheduleDeferredStartupTask } from "@tui/util/startup-task"
import { optionalStateErrorMessage, shouldSurfaceOptionalStateError } from "@tui/util/optional-state"
import { useToast } from "../../ui/toast"
import { Log } from "@/util/log"
import z from "zod"
import { useSDK } from "@tui/context/sdk"
import { directoryRequestHeaders } from "@tui/util/request-headers"

export type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: (
    | Omit<FilePart, "id" | "messageID" | "sessionID">
    | Omit<AgentPart, "id" | "messageID" | "sessionID">
    | (Omit<TextPart, "id" | "messageID" | "sessionID"> & {
        source?: {
          text: {
            start: number
            end: number
            value: string
          }
        }
      })
  )[]
}

const PromptInfoSchema = z
  .object({
    input: z.string(),
    mode: z.enum(["normal", "shell"]).optional(),
    parts: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .passthrough()

const isPromptInfo = (value: unknown): value is PromptInfo => {
  if (!value || typeof value !== "object") return false
  const candidate = value as { input?: unknown; mode?: unknown; parts?: unknown }
  if (typeof candidate.input !== "string") return false
  if (candidate.mode !== undefined && candidate.mode !== "normal" && candidate.mode !== "shell") return false
  if (!Array.isArray(candidate.parts)) return false
  for (const part of candidate.parts) {
    if (!part || typeof part !== "object") return false
    if (typeof (part as { type?: unknown }).type !== "string") return false
  }
  return true
}

const MAX_HISTORY_ENTRIES = 50
const HISTORY_LOAD_DELAY_MS = 100
const log = Log.create({ service: "tui.prompt-history" })

export const { use: usePromptHistory, provider: PromptHistoryProvider } = createSimpleContext({
  name: "PromptHistory",
  init: () => {
    const sdk = useSDK()
    const toast = useToast()
    let writeWarningShown = false

    function historyHeaders(input: { contentType?: string } = {}) {
      return directoryRequestHeaders({
        directory: sdk.directory,
        accept: "application/json",
        contentType: input.contentType,
      })
    }

    async function loadProjectHistory() {
      const response = await sdk.fetch(`${sdk.url}/prompt-history?limit=${MAX_HISTORY_ENTRIES}`, {
        headers: historyHeaders(),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
      const body = await response.json()
      const parsed = z.array(PromptInfoSchema).safeParse(body)
      if (!parsed.success) return []
      return parsed.data.filter(isPromptInfo)
    }

    async function appendProjectHistory(entry: PromptInfo) {
      const response = await sdk.fetch(`${sdk.url}/prompt-history`, {
        method: "POST",
        headers: historyHeaders({ contentType: "application/json" }),
        body: JSON.stringify(entry),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
    }

    onMount(() => {
      const cancel = scheduleDeferredStartupTask(
        async () => {
          const lines = await loadProjectHistory().catch((error) => {
            log.warn("failed to load prompt history", { error })
            if (shouldSurfaceOptionalStateError(error)) {
              toast.show({
                message: optionalStateErrorMessage(error, "Failed to load prompt history"),
                variant: "warning",
                duration: 3000,
              })
            }
            return []
          })

          const merged = [...lines, ...store.history].slice(-MAX_HISTORY_ENTRIES)
          setStore("history", merged)
        },
        {
          delayMs: HISTORY_LOAD_DELAY_MS,
        },
      )
      onCleanup(cancel)
    })

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

        void appendProjectHistory(entry)
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
