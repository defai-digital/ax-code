import type { PromptInfo } from "./model"

export type PromptExtmark = {
  id: number
  start: number
  end: number
}

export type PromptSubmissionView = {
  text: string
  parts: PromptInfo["parts"]
}

export type PromptSlashDispatch =
  | {
      type: "none"
    }
  | {
      type: "local"
      name: string
    }
  | {
      type: "remote"
      name: string
      arguments: string
    }

export function isPromptExitCommand(input: string) {
  const trimmed = input.trim()
  return trimmed === "exit" || trimmed === "quit" || trimmed === ":q"
}

export function resolvePromptSlashDispatch(input: {
  text: string
  localSlashes: {
    name: string
    aliases?: string[]
  }[]
  remoteCommands: string[]
}): PromptSlashDispatch {
  if (!input.text.startsWith("/")) return { type: "none" }

  const firstLineEnd = input.text.indexOf("\n")
  const firstLine = firstLineEnd === -1 ? input.text : input.text.slice(0, firstLineEnd)
  const [slashToken, ...firstLineArgs] = firstLine.split(" ")
  const name = slashToken?.slice(1)
  if (!name) return { type: "none" }

  const local = input.localSlashes.find((slash) => slash.name === name || slash.aliases?.includes(name))
  if (local) {
    return {
      type: "local",
      name: local.name,
    }
  }

  if (!input.remoteCommands.includes(name)) return { type: "none" }

  const restOfInput = firstLineEnd === -1 ? "" : input.text.slice(firstLineEnd + 1)
  return {
    type: "remote",
    name,
    arguments: firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : ""),
  }
}

export function promptSubmissionView(input: {
  text: string
  parts: PromptInfo["parts"]
  extmarks: PromptExtmark[]
  extmarkToPartIndex: ReadonlyMap<number, number>
}): PromptSubmissionView {
  let text = input.text
  const sorted = [...input.extmarks].sort((a, b) => b.start - a.start)

  for (const extmark of sorted) {
    const partIndex = input.extmarkToPartIndex.get(extmark.id)
    if (partIndex === undefined) continue
    const part = input.parts[partIndex]
    if (part?.type !== "text" || !part.text) continue
    const before = text.slice(0, extmark.start)
    const after = text.slice(extmark.end)
    text = before + part.text + after
  }

  return {
    text,
    parts: input.parts.filter((part) => part.type !== "text"),
  }
}
