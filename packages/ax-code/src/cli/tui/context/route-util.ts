import { parsePromptInfo, type PromptInfo } from "../component/prompt/prompt-info"
import { parseTuiJsonPayload } from "../util/json"
import z from "zod"

export type HomeRoute = {
  type: "home"
  initialPrompt?: PromptInfo
  workspaceID?: string
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  initialPrompt?: PromptInfo
}

export type Route = HomeRoute | SessionRoute

const HomeRoutePayload = z
  .object({
    type: z.literal("home"),
    initialPrompt: z.unknown().optional(),
    workspaceID: z.string().optional(),
  })
  .passthrough()

const SessionRoutePayload = z
  .object({
    type: z.literal("session"),
    sessionID: z.string(),
    initialPrompt: z.unknown().optional(),
  })
  .passthrough()

const InitialRoutePayload = z.discriminatedUnion("type", [HomeRoutePayload, SessionRoutePayload])

export function decodeInitialRoutePayload(value: unknown): Route {
  const parsed = InitialRoutePayload.safeParse(value)
  if (!parsed.success) return { type: "home" }
  if (parsed.data.type === "home") {
    return {
      type: "home",
      initialPrompt: parsePromptInfo(parsed.data.initialPrompt),
      workspaceID: parsed.data.workspaceID,
    }
  }
  return {
    type: "session",
    sessionID: parsed.data.sessionID,
    initialPrompt: parsePromptInfo(parsed.data.initialPrompt),
  }
}

export function parseInitialRoutePayload(raw?: string): Route {
  const parsed = parseTuiJsonPayload(raw)
  return parsed === undefined ? { type: "home" } : decodeInitialRoutePayload(parsed)
}
