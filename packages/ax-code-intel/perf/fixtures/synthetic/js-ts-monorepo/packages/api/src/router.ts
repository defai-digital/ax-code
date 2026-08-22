import { handleRequest } from "./handler"
import type { ApiRequest, ApiResponse } from "./types"

export function route(req: ApiRequest): ApiResponse {
  if (req.path === "/health") return { status: 200, body: "ok" }
  return handleRequest(req)
}
