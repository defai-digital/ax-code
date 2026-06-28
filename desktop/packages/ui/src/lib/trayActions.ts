export type TrayPermissionResponse = "once" | "always" | "reject"

export type TrayPermissionAction = {
  type: "respond-permission"
  sessionId: string
  id: string
  response: TrayPermissionResponse
}

const VALID_PERMISSION_RESPONSES = new Set<TrayPermissionResponse>(["once", "always", "reject"])

const isTrayPermissionResponse = (value: unknown): value is TrayPermissionResponse => {
  return typeof value === "string" && VALID_PERMISSION_RESPONSES.has(value as TrayPermissionResponse)
}

export const normalizeTrayPermissionAction = (value: unknown): TrayPermissionAction | null => {
  if (!value || typeof value !== "object") {
    return null
  }

  const action = value as Record<string, unknown>
  if (action.type !== "respond-permission") {
    return null
  }

  const sessionId = typeof action.sessionId === "string" ? action.sessionId.trim() : ""
  const id = typeof action.id === "string" ? action.id.trim() : ""
  const response = action.response
  if (!sessionId || !id || !isTrayPermissionResponse(response)) {
    return null
  }

  return {
    type: "respond-permission",
    sessionId,
    id,
    response,
  }
}

const getTrayPermissionActionKey = (action: TrayPermissionAction): string => {
  return `${action.sessionId}\u0000${action.id}\u0000${action.response}`
}

export const createTrayPermissionActionDeduper = ({
  duplicateWindowMs = 1000,
  now = () => Date.now(),
}: {
  duplicateWindowMs?: number
  now?: () => number
} = {}) => {
  const acceptedAtByKey = new Map<string, number>()

  return (value: unknown): TrayPermissionAction | null => {
    const action = normalizeTrayPermissionAction(value)
    if (!action) {
      return null
    }

    const key = getTrayPermissionActionKey(action)
    const timestamp = now()
    for (const [acceptedKey, acceptedAt] of acceptedAtByKey) {
      if (timestamp - acceptedAt >= duplicateWindowMs) {
        acceptedAtByKey.delete(acceptedKey)
      }
    }

    const lastAcceptedAt = acceptedAtByKey.get(key)
    if (lastAcceptedAt !== undefined && timestamp - lastAcceptedAt < duplicateWindowMs) {
      return null
    }

    acceptedAtByKey.set(key, timestamp)
    return action
  }
}
