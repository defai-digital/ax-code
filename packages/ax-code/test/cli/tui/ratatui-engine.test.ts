import { describe, expect, test } from "vitest"
import {
  isRatatuiDogfood,
  parseTuiEngine,
  ratatuiBinaryCandidates,
  resolveTuiEngine,
} from "../../../src/cli/cmd/tui/ratatui-engine"

describe("ratatui-engine (ADR-054 dogfood)", () => {
  test("defaults to opentui when unset", () => {
    expect(parseTuiEngine(undefined)).toBe("opentui")
    expect(parseTuiEngine("")).toBe("opentui")
    expect(parseTuiEngine("opentui")).toBe("opentui")
    expect(resolveTuiEngine({})).toBe("opentui")
    expect(isRatatuiDogfood({})).toBe(false)
  })

  test("selects ratatui for dogfood env values", () => {
    expect(parseTuiEngine("ratatui")).toBe("ratatui")
    expect(parseTuiEngine("RATATUI")).toBe("ratatui")
    expect(parseTuiEngine("native")).toBe("ratatui")
    expect(parseTuiEngine("rust")).toBe("ratatui")
    expect(isRatatuiDogfood({ AX_CODE_TUI_ENGINE: "ratatui" })).toBe(true)
  })

  test("binary candidates prefer explicit AX_CODE_TUI_BIN", () => {
    expect(ratatuiBinaryCandidates({ AX_CODE_TUI_BIN: "/opt/ax-code-tui" })).toEqual(["/opt/ax-code-tui"])
    expect(ratatuiBinaryCandidates({})[0]).toBe("ax-code-tui")
  })
})
