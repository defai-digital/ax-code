import { expect, test } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ClaudeSessions } from "../../src/import/claude-sessions"
import { formatClaudeSessionsReport } from "../../src/cli/cmd/import"
import { Env } from "../../src/util/env"

function assistant(text: string) {
  return JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } })
}
function user(text: string) {
  return JSON.stringify({ type: "user", message: { role: "user", content: text } })
}

test("encodeProjectPath mirrors Claude Code's directory naming", () => {
  expect(ClaudeSessions.encodeProjectPath("/Users/me/project")).toBe("-Users-me-project")
  expect(ClaudeSessions.projectDirectory({ root: "/r", projectPath: "/Users/me/project" })).toBe(
    path.join("/r", "-Users-me-project"),
  )
})

test("buildSummary keeps user and assistant text and describes tool calls by name", () => {
  const jsonl = [
    user("please add a health check"),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "I will look at the router" },
          { type: "tool_use", name: "read_file", input: { path: "/secret/path" } },
          { type: "tool_result", content: "huge payload that must not be inlined" },
        ],
      },
    }),
  ].join("\n")

  const summary = ClaudeSessions.buildSummary(jsonl)

  expect(summary).toContain("User: please add a health check")
  expect(summary).toContain("Assistant: I will look at the router")
  expect(summary).toContain("Assistant: [tool] read_file")
  expect(summary).toContain("Assistant: [tool result]")
  // The tool result payload is never replayed.
  expect(summary).not.toContain("huge payload")
})

test("buildSummary redacts secrets with the shared log redaction helper", () => {
  const secret = ["sk", "live-abcdefghijklmnopqrstuvwxyz0123456789"].join("-")
  const summary = ClaudeSessions.buildSummary(user(`my key is ${secret}`))

  expect(summary).not.toContain(secret)
  expect(summary).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789")
  expect(summary).toContain(Env.redactSecrets(secret))
})

test("buildSummary truncates to the 20 KB budget and marks the drop", () => {
  const summary = ClaudeSessions.buildSummary(user("x".repeat(30 * 1024)))

  expect(summary.length).toBeLessThanOrEqual(ClaudeSessions.SUMMARY_MAX_CHARS + 40)
  expect(summary).toContain("chars truncated]")
})

test("buildSummary tolerates malformed lines without throwing", () => {
  const summary = ClaudeSessions.buildSummary(["not json", "", user("real line")].join("\n"))
  expect(summary).toBe("User: real line")
})

test("run lists transcripts without writing by default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "claude-import-"))
  const projectDirectory = path.join(root, "project")
  await fs.mkdir(projectDirectory, { recursive: true })
  await fs.writeFile(path.join(projectDirectory, "abc.jsonl"), user("hello from a past session"))

  let writes = 0
  const report = await ClaudeSessions.run({
    projectPath: "/some/project",
    projectDirectory,
    write: false,
    createSession: async () => {
      writes++
    },
  })

  expect(report.dryRun).toBe(true)
  expect(report.transcripts).toHaveLength(1)
  expect(report.transcripts[0]?.name).toBe("abc")
  expect(report.transcripts[0]?.summary).toContain("hello from a past session")
  expect(writes).toBe(0)
  expect(formatClaudeSessionsReport(report)).toContain("Import claude sessions: dry-run")

  await fs.rm(root, { recursive: true, force: true })
})

test("run writes one session per transcript only with write", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "claude-import-"))
  const projectDirectory = path.join(root, "project")
  await fs.mkdir(projectDirectory, { recursive: true })
  await fs.writeFile(path.join(projectDirectory, "one.jsonl"), user("first"))
  await fs.writeFile(path.join(projectDirectory, "two.jsonl"), assistant("second"))

  const created: string[] = []
  const report = await ClaudeSessions.run({
    projectPath: "/some/project",
    projectDirectory,
    write: true,
    createSession: async (transcript) => {
      created.push(transcript.summary)
    },
  })

  expect(report.dryRun).toBe(false)
  expect(report.transcripts).toHaveLength(2)
  expect(created).toHaveLength(2)
  expect(formatClaudeSessionsReport(report)).toContain("Import claude sessions: written")

  await fs.rm(root, { recursive: true, force: true })
})

test("run reports a missing project directory as empty", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "claude-import-"))
  const report = await ClaudeSessions.run({
    projectPath: "/some/project",
    projectDirectory: path.join(root, "does-not-exist"),
    write: false,
  })

  expect(report.missing).toBe(true)
  expect(report.transcripts).toEqual([])
  expect(formatClaudeSessionsReport(report)).toContain("no transcripts found")

  await fs.rm(root, { recursive: true, force: true })
})

test("run refuses to write without a createSession implementation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "claude-import-"))
  const projectDirectory = path.join(root, "project")
  await fs.mkdir(projectDirectory, { recursive: true })
  await fs.writeFile(path.join(projectDirectory, "one.jsonl"), user("hi"))

  await expect(ClaudeSessions.run({ projectPath: "/p", projectDirectory, write: true })).rejects.toThrow(
    /createSession/,
  )

  await fs.rm(root, { recursive: true, force: true })
})
