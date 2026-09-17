// Shared by backend admission and UI choices; keep this module free of runtime state.
export const INTERACTIVE_ONLY_PERMISSIONS: ReadonlySet<string> = new Set([
  "isolation_escalation",
  "bash_destructive",
  "ops_approve",
  "webmcp",
  // A PreToolUse lifecycle hook answered `ask`: the hook author asked for a
  // human decision on this call, so no wildcard rule or autonomous
  // auto-approval may answer on the human's behalf.
  "hook",
])

export function isInteractivePermission(permission: string, metadata?: Record<string, unknown>): boolean {
  return INTERACTIVE_ONLY_PERMISSIONS.has(permission) || metadata?.["requireInteractive"] === true
}

type PersistenceRequest = {
  id: string
  permission: string
  metadata?: Record<string, unknown>
  always: readonly string[]
}

export function canPersistPermission(request: PersistenceRequest): boolean {
  return request.always.length > 0 && !isInteractivePermission(request.permission, request.metadata)
}

export function canConfirmPersistentPermission(
  request: PersistenceRequest,
  stagedRequestID: string | undefined,
): boolean {
  return request.id === stagedRequestID && canPersistPermission(request)
}
