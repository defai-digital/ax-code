import { createSignal, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { useToast } from "../ui/toast"
import { directoryRequestHeaders } from "@tui/util/request-headers"
import { scheduleTuiTimeout } from "@tui/util/timer"
import { urlAllowlistServerRoute } from "@tui/util/server-url"
import {
  activeAxEngineJobForModel,
  axEngineJobActive,
  axEngineJobToast,
  axEngineJobTransitions,
  type AxEngineDownloadJobView,
} from "../component/ax-engine-downloads-view-model"

const POLL_INTERVAL_MS = 3_000

// Wire shape of one GET /provider/ax-engine/downloads entry (only the fields
// the watcher reads; the server summary is the authority).
type AxEngineDownloadJobWire = {
  id?: unknown
  modelID?: unknown
  status?: unknown
  error?: unknown
  progress?: { percent?: unknown }
}

function toJobView(job: AxEngineDownloadJobWire): AxEngineDownloadJobView | undefined {
  if (typeof job.id !== "string" || typeof job.modelID !== "string" || typeof job.status !== "string") return undefined
  return {
    id: job.id,
    modelID: job.modelID,
    status: job.status as AxEngineDownloadJobView["status"],
    percent: typeof job.progress?.percent === "number" ? job.progress.percent : undefined,
    error: typeof job.error === "string" ? job.error : undefined,
  }
}

/**
 * Watches server-side AX Engine download jobs for the whole TUI lifetime.
 * Polls only while jobs are queued/running (plus one baseline fetch on mount)
 * and toasts observed transitions to complete/failed/cancelled — the first
 * snapshot is a baseline so terminal jobs from before this process never
 * re-toast. The prompt reads `jobForModel` for the progress chip and the
 * submit guard; the download dialog calls `refresh` after starting a job so
 * watching begins immediately.
 */
export const { provider: AxEngineDownloadsProvider, use: useAxEngineDownloads } = createSimpleContext({
  name: "AxEngineDownloads",
  init: () => {
    const sdk = useSDK()
    const toast = useToast()
    const [jobs, setJobs] = createSignal<AxEngineDownloadJobView[]>([])
    const observed = new Map<string, string>()
    let pollCancel: (() => void) | undefined
    let disposed = false
    let baselineDone = false

    function stopPolling() {
      pollCancel?.()
      pollCancel = undefined
    }

    function schedule() {
      stopPolling()
      pollCancel = scheduleTuiTimeout(() => void poll(), {
        name: "ax-engine-downloads-poll",
        delayMs: POLL_INTERVAL_MS,
        unref: true,
      })
    }

    async function fetchJobs(): Promise<AxEngineDownloadJobView[]> {
      const response = await sdk.fetch(urlAllowlistServerRoute(sdk.url, "/provider/ax-engine/downloads"), {
        headers: directoryRequestHeaders({ directory: sdk.directory }),
      })
      if (!response.ok) return []
      const raw = (await response.json()) as AxEngineDownloadJobWire[]
      if (!Array.isArray(raw)) return []
      return raw.flatMap((job) => {
        const view = toJobView(job)
        return view ? [view] : []
      })
    }

    async function poll() {
      let next: AxEngineDownloadJobView[]
      try {
        next = await fetchJobs()
      } catch {
        // Best-effort watcher: on a fetch failure keep watching only when we
        // believe work is still in flight; otherwise stay quiet until the
        // next explicit refresh.
        if (!disposed && jobs().some(axEngineJobActive)) schedule()
        return
      }
      if (disposed) return
      if (baselineDone) {
        for (const transition of axEngineJobTransitions(observed, next)) {
          const notice = axEngineJobToast(transition)
          toast.show({ message: notice.message, variant: notice.variant })
        }
      }
      observed.clear()
      for (const job of next) observed.set(job.id, job.status)
      baselineDone = true
      setJobs(next)
      if (next.some(axEngineJobActive)) schedule()
      else stopPolling()
    }

    onMount(() => void poll())
    onCleanup(() => {
      disposed = true
      stopPolling()
    })

    return {
      jobs,
      jobForModel: (modelID: string) => activeAxEngineJobForModel(jobs(), modelID),
      refresh: () => void poll(),
    }
  },
})
