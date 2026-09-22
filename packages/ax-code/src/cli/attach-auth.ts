import { Flag } from "../flag/flag"

function buildBasicAuthHeader(password?: string): Record<string, string> | undefined {
  const resolved = password ?? Flag.AX_CODE_SERVER_PASSWORD
  if (!resolved) return undefined
  const username = Flag.AX_CODE_SERVER_USERNAME ?? "ax-code"
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${resolved}`).toString("base64")}`,
  }
}

export function buildAttachAuthHeaders(password?: string) {
  return buildBasicAuthHeader(password)
}

/**
 * Headers for `run --attach`: basic auth (from `--password` or the
 * AX_CODE_SERVER_PASSWORD env) plus the runtime auth token when
 * AX_CODE_RUNTIME_TOKEN is set. A managed runtime uses the token header
 * (x-ax-code-runtime-token) rather than basic auth; both may be present.
 */
export function buildAttachHeaders(input: {
  password?: string
  runtimeToken?: string
}): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  const basic = buildBasicAuthHeader(input.password)
  if (basic) Object.assign(headers, basic)
  const token = input.runtimeToken ?? Flag.AX_CODE_RUNTIME_TOKEN
  if (token) headers["x-ax-code-runtime-token"] = token
  return Object.keys(headers).length > 0 ? headers : undefined
}
