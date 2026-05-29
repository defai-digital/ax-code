import type { AppDiagnosticsReport } from "./runtime/diagnostics"

export function DiagnosticsPanel(props: {
  report: AppDiagnosticsReport
  busy?: boolean
  error?: string
  logText?: string
  onRefresh: () => void
  onExportLogs: () => void
}) {
  return (
    <section aria-label="Diagnostics">
      <h3>Diagnostics</h3>
      <div class="diagnostics-grid">
        <span>
          <strong>{props.report.runtime.mode}</strong>
          runtime
        </span>
        <span>
          <strong>{props.report.runtime.authMode}</strong>
          auth
        </span>
        <span>
          <strong>{props.report.eventStream.status}</strong>
          events
        </span>
        <span>
          <strong>{props.report.queue.health}</strong>
          queue
        </span>
        <span>
          <strong>{props.report.renderer.visibleMessages}</strong>
          messages
        </span>
        <span>
          <strong>{props.report.security.bridgeAvailable ? "desktop" : "browser"}</strong>
          bridge
        </span>
      </div>
      <div class="diagnostics-card">
        <div>
          <strong>{props.report.renderer.name}</strong>
          <small>{props.report.renderer.version}</small>
        </div>
        <p>
          {props.report.runtime.backendUrl ?? "fixture backend"} · {props.report.queue.total} queue items ·{" "}
          {props.report.eventStream.appliedEvents} events
        </p>
        <p>
          {props.report.security.contentOrigin} · sandbox {formatBoolean(props.report.security.sandbox)} · node{" "}
          {formatBoolean(props.report.security.nodeIntegration)}
        </p>
        <p>
          {releaseLabel(props.report.desktop.capabilities?.release)} · updates{" "}
          {formatBoolean(props.report.desktop.capabilities?.release?.updaterConfigured)}
        </p>
      </div>
      <div class="diagnostics-actions">
        <button disabled={props.busy} onClick={props.onRefresh} type="button">
          Refresh
        </button>
        <button disabled={props.busy || !props.report.desktop.available} onClick={props.onExportLogs} type="button">
          Export logs
        </button>
      </div>
      {props.error ? <p class="approval-error">{props.error}</p> : undefined}
      {props.logText ? (
        <textarea
          aria-label="Diagnostics log export"
          class="diagnostics-log"
          readOnly
          value={trimLogPreview(props.logText)}
        />
      ) : undefined}
    </section>
  )
}

function formatBoolean(value: boolean | undefined) {
  if (typeof value !== "boolean") return "unknown"
  return value ? "on" : "off"
}

function trimLogPreview(value: string) {
  const lines = value.split("\n")
  return lines.slice(Math.max(0, lines.length - 40)).join("\n")
}

function releaseLabel(release: NonNullable<AppDiagnosticsReport["desktop"]["capabilities"]>["release"] | undefined) {
  if (!release) return "release manifest unknown"
  const status = release.status ?? "unknown"
  const target = release.packageTarget ?? "dev"
  const gates = release.gates ? Object.values(release.gates).filter((gate) => gate.status === "blocked").length : 0
  return `${target} ${status}${gates > 0 ? ` · ${gates} gates blocked` : ""}`
}
