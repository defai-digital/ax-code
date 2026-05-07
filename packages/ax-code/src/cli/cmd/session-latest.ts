import { Session } from "../../session"

export async function getLatestSession() {
  for await (const session of Session.list({ limit: 1 })) {
    return session
  }
}
