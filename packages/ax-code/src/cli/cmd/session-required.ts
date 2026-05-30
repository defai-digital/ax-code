import { UI } from "../ui"
import { Session } from "../../session"
import { NotFoundError } from "../../storage/db"

export async function getRequiredSession(sessionID: Parameters<typeof Session.get>[0], displayID = String(sessionID)) {
  try {
    return await Session.get(sessionID)
  } catch (error) {
    if (!NotFoundError.isInstance(error)) throw error
    UI.error(`Session not found: ${displayID}`)
    process.exit(1)
  }
}
