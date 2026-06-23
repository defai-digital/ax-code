import type { ToolPart as ToolPartType } from "@ax-code/sdk/v2"

const ACTIVE_TOOL_STATUSES = new Set(["pending", "running", "started"])
const FINAL_TOOL_STATUSES = new Set(["completed", "error", "aborted", "failed", "timeout", "cancelled"])

function getToolState(toolPart: ToolPartType): Record<string, unknown> {
  return ((toolPart as Record<string, unknown>).state as Record<string, unknown> | undefined) ?? {}
}

function getToolStatus(toolPart: ToolPartType): string | undefined {
  const status = getToolState(toolPart).status
  return typeof status === "string" ? status : undefined
}

export function isActiveToolPart(toolPart: ToolPartType): boolean {
  const status = getToolStatus(toolPart)
  return Boolean(status && ACTIVE_TOOL_STATUSES.has(status))
}

export function isFinalizedToolPart(toolPart: ToolPartType): boolean {
  const status = getToolStatus(toolPart)
  if (status && ACTIVE_TOOL_STATUSES.has(status)) {
    return false
  }
  if (status && FINAL_TOOL_STATUSES.has(status)) {
    return true
  }

  const state = getToolState(toolPart)
  const time = (state.time as Record<string, unknown> | undefined) ?? {}
  const endTime = typeof time.end === "number" ? time.end : undefined
  const startTime = typeof time.start === "number" ? time.start : undefined
  if (typeof endTime !== "number") {
    return false
  }
  if (typeof startTime === "number" && endTime < startTime) {
    return false
  }
  return true
}
