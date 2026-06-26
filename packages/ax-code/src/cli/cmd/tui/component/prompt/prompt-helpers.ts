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

function stringIndexFromDisplayOffset(text: string, displayOffset: number) {
  if (displayOffset <= 0) return 0
  let width = 0
  let index = 0
  for (const char of text) {
    if (width >= displayOffset) break
    width += stringWidth(char)
    index += char.length
  }
  return index
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

  const start = content.indexOf(virtualText)
  if (start === -1) return null
  const end = start + virtualText.length

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
