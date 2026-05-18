export const SESSION_TOOL_RENDERER_KEYS = [
  "bash",
  "glob",
  "read",
  "grep",
  "list",
  "webfetch",
  "codesearch",
  "websearch",
  "write",
  "edit",
  "task",
  "apply_patch",
  "todowrite",
  "question",
  "skill",
  "refactor_plan",
  "refactor_apply",
  "impact_analyze",
  "dedup_scan",
  "generic",
] as const

export type SessionToolRendererKey = (typeof SESSION_TOOL_RENDERER_KEYS)[number]

const SPECIALIZED_TOOL_RENDERERS = new Set<string>(SESSION_TOOL_RENDERER_KEYS.filter((key) => key !== "generic"))

export function isKnownSessionToolRenderer(tool: string): tool is Exclude<SessionToolRendererKey, "generic"> {
  return SPECIALIZED_TOOL_RENDERERS.has(tool)
}

export function sessionToolRendererKey(tool: string): SessionToolRendererKey {
  return isKnownSessionToolRenderer(tool) ? tool : "generic"
}

export function coalescedToolLabel(tool: string, count: number): string {
  if (tool === "read") return `Read · ${count} files`
  if (tool === "list") return `List · ${count} directories`
  if (tool === "glob") return `Glob · ${count} searches`
  if (tool === "grep") return `Grep · ${count} searches`
  return `${tool} · ${count}`
}
