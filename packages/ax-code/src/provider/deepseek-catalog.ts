const HIDDEN_FINAL_SEGMENTS = new Set(["deepseek-chat", "deepseek-reasoner"])
const HIDDEN_NAMES = new Set(["deepseek chat", "deepseek reasoner"])

/** Legacy DeepSeek aliases. First-party picker keeps V4 Flash/Pro instead. */
export function isHiddenDeepseekLegacySku(id: string, name?: string): boolean {
  const segment = (id.split("/").pop() ?? id).toLowerCase()
  if (HIDDEN_FINAL_SEGMENTS.has(segment)) return true
  if (typeof name === "string" && HIDDEN_NAMES.has(name.toLowerCase().trim())) return true
  return false
}
