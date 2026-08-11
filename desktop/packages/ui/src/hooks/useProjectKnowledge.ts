import React from "react"
import { useRuntimeAPIs } from "@/hooks/useRuntimeAPIs"

export type ProjectKnowledgeState = {
  /** True when any project knowledge file (AGENTS.md or CLAUDE.md) exists. */
  exists: boolean
  /** True when a project-level AGENTS.md exists (AX Code primary). */
  agentsMd: boolean
  /** True when a project-level CLAUDE.md exists (compat / secondary). */
  claudeMd: boolean
  isLoading: boolean
}

const EMPTY: ProjectKnowledgeState = { exists: false, agentsMd: false, claudeMd: false, isLoading: false }

const cache = new Map<string, ProjectKnowledgeState>()

/**
 * Detects whether project knowledge files exist in the given workspace
 * directory. AX Code prefers project-level AGENTS.md (also reads CLAUDE.md
 * for compatibility). Surfaces existence for the draft welcome indicator.
 */
export function useProjectKnowledge(directory: string | null | undefined): ProjectKnowledgeState {
  const { files } = useRuntimeAPIs()
  const [state, setState] = React.useState<ProjectKnowledgeState>(() => {
    if (!directory) return EMPTY
    return cache.get(directory) ?? { ...EMPTY, isLoading: true }
  })

  React.useEffect(() => {
    const readFile = files.readFile
    if (!directory || !readFile) {
      setState(EMPTY)
      return
    }

    const cached = cache.get(directory)
    if (cached) {
      setState(cached)
      return
    }

    let cancelled = false
    setState({ ...EMPTY, isLoading: true })

    const base = directory.replace(/\/$/, "")
    const probe = (name: string) =>
      readFile(`${base}/${name}`)
        .then(() => true)
        .catch(() => false)

    Promise.all([probe("AGENTS.md"), probe("CLAUDE.md")]).then(([agentsMd, claudeMd]) => {
      if (cancelled) return
      const next: ProjectKnowledgeState = {
        exists: agentsMd || claudeMd,
        agentsMd,
        claudeMd,
        isLoading: false,
      }
      cache.set(directory, next)
      setState(next)
    })

    return () => {
      cancelled = true
    }
  }, [directory, files])

  return state
}

/**
 * Builds a display label naming the detected project knowledge file(s).
 * AGENTS.md is listed first (AX Code primary); CLAUDE.md is secondary compat.
 * Returns an empty string when none are present.
 */
export function projectKnowledgeFileLabel(state: ProjectKnowledgeState): string {
  const files: string[] = []
  if (state.agentsMd) files.push("AGENTS.md")
  if (state.claudeMd) files.push("CLAUDE.md")
  return files.join(" + ")
}
