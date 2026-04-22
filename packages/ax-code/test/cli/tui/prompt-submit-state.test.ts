import { describe, expect, test } from "bun:test"
import {
  createSubmitAbortError,
  isSubmitAbortError,
  pendingSubmitKeyIntent,
  pendingSubmitStatusText,
} from "../../../src/cli/cmd/tui/component/prompt/submit-state"

describe("prompt submit state", () => {
  test("renders stage-specific pending labels", () => {
    expect(pendingSubmitStatusText("creating-session")).toBe("Creating session...")
    expect(pendingSubmitStatusText("dispatching")).toBe("Submitting...")
    expect(pendingSubmitStatusText(undefined)).toBe("")
  })

  test("only exposes cancel intent for exit and interrupt keys while pending", () => {
    expect(
      pendingSubmitKeyIntent({
        pending: true,
        appExit: true,
        sessionInterrupt: false,
      }),
    ).toBe("cancel")
    expect(
      pendingSubmitKeyIntent({
        pending: true,
        appExit: false,
        sessionInterrupt: true,
      }),
    ).toBe("cancel")
    expect(
      pendingSubmitKeyIntent({
        pending: true,
        appExit: false,
        sessionInterrupt: false,
      }),
    ).toBe("block")
    expect(
      pendingSubmitKeyIntent({
        pending: false,
        appExit: true,
        sessionInterrupt: true,
      }),
    ).toBe("none")
  })

  test("recognizes local and platform abort errors", () => {
    expect(isSubmitAbortError(createSubmitAbortError())).toBe(true)
    expect(isSubmitAbortError(new DOMException("The operation was aborted.", "AbortError"))).toBe(true)
    expect(isSubmitAbortError(new Error("Prompt submission failed"))).toBe(false)
  })
})
