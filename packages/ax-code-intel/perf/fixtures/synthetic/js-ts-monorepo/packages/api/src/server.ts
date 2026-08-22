import { route } from "./router"
import { withLogging } from "./middleware"
import type { ApiRequest, ApiResponse } from "./types"

export function createServer() {
  return {
    handle(req: ApiRequest): ApiResponse {
      return route(withLogging(req))
    },
  }
}
