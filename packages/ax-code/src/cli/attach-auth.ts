import { Flag } from "../flag/flag"

export function buildAttachAuthHeaders(password?: string) {
  const resolved = password ?? Flag.AX_CODE_SERVER_PASSWORD
  if (!resolved) return undefined
  const username = Flag.AX_CODE_SERVER_USERNAME ?? "ax-code"
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${resolved}`).toString("base64")}`,
  }
}
