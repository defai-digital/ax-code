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

test("redacts monitor command and bash_input stdin payloads", () => {
  expect(
    SessionProcessor.redactPersistedBashInput("monitor", {
      command: "API_KEY=placeholder-token-value ./poll.sh",
      description: "poll",
    }),
  ).toEqual({
    command: "API_KEY=[redacted] ./poll.sh",
    description: "poll",
  })
  expect(
    SessionProcessor.redactPersistedBashInput("bash_input", {
      shell_id: "sh_1",
      input: "GITHUB_TOKEN=placeholder-token-value",
    }),
  ).toEqual({
    shell_id: "sh_1",
    input: "GITHUB_TOKEN=[redacted]",
  })
})

test("falls back to cmd when command is blank", () => {
  const redacted = SessionProcessor.redactPersistedBashInput("bash", {
    command: "  ",
    cmd: "GH_TOKEN=placeholder-token-value ./deploy",
  })
  expect(redacted.command).toContain("[redacted]")
  expect(redacted).not.toHaveProperty("cmd")
})
