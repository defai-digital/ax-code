import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../component/prompt/history"

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

function parseInitialRoute(raw?: string): Route {
  if (!raw) return { type: "home" }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return { type: "home" }
    if (parsed.type === "home") {
      return {
        type: "home",
        initialPrompt: parsed.initialPrompt,
        workspaceID: typeof parsed.workspaceID === "string" ? parsed.workspaceID : undefined,
      }
    }
    if (parsed.type === "session" && typeof parsed.sessionID === "string") {
      return {
        type: "session",
        sessionID: parsed.sessionID,
        initialPrompt: parsed.initialPrompt,
      }
    }
  } catch {}
  return { type: "home" }
}

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const [store, setStore] = createStore<Route>(
      parseInitialRoute(process.env["AX_CODE_ROUTE"] || process.env["OPENCODE_ROUTE"]),
    )

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        setStore(route)
      },
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
