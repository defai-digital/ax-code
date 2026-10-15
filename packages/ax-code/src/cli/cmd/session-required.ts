import { UI } from "../ui"
import type { SessionID } from "../../session/schema"
import { NotFoundError } from "../../storage/db"

export async function getRequiredSession(sessionID: SessionID, displayID = String(sessionID)) {
  const { Session } = await import("../../session")
  try {
    return await Session.get(sessionID)
  } catch (error) {
    if (!NotFoundError.isInstance(error)) throw error
    UI.error(`Session not found: ${displayID}`)
    process.exit(1)
  }
}
