import type { LineComment } from "@/context/comments"
import type { CommandOption } from "@/context/command"
import type { ContextItem } from "@/context/prompt"
import type { PromptHistoryComment } from "./history"
import type { SlashCommand } from "./slash-popover"

export type PromptMode = "normal" | "shell"
const NON_EMPTY_TEXT = /[^\s\u200B]/

export type PromptRecipeState = {
  pin: string[]
  recent: string[]
}

export type PromptCommand = {
  name: string
  description?: string
  source?: "command" | "mcp" | "skill"
}

export function recentPaths(
  tabs: string[],
  active: string | undefined,
  pathFromTab: (tab: string) => string | undefined,
) {
  const order = active ? [active, ...tabs.filter((item) => item !== active)] : tabs
  const seen = new Set<string>()
  const paths: string[] = []

  for (const tab of order) {
    const path = pathFromTab(tab)
    if (!path || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }

  return paths
}

export function commentCount<T extends ContextItem>(items: readonly T[], mode: PromptMode) {
  if (mode === "shell") return 0
  return items.filter((item) => !!item.comment?.trim()).length
}

export function contextItems<T extends ContextItem>(items: readonly T[], mode: PromptMode) {
  if (mode !== "shell") return [...items]
  return items.filter((item) => !item.comment?.trim())
}

export function hasUserPrompt(messages: { role: string }[] | undefined) {
  if (!messages) return false
  return messages.some((item) => item.role === "user")
}

export function isSeedable(input: {
  mode: PromptMode
  suggest: boolean
  dirty: boolean
  working: boolean
  imageCount: number
  contextCount: number
}) {
  return (
    input.mode === "normal" &&
    input.suggest &&
    !input.dirty &&
    !input.working &&
    input.imageCount === 0 &&
    input.contextCount === 0
  )
}

export function historyComments<T extends ContextItem>(items: readonly T[], comments: readonly LineComment[]) {
  const byID = new Map(comments.map((item) => [`${item.file}\n${item.id}`, item] as const))

  return items.flatMap((item) => {
    if (item.type !== "file") return []

    const comment = item.comment?.trim()
    if (!comment) return []

    const current = item.commentID ? byID.get(`${item.path}\n${item.commentID}` as const) : undefined
    const selection =
      current?.selection ??
      (item.selection
        ? {
            start: item.selection.startLine,
            end: item.selection.endLine,
          }
        : undefined)
    if (!selection) return []

    return [
      {
        id: item.commentID ?? item.path,
        path: item.path,
        selection: { ...selection },
        comment,
        time: current?.time ?? Date.now(),
        origin: item.commentOrigin,
        preview: item.preview,
      } satisfies PromptHistoryComment,
    ]
  })
}

export function buildSlashCommands(input: {
  options: readonly CommandOption[]
  commands: readonly PromptCommand[]
  recipes: PromptRecipeState
  t: (key: string) => string
}) {
  const pin = new Map(input.recipes.pin.map((id, index) => [id, index] as const))
  const recent = new Map(input.recipes.recent.map((id, index) => [id, index] as const))

  const builtin = input.options
    .filter((opt) => !opt.disabled && !opt.id.startsWith("suggested.") && opt.slash)
    .map((opt) => ({
      id: opt.id,
      trigger: opt.slash!,
      title: opt.title,
      description: opt.description,
      category: opt.category,
      keybind: opt.keybind,
      type: "builtin" as const,
    }))

  const custom = input.commands.map((cmd) => ({
    id: `custom.${cmd.name}`,
    trigger: cmd.name,
    title: cmd.name,
    description: cmd.description,
    type: "custom" as const,
    source: cmd.source,
  }))

  return [...custom, ...builtin]
    .map((cmd, index) => {
      if (pin.has(cmd.id)) {
        return {
          ...cmd,
          category: input.t("prompt.recipe.group.pinned"),
          order: -3_000 + (pin.get(cmd.id) ?? index),
          index,
        }
      }

      if (recent.has(cmd.id)) {
        return {
          ...cmd,
          category: input.t("prompt.recipe.group.recent"),
          order: -2_000 + (recent.get(cmd.id) ?? index),
          index,
        }
      }

      if (cmd.type === "custom" && cmd.source === "command") {
        return {
          ...cmd,
          category: input.t("prompt.recipe.group.recommended"),
          order: -1_000 + index,
          index,
        }
      }

      return {
        ...cmd,
        order: index,
        index,
      }
    })
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ order, index, ...cmd }) => cmd satisfies SlashCommand)
}

export function touchRecipe(list: readonly string[], id: string, max = 6) {
  return [id, ...list.filter((item) => item !== id)].slice(0, max)
}

export function togglePin(list: readonly string[], id: string) {
  if (list.includes(id)) return list.filter((item) => item !== id)
  return [id, ...list.filter((item) => item !== id)]
}

export function promptText(parts: readonly { type: string; content?: string }[]) {
  if (parts.length === 1 && parts[0]?.type === "text") return parts[0].content ?? ""
  return parts.map((part) => part.content ?? "").join("")
}

export function shouldResetPrompt(input: { text: string; parts: readonly { type: string }[]; imageCount: number }) {
  return !NON_EMPTY_TEXT.test(input.text) && !input.parts.some((part) => part.type !== "text") && input.imageCount === 0
}

export function promptPopover(input: { mode: PromptMode; text: string; cursor: number }) {
  if (input.mode === "shell") return
  const atMatch = input.text.substring(0, input.cursor).match(/@(\S*)$/)
  if (atMatch) return { type: "at" as const, query: atMatch[1] }
  const slashMatch = input.text.match(/^\/(\S*)$/)
  if (slashMatch) return { type: "slash" as const, query: slashMatch[1] }
}

export function shouldIgnoreWorkingSubmit(input: {
  working: boolean
  text: string
  imageCount: number
  commentCount: number
}) {
  return input.working && input.text.trim().length === 0 && input.imageCount === 0 && input.commentCount === 0
}
