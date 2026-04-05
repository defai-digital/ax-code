import type { ToolPart } from "@ax-code/sdk/v2"
import { getFilename } from "@ax-code/util/path"
import type { IconProps } from "./icon"

type ToolText = (key: string, params?: Record<string, string | number>) => string

export type ToolInfo = {
  icon: IconProps["name"]
  title: string
  subtitle?: string
}

function text(input: Record<string, unknown>, key: string) {
  const value = input[key]
  return typeof value === "string" && value ? value : undefined
}

function count(input: Record<string, unknown>, key: string) {
  const value = input[key]
  return typeof value === "number" ? value : undefined
}

function files(input: Record<string, unknown>) {
  const value = input["files"]
  return Array.isArray(value) ? value.length : undefined
}

function agentTitle(t: ToolText, type?: string) {
  if (!type) return t("ui.tool.agent.default")
  return t("ui.tool.agent", { type })
}

export function getToolInfo(tool: string, input: Record<string, unknown>, t: ToolText): ToolInfo {
  switch (tool) {
    case "read":
      return {
        icon: "glasses",
        title: t("ui.tool.read"),
        subtitle: text(input, "filePath") ? getFilename(text(input, "filePath")!) : undefined,
      }
    case "list":
      return {
        icon: "bullet-list",
        title: t("ui.tool.list"),
        subtitle: text(input, "path") ? getFilename(text(input, "path")!) : undefined,
      }
    case "glob":
      return {
        icon: "magnifying-glass-menu",
        title: t("ui.tool.glob"),
        subtitle: text(input, "pattern"),
      }
    case "grep":
      return {
        icon: "magnifying-glass-menu",
        title: t("ui.tool.grep"),
        subtitle: text(input, "pattern"),
      }
    case "webfetch":
      return {
        icon: "window-cursor",
        title: t("ui.tool.webfetch"),
        subtitle: text(input, "url"),
      }
    case "websearch":
      return {
        icon: "window-cursor",
        title: t("ui.tool.websearch"),
        subtitle: text(input, "query"),
      }
    case "codesearch":
      return {
        icon: "code",
        title: t("ui.tool.codesearch"),
        subtitle: text(input, "query"),
      }
    case "task": {
      const type = text(input, "subagent_type")
      const label = type ? type[0]!.toUpperCase() + type.slice(1) : undefined
      return {
        icon: "task",
        title: agentTitle(t, label),
        subtitle: text(input, "description"),
      }
    }
    case "bash":
      return {
        icon: "console",
        title: t("ui.tool.shell"),
        subtitle: text(input, "description"),
      }
    case "edit":
      return {
        icon: "code-lines",
        title: t("ui.messagePart.title.edit"),
        subtitle: text(input, "filePath") ? getFilename(text(input, "filePath")!) : undefined,
      }
    case "write":
      return {
        icon: "code-lines",
        title: t("ui.messagePart.title.write"),
        subtitle: text(input, "filePath") ? getFilename(text(input, "filePath")!) : undefined,
      }
    case "apply_patch": {
      const total = files(input)
      return {
        icon: "code-lines",
        title: t("ui.tool.patch"),
        subtitle:
          total !== undefined ? `${total} ${t(total > 1 ? "ui.common.file.other" : "ui.common.file.one")}` : undefined,
      }
    }
    case "todowrite":
      return {
        icon: "checklist",
        title: t("ui.tool.todos"),
      }
    case "todoread":
      return {
        icon: "checklist",
        title: t("ui.tool.todos.read"),
      }
    case "question":
      return {
        icon: "bubble-5",
        title: t("ui.tool.questions"),
      }
    case "skill":
      return {
        icon: "brain",
        title: text(input, "name") || t("ui.tool.skill"),
      }
    default:
      return {
        icon: "mcp",
        title: tool,
      }
  }
}

function detail(part: ToolPart, t: ToolText) {
  const info = getToolInfo(part.tool, (part.state.input ?? {}) as Record<string, unknown>, t)
  if (info.subtitle) return info.subtitle
  if (part.state.status === "error") return part.state.error
  if ((part.state.status === "running" || part.state.status === "completed") && part.state.title)
    return part.state.title
  return text((part.state.input ?? {}) as Record<string, unknown>, "description")
}

export function contextToolTrigger(part: ToolPart, t: ToolText, dir: (path: string | undefined) => string) {
  const input = (part.state.input ?? {}) as Record<string, unknown>
  const path = text(input, "path") ?? "/"
  const filePath = text(input, "filePath")
  const pattern = text(input, "pattern")
  const include = text(input, "include")
  const offset = count(input, "offset")
  const limit = count(input, "limit")

  switch (part.tool) {
    case "read": {
      const args: string[] = []
      if (offset !== undefined) args.push("offset=" + offset)
      if (limit !== undefined) args.push("limit=" + limit)
      return {
        title: t("ui.tool.read"),
        subtitle: filePath ? getFilename(filePath) : "",
        args,
      }
    }
    case "list":
      return {
        title: t("ui.tool.list"),
        subtitle: dir(path),
      }
    case "glob":
      return {
        title: t("ui.tool.glob"),
        subtitle: dir(path),
        args: pattern ? ["pattern=" + pattern] : [],
      }
    case "grep": {
      const args: string[] = []
      if (pattern) args.push("pattern=" + pattern)
      if (include) args.push("include=" + include)
      return {
        title: t("ui.tool.grep"),
        subtitle: dir(path),
        args,
      }
    }
    default: {
      const info = getToolInfo(part.tool, input, t)
      return {
        title: info.title,
        subtitle: info.subtitle || detail(part, t),
        args: [],
      }
    }
  }
}
