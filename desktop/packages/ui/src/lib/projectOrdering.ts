import type { ProjectEntry } from "@/lib/api/types"

/**
 * Display order for projects:
 * 1. Pinned projects first (most recently opened first)
 * 2. Unpinned projects keep relative order, but prefer lastOpenedAt when both set
 *    and orderIndex is unavailable (stable fallback).
 *
 * Callers that support manual drag-reorder should pass `orderIndex` from the
 * current array position so unpinned items keep their manual sequence.
 */
export function compareProjectsForDisplay(
  a: Pick<ProjectEntry, "pinned" | "lastOpenedAt" | "addedAt" | "label" | "path"> & { orderIndex?: number },
  b: Pick<ProjectEntry, "pinned" | "lastOpenedAt" | "addedAt" | "label" | "path"> & { orderIndex?: number },
): number {
  const aPinned = a.pinned === true
  const bPinned = b.pinned === true
  if (aPinned !== bPinned) {
    return aPinned ? -1 : 1
  }

  if (aPinned && bPinned) {
    const aOpened = typeof a.lastOpenedAt === "number" ? a.lastOpenedAt : 0
    const bOpened = typeof b.lastOpenedAt === "number" ? b.lastOpenedAt : 0
    if (aOpened !== bOpened) {
      return bOpened - aOpened
    }
  }

  const aIndex = typeof a.orderIndex === "number" ? a.orderIndex : Number.MAX_SAFE_INTEGER
  const bIndex = typeof b.orderIndex === "number" ? b.orderIndex : Number.MAX_SAFE_INTEGER
  if (aIndex !== bIndex) {
    return aIndex - bIndex
  }

  const aOpened = typeof a.lastOpenedAt === "number" ? a.lastOpenedAt : 0
  const bOpened = typeof b.lastOpenedAt === "number" ? b.lastOpenedAt : 0
  if (aOpened !== bOpened) {
    return bOpened - aOpened
  }

  const aAdded = typeof a.addedAt === "number" ? a.addedAt : 0
  const bAdded = typeof b.addedAt === "number" ? b.addedAt : 0
  if (aAdded !== bAdded) {
    return bAdded - aAdded
  }

  const aLabel = (a.label || a.path || "").toLowerCase()
  const bLabel = (b.label || b.path || "").toLowerCase()
  return aLabel.localeCompare(bLabel)
}

export function sortProjectsForDisplay<T extends ProjectEntry>(projects: readonly T[]): T[] {
  return projects
    .map((project, orderIndex) => ({ project, orderIndex }))
    .sort((a, b) =>
      compareProjectsForDisplay(
        { ...a.project, orderIndex: a.orderIndex },
        { ...b.project, orderIndex: b.orderIndex },
      ),
    )
    .map(({ project }) => project)
}
