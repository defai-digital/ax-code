import React from "react"
import { useRuntimeAPIs } from "@/hooks/useRuntimeAPIs"

export type ProjectKnowledgeState = {
  /** True when any project knowledge file (CLAUDE.md or AGENTS.md) exists. */
  exists: boolean
  /** True when a project-level CLAUDE.md exists. */
  claudeMd: boolean
  /** True when a project-level AGENTS.md exists. */
  agentsMd: boolean
  isLoading: boolean
}

const EMPTY: ProjectKnowledgeState = { exists: false, claudeMd: false, agentsMd: false, isLoading: false }

const cache = new Map<string, ProjectKnowledgeState>()

/**
 * Detects whether project knowledge files exist in the given workspace
 * directory. ax-code reads both CLAUDE.md and project-level AGENTS.md
 * automatically at session start; this hook surfaces the result in the UI
 * (indicator + "create" shortcut).
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

    Promise.all([probe("CLAUDE.md"), probe("AGENTS.md")]).then(([claudeMd, agentsMd]) => {
      if (cancelled) return
      const next: ProjectKnowledgeState = {
        exists: claudeMd || agentsMd,
        claudeMd,
        agentsMd,
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
 * Builds a display label naming the detected project knowledge file(s),
 * e.g. "CLAUDE.md", "AGENTS.md", or "CLAUDE.md + AGENTS.md". Returns an
 * empty string when none are present.
 */
export function projectKnowledgeFileLabel(state: ProjectKnowledgeState): string {
  const files: string[] = []
  if (state.claudeMd) files.push("CLAUDE.md")
  if (state.agentsMd) files.push("AGENTS.md")
  return files.join(" + ")
}
