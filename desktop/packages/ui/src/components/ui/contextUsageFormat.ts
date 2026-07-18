/** Compact token count for context-usage tooltips. */
export function formatContextTokens(tokens: number): string {
  // Promote at 999_950 so 1-decimal K rounding never yields "1000.0K".
  if (tokens >= 999_950) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`
  }
  return tokens.toFixed(1).replace(/\.0$/, "")
}
