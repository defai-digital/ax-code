import { Show } from "solid-js"

export function AxCodeStatusDialog(props: {
  open: boolean
  reportText: string
  busy?: boolean
  onClose: () => void
}) {
  async function handleCopy() {
    if (!props.reportText || props.busy) return
    try {
      await navigator.clipboard.writeText(props.reportText)
    } catch {
      // clipboard API unavailable — no-op
    }
  }

  function handleOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) props.onClose()
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") props.onClose()
  }

  return (
    <Show when={props.open}>
      <div
        class="status-dialog-overlay"
        role="presentation"
        onClick={handleOverlayClick}
        onKeyDown={handleKeyDown}
      >
        <div role="dialog" aria-modal="true" aria-label="ax-code status report" class="status-dialog">
          <div class="status-dialog-header">
            <h3>ax-code Status Report</h3>
            <p class="status-dialog-description">Diagnostic snapshot of the running ax-code session.</p>
          </div>
          <div class="status-dialog-actions">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!props.reportText || props.busy}
              class="status-dialog-copy"
            >
              Copy to clipboard
            </button>
            <button type="button" onClick={props.onClose} class="status-dialog-close">
              Close
            </button>
          </div>
          <pre class="status-dialog-pre">{props.busy ? "Generating report…" : (props.reportText || "No data available")}</pre>
        </div>
      </div>
    </Show>
  )
}
