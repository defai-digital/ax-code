import { toast } from "@/components/ui"
import { useI18nStore, formatMessage, type I18nKey, type I18nParams } from "@/lib/i18n/store"
import { fetchAxEngineModels, type AxEngineModelJobSummary } from "./axEngineModelsApi"

const tr = (key: I18nKey, params?: I18nParams): string => formatMessage(useI18nStore.getState().dictionary, key, params)

// Tracks the persistent "Downloading…" toasts for AX Engine model downloads at
// module level. The downloads run server-side and outlive the models page, so
// toast resolution must not depend on the page staying mounted: while any
// announced job is unresolved the tracker polls on its own, whether or not the
// page (and its own polling) is around. Previously the toast state lived in
// the page component and navigating away orphaned an infinite "Downloading…"
// toast forever.

type ToastOptions = { id: string; description?: string; duration?: number }

export type DownloadToastDeps = {
  toast: {
    loading: (message: string, options: ToastOptions) => unknown
    success: (message: string, options: ToastOptions) => unknown
    error: (message: string, options: ToastOptions) => unknown
    dismiss: (id: string) => unknown
  }
  fetchJobs: (directory: string | null) => Promise<AxEngineModelJobSummary[]>
  setInterval: (fn: () => void, ms: number) => number
  clearInterval: (id: number) => void
  now: () => number
}

const POLL_MS = 2000

// A job id missing from the server's job list normally means the CLI process
// restarted (jobs are in-memory server-side). Give a freshly announced job a
// grace window first so a reconcile against a payload fetched just before the
// download started does not misreport it.
const MISSING_JOB_GRACE_MS = 10_000

export function createDownloadToastTracker(deps: DownloadToastDeps) {
  const announced = new Map<string, { name: string; directory: string | null; announcedAt: number }>()
  let timer: number | undefined
  let polling = false

  const toastId = (jobId: string) => `axe-dl-${jobId}`

  function announce(job: { id: string }, name: string, directory: string | null) {
    announced.set(job.id, { name, directory, announcedAt: deps.now() })
    deps.toast.loading(tr("axEngine.download.toast.downloading", { name }), {
      id: toastId(job.id),
      description: tr("axEngine.download.toast.downloadingDescription"),
      duration: Infinity,
    })
    ensureTimer()
  }

  function reconcile(jobs: AxEngineModelJobSummary[]) {
    for (const [jobId, info] of announced) {
      const job = jobs.find((entry) => entry.id === jobId)
      if (!job) {
        if (deps.now() - info.announcedAt > MISSING_JOB_GRACE_MS) {
          deps.toast.error(tr("axEngine.download.toast.interrupted", { name: info.name }), {
            id: toastId(jobId),
            description: tr("axEngine.download.toast.interruptedDescription"),
          })
          announced.delete(jobId)
        }
        continue
      }
      if (job.status === "complete") {
        deps.toast.success(tr("axEngine.download.toast.downloaded", { name: info.name }), {
          id: toastId(jobId),
          description: tr("axEngine.download.toast.downloadedDescription"),
        })
        announced.delete(jobId)
      } else if (job.status === "failed") {
        deps.toast.error(tr("axEngine.download.toast.failed", { name: info.name }), {
          id: toastId(jobId),
          description: job.error,
        })
        announced.delete(jobId)
      } else if (job.status === "cancelled") {
        deps.toast.dismiss(toastId(jobId))
        announced.delete(jobId)
      }
    }
    if (announced.size === 0) stopTimer()
  }

  function ensureTimer() {
    if (timer !== undefined) return
    timer = deps.setInterval(() => void poll(), POLL_MS)
  }

  function stopTimer() {
    if (timer === undefined) return
    deps.clearInterval(timer)
    timer = undefined
  }

  async function poll() {
    if (polling) return
    polling = true
    try {
      const first = announced.values().next().value
      if (!first) {
        stopTimer()
        return
      }
      reconcile(await deps.fetchJobs(first.directory))
    } catch {
      // Transient (e.g. the CLI is restarting) — keep polling; the toast stays
      // "Downloading…" until a terminal state can actually be observed.
    } finally {
      polling = false
    }
  }

  return { announce, reconcile, hasAnnounced: () => announced.size > 0 }
}

export const downloadToastTracker = createDownloadToastTracker({
  toast,
  fetchJobs: async (directory) => (await fetchAxEngineModels(directory)).jobs,
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
  now: () => Date.now(),
})
