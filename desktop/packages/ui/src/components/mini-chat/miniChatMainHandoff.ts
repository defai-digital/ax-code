export type MiniChatMainHandoffPayload =
  | {
      sessionId: string
      directory: string
    }
  | {
      mode: "draft"
      directory: string
      projectId: string | null
    }

const firstNonEmpty = (...values: Array<string | null | undefined>): string => {
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : ""
    if (trimmed) return trimmed
  }
  return ""
}

export function buildMiniChatMainHandoffPayload(input: {
  currentSessionId?: string | null
  openDirectory?: string | null
  sessionDirectory?: string | null
  currentDirectory?: string | null
  draftProjectId?: string | null
}): MiniChatMainHandoffPayload {
  const sessionId = firstNonEmpty(input.currentSessionId)
  if (sessionId) {
    return {
      sessionId,
      directory: firstNonEmpty(input.openDirectory, input.sessionDirectory, input.currentDirectory),
    }
  }

  return {
    mode: "draft",
    directory: firstNonEmpty(input.openDirectory, input.currentDirectory),
    projectId: firstNonEmpty(input.draftProjectId) || null,
  }
}
