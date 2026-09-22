import { expect, test } from "vitest"
import path from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import {
  buildRunEarlyErrorEvent,
  buildRunResultEvent,
  extractRunFinalAssistantText,
  extractRunUsageTotals,
  handleRunStructuredOutput,
  isBlockedRun,
  isRunMutatingToolCompletion,
  isRunReadOnlyToolDenial,
  isRunSelfAbortError,
  parseFinalJson,
  resolveRunOutputPath,
  resolveRunResultStatus,
  validateJsonSchema,
} from "../../src/cli/cmd/run-output"

test("run structured output resolves relative paths from caller cwd", async () => {
  await using tmp = await tmpdir()

  expect(resolveRunOutputPath(tmp.path, "out/report.json")).toBe(path.join(tmp.path, "out", "report.json"))
  expect(resolveRunOutputPath(tmp.path, "/tmp/report.json")).toBe("/tmp/report.json")
})

test("run structured output extracts text only from the current assistant message", () => {
  const messages = [
    {
      info: { id: "msg_old", role: "assistant" },
      parts: [{ type: "text", text: "old answer" }],
    },
    {
      info: { id: "msg_new", role: "assistant" },
      parts: [
        { type: "text", text: "first draft" },
        { type: "text", text: " final answer " },
      ],
    },
  ]

  expect(extractRunFinalAssistantText(messages, "msg_new")).toBe("final answer")
  expect(extractRunFinalAssistantText(messages, undefined)).toBeUndefined()
  expect(extractRunFinalAssistantText(messages, "msg_missing")).toBeUndefined()
})

test("run structured output parses final JSON strictly", () => {
  expect(parseFinalJson('{"status":"ok"}')).toEqual({ status: "ok" })
  expect(() => parseFinalJson('```json\n{"status":"ok"}\n```')).toThrow("Final assistant message is not valid JSON")
})

test("run structured output validates object schema", () => {
  const schema = {
    type: "object",
    required: ["status", "summary"],
    properties: {
      status: { enum: ["pass", "fail"] },
      summary: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  }

  expect(validateJsonSchema({ status: "pass", summary: "done" }, schema)).toEqual({ ok: true })

  const missing = validateJsonSchema({ status: "pass" }, schema)
  expect(missing.ok).toBe(false)
  if (!missing.ok) expect(missing.errors).toContain("$.summary is required")

  const extra = validateJsonSchema({ status: "pass", summary: "done", other: true }, schema)
  expect(extra.ok).toBe(false)
  if (!extra.ok) expect(extra.errors).toContain("$.other is not allowed")
})

test("run structured output supports array item and composition validation", () => {
  const schema = {
    type: "array",
    minItems: 1,
    items: {
      anyOf: [{ type: "integer", minimum: 1 }, { const: "skip" }],
    },
  }

  expect(validateJsonSchema([1, "skip"], schema)).toEqual({ ok: true })

  const result = validateJsonSchema([0], schema)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors).toContain("$[0] does not match any anyOf schema")
})

test("run structured output compares object enum values independent of key order", () => {
  const schema = {
    enum: [{ status: "ok", result: { score: 1, label: "pass" } }],
  }

  expect(validateJsonSchema({ result: { label: "pass", score: 1 }, status: "ok" }, schema)).toEqual({ ok: true })
})

test("run structured output writes file after schema success", async () => {
  await using tmp = await tmpdir()
  await writeFile(
    path.join(tmp.path, "schema.json"),
    JSON.stringify({
      type: "object",
      required: ["status"],
      properties: { status: { const: "ok" } },
      additionalProperties: false,
    }),
  )

  await handleRunStructuredOutput('{"status":"ok"}', {
    callerCwd: tmp.path,
    outputFile: "nested/result.json",
    outputSchema: "schema.json",
  })

  await expect(readFile(path.join(tmp.path, "nested", "result.json"), "utf8")).resolves.toBe('{"status":"ok"}')
})

test("run structured output does not write file after schema failure", async () => {
  await using tmp = await tmpdir()
  await writeFile(
    path.join(tmp.path, "schema.json"),
    JSON.stringify({
      type: "object",
      required: ["status"],
      properties: { status: { const: "ok" } },
      additionalProperties: false,
    }),
  )

  await expect(
    handleRunStructuredOutput('{"status":"bad"}', {
      callerCwd: tmp.path,
      outputFile: "result.json",
      outputSchema: "schema.json",
    }),
  ).rejects.toThrow("Output schema validation failed")

  await expect(readFile(path.join(tmp.path, "result.json"), "utf8")).rejects.toThrow()
})

test("run result event builder carries usage only when token counts exist", () => {
  const usage = { input: 10, output: 5, reasoning: 2, cacheRead: 7, cacheWrite: 1 }
  const withUsage = buildRunResultEvent({
    timestamp: 123,
    sessionID: "ses_1",
    status: "completed",
    text: "done",
    permissionDenials: 0,
    usage,
  })
  expect(withUsage).toEqual({
    type: "result",
    timestamp: 123,
    sessionID: "ses_1",
    status: "completed",
    text: "done",
    permissionDenials: 0,
    usage,
  })

  const withoutUsage = buildRunResultEvent({
    timestamp: 456,
    sessionID: "ses_2",
    status: "blocked",
    text: "",
    permissionDenials: 2,
  })
  expect(withoutUsage).toEqual({
    type: "result",
    timestamp: 456,
    sessionID: "ses_2",
    status: "blocked",
    text: "",
    permissionDenials: 2,
  })
  expect("usage" in withoutUsage).toBe(false)
  expect(JSON.stringify(withoutUsage)).not.toContain('"usage"')
})

test("extractRunUsageTotals flattens final assistant tokens and omits missing or partial counts", () => {
  const messages = [
    {
      info: {
        id: "msg_user",
        role: "user",
        tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      },
      parts: [],
    },
    {
      info: {
        id: "msg_final",
        role: "assistant",
        tokens: { input: 10, output: 20, reasoning: 30, cache: { read: 40, write: 50 } },
      },
      parts: [{ type: "text", text: "answer" }],
    },
  ]

  expect(extractRunUsageTotals(messages, "msg_final")).toEqual({
    input: 10,
    output: 20,
    reasoning: 30,
    cacheRead: 40,
    cacheWrite: 50,
  })
  // User messages never carry run usage; unknown IDs omit the key.
  expect(extractRunUsageTotals(messages, "msg_user")).toBeUndefined()
  expect(extractRunUsageTotals(messages, "msg_missing")).toBeUndefined()
  expect(extractRunUsageTotals(messages, undefined)).toBeUndefined()
  expect(extractRunUsageTotals(undefined, "msg_final")).toBeUndefined()

  // Assistant message without token counts: usage stays absent.
  expect(extractRunUsageTotals([{ info: { id: "msg_a", role: "assistant" }, parts: [] }], "msg_a")).toBeUndefined()

  // Partial counts would be a wrong number; they are dropped entirely.
  expect(
    extractRunUsageTotals(
      [
        {
          info: { id: "msg_p", role: "assistant", tokens: { input: 1, output: 2, reasoning: 3 } },
          parts: [],
        },
      ],
      "msg_p",
    ),
  ).toBeUndefined()
})

test("run mutating-tool and blocked-run rules classify recovery correctly", () => {
  expect(isRunMutatingToolCompletion("write", "completed")).toBe(true)
  expect(isRunMutatingToolCompletion("edit", "completed")).toBe(true)
  expect(isRunMutatingToolCompletion("multiedit", "completed")).toBe(true)
  expect(isRunMutatingToolCompletion("apply_patch", "completed")).toBe(true)
  expect(isRunMutatingToolCompletion("bash", "completed")).toBe(true)
  expect(isRunMutatingToolCompletion("read", "completed")).toBe(false)
  expect(isRunMutatingToolCompletion("bash", "error")).toBe(false)
  expect(isRunMutatingToolCompletion("bash", "running")).toBe(false)

  expect(isBlockedRun(1, 0)).toBe(true)
  expect(isBlockedRun(3, 0)).toBe(true)
  // Denied once, then a mutation completed: recovered, not blocked.
  expect(isBlockedRun(1, 1)).toBe(false)
  expect(isBlockedRun(0, 0)).toBe(false)

  expect(resolveRunResultStatus({ failed: false, blocked: false })).toBe("completed")
  expect(resolveRunResultStatus({ failed: false, blocked: true })).toBe("blocked")
  // An observed error wins over blocked.
  expect(resolveRunResultStatus({ failed: true, blocked: true })).toBe("error")
})

test("resolveRunResultStatus orders error, cancelled, timeout, blocked, completed", () => {
  // timeout beats blocked.
  expect(resolveRunResultStatus({ failed: false, blocked: true, timedOut: true })).toBe("timeout")
  expect(resolveRunResultStatus({ failed: false, blocked: false, timedOut: true })).toBe("timeout")
  // cancelled beats timeout.
  expect(resolveRunResultStatus({ failed: false, blocked: true, timedOut: true, cancelled: true })).toBe("cancelled")
  expect(resolveRunResultStatus({ failed: false, blocked: false, timedOut: false, cancelled: true })).toBe("cancelled")
  // error beats cancelled, timeout, and blocked.
  expect(resolveRunResultStatus({ failed: true, blocked: false, timedOut: true, cancelled: true })).toBe("error")
  expect(resolveRunResultStatus({ failed: true, blocked: true, timedOut: false, cancelled: false })).toBe("error")
})

test("isRunSelfAbortError is true only for a self-requested MessageAbortedError", () => {
  // The abort this process requested (--timeout or SIGINT) is the expected
  // outcome, not a failure.
  expect(isRunSelfAbortError("MessageAbortedError", { timedOut: true, cancelled: false })).toBe(true)
  expect(isRunSelfAbortError("MessageAbortedError", { timedOut: false, cancelled: true })).toBe(true)
  expect(isRunSelfAbortError("MessageAbortedError", { timedOut: true, cancelled: true })).toBe(true)
  // The same abort error with no timeout and no SIGINT is someone else's
  // server-side cancel: still a failure.
  expect(isRunSelfAbortError("MessageAbortedError", { timedOut: false, cancelled: false })).toBe(false)
  // Any other error is never swallowed.
  expect(isRunSelfAbortError("UnknownError", { timedOut: true, cancelled: false })).toBe(false)
  expect(isRunSelfAbortError(undefined, { timedOut: true, cancelled: false })).toBe(false)
})

test("read-only sandbox tool denials are classified by their error prefix", () => {
  // prompt-tools throws `Tool denied in read-only mode: <reason>` for a
  // mutating call denied under --sandbox read-only; it reaches the CLI as a
  // tool error and must count as a permission denial for blocked runs.
  expect(isRunReadOnlyToolDenial({ status: "error", error: "Tool denied in read-only mode" })).toBe(true)
  expect(
    isRunReadOnlyToolDenial({ status: "error", error: "Tool denied in read-only mode: bash is not permitted" }),
  ).toBe(true)
  // Other tool errors, completed tools, and missing error text do not count.
  expect(isRunReadOnlyToolDenial({ status: "error", error: "Permission denied" })).toBe(false)
  expect(isRunReadOnlyToolDenial({ status: "error", error: "prefix Tool denied in read-only mode" })).toBe(false)
  expect(isRunReadOnlyToolDenial({ status: "error" })).toBe(false)
  expect(isRunReadOnlyToolDenial({ status: "completed", error: "Tool denied in read-only mode" })).toBe(false)
})

test("run early error event builder emits the structured code shape", () => {
  expect(buildRunEarlyErrorEvent("provider", 'Unknown provider "x"')).toEqual({
    type: "error",
    error: { code: "provider", message: 'Unknown provider "x"' },
  })
  expect(buildRunEarlyErrorEvent("usage", "--fork requires --continue or --session")).toEqual({
    type: "error",
    error: { code: "usage", message: "--fork requires --continue or --session" },
  })
  expect(buildRunEarlyErrorEvent("model", 'Model "m" not found')).toEqual({
    type: "error",
    error: { code: "model", message: 'Model "m" not found' },
  })
  // The early line carries exactly type + error: no timestamp/sessionID.
  expect(Object.keys(buildRunEarlyErrorEvent("usage", "x"))).toEqual(["type", "error"])
})
