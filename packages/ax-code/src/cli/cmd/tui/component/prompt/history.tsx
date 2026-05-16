import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { onCleanup, onMount } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { createSimpleContext } from "../../context/helper"
import { appendFile, writeFile } from "fs/promises"
import type { AgentPart, FilePart, TextPart } from "@ax-code/sdk/v2"
import { scheduleDeferredStartupTask } from "@tui/util/startup-task"
import { optionalStateErrorMessage, shouldSurfaceOptionalStateError } from "@tui/util/optional-state"
import { useToast } from "../../ui/toast"
import { Log } from "@/util/log"
import z from "zod"

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
    const historyPath = path.join(Global.Path.state, "prompt-history.jsonl")
    const toast = useToast()
    let writeWarningShown = false

    const persistHistory = (content: string) =>
      writeFile(historyPath, content)
        .then(() => {
          writeWarningShown = false
        })
        .catch((error) => {
          if (writeWarningShown) return
          writeWarningShown = true
          log.warn("failed to persist prompt history", { historyPath, error })
          if (!shouldSurfaceOptionalStateError(error)) return
          toast.show({
            message: optionalStateErrorMessage(error, "Failed to save prompt history"),
            variant: "warning",
            duration: 3000,
          })
        })

    onMount(() => {
      const cancel = scheduleDeferredStartupTask(
        async () => {
          const text = await Filesystem.readText(historyPath).catch((error) => {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return ""
            log.warn("failed to load prompt history", { historyPath, error })
            if (shouldSurfaceOptionalStateError(error)) {
              toast.show({
                message: optionalStateErrorMessage(error, "Failed to load prompt history"),
                variant: "warning",
                duration: 3000,
              })
            }
            return ""
          })
          const lines = text
            .split("\n")
            .filter(Boolean)
            .flatMap((line) => {
              try {
                const parsed = PromptInfoSchema.safeParse(JSON.parse(line))
                if (!parsed.success) return []
                if (!isPromptInfo(parsed.data)) return []
                return [parsed.data]
              } catch {
                return []
              }
            })
            .slice(-MAX_HISTORY_ENTRIES)

          const merged = [...lines, ...store.history].slice(-MAX_HISTORY_ENTRIES)
          setStore("history", merged)

          // Rewrite file with only valid entries to self-heal corruption
          if (merged.length > 0) {
            const content = merged.map((line) => JSON.stringify(line)).join("\n") + "\n"
            void persistHistory(content)
          }
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
          const content = store.history.map((line) => JSON.stringify(line)).join("\n") + "\n"
          void persistHistory(content)
          return
        }

        void appendFile(historyPath, JSON.stringify(entry) + "\n")
          .then(() => {
            writeWarningShown = false
          })
          .catch((error) => {
            if (writeWarningShown) return
            writeWarningShown = true
            log.warn("failed to append prompt history", { historyPath, error })
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
