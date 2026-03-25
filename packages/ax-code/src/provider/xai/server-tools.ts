/**
 * Grok server-side tools configuration
 * Ported from ax-cli's server-tools.ts
 *
 * xAI's Agent Tools API provides server-side capabilities:
 * - x_search: Search X/Twitter posts (keyword or semantic)
 * - code_execution: Server-side Python sandbox (30s timeout)
 * - web_search: DEPRECATED (HTTP 410)
 *
 * These are passed to the xAI API via providerOptions, not as regular tools.
 */

export interface XSearchConfig {
  enabled: boolean
  searchType: "keyword" | "semantic"
  timeRange?: string // e.g., '24h', '7d', '30d'
  maxResults?: number
}

export interface CodeExecutionConfig {
  enabled: boolean
  timeout: number // ms, max 30000
}

export interface ServerToolsConfig {
  xSearch: XSearchConfig
  codeExecution: CodeExecutionConfig
}

export const DEFAULT_CONFIG: ServerToolsConfig = {
  xSearch: {
    enabled: true,
    searchType: "semantic",
  },
  codeExecution: {
    enabled: true,
    timeout: 30_000,
  },
}

/**
 * Build the server_tools array for the API request
 * Returns list of enabled tool names
 */
export function buildToolsArray(config: ServerToolsConfig = DEFAULT_CONFIG): string[] {
  const tools: string[] = []
  if (config.xSearch.enabled) tools.push("x_search")
  if (config.codeExecution.enabled) tools.push("code_execution")
  return tools
}

/**
 * Build server_tool_config object for the API request
 */
export function buildToolConfig(config: ServerToolsConfig = DEFAULT_CONFIG): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  if (config.xSearch.enabled) {
    const xConfig: Record<string, unknown> = {
      search_type: config.xSearch.searchType,
    }
    if (config.xSearch.timeRange) xConfig.time_range = config.xSearch.timeRange
    if (config.xSearch.maxResults) xConfig.max_results = config.xSearch.maxResults
    result.x_search = xConfig
  }

  if (config.codeExecution.enabled) {
    result.code_execution = {
      timeout: Math.min(config.codeExecution.timeout, 30_000),
    }
  }

  return result
}

/**
 * Check if any server tools are enabled
 */
export function hasEnabled(config: ServerToolsConfig = DEFAULT_CONFIG): boolean {
  return config.xSearch.enabled || config.codeExecution.enabled
}

/**
 * Merge user config with defaults
 */
export function merge(partial: Partial<ServerToolsConfig>): ServerToolsConfig {
  return {
    xSearch: { ...DEFAULT_CONFIG.xSearch, ...partial.xSearch },
    codeExecution: { ...DEFAULT_CONFIG.codeExecution, ...partial.codeExecution },
  }
}

/**
 * Check if a model supports server-side tools
 */
export function supportsServerTools(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return id.includes("grok-4") || id.includes("grok-3") || id.includes("grok-code")
}

/**
 * Check if a model supports reasoning/extended thinking
 */
export function supportsReasoning(modelId: string): boolean {
  const id = modelId.toLowerCase()
  if (id.includes("non-reasoning")) return false
  return id.includes("grok-4") || id.includes("grok-3-mini") || id.includes("grok-code")
}
