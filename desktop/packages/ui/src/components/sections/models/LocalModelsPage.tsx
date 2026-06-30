import React from "react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon/Icon"
import { ScrollableOverlay } from "@/components/ui/ScrollableOverlay"
import { toast } from "@/components/ui"
import { cn } from "@/lib/utils"
import { useProjectsStore } from "@/stores/useProjectsStore"
import {
  cancelAxEngineModelDownload,
  deleteAxEngineModel,
  fetchAxEngineModels,
  startAxEngineServer,
  startAxEngineModelDownload,
  stopAxEngineServer,
  type AxEngineModelCatalogEntry,
  type AxEngineModelJobSummary,
  type AxEngineModelsResponse,
} from "@/lib/ax-code/axEngineModelsApi"
import { getCurrentDirectory } from "@/lib/ax-code/providerApi"

const formatBytes = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "Unknown"
  if (value <= 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"]
  let next = value
  let unit = 0
  while (next >= 1024 && unit < units.length - 1) {
    next /= 1024
    unit += 1
  }
  return `${next >= 10 ? next.toFixed(0) : next.toFixed(1)} ${units[unit]}`
}

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
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busyKey, setBusyKey] = React.useState<string | null>(null)
  // Ticks once a second while a download is active so the in-row elapsed timer
  // advances smoothly between the 2s catalog polls.
  const [now, setNow] = React.useState(() => Date.now())
  // Downloads we've shown a persistent toast for, so we can resolve it to
  // success/failure once the async job finishes (observed on a later poll).
  const announcedRef = React.useRef<Map<string, { name: string }>>(new Map())

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const next = await fetchAxEngineModels(directory)
      setData(next)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load local models"
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [directory])

  React.useEffect(() => {
    setLoading(true)
    void load()
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

  // Resolve the persistent "Downloading…" toast once its job reaches a terminal
  // state. The job finishes server-side, so we learn the outcome on a poll.
  React.useEffect(() => {
    if (!data) return
    const announced = announcedRef.current
    for (const [jobId, info] of announced) {
      const job = data.jobs.find((entry) => entry.id === jobId)
      if (!job) continue
      if (job.status === "complete") {
        toast.success(`${info.name} downloaded`, {
          id: `axe-dl-${jobId}`,
          description: "Ready to start.",
        })
        announced.delete(jobId)
      } else if (job.status === "failed") {
        toast.error(`${info.name} download failed`, {
          id: `axe-dl-${jobId}`,
          description: job.error,
        })
        announced.delete(jobId)
      } else if (job.status === "cancelled") {
        toast.dismiss(`axe-dl-${jobId}`)
        announced.delete(jobId)
      }
    }
  }, [data])

  const handleDownload = async (model: AxEngineModelCatalogEntry) => {
    setBusyKey(model.id)
    try {
      const job = await startAxEngineModelDownload(model.id, directory)
      announcedRef.current.set(job.id, { name: model.name })
      toast.loading(`Downloading ${model.name}…`, {
        id: `axe-dl-${job.id}`,
        description: "Large models can take several minutes — you can keep working while it downloads.",
        duration: Infinity,
      })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start download")
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
      toast.error(err instanceof Error ? err.message : "Model action failed")
    } finally {
      setBusyKey(null)
    }
  }

  const hostSummary = data
    ? data.eligibility.supported
      ? `${data.eligibility.chip ?? data.eligibility.platform} · ${formatBytes(data.eligibility.memoryBytes)} memory`
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
  const canStartServer = Boolean(startCandidate) && !hasActiveJob && !loading
  const handleServerToggle = async () => {
    if (data?.server.running) {
      await runAction("ax-engine-server", () => stopAxEngineServer(directory), "AX Engine stopped")
      return
    }
    if (!startCandidate) {
      toast.error("Download a runnable model before starting AX Engine")
      return
    }
    await runAction("ax-engine-server", () => startAxEngineServer(startCandidate.id, directory), "AX Engine started")
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="typography-ui-header font-semibold text-foreground">Models</h1>
            <p className="typography-meta text-muted-foreground">
              Download and manage local AX Engine MTP models. AX Engine requires macOS 26+, Apple Silicon M2 or later.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              {data?.server.running ? "Stop" : "Start"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <Icon name={loading ? "loader" : "refresh"} className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <ScrollableOverlay outerClassName="flex-1 min-h-0" className="p-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
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
            />
            <StatusBox
              title="Server"
              value={serverSummary}
              blocked={
                data ? Boolean(data.server.blockers.length) || (data.server.running && !data.server.ready) : false
              }
            />
            <StatusBox
              title="Download Cache"
              value={data ? `${data.diskRoot.path} · ${formatBytes(data.diskRoot.freeBytes)} free` : "Checking"}
              blocked={Boolean(data?.diskRoot.blockers.length)}
            />
          </div>

          {error && (
            <div className="rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-3 py-2 typography-ui text-[var(--status-error)]">
              {error}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-border bg-[var(--surface-elevated)]">
            <div className="hidden grid-cols-[minmax(220px,1.4fr)_minmax(140px,0.7fr)_minmax(180px,0.9fr)_auto] gap-3 border-b border-border px-4 py-2 text-[11px] font-medium text-muted-foreground md:grid">
              <span>Model</span>
              <span>Status</span>
              <span>Requirements</span>
              <span className="text-right">Actions</span>
            </div>
            {loading && !data ? (
              <div className="flex items-center gap-2 px-4 py-8 typography-ui text-muted-foreground">
                <Icon name="loader" className="h-4 w-4 animate-spin" />
                Loading models...
              </div>
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
                      void runAction(job.id, () => cancelAxEngineModelDownload(job.id, directory), "Download cancelled")
                    }}
                    onDelete={() => {
                      const ok = window.confirm(`Delete local copy of ${model.name}?`)
                      if (!ok) return
                      void runAction(model.id, () => deleteAxEngineModel(model.id, directory), "Model deleted")
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

const StatusBox: React.FC<{ title: string; value: string; blocked?: boolean }> = ({ title, value, blocked }) => (
  <div
    className={cn(
      "min-w-0 rounded-md border px-3 py-2",
      blocked ? "border-[var(--status-warning)]/35 bg-[var(--status-warning)]/5" : "border-border bg-background",
    )}
  >
    <div className="text-[11px] leading-4 text-muted-foreground">{title}</div>
    <div className="truncate text-[12px] leading-5 text-foreground" title={value}>
      {value}
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
        "grid grid-cols-1 gap-3 border-b border-border/70 px-4 py-2.5 text-[12px] leading-4 last:border-b-0 md:grid-cols-[minmax(220px,1.4fr)_minmax(140px,0.7fr)_minmax(180px,0.9fr)_auto]",
        dimmed && "opacity-60",
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <div className="truncate text-[13px] font-medium leading-5 text-foreground" title={model.name}>
          {model.name}
        </div>
        <div className="truncate text-[11px] leading-4 text-muted-foreground" title={`${model.id} · ${model.hfRepo}`}>
          {model.id}
        </div>
      </div>
      <div className="min-w-0 space-y-1">
        {job ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[12px] font-medium leading-4 text-foreground">
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
            <div className="text-[11px] leading-4 text-muted-foreground">
              {`≈${formatBytes(model.minDiskBytes)}`}
              {job.status === "running" && job.startedAt ? ` · ${formatElapsed(now - job.startedAt)} elapsed` : ""}
            </div>
          </div>
        ) : (
          <span
            className="inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-[11px] leading-4 text-foreground"
            title={model.local.present ? model.local.path : reason}
          >
            {statusLabel(model)}
          </span>
        )}
      </div>
      <div className="min-w-0 space-y-0.5 text-[11px] leading-4 text-muted-foreground" title={model.mtpSource}>
        <div>{model.quantization} · MTP</div>
        <div>
          Disk {formatBytes(model.minDiskBytes)} · Memory{" "}
          {model.minMemoryBytes > 0 ? formatBytes(model.minMemoryBytes) : "standard"}
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
