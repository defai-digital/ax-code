import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Icon } from "@/components/icon/Icon"
import { ScrollableOverlay } from "@/components/ui/ScrollableOverlay"
import { ViewLoadingSkeleton } from "@/components/ui/ViewLoadingSkeleton"
import { toast } from "@/components/ui"
import { useConfirmDialog } from "@/components/ui/ConfirmDialog"
import { cn } from "@/lib/utils"
import { useProjectsStore } from "@/stores/useProjectsStore"
import {
  cancelAxEngineModelDownload,
  deleteAxEngineModel,
  fetchAxEngineConnection,
  fetchAxEngineModels,
  installAxEngine,
  startAxEngineServer,
  startAxEngineModelDownload,
  stopAxEngineServer,
  updateAxEngineConnection,
  type AxEngineConnectionView,
  type AxEngineModelCatalogEntry,
  type AxEngineModelJobSummary,
  type AxEngineModelsResponse,
} from "@/lib/ax-code/axEngineModelsApi"
import { downloadToastTracker } from "@/lib/ax-code/axEngineDownloadToasts"
import { getCurrentDirectory } from "@/lib/ax-code/providerApi"
import { formatLocalModelBytes } from "./localModelFormat"
import { useI18n } from "@/lib/i18n"

const formatElapsed = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00"
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

const statusLabel = (model: AxEngineModelCatalogEntry) => (model.local.present ? "Downloaded" : "Ready to download")

const isDimmed = (model: AxEngineModelCatalogEntry) =>
  !model.fit.downloadable && !model.fit.runnable && model.fit.state !== "downloading"

const primaryReason = (model: AxEngineModelCatalogEntry) =>
  model.fit.blockers[0] ?? model.local.blockers[0] ?? model.disk.blockers[0] ?? model.fit.warnings[0]

const activeJobFor = (jobs: AxEngineModelJobSummary[], model: AxEngineModelCatalogEntry) =>
  jobs.find(
    (job) =>
      job.modelID === model.id &&
      job.quantization === model.quantization &&
      (job.status === "queued" || job.status === "running"),
  )

export const LocalModelsPage: React.FC = () => {
  const activeProjectId = useProjectsStore((state) => state.activeProjectId)
  const directory = React.useMemo(() => {
    void activeProjectId
    return getCurrentDirectory()
  }, [activeProjectId])
  const [data, setData] = React.useState<AxEngineModelsResponse | null>(null)
  const [connection, setConnection] = React.useState<AxEngineConnectionView | null>(null)
  const [showAttachForm, setShowAttachForm] = React.useState(false)
  const [attachBaseURL, setAttachBaseURL] = React.useState("http://127.0.0.1:31418/v1")
  const [attachApiKey, setAttachApiKey] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busyKey, setBusyKey] = React.useState<string | null>(null)
  const { requestConfirm, confirmDialog } = useConfirmDialog()
  const { t } = useI18n()
  // Ticks once a second while a download is active so the in-row elapsed timer
  // advances smoothly between the 2s catalog polls.
  const [now, setNow] = React.useState(() => Date.now())
  const mountedRef = React.useRef(true)
  // The fetch retries internally for up to ~18s while the CLI restarts; without
  // this guard the 2s poll stacks concurrent requests and an older response can
  // resolve after a newer one, clobbering fresher job state.
  const inFlightRef = React.useRef(false)
  const connectionInitializedRef = React.useRef(false)

  const load = React.useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const [next, nextConnection] = await Promise.all([
        fetchAxEngineModels(directory),
        fetchAxEngineConnection(directory),
      ])
      if (!mountedRef.current) return
      setError(null)
      setData(next)
      setConnection(nextConnection)
      if (!connectionInitializedRef.current) {
        connectionInitializedRef.current = true
        setAttachBaseURL(nextConnection.baseURL)
        setShowAttachForm(nextConnection.mode === "attach")
      }
    } catch (err) {
      if (!mountedRef.current) return
      const message = err instanceof Error ? err.message : "Failed to load local models"
      setError(message)
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }, [directory])

  React.useEffect(() => {
    mountedRef.current = true
    setLoading(true)
    void load()
    return () => {
      mountedRef.current = false
    }
  }, [load])

  const hasActiveJob = data?.jobs.some((job) => job.status === "queued" || job.status === "running") ?? false
  React.useEffect(() => {
    if (!hasActiveJob) return
    const timer = window.setInterval(() => void load(), 2000)
    return () => window.clearInterval(timer)
  }, [hasActiveJob, load])

  React.useEffect(() => {
    if (!hasActiveJob) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasActiveJob])

  // Resolve the persistent "Downloading…" toast once its job reaches a
  // terminal state. The tracker lives at module level (and polls on its own
  // while jobs are pending), so navigating away from this page cannot orphan a
  // toast; reconciling here as well just applies fresh poll data sooner.
  React.useEffect(() => {
    if (!data) return
    downloadToastTracker.reconcile(data.jobs)
  }, [data])

  const handleDownload = async (model: AxEngineModelCatalogEntry) => {
    setBusyKey(model.id)
    try {
      const job = await startAxEngineModelDownload(model.id, directory)
      downloadToastTracker.announce(job, model.name, directory)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("localModels.toast.downloadStartFailed"))
    } finally {
      setBusyKey(null)
    }
  }

  const handleCancel = async (job: AxEngineModelJobSummary) => {
    setBusyKey(job.id)
    try {
      const result = await cancelAxEngineModelDownload(job.id, directory)
      // The job can finish between the last poll and the click — the server
      // then reports the already-terminal state instead of cancelling.
      if (result?.status === "complete") toast.success(t("localModels.toast.downloadAlreadyFinished"))
      else toast.success(t("localModels.toast.downloadCancelled"))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("localModels.toast.actionFailed"))
    } finally {
      setBusyKey(null)
    }
  }

  const runAction = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusyKey(key)
    try {
      await action()
      toast.success(success)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("localModels.toast.actionFailed"))
    } finally {
      setBusyKey(null)
    }
  }

  const hostSummary = data
    ? data.eligibility.supported
      ? `${data.eligibility.chip ?? data.eligibility.platform} · ${formatLocalModelBytes(data.eligibility.memoryBytes)} memory`
      : (data.eligibility.blockers[0] ?? "AX Engine is not supported on this host")
    : "Loading host readiness"
  const serverModel = data?.server.state
    ? data.models.find((model) => model.id === data.server.state?.modelID)
    : undefined
  const serverSummary = data
    ? data.server.running
      ? data.server.ready
        ? `Running${serverModel ? ` · ${serverModel.name}` : ""}`
        : (data.server.blockers[0] ?? "Starting")
      : "Stopped"
    : "Checking"
  const startCandidate = data?.models.find((model) => model.fit.runnable)
  const serverBusy = busyKey === "ax-engine-server"
  const canInstallEngine = Boolean(
    data && !data.dependency.available && data.dependency.installable && data.eligibility.supported,
  )
  const installBusy = busyKey === "ax-engine-install"
  const handleInstallEngine = () =>
    void runAction("ax-engine-install", () => installAxEngine(directory), t("localModels.toast.engineInstalled"))
  const canStartServer = Boolean(startCandidate) && !hasActiveJob && !loading
  const handleServerToggle = async () => {
    if (data?.server.running) {
      await runAction("ax-engine-server", () => stopAxEngineServer(directory), t("localModels.toast.engineStopped"))
      return
    }
    if (!startCandidate) {
      toast.error(t("localModels.toast.noRunnableModel"))
      return
    }
    await runAction(
      "ax-engine-server",
      () => startAxEngineServer(startCandidate.id, directory),
      t("localModels.toast.engineStarted"),
    )
  }

  const handleManagedConnection = async () => {
    setBusyKey("ax-engine-connection")
    try {
      const next = await updateAxEngineConnection({ mode: "managed" }, directory)
      setConnection(next)
      setShowAttachForm(false)
      setAttachApiKey("")
      toast.success("AX Engine will start automatically when a local model is used")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to switch AX Engine to managed mode")
    } finally {
      setBusyKey(null)
    }
  }

  const handleAttachConnection = async () => {
    setBusyKey("ax-engine-connection")
    try {
      const next = await updateAxEngineConnection(
        {
          mode: "attach",
          baseURL: attachBaseURL,
          ...(attachApiKey.trim() ? { apiKey: attachApiKey.trim() } : {}),
        },
        directory,
      )
      setConnection(next)
      setAttachBaseURL(next.baseURL)
      setAttachApiKey("")
      setShowAttachForm(true)
      toast.success(`Attached AX Engine at ${next.baseURL}`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to attach AX Engine")
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {confirmDialog}
      <div className="border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="typography-ui-header font-semibold text-foreground">Models</h1>
            <p className="typography-meta text-muted-foreground">
              Download and manage local AX Engine models with automatic MTP or Direct decode. AX Engine requires macOS
              26+, Apple Silicon M2 or later.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {connection?.mode !== "attach" && (
              <Button
                variant={data?.server.running ? "outline" : "default"}
                size="sm"
                onClick={() => void handleServerToggle()}
                disabled={serverBusy || (!data?.server.running && !canStartServer)}
                title={
                  !data?.server.running && !startCandidate
                    ? "Download a runnable model before starting AX Engine"
                    : undefined
                }
              >
                <Icon
                  name={serverBusy ? "loader" : data?.server.running ? "close" : "play"}
                  className={cn("h-4 w-4", serverBusy && "animate-spin")}
                />
                {data?.server.running ? "Stop" : "Prewarm"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <Icon name={loading ? "loader" : "refresh"} className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <ScrollableOverlay outerClassName="flex-1 min-h-0" className="p-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div className="rounded-lg border border-border bg-[var(--surface-elevated)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="typography-ui-label font-medium text-foreground">Connection</div>
                <div className="typography-micro text-muted-foreground">
                  Managed mode starts automatically when used. Attach mode connects to an AX Engine server you already
                  run.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={connection?.mode === "managed" && !showAttachForm ? "default" : "outline"}
                  onClick={() => void handleManagedConnection()}
                  disabled={busyKey === "ax-engine-connection"}
                >
                  Managed local
                </Button>
                <Button
                  size="sm"
                  variant={showAttachForm ? "default" : "outline"}
                  onClick={() => setShowAttachForm(true)}
                  disabled={busyKey === "ax-engine-connection"}
                >
                  Existing server
                </Button>
              </div>
            </div>

            {showAttachForm && (
              <div className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-[minmax(240px,1fr)_minmax(180px,0.7fr)_auto]">
                <label className="space-y-1">
                  <span className="typography-micro font-medium text-foreground">Endpoint</span>
                  <Input
                    value={attachBaseURL}
                    onChange={(event) => setAttachBaseURL(event.target.value)}
                    placeholder="http://127.0.0.1:31418/v1"
                  />
                </label>
                <label className="space-y-1">
                  <span className="typography-micro font-medium text-foreground">API key</span>
                  <Input
                    type="password"
                    value={attachApiKey}
                    onChange={(event) => setAttachApiKey(event.target.value)}
                    placeholder={connection?.hasApiKey ? "Saved securely" : "local"}
                  />
                </label>
                <div className="flex items-end">
                  <Button
                    size="sm"
                    onClick={() => void handleAttachConnection()}
                    disabled={busyKey === "ax-engine-connection" || !attachBaseURL.trim()}
                  >
                    <Icon
                      name={busyKey === "ax-engine-connection" ? "loader" : "link-unlink-m"}
                      className={cn("h-4 w-4", busyKey === "ax-engine-connection" && "animate-spin")}
                    />
                    {connection?.mode === "attach" ? "Update" : "Connect"}
                  </Button>
                </div>
                <div className="typography-micro text-muted-foreground md:col-span-3">
                  The endpoint is validated before saving. Leave the key blank to keep the saved credential or use the
                  local default on first connect.
                </div>
              </div>
            )}

            {connection && (
              <div
                className={cn(
                  "mt-3 typography-micro",
                  connection.ready ? "text-[var(--status-success)]" : "text-muted-foreground",
                )}
              >
                {connection.mode === "attach"
                  ? connection.ready
                    ? `Attached · ${connection.baseURL} · ${connection.models.length} model${
                        connection.models.length === 1 ? "" : "s"
                      }`
                    : `Attached endpoint unavailable${connection.error ? ` · ${connection.error}` : ""}`
                  : connection.ready
                    ? `Managed server ready · ${connection.baseURL}`
                    : "Managed local · starts automatically when a downloaded model is used"}
              </div>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-4">
            <StatusBox title="Host" value={hostSummary} blocked={data ? !data.eligibility.supported : false} />
            <StatusBox
              title="AX Engine"
              value={
                data?.dependency.available
                  ? (data.dependency.binaryPath ?? "Available")
                  : (data?.dependency.blockers[0] ?? "Checking")
              }
              blocked={data ? !data.dependency.available : false}
              action={
                canInstallEngine ? (
                  <Button size="sm" onClick={handleInstallEngine} disabled={installBusy}>
                    <Icon
                      name={installBusy ? "loader" : "download"}
                      className={cn("h-4 w-4", installBusy && "animate-spin")}
                    />
                    {installBusy ? "Installing…" : "Install"}
                  </Button>
                ) : undefined
              }
            />
            <StatusBox
              title="Server"
              value={
                connection?.mode === "attach"
                  ? connection.ready
                    ? `Attached · ${connection.models.length} model${connection.models.length === 1 ? "" : "s"}`
                    : "Attached · unavailable"
                  : serverSummary
              }
              blocked={
                connection?.mode === "attach"
                  ? !connection.ready
                  : data
                    ? Boolean(data.server.blockers.length) || (data.server.running && !data.server.ready)
                    : false
              }
            />
            <StatusBox
              title="Download Cache"
              value={
                data ? `${data.diskRoot.path} · ${formatLocalModelBytes(data.diskRoot.freeBytes)} free` : "Checking"
              }
              blocked={Boolean(data?.diskRoot.blockers.length)}
            />
          </div>

          {error && (
            <div className="rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-3 py-2 typography-ui-label text-[var(--status-error)]">
              {error}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-border bg-[var(--surface-elevated)]">
            <div className="hidden grid-cols-[minmax(220px,1.4fr)_minmax(140px,0.7fr)_minmax(180px,0.9fr)_auto] gap-3 border-b border-border px-4 py-2 typography-micro font-medium text-muted-foreground md:grid">
              <span>Model</span>
              <span>Status</span>
              <span>Requirements</span>
              <span className="text-right">Actions</span>
            </div>
            {loading && !data ? (
              <ViewLoadingSkeleton rows={4} label="Loading models" />
            ) : (
              data?.models.map((model) => {
                const job = activeJobFor(data.jobs, model)
                return (
                  <ModelRow
                    key={model.id}
                    model={model}
                    job={job}
                    now={now}
                    busy={busyKey === model.id || (job ? busyKey === job.id : false)}
                    onDownload={() => void handleDownload(model)}
                    onCancel={() => {
                      if (!job) return
                      void handleCancel(job)
                    }}
                    onDelete={() => {
                      void (async () => {
                        const ok = await requestConfirm(`Delete local copy of ${model.name}?`, { destructive: true })
                        if (!ok) return
                        void runAction(model.id, () => deleteAxEngineModel(model.id, directory), "Model deleted")
                      })()
                    }}
                  />
                )
              })
            )}
          </div>
        </div>
      </ScrollableOverlay>
    </div>
  )
}

const StatusBox: React.FC<{ title: string; value: string; blocked?: boolean; action?: React.ReactNode }> = ({
  title,
  value,
  blocked,
  action,
}) => (
  <div
    className={cn(
      "min-w-0 rounded-md border px-3 py-2",
      blocked ? "border-[var(--status-warning)]/35 bg-[var(--status-warning)]/5" : "border-border bg-background",
    )}
  >
    <div className="typography-micro leading-4 text-muted-foreground">{title}</div>
    <div className="flex items-center justify-between gap-2">
      <div className="truncate typography-micro leading-5 text-foreground" title={value}>
        {value}
      </div>
      {action}
    </div>
  </div>
)

const ModelRow: React.FC<{
  model: AxEngineModelCatalogEntry
  job?: AxEngineModelJobSummary
  now: number
  busy: boolean
  onDownload: () => void
  onCancel: () => void | undefined
  onDelete: () => void
}> = ({ model, job, now, busy, onDownload, onCancel, onDelete }) => {
  const reason = primaryReason(model)
  const dimmed = isDimmed(model)
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 border-b border-border/70 px-4 py-2.5 typography-micro leading-4 last:border-b-0 md:grid-cols-[minmax(220px,1.4fr)_minmax(140px,0.7fr)_minmax(180px,0.9fr)_auto]",
        dimmed && "opacity-60",
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <div className="truncate typography-meta font-medium leading-5 text-foreground" title={model.name}>
          {model.name}
        </div>
        <div
          className="truncate typography-micro leading-4 text-muted-foreground"
          title={`${model.id} · ${model.hfRepo}`}
        >
          {model.id}
        </div>
      </div>
      <div className="min-w-0 space-y-1">
        {job ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 typography-micro font-medium leading-4 text-foreground">
              <Icon name="loader" className="h-3 w-3 animate-spin text-muted-foreground" />
              {job.status === "queued" ? "Queued…" : "Downloading…"}
            </div>
            <div
              className="relative h-1 w-full overflow-hidden rounded-full bg-border"
              role="progressbar"
              aria-label={`${model.name} ${job.status === "queued" ? "queued for download" : "downloading"}`}
            >
              <div className="oc-indeterminate-progress-bar absolute inset-y-0 left-0 w-1/4 rounded-full bg-primary" />
            </div>
            <div className="typography-micro leading-4 text-muted-foreground">
              {`≈${formatLocalModelBytes(model.minDiskBytes)}`}
              {job.status === "running" && job.startedAt ? ` · ${formatElapsed(now - job.startedAt)} elapsed` : ""}
            </div>
          </div>
        ) : (
          <span
            className="inline-flex rounded-full border border-border bg-background px-2 py-0.5 typography-micro leading-4 text-foreground"
            title={model.local.present ? model.local.path : reason}
          >
            {statusLabel(model)}
          </span>
        )}
      </div>
      <div className="min-w-0 space-y-0.5 typography-micro leading-4 text-muted-foreground" title={model.mtpSource}>
        <div>{model.quantization} · MTP</div>
        <div>
          Disk {formatLocalModelBytes(model.minDiskBytes)} · Memory{" "}
          {model.minMemoryBytes > 0 ? formatLocalModelBytes(model.minMemoryBytes) : "standard"}
        </div>
      </div>
      <div className="flex items-start justify-start gap-2 md:justify-end">
        {job ? (
          <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
            <Icon name={busy ? "loader" : "close"} className={cn("h-4 w-4", busy && "animate-spin")} />
            Cancel
          </Button>
        ) : model.fit.downloadable ? (
          <Button size="sm" onClick={onDownload} disabled={busy}>
            <Icon name={busy ? "loader" : "download"} className={cn("h-4 w-4", busy && "animate-spin")} />
            Download
          </Button>
        ) : !model.fit.runnable ? (
          <Button size="sm" variant="outline" disabled title={reason}>
            Unavailable
          </Button>
        ) : null}
        {model.fit.deletable && (
          <Button size="sm" variant="destructive" onClick={onDelete} disabled={busy || Boolean(job)}>
            <Icon name="delete-bin" className="h-4 w-4" />
            Delete
          </Button>
        )}
      </div>
    </div>
  )
}
