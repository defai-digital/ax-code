import { describe, expect, test } from "vitest"
import { buildSessionPulseModel, formatDurationMs, formatTokenCount } from "./sessionPulseModel"

describe("buildSessionPulseModel", () => {
  test("returns unknown empty pulse when payloads are missing", () => {
    const model = buildSessionPulseModel({})
    expect(model.hasAnalysis).toBe(false)
    expect(model.readiness).toBe("unknown")
    expect(model.changes).toEqual([])
    expect(model.validation.state).toBe("unknown")
  })

  test("maps risk readiness, validation, and changes without vanity scores", () => {
    const model = buildSessionPulseModel({
      risk: {
        assessment: {
          readiness: "needs_validation",
          summary: "Large untested change set",
          unknowns: ["No unit tests run for auth module"],
          mitigations: ["Run auth package tests"],
          signals: {
            validationState: "not_run",
            validationCommands: [],
            filesChanged: 4,
          },
        },
        drivers: ["Large diff · 4 files"],
        semantic: {
          headline: "Auth session middleware updated",
          files: 4,
          additions: 120,
          deletions: 40,
          changes: [
            {
              file: "src/auth/session.ts",
              risk: "high",
              kind: "logic_change",
              additions: 80,
              deletions: 20,
              signals: ["auth path"],
            },
            {
              file: "src/auth/types.ts",
              risk: "low",
              kind: "type_change",
              additions: 40,
              deletions: 20,
              signals: [],
            },
          ],
        },
      },
      dre: {
        detail: {
          decision: "Needs validation before accepting",
          duration: 45_000,
          tokens: { input: 12_400, output: 3_200 },
        },
      },
    })

    expect(model.hasAnalysis).toBe(true)
    expect(model.readiness).toBe("needs_validation")
    expect(model.headline).toBe("Needs validation")
    expect(model.decision).toBe("Needs validation before accepting")
    expect(model.reason).toBe("No unit tests run for auth module")
    expect(model.validation.state).toBe("not_run")
    expect(model.validation.summary).toMatch(/no tests/i)
    expect(model.changes).toHaveLength(2)
    expect(model.changes[0]?.file).toBe("src/auth/session.ts")
    expect(model.filesChanged).toBe(4)
    expect(model.additions).toBe(120)
    expect(model.durationMs).toBe(45_000)
    expect(model.tokensIn).toBe(12_400)
    // Explicitly no score/gauge fields on the pulse model
    expect(model).not.toHaveProperty("score")
    expect(model).not.toHaveProperty("gauge")
  })

  test("prefers passed validation summary when commands exist", () => {
    const model = buildSessionPulseModel({
      risk: {
        assessment: {
          readiness: "ready",
          signals: {
            validationState: "passed",
            validationCommands: ["pnpm test", "pnpm typecheck"],
            filesChanged: 2,
          },
        },
      },
    })
    expect(model.validation.state).toBe("passed")
    expect(model.validation.commands).toEqual(["pnpm test", "pnpm typecheck"])
    expect(model.validation.summary).toMatch(/2 validation/)
  })
})

describe("format helpers", () => {
  test("formatDurationMs", () => {
    expect(formatDurationMs(null)).toBeNull()
    expect(formatDurationMs(500)).toBe("500ms")
    expect(formatDurationMs(1500)).toBe("1.5s")
    expect(formatDurationMs(65_000)).toBe("1m 5s")
    // Regression: rounding remainder must not produce "1m 60s".
    expect(formatDurationMs(119_500)).toBe("2m 0s")
    expect(formatDurationMs(119_999)).toBe("2m 0s")
    expect(formatDurationMs(120_000)).toBe("2m 0s")
  })

  test("formatTokenCount", () => {
    expect(formatTokenCount(null)).toBeNull()
    expect(formatTokenCount(420)).toBe("420")
    expect(formatTokenCount(2400)).toBe("2.4k")
    expect(formatTokenCount(24_000)).toBe("24k")
  })
})
