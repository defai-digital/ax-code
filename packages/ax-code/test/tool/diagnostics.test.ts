import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import { collectDiagnostics } from "../../src/tool/diagnostics"
import { LSP } from "../../src/lsp"
import { Log } from "../../src/util/log"
import { DebugEngine } from "../../src/debug-engine"

Log.init({ print: false })

let touchFileSpy: MockInstance | undefined
let diagnosticsSpy: MockInstance | undefined
let analyzeImpactSpy: MockInstance | undefined

afterEach(() => {
  touchFileSpy?.mockRestore()
  diagnosticsSpy?.mockRestore()
  analyzeImpactSpy?.mockRestore()
  touchFileSpy = undefined
  diagnosticsSpy = undefined
  analyzeImpactSpy = undefined
})

describe("tool diagnostics", () => {
  test("collectDiagnostics touches unique files in parallel", async () => {
    let inflight = 0
    let maxInflight = 0

    touchFileSpy = vi.spyOn(LSP, "touchFile").mockImplementation(async () => {
      inflight++
      maxInflight = Math.max(maxInflight, inflight)
      await sleep(25)
      inflight--
      return 1
    })
    diagnosticsSpy = vi.spyOn(LSP, "diagnostics").mockResolvedValue({})

    await collectDiagnostics(["/repo/a.ts", "/repo/b.ts", "/repo/a.ts"])

    expect(touchFileSpy).toHaveBeenCalledTimes(2)
    expect(maxInflight).toBe(2)
    expect(diagnosticsSpy).toHaveBeenCalledTimes(1)
  })

  test("skips DRE impact prewarm when edited files have no LSP errors", async () => {
    touchFileSpy = vi.spyOn(LSP, "touchFile").mockResolvedValue(1)
    diagnosticsSpy = vi.spyOn(LSP, "diagnostics").mockResolvedValue({
      "/repo/a.ts": [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          severity: 2,
          message: "warning only",
        },
      ],
    })
    analyzeImpactSpy = vi.spyOn(DebugEngine, "analyzeImpact")

    await collectDiagnostics(["/repo/a.ts"])

    expect(analyzeImpactSpy).not.toHaveBeenCalled()
  })
})
