import { normalizeProjectPath, projectPathMatchesRoot } from "@/lib/projectResolution"
import { formatPathForDisplay } from "@/lib/utils"

export type MiniChatProjectPath = {
  path: string
}

export const compactMiniChatPath = (value: string | null | undefined, homeDirectory?: string | null): string => {
  const normalizedPath = normalizeProjectPath(value)
  if (!normalizedPath) return ""

  const displayPath = formatPathForDisplay(normalizedPath, homeDirectory)
  if (displayPath === "~" || displayPath.startsWith("~/")) {
    return displayPath
  }

  const segments = displayPath.split("/").filter(Boolean)
  if (segments.length <= 3) return displayPath
  return `.../${segments.slice(-3).join("/")}`
}

export const findMiniChatProjectForDirectory = <T extends MiniChatProjectPath>(
  projects: T[],
  directory: string | null | undefined,
  projectDirectory?: string | null,
): T | null => {
  const candidateDirectory = normalizeProjectPath(projectDirectory) ?? normalizeProjectPath(directory)
  if (!candidateDirectory) return null

  let best: T | null = null
  let bestLength = -1
  for (const project of projects) {
    const projectPath = normalizeProjectPath(project.path)
    if (!projectPath || !projectPathMatchesRoot(candidateDirectory, projectPath)) {
      continue
    }
    if (projectPath.length > bestLength) {
      best = project
      bestLength = projectPath.length
    }
  }

  return best
}
