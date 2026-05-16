import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { DiagnosticLog } from "../../src/debug/diagnostic-log"
import { tmpdir } from "../fixture/fixture"

async function readJsonLines(file: string) {
  const text = await fs.readFile(file, "utf8")
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function exists(file: string) {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
}

afterEach(async () => {
  await DiagnosticLog.flush()
  await DiagnosticLog.configure({ enabled: false })
})

describe("DiagnosticLog", () => {
  test("writes manifest and process events into the configured directory", async () => {
    await using tmp = await tmpdir()

    await DiagnosticLog.configure({
      enabled: true,
      dir: tmp.path,
      includeContent: false,
      manifest: {
        component: "test",
        version: "1.2.3",
        pid: 123,
        argv: ["run", "secret prompt"],
        cwd: "/repo/project",
      },
    })

    const manifest = JSON.parse(await fs.readFile(path.join(tmp.path, "manifest-test-123.json"), "utf8"))
    expect(manifest.component).toBe("test")
    expect(manifest.cwd).toEqual({ redacted: true, basename: "project" })
    expect(manifest.args).toEqual(["run", "<arg>"])
    expect(await exists(path.join(tmp.path, "manifest-latest-test.json"))).toBe(true)
    expect(await exists(path.join(tmp.path, "manifest-latest.json"))).toBe(true)

    const processEvents = await readJsonLines(path.join(tmp.path, "process.jsonl"))
    expect(processEvents[0]).toMatchObject({
      kind: "process.event",
      eventType: "configured",
      data: {
        component: "test",
        version: "1.2.3",
      },
    })
  })

  test("redacts replay and process content by default", async () => {
    await using tmp = await tmpdir()

    await DiagnosticLog.configure({
      enabled: true,
      dir: tmp.path,
      includeContent: false,
      manifest: { component: "test", pid: 456 },
    })

    DiagnosticLog.record(
      {
        type: "llm.output",
        sessionID: "ses_1",
        parts: [{ type: "text", text: "private answer" }],
      },
      { id: "evt_1", sequence: 0, time: Date.parse("2026-04-12T00:00:00Z") },
    )
    DiagnosticLog.recordProcess("provider.error", {
      body: { apiKey: "secret" },
      url: "https://example.com/path?token=secret#fragment",
    })
    await DiagnosticLog.flush()

    const replayEvents = await readJsonLines(path.join(tmp.path, "events.jsonl"))
    expect(replayEvents[0]).toMatchObject({
      kind: "replay.event",
      id: "evt_1",
      sequence: 0,
      eventType: "llm.output",
    })
    expect(replayEvents[0].event.parts[0].text).toMatchObject({
      redacted: true,
      bytes: 14,
    })

    const processEvents = await readJsonLines(path.join(tmp.path, "process.jsonl"))
    expect(processEvents.at(-1)).toMatchObject({
      eventType: "provider.error",
      data: {
        body: {
          redacted: true,
        },
        url: "https://example.com/path",
      },
    })
  })

  test("preserves structured tool error summaries in replay logs", async () => {
    await using tmp = await tmpdir()

    await DiagnosticLog.configure({
      enabled: true,
      dir: tmp.path,
      includeContent: false,
      manifest: { component: "test", pid: 789 },
    })

    DiagnosticLog.record(
      {
        type: "tool.result",
        sessionID: "ses_2",
        tool: "read",
        callID: "call_1",
        status: "error",
        errorCode: "ReadFileNotFoundError",
        errorMessage: "File not found: /Users/example/project/src/modules/quotation-comment.controller.ts",
        error: "File not found: /Users/example/project/src/modules/quotation-comment.controller.ts",
        durationMs: 1,
      },
      { id: "evt_2", sequence: 1, time: Date.parse("2026-04-12T00:00:01Z") },
    )
    await DiagnosticLog.flush()

    const replayEvents = await readJsonLines(path.join(tmp.path, "events.jsonl"))
    expect(replayEvents[0]).toMatchObject({
      kind: "replay.event",
      eventType: "tool.result",
      event: {
        errorCode: "ReadFileNotFoundError",
      },
    })
    expect(replayEvents[0].event.errorMessage).toMatchObject({ redacted: true })
    expect(replayEvents[0].event.error).toMatchObject({ redacted: true })
    expect(replayEvents[0].event.errorMessage.bytes).toBeGreaterThan(0)
    expect(replayEvents[0].event.error.bytes).toBeGreaterThan(0)
  })

  test("redacts provider errors for normal logs", () => {
    const error = Object.assign(new Error("provider failed"), {
      body: { apiKey: "secret" },
      headers: { authorization: "Bearer secret" },
      url: "https://example.com/v1/chat?token=secret",
    })
    error.stack = `Error: provider failed\n    at run (${process.cwd()}/src/session/llm.ts:1:1)`

    const redacted = DiagnosticLog.redactForLog(error) as Record<string, unknown>
    expect(redacted).toMatchObject({
      name: "Error",
      message: "provider failed",
      stack: "Error: provider failed\n    at run (<cwd>/src/session/llm.ts:1:1)",
      body: {
        redacted: true,
      },
      headers: {
        redacted: true,
      },
      url: "https://example.com/v1/chat",
    })
  })
})
