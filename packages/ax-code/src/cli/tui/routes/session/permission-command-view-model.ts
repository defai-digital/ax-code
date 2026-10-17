/** Approval uses the request's effective command, never a stale model input after a rewrite. */
export function permissionCommandView(metadata: Record<string, unknown>, input: Record<string, unknown>) {
  const data = approvalInput(metadata, input)
  const command =
    metadata.hookRewritten === true
      ? typeof data.command === "string"
        ? data.command
        : ""
      : typeof metadata.command === "string"
        ? metadata.command
        : typeof data.command === "string"
          ? data.command
          : ""
  return { command }
}

/** Persisted inputs retain replay identity; the redacted audit explains the executed replacement. */
export function hookRewriteSummary(metadata: Record<string, unknown>): string {
  const record = metadata.hookRewrite
  if (!record || typeof record !== "object" || !("before" in record) || !("after" in record)) return ""
  if (typeof record.before !== "string" || typeof record.after !== "string") return ""
  return `${record.before} -> ${record.after}`
}

/**
 * The input an approval view should render. A hook-rewritten call carries its redacted effective input on the
 * request; the persisted part keeps the model's original input for replay and must not be shown as what runs.
 */
export function approvalInput(
  metadata: Record<string, unknown>,
  persisted: Record<string, unknown>,
): Record<string, unknown> {
  const effective = metadata.effectiveInput
  if (metadata.hookRewritten === true && effective && typeof effective === "object" && !Array.isArray(effective)) {
    return effective as Record<string, unknown>
  }
  return metadata.hookRewritten === true ? {} : persisted
}

/** Shared by every permission type, including hook confirmations and MCP calls. */
export function permissionRewriteView(metadata: Record<string, unknown>) {
  if (metadata.hookRewritten !== true) return undefined
  const effective = approvalInput(metadata, {})
  const changedFields = Array.isArray(metadata.changedFields)
    ? metadata.changedFields.filter((key): key is string => typeof key === "string")
    : []
  return {
    changedFields,
    values: changedFields.map(
      (key) => `${key}: ${Object.hasOwn(effective, key) ? JSON.stringify(effective[key]) : "[removed or omitted]"}`,
    ),
  }
}

export function permissionSearchView(input: Record<string, unknown>) {
  return ["pattern", "path", "include"].flatMap((key) =>
    typeof input[key] === "string" ? [`${key}: ${input[key]}`] : [],
  )
}
