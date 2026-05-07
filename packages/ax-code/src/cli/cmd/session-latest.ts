import { Session } from "../../session"
import { SessionID } from "../../session/schema"

export async function resolveSession(id?: string) {
  if (id) {
    return Session.get(SessionID.make(id))
  }
  return [...Session.list({ limit: 1 })][0]
}

export function printNoSessionFound() {
  console.log("No sessions found. Run ax-code first.")
}
