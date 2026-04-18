import { unwrap } from "solid-js/store"
import type { PromptInfo } from "../component/prompt/model"
import { promptSubmissionView } from "../component/prompt/view-model"

// Callers pass SolidJS store proxies (from prompt/index.tsx, history store, etc.).
// `structuredClone` throws DataCloneError on Solid proxies, so unwrap first.
function cloneValue<T>(value: T): T {
  return structuredClone(unwrap(value))
}

export type PromptMode = "normal" | "shell"

export type PromptEditorState = {
  input: string
  mode: PromptMode
  parts: PromptInfo["parts"]
  history: PromptInfo[]
  historyCursor: number
  historyDraft?: PromptInfo
  interrupt: number
}

export type PromptEditorAction =
  | {
      type: "input.changed"
      value: string
    }
  | {
      type: "mode.set"
      mode: PromptMode
    }
  | {
      type: "prompt.cleared"
    }
  | {
      type: "prompt.cancelled"
    }
  | {
      type: "history.loaded"
      entries: PromptInfo[]
    }
  | {
      type: "history.previous"
    }
  | {
      type: "history.next"
    }
  | {
      type: "paste.text"
      text: string
      label: string
      range?: {
        start: number
        end: number
      }
    }
  | {
      type: "paste.file"
      file: Extract<PromptInfo["parts"][number], { type: "file" }>
      label: string
      range?: {
        start: number
        end: number
      }
    }
  | {
      type: "interrupt.incremented"
    }
  | {
      type: "interrupt.reset"
    }
  | {
      type: "submission.committed"
    }

type PromptTextPart = Extract<PromptInfo["parts"][number], { type: "text" }>
type PromptSourceText = {
  start: number
  end: number
  value: string
}

const EMPTY_PROMPT: PromptInfo = {
  input: "",
  mode: "normal",
  parts: [],
}

export function createPromptEditorState(input: Partial<PromptEditorState> = {}): PromptEditorState {
  return {
    input: input.input ?? "",
    mode: input.mode ?? "normal",
    parts: input.parts ? [...input.parts] : [],
    history: input.history ? input.history.map((entry) => cloneValue(entry)) : [],
    historyCursor: input.historyCursor ?? 0,
    historyDraft: input.historyDraft ? cloneValue(input.historyDraft) : undefined,
    interrupt: input.interrupt ?? 0,
  }
}

function reconcilePromptParts(value: string, parts: PromptInfo["parts"]) {
  return parts.filter((part) => {
    const source = getPromptSourceText(part)
    if (!source) return true
    return value.slice(source.start, source.end) === source.value
  })
}

function getPromptSourceText(part: PromptInfo["parts"][number]): PromptSourceText | undefined {
  if (part.type === "text") return part.source?.text
  if (part.type === "file") return part.source?.text
  if (part.type === "agent") return part.source
  return undefined
}

function withPromptSource(part: PromptInfo["parts"][number], source: PromptSourceText): PromptInfo["parts"][number] {
  if (part.type === "text") {
    return {
      ...part,
      source: {
        text: source,
      },
    }
  }

  if (part.type === "file") {
    return {
      ...part,
      source: part.source
        ? {
            ...part.source,
            text: source,
          }
        : {
            type: "file",
            path: part.filename ?? "",
            text: source,
          },
    }
  }

  if (part.type === "agent") {
    return {
      ...part,
      source,
    }
  }

  return part
}

function shiftPromptPart(
  part: PromptInfo["parts"][number],
  edit: {
    start: number
    end: number
    insertedLength: number
  },
) {
  const source = getPromptSourceText(part)
  if (!source) return part

  if (source.end <= edit.start) return part
  if (source.start >= edit.end) {
    const delta = edit.insertedLength - (edit.end - edit.start)
    return withPromptSource(part, {
      ...source,
      start: source.start + delta,
      end: source.end + delta,
    })
  }

  return undefined
}

function applyEdit(
  state: PromptEditorState,
  edit: {
    insertedText: string
    range?: {
      start: number
      end: number
    }
    part?: PromptInfo["parts"][number]
  },
): PromptEditorState {
  const start = edit.range?.start ?? state.input.length
  const end = edit.range?.end ?? start
  const nextInput = state.input.slice(0, start) + edit.insertedText + state.input.slice(end)
  const nextParts = state.parts
    .map((part) =>
      shiftPromptPart(part, {
        start,
        end,
        insertedLength: edit.insertedText.length,
      }),
    )
    .filter((part): part is PromptInfo["parts"][number] => part !== undefined)

  if (!edit.part) {
    return {
      ...state,
      input: nextInput,
      parts: reconcilePromptParts(nextInput, nextParts),
      historyCursor: 0,
      historyDraft: undefined,
      interrupt: 0,
    }
  }

  const source = {
    start,
    end: start + edit.insertedText.length,
    value: edit.insertedText,
  }

  return {
    ...state,
    input: nextInput,
    parts: [...nextParts, withPromptSource(edit.part, source)],
    historyCursor: 0,
    historyDraft: undefined,
    interrupt: 0,
  }
}

function currentPromptEntry(state: PromptEditorState): PromptInfo {
  return {
    input: state.input,
    mode: state.mode,
    parts: cloneValue(state.parts),
  }
}

function historyEntryAt(entries: PromptInfo[], cursor: number) {
  if (cursor <= 0) return undefined
  return entries.at(-cursor)
}

function restoreHistoryEntry(state: PromptEditorState, entry: PromptInfo, cursor: number): PromptEditorState {
  return {
    ...state,
    input: entry.input,
    mode: entry.mode ?? "normal",
    parts: cloneValue(entry.parts),
    historyCursor: cursor,
    interrupt: 0,
  }
}

function withHistoryCursor(state: PromptEditorState, direction: -1 | 1): PromptEditorState {
  if (direction === -1) {
    const nextCursor = state.historyCursor + 1
    const entry = historyEntryAt(state.history, nextCursor)
    if (!entry) return state
    return restoreHistoryEntry(
      {
        ...state,
        historyDraft: state.historyCursor === 0 ? currentPromptEntry(state) : state.historyDraft,
      },
      entry,
      nextCursor,
    )
  }

  if (state.historyCursor === 0) return state
  if (state.historyCursor === 1) {
    const draft = state.historyDraft ?? EMPTY_PROMPT
    return {
      ...state,
      input: draft.input,
      mode: draft.mode ?? "normal",
      parts: cloneValue(draft.parts),
      historyCursor: 0,
      historyDraft: undefined,
      interrupt: 0,
    }
  }

  const nextCursor = state.historyCursor - 1
  const entry = historyEntryAt(state.history, nextCursor)
  if (!entry) return state
  return restoreHistoryEntry(state, entry, nextCursor)
}

export function reducePromptEditor(state: PromptEditorState, action: PromptEditorAction): PromptEditorState {
  switch (action.type) {
    case "input.changed":
      return {
        ...state,
        input: action.value,
        parts: reconcilePromptParts(action.value, state.parts),
        historyCursor: 0,
        historyDraft: undefined,
        interrupt: 0,
      }
    case "mode.set":
      return {
        ...state,
        mode: action.mode,
      }
    case "prompt.cleared":
      return {
        ...state,
        input: "",
        parts: [],
        historyCursor: 0,
        historyDraft: undefined,
        interrupt: 0,
      }
    case "prompt.cancelled":
      return {
        ...state,
        mode: "normal",
        interrupt: 0,
      }
    case "history.loaded":
      return {
        ...state,
        history: action.entries.map((entry) => cloneValue(entry)),
        historyCursor: 0,
        historyDraft: undefined,
      }
    case "history.previous":
      return withHistoryCursor(state, -1)
    case "history.next":
      return withHistoryCursor(state, 1)
    case "paste.text":
      return applyEdit(state, {
        insertedText: action.label,
        range: action.range,
        part: {
          type: "text",
          text: action.text,
        } satisfies PromptTextPart,
      })
    case "paste.file":
      return applyEdit(state, {
        insertedText: action.label,
        range: action.range,
        part: action.file,
      })
    case "interrupt.incremented":
      return {
        ...state,
        interrupt: state.interrupt + 1,
      }
    case "interrupt.reset":
      return {
        ...state,
        interrupt: 0,
      }
    case "submission.committed": {
      if (!state.input) {
        return {
          ...state,
          mode: "normal",
          interrupt: 0,
        }
      }
      return {
        ...state,
        input: "",
        mode: "normal",
        parts: [],
        history: [...state.history, currentPromptEntry(state)],
        historyCursor: 0,
        historyDraft: undefined,
        interrupt: 0,
      }
    }
  }
}

export function canSubmitPromptEditor(state: PromptEditorState) {
  return state.input.trim().length > 0
}

export function promptEditorSubmission(state: PromptEditorState) {
  return {
    ...promptSubmissionView({
      text: state.input,
      parts: state.parts,
      extmarks: state.parts.flatMap((part, index) => {
        const source = getPromptSourceText(part)
        if (!source) return []
        return [
          {
            id: index,
            start: source.start,
            end: source.end,
          },
        ]
      }),
      extmarkToPartIndex: new Map(state.parts.map((_, index) => [index, index])),
    }),
    mode: state.mode,
  }
}
