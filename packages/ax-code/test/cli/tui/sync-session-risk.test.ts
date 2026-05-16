import { describe, expect, test } from "bun:test"
import { parseSyncedSessionRisk } from "../../../src/cli/cmd/tui/context/sync-session-risk"

describe("tui synced session risk parser", () => {
  const debugCase = {
    schemaVersion: 1 as const,
    caseId: "0123456789abcdef",
    problem: "CLI hangs during startup",
    status: "open" as const,
    createdAt: "2026-04-26T18:00:00.000Z",
    source: { tool: "debug_open_case", version: "4.x.x", runId: "ses_debug" },
  }

  test("preserves debug rollups from the session risk payload", () => {
    const parsed = parseSyncedSessionRisk({
      id: "risk:ses_debug",
      debug: {
        cases: [debugCase],
        evidence: [],
        instrumentationPlans: [],
        hypotheses: [],
        rollups: [{ ...debugCase, effectiveStatus: "unresolved" }],
      },
    })

    expect(parsed.debug?.rollups).toEqual([{ ...debugCase, effectiveStatus: "unresolved" }])
  })

  test("defaults rollups to an empty list for older risk payloads", () => {
    const parsed = parseSyncedSessionRisk({
      id: "risk:ses_debug",
      debug: {
        cases: [debugCase],
        evidence: [],
        hypotheses: [],
      },
    })

    expect(parsed.debug?.rollups).toEqual([])
    expect(parsed.debug?.instrumentationPlans).toEqual([])
  })
})
