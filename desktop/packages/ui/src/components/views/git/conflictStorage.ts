import type { IntegrateInProgress } from "@/lib/git/integrateWorktreeCommits"

export type BranchConflictOperation = "merge" | "rebase"

export type BranchConflictState = {
  readonly directory: string
  readonly conflictFiles: string[]
  readonly operation: BranchConflictOperation
}

const BRANCH_CONFLICT_STORAGE_PREFIX = "openchamber.conflict"
const INTEGRATE_CONFLICT_STORAGE_PREFIX = "openchamber.integrate.conflict"

const getLocalStorage = (): Storage | null => {
  if (typeof window === "undefined") {
    return null
  }
  return window.localStorage
}

const getSessionStorageKey = (prefix: string, sessionId: string | null | undefined): string | null => {
  if (!sessionId) {
    return null
  }
  return `${prefix}:${sessionId}`
}

const parseJsonObject = (raw: string | null): Record<string, unknown> | null => {
  if (!raw) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

const parseStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null
  }
  return value.every((entry) => typeof entry === "string") ? value : null
}

const isBranchConflictOperation = (value: unknown): value is BranchConflictOperation =>
  value === "merge" || value === "rebase"

export function parseBranchConflictState(raw: string | null, currentDirectory: string): BranchConflictState | null {
  const parsed = parseJsonObject(raw)
  if (!parsed || parsed.directory !== currentDirectory) {
    return null
  }

  const conflictFiles = parsed.conflictFiles === undefined ? [] : parseStringArray(parsed.conflictFiles)
  if (!conflictFiles) {
    return null
  }

  const operation = parsed.operation === undefined ? "merge" : parsed.operation
  if (!isBranchConflictOperation(operation)) {
    return null
  }

  return {
    directory: currentDirectory,
    conflictFiles,
    operation,
  }
}

export function parseIntegrateConflictState(raw: string | null, repoRoot: string): IntegrateInProgress | null {
  const parsed = parseJsonObject(raw)
  if (!parsed || parsed.repoRoot !== repoRoot) {
    return null
  }

  const cleanTargetWorktrees = parseStringArray(parsed.cleanTargetWorktrees)
  const remainingCommits = parseStringArray(parsed.remainingCommits)
  if (!cleanTargetWorktrees || !remainingCommits) {
    return null
  }

  if (
    typeof parsed.tempWorktreePath !== "string" ||
    !parsed.tempWorktreePath ||
    typeof parsed.sourceBranch !== "string" ||
    typeof parsed.targetBranch !== "string" ||
    typeof parsed.currentCommit !== "string"
  ) {
    return null
  }

  return {
    repoRoot,
    tempWorktreePath: parsed.tempWorktreePath,
    sourceBranch: parsed.sourceBranch,
    targetBranch: parsed.targetBranch,
    cleanTargetWorktrees,
    remainingCommits,
    currentCommit: parsed.currentCommit,
  }
}

export function readBranchConflictState(
  sessionId: string | null | undefined,
  currentDirectory: string,
): BranchConflictState | null {
  const storage = getLocalStorage()
  const key = getSessionStorageKey(BRANCH_CONFLICT_STORAGE_PREFIX, sessionId)
  if (!storage || !key) {
    return null
  }

  const raw = storage.getItem(key)
  const state = parseBranchConflictState(raw, currentDirectory)
  if (raw && !state) {
    storage.removeItem(key)
  }
  return state
}

export function saveBranchConflictState(sessionId: string | null | undefined, state: BranchConflictState): void {
  const storage = getLocalStorage()
  const key = getSessionStorageKey(BRANCH_CONFLICT_STORAGE_PREFIX, sessionId)
  if (!storage || !key) {
    return
  }
  storage.setItem(key, JSON.stringify(state))
}

export function clearBranchConflictState(sessionId: string | null | undefined): void {
  const storage = getLocalStorage()
  const key = getSessionStorageKey(BRANCH_CONFLICT_STORAGE_PREFIX, sessionId)
  if (!storage || !key) {
    return
  }
  storage.removeItem(key)
}

export function readIntegrateConflictState(
  sessionId: string | null | undefined,
  repoRoot: string,
): IntegrateInProgress | null {
  const storage = getLocalStorage()
  const key = getSessionStorageKey(INTEGRATE_CONFLICT_STORAGE_PREFIX, sessionId)
  if (!storage || !key) {
    return null
  }

  const raw = storage.getItem(key)
  const state = parseIntegrateConflictState(raw, repoRoot)
  if (raw && !state) {
    storage.removeItem(key)
  }
  return state
}

export function saveIntegrateConflictState(sessionId: string | null | undefined, state: IntegrateInProgress): void {
  const storage = getLocalStorage()
  const key = getSessionStorageKey(INTEGRATE_CONFLICT_STORAGE_PREFIX, sessionId)
  if (!storage || !key) {
    return
  }
  storage.setItem(key, JSON.stringify(state))
}

export function clearIntegrateConflictState(sessionId: string | null | undefined): void {
  const storage = getLocalStorage()
  const key = getSessionStorageKey(INTEGRATE_CONFLICT_STORAGE_PREFIX, sessionId)
  if (!storage || !key) {
    return
  }
  storage.removeItem(key)
}
