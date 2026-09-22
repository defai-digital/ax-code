import type { PromptInfo } from "./history"
import { charWidth } from "@/bun/node-compat"
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
//
// The helpers below iterate scalars with for..of, so `char` is exactly one
// code point: a lone ESC or 0x9B is a zero-width control either way, which is
// why charWidth on the code point is byte-identical to stringWidth(char)
// without its per-call ANSI check and second loop.
function displayWidthOfChar(char: string) {
  return char === "\n" ? 1 : charWidth(char.codePointAt(0) ?? 0)
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

/**
 * Both string indices for an ordered pair of display offsets in one walk.
 * Equivalent to calling stringIndexFromDisplayOffset twice: the low index is
 * recorded at the exact iteration where the single-offset walk would stop
 * (before consuming the character), and the walk then continues to the high
 * offset. Precondition: 0 <= lowOffset <= highOffset.
 */
export function stringIndicesFromDisplayOffsets(
  text: string,
  lowOffset: number,
  highOffset: number,
): [lowIndex: number, highIndex: number] {
  if (highOffset <= 0) return [0, 0]
  let lowIndex: number | undefined = lowOffset <= 0 ? 0 : undefined
  let width = 0
  let index = 0
  for (const char of text) {
    if (lowIndex === undefined && width >= lowOffset) lowIndex = index
    if (width >= highOffset) return [lowIndex ?? index, index]
    width += displayWidthOfChar(char)
    index += char.length
  }
  return [lowIndex ?? index, index]
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
  return relocatePromptPartAt(part, content, index)
}

// Original display offset of a part's virtual text, used to keep parts in
// document order when several share the same virtual text.
function promptPartSourceStart(part: PromptPart) {
  if (part.type === "agent") return part.source?.start ?? 0
  if (part.type === "file" || part.type === "text") return part.source?.text?.start ?? 0
  return 0
}

/**
 * Relocates every non-text part after an external-editor round-trip. Parts
 * are matched in their original document order and each match is consumed,
 * so two attachments with the same virtual text (two files named README.md)
 * land on their own occurrence instead of both collapsing onto the first.
 * A part whose text only survives before the cursor (the user reordered the
 * chips) falls back to the first occurrence no other part has claimed; a
 * part with no unclaimed occurrence left is dropped. The returned array
 * keeps the input order.
 */
export function relocatePromptPartsAfterEditor(parts: readonly PromptPart[], content: string): PromptPart[] {
  const ordered = parts
    .map((part, order) => ({ part, order, start: promptPartSourceStart(part) }))
    .sort((a, b) => a.start - b.start || a.order - b.order)
  const relocated: { order: number; part: PromptPart }[] = []
  const claimed: { start: number; end: number }[] = []
  const isClaimed = (start: number, end: number) =>
    claimed.some((span) => start < span.end && end > span.start)
  // First unclaimed occurrence at or after `from`, or -1.
  const findUnclaimed = (virtualText: string, from: number) => {
    let index = content.indexOf(virtualText, from)
    while (index !== -1 && isClaimed(index, index + virtualText.length)) {
      index = content.indexOf(virtualText, index + 1)
    }
    return index
  }
  let cursor = 0
  for (const entry of ordered) {
    const virtualText = promptPartVirtualText(entry.part)
    if (!virtualText) {
      relocated.push({ order: entry.order, part: entry.part })
      continue
    }
    let index = findUnclaimed(virtualText, cursor)
    if (index === -1) index = findUnclaimed(virtualText, 0)
    if (index === -1) continue
    const part = relocatePromptPartAt(entry.part, content, index)
    if (part) relocated.push({ order: entry.order, part })
    claimed.push({ start: index, end: index + virtualText.length })
    cursor = Math.max(cursor, index + virtualText.length)
  }
  return relocated.sort((a, b) => a.order - b.order).map((entry) => entry.part)
}

function relocatePromptPartAt(part: PromptPart, content: string, index: number): PromptPart | null {
  const virtualText = promptPartVirtualText(part)
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
  // Only the newest completed todowrite matters, so walk from the end and
  // stop at the first one. This runs inside a memo that re-evaluates on every
  // subagent status event; the forward scan touched every part of every
  // message through the store proxy each time.
  const list = messages ?? []
  for (let messageIndex = list.length - 1; messageIndex >= 0; messageIndex--) {
    const message = list[messageIndex]!
    if (!message.id) continue
    const parts = partsByMessage[message.id] ?? []
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const toolPart = parts[partIndex] as {
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
      return (todos as Array<{ status?: unknown }>).some(isActiveTodo)
    }
  }
  return false
}
