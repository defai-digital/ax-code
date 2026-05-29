import { createMemo, Show } from "solid-js"
import type { AssistantStatusSnapshot } from "./runtime/assistant-status"

export function SessionStatusRow(props: {
  snapshot: AssistantStatusSnapshot
  onAbort: () => void
  abortDisabled?: boolean
}) {
  const working = createMemo(() => props.snapshot.working)

  const statusLabel = createMemo(() => {
    const w = working()
    if (w.wasAborted || w.abortActive) return "stopping..."
    if (w.retryInfo)
      return `retrying${typeof w.retryInfo.attempt === "number" ? ` (attempt ${w.retryInfo.attempt})` : ""}`
    if (w.isWaitingForPermission) return "waiting for permission"
    if (w.isWaitingForQuestion) return "waiting for answer"
    if (w.isWorking) return w.statusText ?? "working"
    return null
  })

  const progressLabel = createMemo(() => {
    const w = working()
    if (!w.isWorking || !w.step) return null
    return w.maxSteps ? `step ${w.step} / ${w.maxSteps}` : `step ${w.step}`
  })

  const waitStateLabel = createMemo(() => {
    const w = working()
    if (!w.isWorking || !w.waitState) return null
    return w.waitState === "llm" ? "llm" : "tool"
  })

  const isVisible = createMemo(
    () => statusLabel() !== null || progressLabel() !== null || working().wasAborted || working().abortActive,
  )

  return (
    <Show when={isVisible()}>
      <div class="session-status-row" data-activity={working().activity} aria-live="polite" role="status">
        <Show when={working().isWorking && !working().isWaitingForPermission && !working().wasAborted}>
          <span class="session-status-spinner" aria-hidden="true" />
        </Show>
        <Show when={working().wasAborted || working().abortActive}>
          <span class="session-status-aborted-icon" aria-hidden="true">
            x
          </span>
        </Show>
        <Show when={statusLabel()}>
          <span class="session-status-text">{statusLabel()}</span>
        </Show>
        <Show when={progressLabel()}>
          <span class="session-status-progress">{progressLabel()}</span>
        </Show>
        <Show when={waitStateLabel()}>
          <span class="session-status-wait-state" data-wait={waitStateLabel()}>
            {waitStateLabel()}
          </span>
        </Show>
        <Show when={working().canAbort}>
          <button
            class="session-status-abort"
            disabled={props.abortDisabled}
            onClick={props.onAbort}
            type="button"
            aria-label="Abort current session"
          >
            Abort
          </button>
        </Show>
      </div>
    </Show>
  )
}
