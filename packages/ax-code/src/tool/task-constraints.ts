import { Session } from "../session"
import type { Permission } from "../permission"
import { MessageV2 } from "../session/message-v2"

/** A delegated task may inherit restrictions, never its parent's tool grants. */
export async function taskParentConstraints(message: MessageV2.Assistant) {
  const parent = await MessageV2.get({ sessionID: message.sessionID, messageID: message.parentID })
  if (parent.info.role !== "user") throw new Error("Task parent must be a user message")
  const session = await Session.get(message.sessionID)
  return {
    permissionDenials: (session.permission ?? []).filter((rule) => rule.action === "deny"),
    isolation: parent.info.isolation,
    tools: Object.fromEntries(Object.entries(parent.info.tools ?? {}).filter(([, enabled]) => enabled === false)),
  }
}

/** Repeated resumes must not accumulate copies or restore parent grants. */
export function inheritTaskPermissionDenials(existing: Permission.Ruleset, denials: Permission.Ruleset) {
  return [
    ...existing.filter(
      (rule) =>
        !denials.some(
          (denial) =>
            denial.permission === rule.permission && denial.pattern === rule.pattern && denial.action === rule.action,
        ),
    ),
    ...denials,
  ]
}
