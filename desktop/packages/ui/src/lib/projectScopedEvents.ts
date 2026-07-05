import { isRecord } from "./record"

export const PROJECT_PLAN_SAVED_EVENT = "openchamber:project-plan-saved"
export const PROJECT_NOTES_UPDATED_EVENT = "openchamber:project-notes-updated"

export type ProjectScopedEventDetail = {
  readonly projectId: string | null
}

const hasDetail = (event: Event): event is Event & { readonly detail: unknown } => {
  return "detail" in event
}

const normalizeProjectId = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed || null
}

export function parseProjectScopedEvent(event: Event): ProjectScopedEventDetail {
  if (!hasDetail(event) || !isRecord(event.detail)) {
    return { projectId: null }
  }

  return {
    projectId: normalizeProjectId(event.detail.projectId),
  }
}

export function projectScopedEventMatchesProject(event: Event, currentProjectId: string | null | undefined): boolean {
  const eventProjectId = parseProjectScopedEvent(event).projectId
  if (eventProjectId === null) {
    return true
  }
  return eventProjectId === normalizeProjectId(currentProjectId)
}

export function dispatchProjectScopedEvent(eventName: string, projectId: string | null | undefined): void {
  if (typeof window === "undefined") {
    return
  }

  const normalizedProjectId = normalizeProjectId(projectId)
  window.dispatchEvent(
    new CustomEvent(eventName, {
      detail: normalizedProjectId ? { projectId: normalizedProjectId } : undefined,
    }),
  )
}

export function dispatchProjectPlanSaved(projectId: string | null | undefined): void {
  dispatchProjectScopedEvent(PROJECT_PLAN_SAVED_EVENT, projectId)
}

export function dispatchProjectNotesUpdated(projectId: string | null | undefined): void {
  dispatchProjectScopedEvent(PROJECT_NOTES_UPDATED_EVENT, projectId)
}
