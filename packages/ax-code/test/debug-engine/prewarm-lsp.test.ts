import { describe, expect, test, vi, beforeEach } from "vitest"

const { touchFile } = vi.hoisted(() => ({
  touchFile: vi.fn(),
}))

vi.mock("../../src/lsp", () => ({
  LSP: {
    touchFile,
  },
}))

import { prewarmAffectedFiles, __clearPrewarmState } from "../../src/debug-engine/prewarm-lsp"
import type { DebugEngine } from "../../src/debug-engine"

function report(files: string[]): DebugEngine.ImpactReport {
  return {
    affectedFiles: files,
  } as DebugEngine.ImpactReport
}

describe("prewarmAffectedFiles rate-limit dedup", () => {
  beforeEach(() => {
    __clearPrewarmState()
    touchFile.mockReset()
  })

  test("two concurrent calls for the same file touch it only once within the interval", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    touchFile.mockImplementation(() => gate.then(() => undefined))

    const file = "/repo/src/a.ts"
    const p1 = prewarmAffectedFiles(report([file]))
    const p2 = prewarmAffectedFiles(report([file]))

    release()
    const [r1, r2] = await Promise.all([p1, p2])

    expect(touchFile).toHaveBeenCalledTimes(1)
    expect(r1).toBe(1)
    expect(r2).toBe(0)
  })

  test("touch failure does not poison the interval — a later call can retry", async () => {
    touchFile.mockRejectedValueOnce(new Error("boom"))

    const file = "/repo/src/b.ts"
    const r1 = await prewarmAffectedFiles(report([file]))
    expect(r1).toBe(0)
    expect(touchFile).toHaveBeenCalledTimes(1)

    touchFile.mockResolvedValueOnce(undefined)
    const r2 = await prewarmAffectedFiles(report([file]))
    expect(r2).toBe(1)
    expect(touchFile).toHaveBeenCalledTimes(2)
  })

  test("respects the minimum interval for sequential successful calls", async () => {
    touchFile.mockResolvedValue(undefined)
    const file = "/repo/src/c.ts"

    const r1 = await prewarmAffectedFiles(report([file]))
    expect(r1).toBe(1)
    expect(touchFile).toHaveBeenCalledTimes(1)

    const r2 = await prewarmAffectedFiles(report([file]))
    expect(r2).toBe(0)
    expect(touchFile).toHaveBeenCalledTimes(1)
  })
})
