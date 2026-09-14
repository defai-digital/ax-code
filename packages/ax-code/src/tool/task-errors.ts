import type { MessageV2 } from "../session/message-v2"
import type { SessionPrompt } from "../session/prompt"

/**
 * Shared rendering for delegated-agent failures.
 *
 * `task` and `task_parallel` both surface subagent errors to the model, so the
 * shape must stay identical between them; keep these in one place instead of
 * letting the two tools drift.
 */

export function assistantError(result: Awaited<ReturnType<typeof SessionPrompt.prompt>>) {
  if (result.info.role !== "assistant") return undefined
  return result.info.error
}

export function assistantErrorMessage(error: NonNullable<MessageV2.Assistant["error"]>) {
  const data = error.data as { message?: unknown } | undefined
  return typeof data?.message === "string" ? data.message : error.name
}

export function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || error.name || "Unknown error",
    }
  }
  if (typeof error === "string") {
    return { name: "Error", message: error }
  }
  return { name: "Error", message: "Unknown error" }
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}
