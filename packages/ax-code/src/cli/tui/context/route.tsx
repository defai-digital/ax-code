import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { pickFirstEnvValue } from "../util/env"
import { parseInitialRoutePayload, type Route } from "./route-util"

export type { HomeRoute, SessionRoute, Route } from "./route-util"

export function parseInitialRoute(raw?: string): Route {
  return parseInitialRoutePayload(raw)
}

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const [store, setStore] = createStore<Route>(
      parseInitialRoute(pickFirstEnvValue({ env: process.env, names: ["AX_CODE_ROUTE", "OPENCODE_ROUTE"] })),
    )

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        // Replace the route object instead of shallow-merging: a plain
        // setStore(route) keeps keys absent from the new route (e.g. a stale
        // initialPrompt from a fork), leaking them into every later navigation.
        setStore(reconcile(route))
      },
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
