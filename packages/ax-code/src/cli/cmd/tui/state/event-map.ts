import type { Event } from "@ax-code/sdk/v2"
import type { Action, EventMapper } from "./actions"

export const mapEventToActions: EventMapper = (event: Event): Action[] => {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      return [{ type: "session.upserted", session: event.properties.info }]
    case "session.deleted":
      return [{ type: "session.deleted", sessionID: event.properties.info.id }]
    case "session.status":
      return [
        {
          type: "session.status.synced",
          sessionID: event.properties.sessionID,
          status: event.properties.status,
        },
      ]
    case "session.idle":
      return [
        {
          type: "session.status.synced",
          sessionID: event.properties.sessionID,
          status: { type: "idle" },
        },
      ]
    case "message.updated":
      return [{ type: "message.upserted", message: event.properties.info }]
    case "message.removed":
      return [
        {
          type: "message.deleted",
          sessionID: event.properties.sessionID,
          messageID: event.properties.messageID,
        },
      ]
    case "message.part.updated":
      return [{ type: "part.upserted", part: event.properties.part }]
    case "message.part.delta":
      return [
        {
          type: "part.delta.received",
          sessionID: event.properties.sessionID,
          messageID: event.properties.messageID,
          partID: event.properties.partID,
          field: event.properties.field,
          delta: event.properties.delta,
        },
      ]
    case "message.part.removed":
      return [
        {
          type: "part.deleted",
          messageID: event.properties.messageID,
          partID: event.properties.partID,
        },
      ]
    case "permission.asked":
      return [{ type: "permission.asked", request: event.properties }]
    case "permission.replied":
      return [
        {
          type: "permission.resolved",
          sessionID: event.properties.sessionID,
          requestID: event.properties.requestID,
        },
      ]
    case "question.asked":
      return [{ type: "question.asked", request: event.properties }]
    case "question.replied":
    case "question.rejected":
      return [
        {
          type: "question.resolved",
          sessionID: event.properties.sessionID,
          requestID: event.properties.requestID,
        },
      ]
    case "tui.prompt.append":
      return [{ type: "prompt.appended", text: event.properties.text }]
    case "tui.session.select":
      return [{ type: "route.session.selected", sessionID: event.properties.sessionID }]
    case "vcs.branch.updated":
      return [{ type: "vcs.synced", vcs: event.properties.branch ? { branch: event.properties.branch } : undefined }]
    default:
      return []
  }
}
