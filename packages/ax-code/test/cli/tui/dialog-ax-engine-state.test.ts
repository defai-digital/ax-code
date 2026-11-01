import { describe, expect, test } from "vitest"
import {
  axEngineDownloadAnnotation,
  axEngineModelStateAnnotation,
  axEngineModelStateAnnotations,
} from "../../../src/cli/tui/component/dialog-ax-engine-state"

describe("axEngineModelStateAnnotation", () => {
  test("annotates missing weights and in-flight downloads", () => {
    expect(axEngineModelStateAnnotation({ state: "downloadable" })).toBe("Not downloaded")
    expect(axEngineModelStateAnnotation({ state: "downloading" })).toBe("Downloading...")
  })

  test("surfaces the download failure reason when the catalog provides one", () => {
    expect(axEngineModelStateAnnotation({ state: "failed", blockers: ["network unreachable"] })).toBe(
      "Download failed: network unreachable",
    )
    expect(axEngineModelStateAnnotation({ state: "failed" })).toBe("Download failed")
  })

  test("passes through the first blocker for non-downloadable states", () => {
    expect(axEngineModelStateAnnotation({ state: "not-fit", blockers: ["64 GB unified memory is required"] })).toBe(
      "64 GB unified memory is required",
    )
    expect(axEngineModelStateAnnotation({ state: "host-unsupported", blockers: ["requires macOS 26"] })).toBe(
      "requires macOS 26",
    )
    expect(axEngineModelStateAnnotation({ state: "disk-blocked" })).toBeUndefined()
  })

  test("leaves ready and unknown states unannotated", () => {
    expect(axEngineModelStateAnnotation({ state: "ready" })).toBeUndefined()
    expect(axEngineModelStateAnnotation({ state: undefined })).toBeUndefined()
    expect(axEngineModelStateAnnotation({ state: "some-future-state" })).toBeUndefined()
  })
})

describe("axEngineDownloadAnnotation", () => {
  test("shows the percent and the engine's current file or retry notice", () => {
    expect(
      axEngineDownloadAnnotation({
        status: "running",
        progress: { percent: 45.4, message: "model-00002-of-00003.safetensors" },
      }),
    ).toBe("Downloading 45% · model-00002-of-00003.safetensors")
    // A rate-limit wait keeps the bar and swaps only the text (sizeless native event).
    expect(
      axEngineDownloadAnnotation({
        status: "running",
        progress: { percent: 45, message: "Download service is busy. Retrying in 4s" },
      }),
    ).toBe("Downloading 45% · Download service is busy. Retrying in 4s")
    expect(axEngineDownloadAnnotation({ status: "running", progress: { percent: 120 } })).toBe("Downloading 100%")
    expect(axEngineDownloadAnnotation({ status: "running", progress: { message: "  " } })).toBe("Downloading...")
    expect(axEngineDownloadAnnotation({ status: "queued", progress: { percent: 0, message: "Queued…" } })).toBe(
      "Download queued",
    )
    expect(axEngineDownloadAnnotation(undefined)).toBe("Downloading...")
  })
})

describe("axEngineModelStateAnnotations", () => {
  test("maps only entries whose weights are not usable locally", () => {
    const annotations = axEngineModelStateAnnotations([
      { id: "ready-model", local: { present: true }, fit: { state: "ready" } },
      { id: "missing-model", local: { present: false }, fit: { state: "downloadable" } },
      { id: "busy-model", fit: { state: "downloading" } },
      // A failed download over present weights is still runnable — no annotation.
      { id: "recovered-model", local: { present: true }, fit: { state: "failed", blockers: ["boom"] } },
    ])
    expect([...annotations.entries()]).toEqual([
      ["missing-model", "Not downloaded"],
      ["busy-model", "Downloading..."],
    ])
  })

  test("annotates a downloading entry from its active catalog job, ignoring finished ones", () => {
    const annotations = axEngineModelStateAnnotations(
      [
        { id: "busy-model", fit: { state: "downloading" } },
        { id: "other-model", fit: { state: "downloading" } },
      ],
      [
        { modelID: "busy-model", status: "failed", progress: { percent: 12, message: "old attempt" } },
        { modelID: "busy-model", status: "running", progress: { percent: 61, message: "mtp.safetensors" } },
        { modelID: "unrelated", status: "running", progress: { percent: 5 } },
      ],
    )
    expect([...annotations.entries()]).toEqual([
      ["busy-model", "Downloading 61% · mtp.safetensors"],
      ["other-model", "Downloading..."],
    ])
  })

  test("returns an empty map for an empty catalog (attach mode / probe failure)", () => {
    expect(axEngineModelStateAnnotations([]).size).toBe(0)
  })
})
