import { DiagnosticLog } from "@/debug/diagnostic-log"
import { withTimeout } from "@/util/timeout"
import { responseErrorMessage } from "@tui/util/error-message"
import { SUBMIT_ACCEPT_TIMEOUT_MS } from "./prompt-config"
import type { AsyncSessionRoute } from "./prompt-types"

export async function submitPromptRoute(input: {
  sessionID: string
  path: AsyncSessionRoute
  body: unknown
  action: string
  signal: AbortSignal
  url: string
  headers: HeadersInit
  fetch: typeof globalThis.fetch
}) {
  const startedAt = performance.now()
  DiagnosticLog.recordProcess("tui.promptSubmitAcceptStarted", {
    sessionID: input.sessionID,
    path: input.path,
    action: input.action,
  })
  const response = await withTimeout(
    input.fetch(`${input.url}/session/${encodeURIComponent(input.sessionID)}/${input.path}`, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify(input.body),
      signal: input.signal,
    }),
    SUBMIT_ACCEPT_TIMEOUT_MS,
    `${input.action} acceptance timed out after ${SUBMIT_ACCEPT_TIMEOUT_MS}ms`,
  ).catch((error) => {
    DiagnosticLog.recordProcess("tui.promptSubmitAcceptFailed", {
      sessionID: input.sessionID,
      path: input.path,
      action: input.action,
      elapsedMs: Math.round(performance.now() - startedAt),
      error,
    })
    throw error
  })

  if (response.status === 202 || response.ok) {
    DiagnosticLog.recordProcess("tui.promptSubmitAccepted", {
      sessionID: input.sessionID,
      path: input.path,
      action: input.action,
      status: response.status,
      elapsedMs: Math.round(performance.now() - startedAt),
    })
    return
  }
  const message = await responseErrorMessage(response)
  DiagnosticLog.recordProcess("tui.promptSubmitRejected", {
    sessionID: input.sessionID,
    path: input.path,
    action: input.action,
    status: response.status,
    elapsedMs: Math.round(performance.now() - startedAt),
    message,
  })
  throw new Error(message)
}
