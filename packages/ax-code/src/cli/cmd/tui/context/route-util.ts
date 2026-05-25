import { parsePromptInfo, type PromptInfo } from "../component/prompt/prompt-info"

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

export function parseInitialRoutePayload(raw?: string): Route {
  if (!raw) return { type: "home" }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return { type: "home" }
    if (parsed.type === "home") {
      return {
        type: "home",
        initialPrompt: parsePromptInfo(parsed.initialPrompt),
        workspaceID: typeof parsed.workspaceID === "string" ? parsed.workspaceID : undefined,
      }
    }
    if (parsed.type === "session" && typeof parsed.sessionID === "string") {
      return {
        type: "session",
        sessionID: parsed.sessionID,
        initialPrompt: parsePromptInfo(parsed.initialPrompt),
      }
    }
  } catch {}
  return { type: "home" }
}
