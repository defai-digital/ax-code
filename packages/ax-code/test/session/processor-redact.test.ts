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

test("redacts attached and concatenated curl cookie arguments in the persisted copy", () => {
  const command = 'curl -bsid=fixture-one --cookie pref=fixture-two"fixture-three" https://example.test'
  const result = SessionProcessor.redactPersistedToolInput("bash", { command })
  expect(result.command).toBe("curl -bsid=[redacted] --cookie pref=[redacted] https://example.test")
  expect(SessionProcessor.redactPersistedToolInput("bash", result)).toEqual(result)
  expect(command).toContain("fixture-one")
  expect(command).toContain("fixture-three")
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

  // Assembled at runtime: the shape the redactor must catch, not a literal credential.
  const postgres = "postgres://" + "admin" + ":" + "s3cret" + "@db.internal/app"
  const uri = SessionProcessor.redactPersistedToolInput("bash", {
    command: "curl '" + postgres + "'",
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

test("redacts a credential nested four object levels deep", () => {
  const redacted = SessionProcessor.redactPersistedToolInput("mcp__server__request", {
    request: { options: { transport: { headers: { Authorization: "Bearer placeholder-token-value" } } } },
  })
  expect(redacted).toEqual({
    request: { options: { transport: { headers: { Authorization: "[redacted]" } } } },
  })
})

test("redacts a credential nested five levels deep with an array inside the chain", () => {
  const redacted = SessionProcessor.redactPersistedToolInput("mcp__server__request", {
    request: {
      options: {
        transports: [{ kind: "http", settings: { headers: { Authorization: "Bearer placeholder-token-value" } } }],
      },
    },
  })
  expect(redacted).toEqual({
    request: {
      options: {
        transports: [{ kind: "http", settings: { headers: { Authorization: "[redacted]" } } }],
      },
    },
  })
})

test("returns a credential-free sibling subtree as the same reference", () => {
  // Copy-on-write must survive deep redaction: only the branch that hides a
  // credential is rebuilt, the document payload keeps its reference.
  const document = {
    pages: [
      { title: "p1", body: "a".repeat(512) },
      { title: "p2", body: "b".repeat(512) },
    ],
  }
  const input = {
    document,
    request: { options: { transport: { headers: { Authorization: "Bearer placeholder-token-value" } } } },
  }
  const redacted = SessionProcessor.redactPersistedToolInput("mcp__server__request", input)
  expect(redacted.request).toEqual({ options: { transport: { headers: { Authorization: "[redacted]" } } } })
  expect(redacted.document).toBe(document)
})

test("keeps the traversal budget bounded on huge credential-free inputs", () => {
  // 5,000 small nested objects with no credential anywhere: the node budget
  // runs out partway, untouched subtrees are returned as-is, and the whole
  // input keeps its original reference. The walk must also simply complete.
  const input = {
    payload: Array.from({ length: 5_000 }, (_, index) => ({ index, label: `item-${index}` })),
  }
  expect(SessionProcessor.redactPersistedToolInput("mcp__server__bulk", input)).toBe(input)
})

test("a wide sibling array cannot starve a later credential field", () => {
  // The bulk array spends the whole traversal budget first. Redaction must
  // still walk the plain-object path where named credentials live, so the
  // bearer token is hidden instead of persisted in clear text.
  const redacted = SessionProcessor.redactPersistedToolInput("mcp__server__bulk", {
    files: Array.from({ length: 5_000 }, (_, index) => ({ index, label: `item-${index}` })),
    request: { options: { transport: { headers: { Authorization: "Bearer placeholder-token-value" } } } },
  })
  expect(redacted).toEqual({
    files: Array.from({ length: 5_000 }, (_, index) => ({ index, label: `item-${index}` })),
    request: { options: { transport: { headers: { Authorization: "[redacted]" } } } },
  })
})
