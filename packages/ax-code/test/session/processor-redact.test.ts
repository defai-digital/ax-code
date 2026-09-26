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

test("redacts header, flag, and URI credentials from the persisted copy", () => {
  // Assembled at runtime: the shape the redactor must catch, not a credential.
  const token = "sk-" + "live" + "abcdefghijklmnopqrstuvwxyz"

  const header = SessionProcessor.redactPersistedBashInput("bash", {
    command: `curl -H "Authorization: Bearer ${token}" https://api.example.com`,
  })
  expect(header.command).not.toContain(token)
  expect(header.command).toContain("[redacted]")

  const apiKeyHeader = SessionProcessor.redactPersistedBashInput("bash", {
    command: `curl -H "X-Api-Key: ${token}" https://api.example.com`,
  })
  expect(apiKeyHeader.command).not.toContain(token)

  const flag = SessionProcessor.redactPersistedBashInput("bash", {
    command: "mysql -u root --password=supersecret -e 'select 1'",
  })
  expect(flag.command).not.toContain("supersecret")
  expect(flag.command).toContain("[redacted]")

  const uri = SessionProcessor.redactPersistedBashInput("bash", {
    command: "curl 'postgres://admin:s3cret@db.internal/app'",
  })
  expect(uri.command).not.toContain("s3cret")

  const stdin = SessionProcessor.redactPersistedBashInput("bash_input", {
    shell_id: "sh_1",
    input: `curl -H "X-Api-Key: ${token}" https://api.example.com`,
  })
  expect(stdin.input).not.toContain(token)
})
