export const WEBFETCH_MAX_RESPONSE_SIZE = 5 * 1024 * 1024
export const WEBFETCH_DEFAULT_TIMEOUT = 30 * 1000
export const WEBFETCH_MAX_TIMEOUT = 120 * 1000
export const BASH_MAX_METADATA_LENGTH = 30_000
export const EXA_BASE_URL = "https://mcp.exa.ai"
export const EXA_ENDPOINT = "/mcp"
export const EXA_DEFAULT_NUM_RESULTS = 8
export const AX_CODE_INTERNAL_HOST = "ax-code.internal"
export const AX_CODE_INTERNAL_ORIGIN = `http://${AX_CODE_INTERNAL_HOST}`
export const LEGACY_OPENCODE_INTERNAL_HOST = "opencode.internal"
export const INTERNAL_FETCH_ALLOWED_HOSTS = [
  AX_CODE_INTERNAL_HOST,
  LEGACY_OPENCODE_INTERNAL_HOST,
  "localhost",
  "127.0.0.1",
  "[::1]",
] as const

export function isInternalFetchHost(hostname: string) {
  return INTERNAL_FETCH_ALLOWED_HOSTS.includes(hostname as (typeof INTERNAL_FETCH_ALLOWED_HOSTS)[number])
}
