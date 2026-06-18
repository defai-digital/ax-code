import type { Session } from "@ax-code/sdk/v2"
import { isRecord } from "@/util/record"

function isRenderableSession(input: unknown): input is Session {
  return (
    isRecord(input) &&
    typeof input.id === "string" &&
    typeof input.title === "string" &&
    isRecord(input.time) &&
    typeof input.time.updated === "number"
  )
}

export function normalizeDialogSessions(data: unknown): Session[] {
  return Array.isArray(data) ? data.filter(isRenderableSession) : []
}
