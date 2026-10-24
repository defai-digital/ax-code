import { describe, expect, test } from "vitest"
import { failureDisposition } from "../../../src/session/correction/detector"
import { SelfCorrection } from "../../../src/session/correction"
import { SessionID } from "../../../src/session/schema"

describe("self-correction failure disposition", () => {
  const session = SessionID.make("ses_failure-disposition")

  test("structured stop reasons get no retry advice", () => {
    for (const reason of ["provider-gone", "timeout", "native-failure", "session-rejected"]) {
      const disposition = failureDisposition("The project browser operation failed.", {
        reason,
        nextAction: "Stop and report the failure; do not retry automatically.",
      })
      expect(disposition.stop).toBe(true)
      expect(SelfCorrection.analyze(session, "desktop_webmcp", `failed ${reason}`, disposition)).toBeNull()
    }
  })

  test("a recoverable failure with its own next step is guided, not stopped", () => {
    // no-page text says "Ask the user to open ..." yet navigate is the permitted recovery.
    const disposition = failureDisposition(
      "The project browser is enrolled but no page can be granted to the agent. Ask the user to open the exact URL",
      { reason: "no-page", nextAction: "Call action=navigate with the https:// or loopback http:// URL to open." },
    )
    expect(disposition).toEqual({ stop: false, guided: true })
    expect(SelfCorrection.analyze(session, "desktop_webmcp", "no page", disposition)).toBeNull()
  })

  test("bridge-authored WebMCP stop wording stops; the same words elsewhere do not", () => {
    expect(failureDisposition("WebMCP console message exceeded the 32 KiB read budget. Do not retry get_console_message").stop).toBe(true)
    expect(
      failureDisposition(
        "WebMCP invocation did not confirm completion; page tool reported an execution error. Do not retry automatically; check the page state or report the failure.",
      ).stop,
    ).toBe(true)
    const fileError = "File not found: /repo/do not retry - ask the user to stop and report.md"
    expect(failureDisposition(fileError)).toEqual({ stop: false, guided: false })
    expect(SelfCorrection.analyze(session, "read", fileError, failureDisposition(fileError))).not.toBeNull()
  })
})
