import { SessionMetadata } from "@/session/metadata"

export const WORK_AGENT_NAME = "work"

export const WORK_SESSION_SEND_DISABLED =
  "AX Work sessions are no longer sendable in AX Code. Export the transcript and continue in AX Work. This session stays readable."

export function isWorkSessionMetadata(metadata: Record<string, unknown> | undefined) {
  return SessionMetadata.product(metadata).work !== undefined
}

export function isWorkAgentName(agent: string | undefined) {
  return agent === WORK_AGENT_NAME
}

export function workSessionSendBlockedReason(input: {
  metadata?: Record<string, unknown>
  agent?: string
}) {
  if (isWorkAgentName(input.agent) || isWorkSessionMetadata(input.metadata)) {
    return WORK_SESSION_SEND_DISABLED
  }
}

export function assertWorkSessionSendable(input: { metadata?: Record<string, unknown>; agent?: string }) {
  const reason = workSessionSendBlockedReason(input)
  if (reason) throw new Error(reason)
}
