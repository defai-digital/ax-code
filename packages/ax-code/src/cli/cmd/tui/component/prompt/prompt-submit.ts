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
  const timeoutAbort = new AbortController()
  const signal = AbortSignal.any([input.signal, timeoutAbort.signal])
  signal.throwIfAborted()
  DiagnosticLog.recordProcess("tui.promptSubmitAcceptStarted", {
    sessionID: input.sessionID,
    path: input.path,
    action: input.action,
  })
  await withTimeout(
    (async () => {
      const response = await input.fetch(`${input.url}/session/${encodeURIComponent(input.sessionID)}/${input.path}`, {
        method: "POST",
        headers: input.headers,
        body: JSON.stringify(input.body),
        signal,
      })
      signal.throwIfAborted()

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
      // The acceptance deadline also covers error bodies: receiving headers
      // alone must not leave the composer locked on a stalled response stream.
      const message = await responseErrorMessage(response)
      signal.throwIfAborted()
      DiagnosticLog.recordProcess("tui.promptSubmitRejected", {
        sessionID: input.sessionID,
        path: input.path,
        action: input.action,
        status: response.status,
        elapsedMs: Math.round(performance.now() - startedAt),
        message,
      })
      throw new Error(message)
    })(),
    SUBMIT_ACCEPT_TIMEOUT_MS,
    `${input.action} acceptance timed out after ${SUBMIT_ACCEPT_TIMEOUT_MS}ms`,
  ).catch((error) => {
    timeoutAbort.abort(error)
    DiagnosticLog.recordProcess("tui.promptSubmitAcceptFailed", {
      sessionID: input.sessionID,
      path: input.path,
      action: input.action,
      elapsedMs: Math.round(performance.now() - startedAt),
      error,
    })
    throw error
  })
}
