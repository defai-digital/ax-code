import { Session } from "../../session"
import { SessionID } from "../../session/schema"

export async function resolveSession(id?: string) {
  if (id) {
    return Session.get(SessionID.make(id))
  }
  return [...Session.list({ limit: 1 })][0]
}
