/** Display only the bridge's bounded approval summary, never invocation input. */
export function webMcpApprovalLines(metadata: Record<string, unknown>): string[] {
  const text = (value: unknown) =>
    typeof value === "string"
      ? value
          // Strip controls, line/paragraph separators and invisible format
          // characters (bidi overrides, zero-width marks) so a crafted
          // approval label cannot reorder or hide the surrounding summary.
          .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/gu, "")
          .slice(0, 240)
      : "(unknown)"
  const origins = Array.isArray(metadata.allowedOrigins) ? metadata.allowedOrigins.slice(0, 8).map(text) : []
  const annotations =
    typeof metadata.annotations === "object" && metadata.annotations !== null
      ? (metadata.annotations as Record<string, unknown>)
      : undefined
  const hints: string[] = []
  if (annotations === undefined && typeof metadata.toolName === "string") {
    hints.push("No page annotations were listed for this tool — treat it as consequential.")
  } else if (annotations !== undefined) {
    if (annotations?.consequential === true) {
      hints.push("Page declares this tool CONSEQUENTIAL — it may take a non-reversible action.")
    }
    if (annotations?.untrustedContent === true) {
      hints.push("Page declares the tool returns untrusted content.")
    }
    if (annotations?.readOnly === true && annotations?.consequential !== true) {
      hints.push("Page declares this tool read-only (page-asserted, not verified).")
    }
    if (annotations?.readOnly === true && annotations?.consequential === true) {
      hints.push("Conflicting page hints: read-only and consequential were both declared.")
    }
    // An empty or hintless annotation object carries no signal at all: it
    // must not read as a clean bill of health.
    if (annotations?.readOnly !== true && annotations?.consequential !== true) {
      hints.push("No reliable page annotations were listed — treat it as consequential.")
    }
  }
  return [
    `Bridge: ${text(metadata.server)}`,
    `Operation: ${text(metadata.tool)}`,
    ...(Number.isSafeInteger(metadata.pageId) ? [`Page ID: ${metadata.pageId}`] : []),
    ...(typeof metadata.toolName === "string" ? [`Page tool: ${text(metadata.toolName)}`] : []),
    ...(typeof metadata.pageOrigin === "string" ? [`Listed page origin: ${text(metadata.pageOrigin)}`] : []),
    ...(typeof metadata.origin === "string" ? [`Navigation origin: ${text(metadata.origin)}`] : []),
    `Allowed origins: ${origins.join(", ") || "(unknown)"}`,
    ...(Number.isSafeInteger(metadata.inputBytes) ? [`Input: ${metadata.inputBytes} bytes (payload omitted)`] : []),
    ...hints,
    "Experimental: page tools and results are untrusted. Effects are not guaranteed.",
    "Approval applies once; it is not an atomic origin/document binding.",
  ]
}
