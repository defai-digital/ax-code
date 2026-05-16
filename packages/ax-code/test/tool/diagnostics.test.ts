import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"
import { collectDiagnostics } from "../../src/tool/diagnostics"
import { LSP } from "../../src/lsp"
import { Log } from "../../src/util/log"

Log.init({ print: false })

let touchFileSpy: ReturnType<typeof spyOn> | undefined
let diagnosticsSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  touchFileSpy?.mockRestore()
  diagnosticsSpy?.mockRestore()
  touchFileSpy = undefined
  diagnosticsSpy = undefined
})

describe("tool diagnostics", () => {
  test("collectDiagnostics touches unique files in parallel", async () => {
    let inflight = 0
    let maxInflight = 0

    touchFileSpy = spyOn(LSP, "touchFile").mockImplementation(async () => {
      inflight++
      maxInflight = Math.max(maxInflight, inflight)
      await sleep(25)
      inflight--
      return 1
    })
    diagnosticsSpy = spyOn(LSP, "diagnostics").mockResolvedValue({})

    await collectDiagnostics(["/repo/a.ts", "/repo/b.ts", "/repo/a.ts"])

    expect(touchFileSpy).toHaveBeenCalledTimes(2)
    expect(maxInflight).toBe(2)
    expect(diagnosticsSpy).toHaveBeenCalledTimes(1)
  })
})
