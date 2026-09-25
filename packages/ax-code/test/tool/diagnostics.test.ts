import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import { collectDiagnostics } from "../../src/tool/diagnostics"
import { LSP } from "@ax-code/ax-code-intel"
import { Log } from "../../src/util/log"
import { DebugEngine } from "@ax-code/ax-code-reason"

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

test("diagnostic failure is disclosed after a successful file edit", async () => {
  touchFileSpy = vi.spyOn(LSP, "touchFile").mockResolvedValue(1)
  diagnosticsSpy = vi.spyOn(LSP, "diagnostics").mockRejectedValue(new Error("Native inventory is incomplete"))
  const result = await collectDiagnostics(["/repo/a.ts"])
  expect(result.output).toContain("File changes were saved")
  expect(result.output).toContain("does not confirm a clean type check")
})

test("edit feedback pulls native TypeScript errors and clears repaired errors", async () => {
  const { tmpdir } = await import("../fixture/fixture")
  const { Instance } = await import("../../src/project/instance")
  const { writeFile } = await import("node:fs/promises")
  const path = await import("node:path")
  await using tmp = await tmpdir({ git: true })
  const file = path.join(tmp.path, "source.ts")
  await writeFile(path.join(tmp.path, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }))
  await writeFile(file, 'export const answer: number = "wrong"\n')
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const failed = await collectDiagnostics([file])
      expect(failed.output).toContain("LSP errors detected")
      expect(failed.diagnostics[file]?.some((item) => item.code === 2322)).toBe(true)
      await writeFile(file, "export const answer: number = 42\n")
      const repaired = await collectDiagnostics([file])
      expect(repaired.output).toBe("")
      expect(repaired.diagnostics[file]).toEqual([])
    },
  })
}, 30_000)
