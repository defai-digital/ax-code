import { describe, expect, test } from "bun:test"
import { createTuiRendererContractReport } from "../../script/tui-renderer-contract"
import { TUI_RENDERER_CONTRACT, TUI_RENDERER_CONTRACT_VERSION } from "../../src/cli/cmd/tui/renderer-contract"

describe("script.tui-renderer-contract", () => {
  test("generates a fully-evidenced contract report from repository mappings", async () => {
    const report = await createTuiRendererContractReport({
      requirements: TUI_RENDERER_CONTRACT,
      verify: false,
    })

    expect(report.version).toBe(TUI_RENDERER_CONTRACT_VERSION)
    expect(report.statuses).toHaveLength(TUI_RENDERER_CONTRACT.length)
    expect(report.statuses.every((status) => status.status === "passed")).toBe(true)
    expect(report.statuses.every((status) => status.evidence && status.evidence.length > 0)).toBe(true)
  })
})
