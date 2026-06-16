import { HTTPException } from "hono/http-exception"
import { SessionID } from "@/session/schema"
import { Session } from "../../session"
import { parseSessionID, type SessionRouteContext } from "./route-params"

export async function assertSessionExists(sessionID: SessionID) {
  await Session.get(sessionID)
}

/**
 * Verify that a session belongs to the current project directory. Throws
 * HTTP 409 when the session belongs to a different project, matching the
 * behavior of the protected `GET /session/:sessionID` route. This is the
 * shared cross-project guard used by every session-derived route.
 */
export async function requireCurrentProjectSession(sessionID: SessionID) {
  const session = await Session.get(sessionID)
  if (Session.isCompatibleWithCurrentProject(session)) return session
  throw new HTTPException(409, {
    message: `Session ${sessionID} belongs to a different project directory; start a new session from the current project instead.`,
  })
}

/**
 * Parse a sessionID from the route params and verify it belongs to the
 * current project. Use the returned sessionID for all downstream work
 * instead of the raw route param so the project scope cannot be bypassed.
 */
export async function parseCurrentProjectSessionID(c: SessionRouteContext) {
  const sessionID = parseSessionID(c)
  await requireCurrentProjectSession(sessionID)
  return sessionID
}
