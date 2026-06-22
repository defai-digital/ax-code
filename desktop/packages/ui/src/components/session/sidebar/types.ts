import type { Session } from "@ax-code/sdk/v2"
import type { WorktreeMetadata } from "@/types/worktree"

export type SessionSummaryMeta = {
  additions?: number | string | null
  deletions?: number | string | null
  files?: number | null
  diffs?: Array<{ additions?: number | string | null; deletions?: number | string | null }>
}

export type SessionNode = {
  session: Session
  children: SessionNode[]
  worktree: WorktreeMetadata | null
}

export type SessionGroup = {
  id: string
  label: string
  branch: string | null
  description: string | null
  isMain: boolean
  isArchivedBucket?: boolean
  worktree: WorktreeMetadata | null
  directory: string | null
  folderScopeKey?: string | null
  sessions: SessionNode[]
}

export type ProjectItem = {
  id: string
  path?: string
  label?: string
  normalizedPath: string
  icon?: string
  color?: string
  iconImage?: { mime: string; updatedAt: number; source: "custom" | "auto" }
  iconBackground?: string
}

export type WorktreeMeta = { path: string }

export type SessionSecondaryMeta = {
  projectLabel?: string | null
  branchLabel?: string | null
}

export type ProjectSection = {
  project: ProjectItem
  groups: SessionGroup[]
}

export type GroupSearchData = {
  filteredNodes: SessionNode[]
  matchedSessionCount: number
  folderNameMatchCount: number
  groupMatches: boolean
  hasMatch: boolean
}
