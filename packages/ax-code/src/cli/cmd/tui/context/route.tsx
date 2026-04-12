import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../component/prompt/history"
import { AX_CODE_ROUTE_ENV, LEGACY_OPENCODE_ROUTE_ENV } from "../transport"

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

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const [store, setStore] = createStore<Route>(
      (() => {
        const raw = process.env[AX_CODE_ROUTE_ENV] || process.env[LEGACY_OPENCODE_ROUTE_ENV]
        if (!raw) return { type: "home" } as Route
        try {
          return JSON.parse(raw)
        } catch {
          return { type: "home" } as Route
        }
      })(),
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
