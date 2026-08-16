import { describe, expect, test } from "vitest"
import {
  axEngineModelStateAnnotation,
  axEngineModelStateAnnotations,
} from "../../../src/cli/cmd/tui/component/dialog-ax-engine-state"

describe("axEngineModelStateAnnotation", () => {
  test("annotates missing weights and in-flight downloads", () => {
    expect(axEngineModelStateAnnotation({ state: "downloadable" })).toBe("Not downloaded")
    expect(axEngineModelStateAnnotation({ state: "downloading" })).toBe("Downloading…")
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
      ["busy-model", "Downloading…"],
    ])
  })

  test("returns an empty map for an empty catalog (attach mode / probe failure)", () => {
    expect(axEngineModelStateAnnotations([]).size).toBe(0)
  })
})
