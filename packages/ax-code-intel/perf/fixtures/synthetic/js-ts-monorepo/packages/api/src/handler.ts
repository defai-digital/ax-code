import { add, greet } from "@perf/core"
import type { ApiRequest, ApiResponse } from "./types"

export function handleRequest(req: ApiRequest): ApiResponse {
  const total = add(1, 2)
  return { status: 200, body: `${greet(req.path)} ${total}` }
}
