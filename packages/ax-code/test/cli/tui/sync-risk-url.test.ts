import { describe, expect, test } from "vitest"
import { sessionRiskURL } from "../../../src/cli/cmd/tui/context/sync-session-urls"

describe("tui session risk sync url", () => {
  test("opts into all sidebar risk summaries", () => {
    const url = new URL(sessionRiskURL({ baseUrl: "http://localhost:4096", sessionID: "ses_123" }))

    for (const name of ["quality", "findings", "envelopes", "reviewResults", "debug", "hints"]) {
      expect(url.searchParams.get(name)).toBe("true")
    }
  })
})
