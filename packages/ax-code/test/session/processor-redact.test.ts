import { expect, test } from "vitest"
import { SessionProcessor } from "../../src/session/processor"

test("redacts cmd-aliased bash input and canonicalizes to command", () => {
  const redacted = SessionProcessor.redactPersistedBashInput("bash", {
    cmd: "GH_TOKEN=placeholder-token-value ./deploy",
  })
  expect(redacted.command).toContain("[redacted]")
  expect(redacted.command).not.toContain("placeholder-token-value")
  expect(redacted).not.toHaveProperty("cmd")
})

test("prefers command over cmd when both are present", () => {
  const redacted = SessionProcessor.redactPersistedBashInput("bash", {
    command: "echo canonical",
    cmd: "GH_TOKEN=placeholder-token-value ./deploy",
  })
  expect(redacted).toEqual({ command: "echo canonical" })
})
