import type { PermissionRequest, QuestionRequest } from "@ax-code/sdk/v2"
import { applyRequestAskedEvent, applyRequestResolvedEvent } from "./sync-event-dispatch"
import { createAutonomousPermissionReply, createAutonomousQuestionReply } from "./sync-request-decision"

export type RequestSyncEvent =
  | { type: "permission.asked"; properties: PermissionRequest }
  | { type: "permission.replied"; properties: { sessionID: string; requestID: string } }
  | { type: "question.asked"; properties: QuestionRequest }
  | { type: "question.replied"; properties: { sessionID: string; requestID: string } }
  | { type: "question.rejected"; properties: { sessionID: string; requestID: string } }

export interface RequestSyncEventHandlers {
  autonomous: boolean
  updatePermission: (updater: (draft: Record<string, PermissionRequest[]>) => void) => void
  updateQuestion: (updater: (draft: Record<string, QuestionRequest[]>) => void) => void
  replyPermission: (payload: ReturnType<typeof createAutonomousPermissionReply>) => Promise<unknown> | unknown
  replyQuestion: (payload: ReturnType<typeof createAutonomousQuestionReply>) => Promise<unknown> | unknown
  onWarn: (label: string, error: unknown) => void
}

function warnAsync(action: () => Promise<unknown> | unknown, label: string, onWarn: RequestSyncEventHandlers["onWarn"]) {
  try {
    void Promise.resolve(action()).catch((error) => onWarn(label, error))
  } catch (error) {
    onWarn(label, error)
  }
}

export function handleRequestSyncEvent(event: RequestSyncEvent, handlers: RequestSyncEventHandlers) {
  switch (event.type) {
    case "permission.replied":
      handlers.updatePermission((draft) => {
        applyRequestResolvedEvent(draft, event.properties.sessionID, event.properties.requestID)
      })
      return true

    case "permission.asked":
      if (handlers.autonomous) {
        warnAsync(
          () => handlers.replyPermission(createAutonomousPermissionReply(event.properties.id)),
          "autonomous permission reply failed",
          handlers.onWarn,
        )
        return true
      }
      handlers.updatePermission((draft) => {
        applyRequestAskedEvent(draft, event.properties)
      })
      return true

    case "question.replied":
    case "question.rejected":
      handlers.updateQuestion((draft) => {
        applyRequestResolvedEvent(draft, event.properties.sessionID, event.properties.requestID)
      })
      return true

    case "question.asked":
      if (handlers.autonomous) {
        warnAsync(
          () => handlers.replyQuestion(createAutonomousQuestionReply(event.properties.id, event.properties.questions)),
          "autonomous question reply failed",
          handlers.onWarn,
        )
        return true
      }
      handlers.updateQuestion((draft) => {
        applyRequestAskedEvent(draft, event.properties)
      })
      return true
  }
}
