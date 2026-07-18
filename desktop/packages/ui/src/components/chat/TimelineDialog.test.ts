import { describe, expect, test } from "vitest"
import type { SessionRollbackPoint } from "@ax-code/sdk/v2"
import { formatRollbackPointMeta } from "./TimelineDialog.helpers"

const rollbackPoint = (overrides: Partial<SessionRollbackPoint>): SessionRollbackPoint => ({
  step: 1,
  messageID: "msg_1",
  partID: "prt_1",
  tools: [],
  kinds: [],
  ...overrides,
})

describe("formatRollbackPointMeta", () => {
  test("formats tool, token, and duration metadata", () => {
    expect(
      formatRollbackPointMeta(
        rollbackPoint({
          tools: ["edit: src/app.ts"],
          tokens: { input: 1530, output: 42 },
          duration: 1250,
        }),
      ),
    ).toBe("edit: src/app.ts | 1.5k in / 42 out | 1.3s")
  })

  test("falls back to kinds and no-tool copy", () => {
    expect(formatRollbackPointMeta(rollbackPoint({ kinds: ["bash"] }))).toBe("bash")
    expect(formatRollbackPointMeta(rollbackPoint({}))).toBe("No tool calls")
  })

  test("carries rounded duration and token units", () => {
    expect(
      formatRollbackPointMeta(
        rollbackPoint({
          tokens: { input: 999_500, output: 1_500_000 },
          duration: 999.5,
        }),
      ),
    ).toBe("No tool calls | 1.0m in / 1.5m out | 1.0s")

    expect(formatRollbackPointMeta(rollbackPoint({ duration: 59_500 }))).toBe("No tool calls | 1m 0s")
  })
})
