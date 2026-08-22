import { shout } from "@perf/core"
import type { ApiRequest } from "./types"

export function withLogging(req: ApiRequest): ApiRequest {
  void shout(req.method)
  return req
}
