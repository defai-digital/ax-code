import type { PromptInfo } from "./history"
import { stringWidth } from "@/bun/node-compat"
import { isActiveTodo } from "@/session/todo-status"

type PromptPart = PromptInfo["parts"][number]

export type PromptPartExtmarkView = {
  start: number
  end: number
  virtualText: string
  styleId?: number
}

// The native edit buffer addresses text in display-width units: wide
// (CJK/emoji) characters count their rendered width, and "\n" counts as 1
// (stringWidth would give it 0). Extmark ranges and cursorOffset use these
// units, while JS string ops (slice/indexOf) use UTF-16 indices — always
// convert through these helpers before mixing the two.
function displayWidthOfChar(char: string) {
  return char === "\n" ? 1 : stringWidth(char)
}

export function stringIndexFromDisplayOffset(text: string, displayOffset: number) {
  if (displayOffset <= 0) return 0
  let width = 0
  let index = 0
  for (const char of text) {
    if (width >= displayOffset) break
    width += displayWidthOfChar(char)
    index += char.length
  }
  return index
}

export function displayOffsetFromStringIndex(text: string, stringIndex: number) {
  if (stringIndex <= 0) return 0
  let width = 0
  let index = 0
  for (const char of text) {
    if (index >= stringIndex) break
    width += displayWidthOfChar(char)
    index += char.length
  }
  return width
}

// Display offset of the end of the buffer — what cursorOffset must equal for
// the cursor to sit at the very end. Not stringWidth(text): that drops the
// newlines the buffer counts, leaving the cursor short on multi-line text.
export function endDisplayOffset(text: string) {
  return displayOffsetFromStringIndex(text, text.length)
}

// Guard for history.move(): index 0 is the live-draft position, while
// history.at(0) is the *oldest* entry — never compare the draft against it,
// or a draft that happens to match gets silently cleared/replaced.
export function promptHistoryNavigationAllowed(input: {
  index: number
  draft: string
  history: readonly { input: string }[]
}) {
  if (input.index === 0) return input.draft.length === 0
  const current = input.history.at(input.index)
  if (!current) return false
  return !input.draft.length || current.input === input.draft
}

export function isPastedImagePart(part: PromptInfo["parts"][number]) {
  return part.type === "file" && part.mime.startsWith("image/") && part.url.startsWith("data:")
}

export function promptPartVirtualText(part: PromptPart) {
  if (part.type === "file" && part.source?.text) return part.source.text.value
  if (part.type === "agent" && part.source) return part.source.value
  if (part.type === "text" && part.source?.text) return part.source.text.value
  return ""
}

export function promptPartExtmarkView(
  part: PromptPart,
  styleIds: {
    fileStyleId: number
    pasteStyleId: number
    agentStyleId: number
  },
): PromptPartExtmarkView | undefined {
  if (part.type === "file" && part.source?.text) {
    return {
      start: part.source.text.start,
      end: part.source.text.end,
      virtualText: part.source.text.value,
      styleId: isPastedImagePart(part) ? styleIds.pasteStyleId : styleIds.fileStyleId,
    }
  }
  if (part.type === "agent" && part.source) {
    return {
      start: part.source.start,
      end: part.source.end,
      virtualText: part.source.value,
      styleId: styleIds.agentStyleId,
    }
  }
  if (part.type === "text" && part.source?.text) {
    return {
      start: part.source.text.start,
      end: part.source.text.end,
      virtualText: part.source.text.value,
      styleId: styleIds.pasteStyleId,
    }
  }
  return undefined
}

export function setPromptPartSourceRange(part: PromptPart, start: number, end: number) {
  if (part.type === "agent" && part.source) {
    part.source.start = start
    part.source.end = end
    return true
  }
  if ((part.type === "file" || part.type === "text") && part.source?.text) {
    part.source.text.start = start
    part.source.text.end = end
    return true
  }
  return false
}

export function relocatePromptPartAfterEditor(part: PromptPart, content: string): PromptPart | null {
  const virtualText = promptPartVirtualText(part)
  if (!virtualText) return part

  const index = content.indexOf(virtualText)
  if (index === -1) return null
  // Source ranges feed extmarks.create, which expects display-width offsets —
  // convert the UTF-16 indexOf result (and range end) before storing.
  const start = displayOffsetFromStringIndex(content, index)
  const end = displayOffsetFromStringIndex(content, index + virtualText.length)

  if (part.type === "file" && part.source?.text) {
    return {
      ...part,
      source: {
        ...part.source,
        text: {
          ...part.source.text,
          start,
          end,
        },
      },
    }
  }

  if (part.type === "agent" && part.source) {
    return {
      ...part,
      source: {
        ...part.source,
        start,
        end,
      },
    }
  }

  if (part.type === "text" && part.source?.text) {
    return {
      ...part,
      source: {
        ...part.source,
        text: {
          ...part.source.text,
          start,
          end,
        },
      },
    }
  }

  return part
}

export function expandPromptTextParts(input: string, parts: PromptInfo["parts"]) {
  return parts
    .filter(
      (part): part is Extract<PromptInfo["parts"][number], { type: "text" }> =>
        part.type === "text" && !!part.source?.text,
    )
    .toSorted((a, b) => b.source!.text.start - a.source!.text.start)
    .reduce((text, part) => {
      const start = stringIndexFromDisplayOffset(text, part.source!.text.start)
      const end = stringIndexFromDisplayOffset(text, part.source!.text.end)
      return text.slice(0, start) + part.text + text.slice(end)
    }, input)
}

export function hasUnfinishedTodosInPromptParts(
  messages: Array<{ id?: string }> | undefined,
  partsByMessage: Record<string, unknown[]>,
) {
  let latestTodos: Array<{ status?: unknown }> | undefined
  for (const message of messages ?? []) {
    if (!message.id) continue
    for (const part of partsByMessage[message.id] ?? []) {
      const toolPart = part as {
        type?: unknown
        tool?: unknown
        state?: {
          status?: unknown
          metadata?: {
            todos?: unknown
          }
        }
      }
      if (toolPart.type !== "tool" || toolPart.tool !== "todowrite") continue
      if (toolPart.state?.status !== "completed") continue
      const todos = toolPart.state.metadata?.todos
      if (!Array.isArray(todos)) continue
      latestTodos = todos as Array<{ status?: unknown }>
    }
  }
  return latestTodos?.some(isActiveTodo) ?? false
}
