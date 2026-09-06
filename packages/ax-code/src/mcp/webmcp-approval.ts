/** Display only the bridge's bounded approval summary, never invocation input. */
export function webMcpApprovalLines(metadata: Record<string, unknown>): string[] {
  const text = (value: unknown) =>
    typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 240) : "(unknown)"
  const origins = Array.isArray(metadata.allowedOrigins) ? metadata.allowedOrigins.slice(0, 8).map(text) : []
  return [
    `Bridge: ${text(metadata.server)}`,
    `Operation: ${text(metadata.tool)}`,
    ...(Number.isSafeInteger(metadata.pageId) ? [`Page ID: ${metadata.pageId}`] : []),
    ...(typeof metadata.toolName === "string" ? [`Page tool: ${text(metadata.toolName)}`] : []),
    ...(typeof metadata.origin === "string" ? [`Navigation origin: ${text(metadata.origin)}`] : []),
    `Allowed origins: ${origins.join(", ") || "(unknown)"}`,
    ...(Number.isSafeInteger(metadata.inputBytes) ? [`Input: ${metadata.inputBytes} bytes (payload omitted)`] : []),
    "Experimental: page tools and results are untrusted. Effects are not guaranteed.",
    "Approval applies once; it is not an atomic origin/document binding.",
  ]
}
