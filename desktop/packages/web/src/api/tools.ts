import type { ToolsAPI } from "@openchamber/ui/api/types"
import { API_ENDPOINTS, HTTP_DEFAULTS } from "./constants"

export const createWebToolsAPI = (): ToolsAPI => ({
  async getAvailableTools(): Promise<string[]> {
    const response = await fetch(API_ENDPOINTS.tools.ids, {
      method: HTTP_DEFAULTS.method.get,
      headers: HTTP_DEFAULTS.headers.acceptJson,
    })

    if (!response.ok) {
      throw new Error(`Tools API returned ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (!Array.isArray(data)) {
      throw new Error("Tools API returned invalid data format")
    }

    return data.filter((tool: unknown): tool is string => typeof tool === "string" && tool !== "invalid").sort()
  },
})
