import { describe, expect, test } from "vitest"
import { detect } from "../../../src/session/correction/detector"
import { SelfCorrection } from "../../../src/session/correction"
import { SessionID } from "../../../src/session/schema"

describe("self-correction detector", () => {
  test("does not advise a retry when the tool error says to stop", () => {
    for (const error of [
      "Browser request canceled or timed out; completion is unconfirmed\nnextAction: Do not retry automatically; list again only if the user asks you to continue.",
      "The project browser operation failed.\nnextAction: Stop and report the failure; do not retry automatically.",
      "No project browser is enrolled for this coding session.\nnextAction: Ask the user to enable agent access in the project browser pane.",
    ]) {
      const signal = detect("desktop_webmcp", error, 1)
      expect(signal.strategy).toBe("escalate")
      expect(signal.recoverable).toBe(false)
      expect(SelfCorrection.analyze(SessionID.make("ses_stop-directive"), "desktop_webmcp", error)).toBeNull()
    }
  })

  test("still advises a retry for an ordinary tool failure", () => {
    const signal = detect("desktop_webmcp", "Tool was not in the latest listing", 1)
    expect(signal.strategy).toBe("retry")
    expect(signal.recoverable).toBe(true)
  })
})
