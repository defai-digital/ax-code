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
  startAxEngineModel,
  startAxEngineModelDownload,
  type AxEngineModelCatalogEntry,
  type AxEngineModelJobSummary,
  type AxEngineModelsResponse,
} from "@/lib/ax-code/axEngineModelsApi"
import { getCurrentDirectory } from "@/lib/ax-code/providerApi"

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

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

const formatTokens = (value: number) => compactNumber.format(value)

const stateLabel: Record<string, string> = {
  ready: "Local",
  downloadable: "Ready to download",
  downloading: "Downloading",
  "not-fit": "Does not fit",
  "host-unsupported": "Unsupported host",
  "dependency-missing": "AX Engine missing",
  "disk-blocked": "Insufficient disk",
  "local-unusable": "Local but unusable",
  failed: "Failed",
}

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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="typography-ui-header font-semibold text-foreground">Models</h1>
            <p className="typography-ui text-muted-foreground">
              Download and manage local AX Engine MTP models. AX Engine requires macOS 26+, Apple Silicon M2 or later.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <Icon name={loading ? "loader" : "refresh"} className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <ScrollableOverlay outerClassName="flex-1 min-h-0" className="p-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <div className="grid gap-3 lg:grid-cols-3">
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
            <div className="hidden grid-cols-[minmax(220px,1.4fr)_minmax(160px,0.8fr)_minmax(220px,1fr)_auto] gap-3 border-b border-border px-4 py-2 typography-meta text-muted-foreground md:grid">
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
                    busy={busyKey === model.id || (job ? busyKey === job.id : false)}
                    onDownload={() =>
                      runAction(model.id, () => startAxEngineModelDownload(model.id, directory), "Download started")
                    }
                    onCancel={() => {
                      if (!job) return
                      void runAction(job.id, () => cancelAxEngineModelDownload(job.id, directory), "Download cancelled")
                    }}
                    onDelete={() => {
                      const ok = window.confirm(`Delete local copy of ${model.name}?`)
                      if (!ok) return
                      void runAction(model.id, () => deleteAxEngineModel(model.id, directory), "Model deleted")
                    }}
                    onStart={() =>
                      runAction(model.id, () => startAxEngineModel(model.id, directory), "AX Engine starting")
                    }
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
    <div className="typography-meta text-muted-foreground">{title}</div>
    <div className="truncate typography-ui-label text-foreground" title={value}>
      {value}
    </div>
  </div>
)

const ModelRow: React.FC<{
  model: AxEngineModelCatalogEntry
  job?: AxEngineModelJobSummary
  busy: boolean
  onDownload: () => void
  onCancel: () => void | undefined
  onDelete: () => void
  onStart: () => void
}> = ({ model, job, busy, onDownload, onCancel, onDelete, onStart }) => {
  const reason = primaryReason(model)
  const dimmed = isDimmed(model)
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 border-b border-border/70 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(220px,1.4fr)_minmax(160px,0.8fr)_minmax(220px,1fr)_auto]",
        dimmed && "opacity-60",
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="truncate typography-ui-label font-medium text-foreground" title={model.name}>
          {model.name}
        </div>
        <div className="truncate typography-micro text-muted-foreground" title={model.id}>
          {model.id}
        </div>
        <div className="truncate typography-micro text-muted-foreground" title={model.hfRepo}>
          {model.hfRepo}
        </div>
      </div>
      <div className="min-w-0 space-y-1">
        <span className="inline-flex rounded-full border border-border bg-background px-2 py-0.5 typography-micro text-foreground">
          {job ? stateLabel.downloading : stateLabel[model.fit.state]}
        </span>
        {model.local.present && (
          <div className="truncate typography-micro text-muted-foreground" title={model.local.path}>
            {formatBytes(model.local.bytes)} · {model.local.path}
          </div>
        )}
        {reason && (
          <div className="line-clamp-2 typography-micro text-muted-foreground" title={reason}>
            {reason}
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-1 typography-micro text-muted-foreground">
        <div>{model.quantization} · MTP</div>
        <div>
          Disk {formatBytes(model.minDiskBytes)} · Memory{" "}
          {model.minMemoryBytes > 0 ? formatBytes(model.minMemoryBytes) : "standard"}
        </div>
        <div>
          Context {formatTokens(model.contextTokens)} · Output {formatTokens(model.outputTokens)}
        </div>
        <div className="truncate" title={model.mtpSource}>
          {model.mtpSource}
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
        ) : model.fit.runnable ? (
          <Button size="sm" onClick={onStart} disabled={busy}>
            <Icon name={busy ? "loader" : "play"} className={cn("h-4 w-4", busy && "animate-spin")} />
            Start
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled title={reason}>
            Unavailable
          </Button>
        )}
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
