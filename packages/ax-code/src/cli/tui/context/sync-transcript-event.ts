/** Heavy event payloads are projected only for the viewed transcript. */
export function transcriptEventSession(event: unknown): string | null | undefined {
  const value = event as {
    type?: string
    properties?: { sessionID?: string; info?: { sessionID?: string }; part?: { sessionID?: string } }
  }
  switch (value?.type) {
    case "message.updated":
      return value.properties?.info?.sessionID ?? null
    case "message.part.updated":
      return value.properties?.part?.sessionID ?? null
    case "message.removed":
    case "message.part.delta":
    case "message.part.removed":
    case "todo.updated":
    case "session.diff":
    case "session.goal":
      return value.properties?.sessionID ?? null
    default:
      return undefined
  }
}
export function retainTranscriptEvent(event: unknown, sessionID: string | undefined) {
  const owner = transcriptEventSession(event)
  return owner === undefined || (owner !== null && owner === sessionID)
}
