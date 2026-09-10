import { isAxTrustProviderID } from "@/mode/provider-category"

export const AX_TRUST_PROMPT_CACHE_HEADER = "X-AX-Prompt-Cache-Key"

export function shouldSendAxTrustPromptCacheKey(input: {
  providerID: string
  management?: unknown
  axTrust?: unknown
}): boolean {
  if (input.axTrust === false) return false
  if (input.axTrust === true) return true
  if (input.management === "ax-trust") return true
  return isAxTrustProviderID(input.providerID)
}

export function applyAxTrustPromptCacheHeader(
  headers: Record<string, string>,
  sessionID: string,
): Record<string, string> {
  const next = { ...headers }
  for (const name of Object.keys(next)) {
    if (name.toLowerCase() === "x-ax-prompt-cache-key") delete next[name]
  }
  next[AX_TRUST_PROMPT_CACHE_HEADER] = sessionID
  return next
}
