import { type LocalProject } from "@/context/layout"
import { workspaceKey } from "./helpers"

export type ProjectRouteState = Record<string, { directory: string; id: string; at: number }>

export const projectRootForDirectory = (input: {
  directory: string
  projects: Pick<LocalProject, "worktree" | "sandboxes">[]
  order: Record<string, string[]>
  childProject?: string
  meta: { id: string; worktree: string }[]
}) => {
  const key = workspaceKey(input.directory)
  const project = input.projects.find(
    (item) => workspaceKey(item.worktree) === key || item.sandboxes?.some((sandbox) => workspaceKey(sandbox) === key),
  )
  if (project) return project.worktree

  const known = Object.entries(input.order).find(
    ([root, dirs]) => workspaceKey(root) === key || dirs.some((item) => workspaceKey(item) === key),
  )
  if (known) return known[0]
  if (!input.childProject) return input.directory
  return input.meta.find((item) => item.id === input.childProject)?.worktree ?? input.directory
}

export const rememberProjectSession = (
  state: ProjectRouteState,
  root: string,
  directory: string,
  id: string,
  at: number,
) => ({
  ...state,
  [root]: { directory, id, at },
})

export const dropProjectSession = (state: ProjectRouteState, root: string) => {
  if (!state[root]) return state
  const next = { ...state }
  delete next[root]
  return next
}
