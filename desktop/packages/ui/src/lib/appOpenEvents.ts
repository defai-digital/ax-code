import type { ProjectEntry } from "@/lib/api/types"

export const OPEN_SESSION_EVENT = "openchamber:open-session"
export const OPEN_DRAFT_SESSION_EVENT = "openchamber:open-draft-session"
export const OPEN_PROJECT_EVENT = "openchamber:open-project"

export type OpenSessionEventDetail = {
  readonly sessionId: string
  readonly directory: string | null
}

export type OpenDraftSessionEventDetail = {
  readonly directory: string | null
  readonly projectId: string | null
}

export type OpenProjectEventDetail = {
  readonly projectPath: string
}

export type OpenProjectStoreAdapter = {
  readonly projects: ReadonlyArray<Pick<ProjectEntry, "id" | "path">>
  validateProjectPath: (path: string) => { ok: boolean; normalizedPath?: string }
  setActiveProject: (id: string) => void
  addProject: (path: string) => ProjectEntry | null
}

export type OpenSessionUiAdapter = {
  setActiveMainTab: (tab: "chat") => void
  setSessionSwitcherOpen: (open: boolean) => void
}

export type OpenSessionStoreAdapter = {
  setCurrentSession: (sessionId: string, directory: string | null) => void | Promise<void>
}

const getEventDetailRecord = (event: Event): Record<string, unknown> | null => {
  const detail = "detail" in event ? (event as CustomEvent<unknown>).detail : null
  return detail !== null && typeof detail === "object" && !Array.isArray(detail)
    ? (detail as Record<string, unknown>)
    : null
}

const trimmedString = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

const nullableTrimmedString = (value: unknown): string | null => {
  const trimmed = trimmedString(value)
  return trimmed.length > 0 ? trimmed : null
}

export function parseOpenSessionEvent(event: Event): OpenSessionEventDetail | null {
  const detail = getEventDetailRecord(event)
  const sessionId = trimmedString(detail?.sessionId)
  if (!sessionId) {
    return null
  }

  return {
    sessionId,
    directory: nullableTrimmedString(detail?.directory),
  }
}

export function parseOpenDraftSessionEvent(event: Event): OpenDraftSessionEventDetail {
  const detail = getEventDetailRecord(event)
  return {
    directory: nullableTrimmedString(detail?.directory),
    projectId: nullableTrimmedString(detail?.projectId),
  }
}

export function parseOpenProjectEvent(event: Event): OpenProjectEventDetail | null {
  const detail = getEventDetailRecord(event)
  const projectPath = trimmedString(detail?.projectPath)
  return projectPath ? { projectPath } : null
}

export function applyOpenProjectPathToStore(
  projectPath: string,
  projectsStore: OpenProjectStoreAdapter,
): string | null {
  const validation = projectsStore.validateProjectPath(projectPath)
  const normalizedPath = validation.ok ? validation.normalizedPath : null
  if (!normalizedPath) {
    return null
  }

  const existing = projectsStore.projects.find((project) => project.path === normalizedPath)
  if (existing) {
    projectsStore.setActiveProject(existing.id)
    return existing.id
  }

  return projectsStore.addProject(normalizedPath)?.id ?? null
}

export function applyOpenSessionEventDetail(
  detail: OpenSessionEventDetail,
  uiStore: OpenSessionUiAdapter,
  sessionStore: OpenSessionStoreAdapter,
) {
  uiStore.setActiveMainTab("chat")
  uiStore.setSessionSwitcherOpen(false)
  return sessionStore.setCurrentSession(detail.sessionId, detail.directory)
}
