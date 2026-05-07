import { Session } from "../../session"
import { SessionID } from "../../session/schema"

export async function getLatestSession() {
  for await (const session of Session.list({ limit: 1 })) {
    return session
  }
}

export async function resolveSession(id?: string) {
  if (id) {
    return Session.get(SessionID.make(id))
  }
  return getLatestSession()
}
