import { SessionID } from "@/session/schema"
import { Session } from "../../session"

export async function assertSessionExists(sessionID: SessionID) {
  await Session.get(sessionID)
}
