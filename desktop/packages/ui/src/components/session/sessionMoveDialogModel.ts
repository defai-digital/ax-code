import type { ProjectEntry } from "@/lib/api/types"
import {
  normalizeProjectPath,
  resolveProjectForSessionDirectory,
  getProjectPathIdentityKey,
} from "@/lib/projectResolution"
import type { WorktreeMetadata } from "@/types/worktree"

export type SessionMoveTarget = {
  id: string
  path: string
  label: string
  description: string | null
  branch: string | null
  dirty: boolean
  current: boolean
}

function directoryName(value: string): string {
  const normalized = normalizeProjectPath(value) ?? value
  const parts = normalized.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function projectLabel(project: ProjectEntry): string {
  return project.label?.trim() || directoryName(project.path)
}

function worktreesForProject(
  project: ProjectEntry,
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>,
): WorktreeMetadata[] {
  const projectKeys = new Set([
    project.path,
    normalizeProjectPath(project.path),
    getProjectPathIdentityKey(project.path),
  ])
  const result: WorktreeMetadata[] = []
  const seen = new Set<string>()

  for (const [key, worktrees] of availableWorktreesByProject.entries()) {
    const normalizedKey = normalizeProjectPath(key)
    const identityKey = getProjectPathIdentityKey(key)
    if (!projectKeys.has(key) && !projectKeys.has(normalizedKey) && !projectKeys.has(identityKey)) continue

    for (const worktree of worktrees) {
      const path = normalizeProjectPath(worktree.path)
      if (!path || seen.has(path)) continue
      seen.add(path)
      result.push(worktree)
    }
  }

  return result
}

export function buildSessionMoveTargets(input: {
  projects: ProjectEntry[]
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>
  currentDirectory: string | null
}): SessionMoveTarget[] {
  const currentDirectory = normalizeProjectPath(input.currentDirectory)
  const project = resolveProjectForSessionDirectory(input.projects, input.availableWorktreesByProject, currentDirectory)
  const seen = new Set<string>()
  const targets: SessionMoveTarget[] = []

  const addTarget = (target: Omit<SessionMoveTarget, "id" | "current"> & { path: string }) => {
    const path = normalizeProjectPath(target.path)
    if (!path || seen.has(path)) return
    seen.add(path)
    targets.push({
      ...target,
      id: path,
      path,
      current: currentDirectory === path,
    })
  }

  if (project) {
    addTarget({
      path: project.path,
      label: projectLabel(project),
      description: "Project root",
      branch: null,
      dirty: false,
    })

    for (const worktree of worktreesForProject(project, input.availableWorktreesByProject).sort((a, b) =>
      (a.label || a.branch || a.path).localeCompare(b.label || b.branch || b.path),
    )) {
      addTarget({
        path: worktree.path,
        label: worktree.label || worktree.name || directoryName(worktree.path),
        description: worktree.relativePath ?? null,
        branch: worktree.branch || null,
        dirty: Boolean(worktree.status?.isDirty),
      })
    }
  }

  if (currentDirectory && targets.length === 0) {
    addTarget({
      path: currentDirectory,
      label: directoryName(currentDirectory),
      description: "Current directory",
      branch: null,
      dirty: false,
    })
  }

  return targets
}
