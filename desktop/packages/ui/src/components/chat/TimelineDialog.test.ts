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
})
