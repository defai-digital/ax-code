import { createSignal } from "solid-js"
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

function parseInitialRoute(): Route {
  const raw = process.env["AX_CODE_ROUTE"] || process.env["OPENCODE_ROUTE"]
  if (!raw) return { type: "home" }
  try {
    return JSON.parse(raw)
  } catch {
    return { type: "home" }
  }
}

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const [route, setRoute] = createSignal<Route>(parseInitialRoute())

    return {
      get data() {
        return route()
      },
      navigate(route: Route) {
        setRoute(route)
      },
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
