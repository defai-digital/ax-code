import type { OpenChamberProjectAction, OpenChamberProjectActionPlatform } from "@/lib/openchamberConfig"
import { normalizeProjectPath } from "@/lib/projectResolution"
import type { IconName } from "@/components/icon/icons"

export type ProjectActionIconKey =
  | "play"
  | "build"
  | "lint"
  | "terminal"
  | "tools"
  | "bug"
  | "flask"
  | "rocket"
  | "code"
  | "server"
  | "branch"
  | "search"
  | "settings"
  | "brain"
  | "stack"
  | "robot"
  | "command"
  | "file"

export const PROJECT_ACTION_ICONS: Array<{
  key: ProjectActionIconKey
  label: string
  Icon: IconName
}> = [
  { key: "play", label: "Play", Icon: "play" },
  { key: "build", label: "Build", Icon: "hammer" },
  { key: "lint", label: "Lint", Icon: "checkbox-circle" },
  { key: "terminal", label: "Terminal", Icon: "terminal-box" },
  { key: "tools", label: "Tools", Icon: "tools" },
  { key: "bug", label: "Bug", Icon: "bug" },
  { key: "flask", label: "Flask", Icon: "flask" },
  { key: "rocket", label: "Rocket", Icon: "rocket" },
  { key: "code", label: "Code", Icon: "code" },
  { key: "server", label: "Server", Icon: "server" },
  { key: "branch", label: "Branch", Icon: "git-branch" },
  { key: "search", label: "Search", Icon: "search" },
  { key: "settings", label: "Settings", Icon: "settings-3" },
  { key: "brain", label: "Brain", Icon: "brain-ai-3" },
  { key: "stack", label: "Stack", Icon: "stack" },
  { key: "robot", label: "Robot", Icon: "robot-2" },
  { key: "command", label: "Command", Icon: "command" },
  { key: "file", label: "File", Icon: "file-text" },
]

export const PROJECT_ACTION_ICON_MAP = Object.fromEntries(
  PROJECT_ACTION_ICONS.map((entry) => [entry.key, entry.Icon]),
) as Record<ProjectActionIconKey, IconName>

export const PROJECT_ACTIONS_UPDATED_EVENT = "openchamber:project-actions-updated"

export const normalizeProjectActionDirectory = (value: string): string => {
  return normalizeProjectPath(value) ?? ""
}

export const getCurrentProjectActionPlatform = (): OpenChamberProjectActionPlatform => {
  if (typeof navigator === "undefined") {
    return "macos"
  }
  const ua = (navigator.userAgent || "").toLowerCase()
  if (ua.includes("windows")) {
    return "windows"
  }
  if (ua.includes("linux")) {
    return "linux"
  }
  return "macos"
}

export const isProjectActionEnabledOnPlatform = (
  action: OpenChamberProjectAction,
  platform: OpenChamberProjectActionPlatform,
): boolean => {
  if (!Array.isArray(action.platforms) || action.platforms.length === 0) {
    return true
  }
  return action.platforms.includes(platform)
}

export const toProjectActionRunKey = (directory: string, actionId: string): string => {
  return `${normalizeProjectActionDirectory(directory)}::${actionId}`
}
