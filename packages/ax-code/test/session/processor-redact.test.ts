import { expect, test } from "vitest"
import { SessionProcessor } from "../../src/session/processor"

test("redacts cmd-aliased bash input and canonicalizes to command", () => {
  const redacted = SessionProcessor.redactPersistedToolInput("bash", {
    cmd: "GH_TOKEN=placeholder-token-value ./deploy",
  })
  expect(redacted.command).toContain("[redacted]")
  expect(redacted.command).not.toContain("placeholder-token-value")
  expect(redacted).not.toHaveProperty("cmd")
})

test("prefers command over cmd when both are present", () => {
  const redacted = SessionProcessor.redactPersistedToolInput("bash", {
    command: "echo canonical",
    cmd: "GH_TOKEN=placeholder-token-value ./deploy",
  })
  expect(redacted).toEqual({ command: "echo canonical" })
})

test("redacts monitor command and bash_input stdin payloads", () => {
  expect(
    SessionProcessor.redactPersistedToolInput("monitor", {
      command: "API_KEY=placeholder-token-value ./poll.sh",
      description: "poll",
    }),
  ).toEqual({
    command: "API_KEY=[redacted] ./poll.sh",
    description: "poll",
  })
  expect(
    SessionProcessor.redactPersistedToolInput("bash_input", {
      shell_id: "sh_1",
      input: "GITHUB_TOKEN=placeholder-token-value",
    }),
  ).toEqual({
    shell_id: "sh_1",
    input: "GITHUB_TOKEN=[redacted]",
  })
})

test("falls back to cmd when command is blank", () => {
  const redacted = SessionProcessor.redactPersistedToolInput("bash", {
    command: "  ",
    cmd: "GH_TOKEN=placeholder-token-value ./deploy",
  })
  expect(redacted.command).toContain("[redacted]")
  expect(redacted).not.toHaveProperty("cmd")
})

test("redacts header, flag, and URI credentials from the persisted copy", () => {
  // Assembled at runtime: the shape the redactor must catch, not a credential.
  const token = "sk-" + "live" + "abcdefghijklmnopqrstuvwxyz"

  const header = SessionProcessor.redactPersistedToolInput("bash", {
    command: `curl -H "Authorization: Bearer ${token}" https://api.example.com`,
  })
  expect(header.command).not.toContain(token)
  expect(header.command).toContain("[redacted]")

  const apiKeyHeader = SessionProcessor.redactPersistedToolInput("bash", {
    command: `curl -H "X-Api-Key: ${token}" https://api.example.com`,
  })
  expect(apiKeyHeader.command).not.toContain(token)

  const flag = SessionProcessor.redactPersistedToolInput("bash", {
    command: "mysql -u root --password=supersecret -e 'select 1'",
  })
  expect(flag.command).not.toContain("supersecret")
  expect(flag.command).toContain("[redacted]")

  const uri = SessionProcessor.redactPersistedToolInput("bash", {
    command: "curl 'postgres://admin:s3cret@db.internal/app'",
  })
  expect(uri.command).not.toContain("s3cret")

  const stdin = SessionProcessor.redactPersistedToolInput("bash_input", {
    shell_id: "sh_1",
    input: `curl -H "X-Api-Key: ${token}" https://api.example.com`,
  })
  expect(stdin.input).not.toContain(token)
})

test("redacts a credential pasted into the bash description", () => {
  const token = "sk-" + "live" + "abcdefghijklmnopqrstuvwxyz"
  const redacted = SessionProcessor.redactPersistedToolInput("bash", {
    command: "true",
    description: `curl -H "Authorization: Bearer ${token}" https://api`,
  })
  expect(redacted.description).not.toContain(token)
  expect(redacted.description).toContain("[redacted]")
})

test("redacts credential-named fields of every tool's persisted input", () => {
  const redacted = SessionProcessor.redactPersistedToolInput("mcp__server__fetch", {
    url: "https://user:secret@example.com/repo",
    token: "placeholder-token-value",
    method: "GET",
  })
  expect(redacted).toEqual({
    url: "https://user:[redacted]@example.com/repo",
    token: "[redacted]",
    method: "GET",
  })
})

test("does not mutate the executed input when it redacts", () => {
  const input = { url: "https://alice:s3cret@example.com/page", format: "markdown" }
  const redacted = SessionProcessor.redactPersistedToolInput("webfetch", input)
  expect(redacted).toEqual({ url: "https://alice:[redacted]@example.com/page", format: "markdown" })
  expect(input.url).toBe("https://alice:s3cret@example.com/page")
})

test("returns the input unchanged when no field is a credential", () => {
  // Copy-on-write: a large document payload must not be rebuilt on the
  // per-tool-call path when there is nothing to hide.
  const input = { filePath: "/tmp/report.md", content: "# Title\n\nBody" }
  expect(SessionProcessor.redactPersistedToolInput("write", input)).toBe(input)
})

test("leaves document content and free-form prompts verbatim", () => {
  // The persisted record is replayed to the model, so rewriting a file body or
  // a task prompt would corrupt the transcript. Only keys that name a
  // credential are hidden.
  const write = {
    filePath: "/tmp/config.ts",
    content: 'export const password = "password=example-value"',
  }
  expect(SessionProcessor.redactPersistedToolInput("write", write)).toEqual(write)

  const task = { description: "audit", prompt: "check the postgres://user:pw@host/db migration" }
  expect(SessionProcessor.redactPersistedToolInput("task", task)).toEqual(task)
})

test("redacts nested credential-named fields without touching siblings", () => {
  const redacted = SessionProcessor.redactPersistedToolInput("mcp__server__request", {
    url: "https://example.com",
    options: { headers: { Authorization: "Bearer placeholder-token-value" }, format: "text" },
  })
  expect(redacted).toEqual({
    url: "https://example.com",
    options: { headers: { Authorization: "[redacted]" }, format: "text" },
  })
})
