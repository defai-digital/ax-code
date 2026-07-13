import { describe, expect, test } from "vitest"
import {
  sessionDerivedRequestHeaders,
  sessionGoalURL,
  sessionRiskURL,
} from "../../../src/cli/cmd/tui/context/sync-session-urls"

describe("tui derived session requests", () => {
  test("uses workspace headers for risk and goal data instead of unsupported query parameters", () => {
    const directory = "/workspace/other-project"
    const headers = sessionDerivedRequestHeaders(directory)
    const risk = new URL(sessionRiskURL({ baseUrl: "http://localhost:4096", sessionID: "ses_123" }))
    const goal = new URL(sessionGoalURL({ baseUrl: "http://localhost:4096", sessionID: "ses_123" }))

    expect(headers).toMatchObject({
      accept: "application/json",
      "x-ax-code-directory": directory,
      "x-opencode-directory": directory,
    })
    expect(risk.searchParams.get("directory")).toBeNull()
    expect(goal.searchParams.get("directory")).toBeNull()
    expect(risk.searchParams.get("quality")).toBe("true")
  })
})
