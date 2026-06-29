import { normalizeProjectPath, projectPathMatchesRoot } from "@/lib/projectResolution"

export const normalizePlanPath = (value: string): string => normalizeProjectPath(value) ?? ""

export const joinPlanPath = (base: string, segment: string): string => {
  const normalizedBase = normalizePlanPath(base)
  const cleanSegment = segment.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
  if (!normalizedBase || normalizedBase === "/") {
    return `/${cleanSegment}`
  }
  if (/^[A-Z]:\/$/.test(normalizedBase)) {
    return `${normalizedBase}${cleanSegment}`
  }
  return `${normalizedBase}/${cleanSegment}`
}

export const buildRepoPlanPath = (directory: string, created: number, slug: string): string => {
  return joinPlanPath(joinPlanPath(joinPlanPath(directory, ".ax-code"), "plans"), `${created}-${slug}.md`)
}

export const buildHomePlanPath = (created: number, slug: string): string => {
  return `~/.ax-code/plans/${created}-${slug}.md`
}

export const resolveTildePlanPath = (path: string, homeDir: string | null): string => {
  const trimmed = path.trim()
  if (!trimmed.startsWith("~")) return trimmed
  if (trimmed === "~") return homeDir || trimmed
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return homeDir ? `${homeDir}${trimmed.slice(1)}` : trimmed
  }
  return trimmed
}

export const toPlanDisplayPath = (
  resolvedPath: string,
  options: { currentDirectory: string; homeDirectory: string },
): string => {
  const current = normalizePlanPath(options.currentDirectory)
  const home = normalizePlanPath(options.homeDirectory)
  const normalized = normalizePlanPath(resolvedPath)

  if (current && normalized !== current && projectPathMatchesRoot(normalized, current)) {
    const relative = normalized.slice(current.length)
    return relative.startsWith("/") ? relative.slice(1) : relative
  }

  if (home && normalized === home) {
    return "~"
  }

  if (home && normalized !== home && projectPathMatchesRoot(normalized, home)) {
    return `~${normalized.slice(home.length)}`
  }

  return normalized
}

export const resolvePlanProjectRefForDirectory = (
  directory: string,
  projects: Array<{ id: string; path: string }>,
  activeProjectId: string | null,
): { id: string; path: string } | null => {
  const normalized = normalizePlanPath(directory)
  if (!normalized) {
    return null
  }

  const activeProject = activeProjectId ? (projects.find((project) => project.id === activeProjectId) ?? null) : null

  if (activeProject?.path) {
    const activePath = normalizePlanPath(activeProject.path)
    if (activePath && projectPathMatchesRoot(normalized, activePath)) {
      return { id: activeProject.id, path: activeProject.path }
    }
  }

  const match = projects
    .filter((project) => {
      const projectPath = normalizePlanPath(project.path)
      return Boolean(projectPath && projectPathMatchesRoot(normalized, projectPath))
    })
    .sort((left, right) => normalizePlanPath(right.path).length - normalizePlanPath(left.path).length)[0]

  return match ? { id: match.id, path: match.path } : null
}
