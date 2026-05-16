import { describe, expect, test } from "bun:test"
import { QualityStabilityGuard } from "../../src/quality/stability-guard"

describe("QualityStabilityGuard", () => {
  test("passes when no rollback history exists", () => {
    const summary = QualityStabilityGuard.summarize({
      source: "stable-model-v1",
      rollbacks: [],
      now: "2026-04-20T12:00:00.000Z",
    })

    expect(summary.overallStatus).toBe("pass")
    expect(summary.coolingWindowActive).toBe(false)
    expect(summary.escalationRequired).toBe(false)

    const report = QualityStabilityGuard.renderReport(summary)
    expect(report).toContain("## ax-code quality model stability")
    expect(report).toContain("- overall status: pass")
  })

  test("fails while the latest rollback is still inside the cooling window", () => {
    const summary = QualityStabilityGuard.summarize({
      source: "cooldown-model-v1",
      rollbacks: [{ source: "cooldown-model-v1", rolledBackAt: "2026-04-20T10:00:00.000Z" }],
      now: "2026-04-20T12:00:00.000Z",
      cooldownHours: 24,
    })

    expect(summary.overallStatus).toBe("fail")
    expect(summary.coolingWindowActive).toBe(true)
    expect(summary.cooldownUntil).toBe("2026-04-21T10:00:00.000Z")
  })

  test("warns when repeated rollback count crosses the escalation threshold outside cooldown", () => {
    const summary = QualityStabilityGuard.summarize({
      source: "unstable-model-v1",
      rollbacks: [
        { source: "unstable-model-v1", rolledBackAt: "2026-04-14T12:00:00.000Z" },
        { source: "unstable-model-v1", rolledBackAt: "2026-04-18T12:00:00.000Z" },
      ],
      now: "2026-04-20T12:00:00.000Z",
      cooldownHours: 24,
      repeatFailureWindowHours: 24 * 7,
      repeatFailureThreshold: 2,
    })

    expect(summary.overallStatus).toBe("warn")
    expect(summary.coolingWindowActive).toBe(false)
    expect(summary.recentRollbackCount).toBe(2)
    expect(summary.escalationRequired).toBe(true)
  })
})
