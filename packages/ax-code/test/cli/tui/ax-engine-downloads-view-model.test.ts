import { describe, expect, test } from "vitest"
import {
  activeAxEngineJobForModel,
  axEngineDownloadChip,
  axEngineJobPercent,
  axEngineJobToast,
  axEngineJobTransitions,
  type AxEngineDownloadJobView,
} from "../../../src/cli/cmd/tui/component/ax-engine-downloads-view-model"

function job(overrides: Partial<AxEngineDownloadJobView> = {}): AxEngineDownloadJobView {
  return { id: "job-1", modelID: "ornith-35b-axq-4bit", status: "running", ...overrides }
}

describe("activeAxEngineJobForModel", () => {
  test("returns the active job for the model and ignores terminal or foreign jobs", () => {
    const jobs = [
      job({ id: "done", status: "complete" }),
      job({ id: "other", modelID: "qwen3.8-27b-axq-6bit" }),
      job({ id: "active", status: "running", percent: 41.6 }),
    ]
    expect(activeAxEngineJobForModel(jobs, "ornith-35b-axq-4bit")?.id).toBe("active")
    expect(activeAxEngineJobForModel(jobs, "qwen3-coder-next-axq-6bit")).toBeUndefined()
  })
})

describe("axEngineJobPercent / axEngineDownloadChip", () => {
  test("clamps and rounds percent, tolerates missing values", () => {
    expect(axEngineJobPercent(job({ percent: 41.6 }))).toBe(42)
    expect(axEngineJobPercent(job({ percent: 140 }))).toBe(100)
    expect(axEngineJobPercent(job({ percent: Number.NaN }))).toBeUndefined()
    expect(axEngineJobPercent(job({}))).toBeUndefined()
  })

  test("renders queued, determinate, and indeterminate chips", () => {
    expect(axEngineDownloadChip(job({ status: "queued" }))).toBe("download queued")
    expect(axEngineDownloadChip(job({ status: "running", percent: 41.6 }))).toBe("downloading 42%")
    expect(axEngineDownloadChip(job({ status: "running" }))).toBe("downloading")
  })
})

describe("axEngineJobTransitions", () => {
  test("fires only for jobs observed as active before reaching a terminal state", () => {
    const observed = new Map([
      ["finished", "running"],
      ["historical", "complete"],
    ])
    const transitions = axEngineJobTransitions(observed, [
      job({ id: "finished", status: "complete" }),
      // Already complete in recent history — never re-toast.
      job({ id: "historical", status: "complete" }),
      // Terminal without ever being observed (baseline snapshot) — no toast.
      job({ id: "unseen", status: "failed" }),
      job({ id: "still-going", status: "running" }),
    ])
    expect(transitions.map((item) => [item.job.id, item.to])).toEqual([["finished", "complete"]])
  })
})

describe("axEngineJobToast", () => {
  test("composes per-outcome messages", () => {
    expect(axEngineJobToast({ job: job({ status: "complete" }), to: "complete" })).toEqual({
      message: "ornith-35b-axq-4bit download complete — the model is ready to use",
      variant: "success",
    })
    expect(axEngineJobToast({ job: job({ status: "failed", error: "disk full" }), to: "failed" })).toEqual({
      message: "ornith-35b-axq-4bit download failed: disk full",
      variant: "error",
    })
    expect(axEngineJobToast({ job: job({ status: "cancelled" }), to: "cancelled" })).toEqual({
      message: "ornith-35b-axq-4bit download cancelled",
      variant: "info",
    })
  })
})
