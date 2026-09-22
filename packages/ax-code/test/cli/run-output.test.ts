import { expect, test, vi } from "vitest"
import path from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import {
  buildAddDirRules,
  buildRunEarlyErrorEvent,
  buildRunResultEvent,
  classifyRunFailure,
  extractRunFinalAssistantText,
  extractRunStructuredOutput,
  extractRunUsageTotals,
  handleRunStructuredOutput,
  isBlockedRun,
  isRunAuthFailure,
  isRunMutatingToolCompletion,
  isRunReadOnlyToolDenial,
  isRunSelfAbortError,
  parseDisallowedTools,
  parseFinalJson,
  preflightRunOutputSchema,
  resolveRunOutputPath,
  resolveRunResultStatus,
  runFileMime,
  RUN_BUILTIN_TOOL_IDS,
  validateJsonSchema,
} from "../../src/cli/cmd/run-output"
import { buildAttachHeaders } from "../../src/cli/attach-auth"

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

test("run structured output extracts the captured structured value of a text-less assistant message", () => {
  // A json_schema run steers the model through the StructuredOutput tool; the
  // server stores the captured object on `info.structured` and the assistant
  // usually produces no text part at all.
  const structured = { status: "pass", findings: [{ file: "a.ts", line: 1 }] }
  const messages = [
    {
      info: { id: "msg_user", role: "user" },
      parts: [{ type: "text", text: "question" }],
    },
    {
      info: { id: "msg_final", role: "assistant", structured },
      parts: [],
    },
    {
      info: { id: "msg_text_only", role: "assistant" },
      parts: [{ type: "text", text: "plain answer" }],
    },
  ]

  expect(extractRunStructuredOutput(messages, "msg_final")).toEqual(structured)
  // Messages without a captured value, other roles, unknown ids, and missing
  // arguments all yield undefined (older servers, or the model failed the
  // requirement and the message carries a StructuredOutputError instead).
  expect(extractRunStructuredOutput(messages, "msg_text_only")).toBeUndefined()
  expect(extractRunStructuredOutput(messages, "msg_user")).toBeUndefined()
  expect(extractRunStructuredOutput(messages, "msg_missing")).toBeUndefined()
  expect(extractRunStructuredOutput(messages, undefined)).toBeUndefined()
  expect(extractRunStructuredOutput(undefined, "msg_final")).toBeUndefined()
})

test("run structured output serialized value round-trips through the post-run schema validation", () => {
  // The final text for a structured run is JSON.stringify(info.structured);
  // re-parsing it must yield the original object and pass the same schema the
  // server already validated the tool input against.
  const structured = { status: "pass", summary: "done" }
  const schema = {
    type: "object",
    required: ["status", "summary"],
    properties: {
      status: { enum: ["pass", "fail"] },
      summary: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  }
  const text = JSON.stringify(structured)

  expect(parseFinalJson(text)).toEqual(structured)
  expect(validateJsonSchema(parseFinalJson(text), schema)).toEqual({ ok: true })
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
  expect(buildRunEarlyErrorEvent("session", "Session not found: ses_x")).toEqual({
    type: "error",
    error: { code: "session", message: "Session not found: ses_x" },
  })
  expect(buildRunEarlyErrorEvent("attach", "Cannot reach ax-code server")).toEqual({
    type: "error",
    error: { code: "attach", message: "Cannot reach ax-code server" },
  })
  expect(buildRunEarlyErrorEvent("internal", "unexpected")).toEqual({
    type: "error",
    error: { code: "internal", message: "unexpected" },
  })
  // The early line carries exactly type + error: no timestamp/sessionID.
  expect(Object.keys(buildRunEarlyErrorEvent("usage", "x"))).toEqual(["type", "error"])
})

test("classifyRunFailure maps unknown rejections to structured codes and readable messages", () => {
  // A deserialized SessionNotFoundError body rejected by the SDK.
  expect(classifyRunFailure({ name: "SessionNotFoundError", data: { message: "Session not found: ses_x" } })).toEqual({
    code: "session",
    message: "Session not found: ses_x",
  })

  // undici wraps the OS socket error as the cause of TypeError: fetch failed.
  const refused = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:4096") })
  expect(classifyRunFailure(refused)).toEqual({
    code: "attach",
    message: "connect ECONNREFUSED 127.0.0.1:4096",
  })
  // A bare TypeError: fetch failed with no cause still classifies as attach.
  expect(classifyRunFailure(new TypeError("fetch failed"))).toEqual({
    code: "attach",
    message: "fetch failed",
  })
  // Direct socket errors carrying the errno code.
  const dns = Object.assign(new Error("getaddrinfo ENOTFOUND ax-code.local"), { code: "ENOTFOUND" })
  expect(classifyRunFailure(dns)).toEqual({ code: "attach", message: "getaddrinfo ENOTFOUND ax-code.local" })

  // Regular Error rejections are internal with their message.
  expect(classifyRunFailure(new Error("boom"))).toEqual({ code: "internal", message: "boom" })

  // Plain records never degrade to "[object Object]".
  expect(classifyRunFailure({ other: 1 })).toEqual({ code: "internal", message: '{"other":1}' })
  expect(classifyRunFailure({ name: "SomeError", data: { message: "deserialized body" } })).toEqual({
    code: "internal",
    message: "deserialized body",
  })
})

test("classifyRunFailure maps HTTP 401/403 auth rejections to attach", () => {
  // The deserialized ForbiddenError body the server emits for a managed runtime
  // missing its x-ax-code-runtime-token header.
  expect(classifyRunFailure({ name: "ForbiddenError", data: { message: "Runtime authorization required" } })).toEqual({
    code: "attach",
    message: "Runtime authorization required",
  })
  // The raw AppErrorEnvelope shape (`{name, message, status}`) carrying a 403.
  expect(
    classifyRunFailure({ name: "InvalidRequestError", message: "Runtime authorization required", status: 403 }),
  ).toEqual({
    code: "attach",
    message: "Runtime authorization required",
  })
  // Any 401/403 status classifies as attach even with a different message.
  expect(classifyRunFailure({ name: "SomeError", message: "Forbidden", status: 401 })).toEqual({
    code: "attach",
    message: "Forbidden",
  })
  expect(classifyRunFailure({ name: "SomeError", data: { statusCode: 403, message: "Denied" } })).toEqual({
    code: "attach",
    message: "Denied",
  })
})

test("classifyRunFailure maps the loopback-policy rejection to a usage error", () => {
  const loopback = new Error(
    "--attach URL must use a loopback address; remote AX Code access is disabled by the local-only policy",
  )
  expect(classifyRunFailure(loopback)).toEqual({
    code: "usage",
    message: "--attach URL must use a loopback address; remote AX Code access is disabled by the local-only policy",
  })
})

test("isRunAuthFailure keys on the authorization message or a 401/403 status", () => {
  expect(isRunAuthFailure({ name: "ForbiddenError", data: { message: "Runtime authorization required" } })).toBe(true)
  expect(
    isRunAuthFailure({ name: "InvalidRequestError", message: "Runtime authorization required", status: 403 }),
  ).toBe(true)
  expect(isRunAuthFailure({ name: "UnknownError", message: "Forbidden", status: 401 })).toBe(true)
  expect(isRunAuthFailure({ name: "UnknownError", data: { statusCode: 403 } })).toBe(true)
  // A 500, an unrelated message, or a non-object are never an auth failure.
  expect(isRunAuthFailure({ name: "UnknownError", message: "Forbidden", status: 500 })).toBe(false)
  expect(isRunAuthFailure({ name: "ForbiddenError", data: { message: "Something else" } })).toBe(false)
  expect(isRunAuthFailure(new Error("Runtime authorization required"))).toBe(false)
  expect(isRunAuthFailure("Runtime authorization required")).toBe(false)
})

test("buildAttachHeaders sends the runtime token header only when AX_CODE_RUNTIME_TOKEN is set", () => {
  vi.stubEnv("AX_CODE_RUNTIME_TOKEN", "tok-abc")
  try {
    expect(buildAttachHeaders({})).toEqual({ "x-ax-code-runtime-token": "tok-abc" })
  } finally {
    vi.unstubAllEnvs()
  }
  // With the env unset and no explicit token, the header is absent.
  expect((buildAttachHeaders({}) ?? {})["x-ax-code-runtime-token"]).toBeUndefined()
})

test("buildAttachHeaders merges basic auth and the runtime token together", () => {
  const basic = `Basic ${Buffer.from("ax-code:pw").toString("base64")}`
  expect(buildAttachHeaders({ password: "pw", runtimeToken: "tok" })).toEqual({
    Authorization: basic,
    "x-ax-code-runtime-token": "tok",
  })
  // Password alone still yields only basic auth.
  expect(buildAttachHeaders({ password: "pw" })).toEqual({ Authorization: basic })
})

test("runFileMime infers binary attachment types from the extension", () => {
  expect(runFileMime("shot.png")).toBe("image/png")
  expect(runFileMime("shot.PNG")).toBe("image/png")
  expect(runFileMime("photo.jpg")).toBe("image/jpeg")
  expect(runFileMime("photo.jpeg")).toBe("image/jpeg")
  expect(runFileMime("anim.gif")).toBe("image/gif")
  expect(runFileMime("pic.webp")).toBe("image/webp")
  expect(runFileMime("doc.pdf")).toBe("application/pdf")
  // Everything else stays text/plain, including no extension, unknown
  // extensions, and compound extensions.
  expect(runFileMime("notes.txt")).toBe("text/plain")
  expect(runFileMime("README")).toBe("text/plain")
  expect(runFileMime("archive.tar.gz")).toBe("text/plain")
  expect(runFileMime("data.json")).toBe("text/plain")
})

test("preflightRunOutputSchema accepts object schemas and reports usage errors otherwise", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "good.json"), JSON.stringify({ type: "object" }))
  // The parsed schema rides along on success so the same value can be sent to
  // the model as the prompt-body `format` (B4).
  await expect(preflightRunOutputSchema(tmp.path, "good.json")).resolves.toEqual({
    ok: true,
    schema: { type: "object" },
  })

  const missing = await preflightRunOutputSchema(tmp.path, "missing.json")
  expect(missing.ok).toBe(false)
  if (!missing.ok) expect(missing.message).toContain("Failed to read output schema missing.json")

  await writeFile(path.join(tmp.path, "broken.json"), "{ not json")
  const broken = await preflightRunOutputSchema(tmp.path, "broken.json")
  expect(broken.ok).toBe(false)
  if (!broken.ok) expect(broken.message).toContain("Failed to parse output schema broken.json")

  await writeFile(path.join(tmp.path, "array.json"), "[]")
  const array = await preflightRunOutputSchema(tmp.path, "array.json")
  expect(array.ok).toBe(false)
  if (!array.ok) expect(array.message).toBe("Output schema array.json must be a JSON object")
})

test("parseDisallowedTools splits commas, trims, dedupes, and ignores empty entries", () => {
  expect(parseDisallowedTools(["bash,write", "read"])).toEqual({ bash: false, write: false, read: false })
  expect(parseDisallowedTools([" bash , write ", "bash"])).toEqual({ bash: false, write: false })
  // Empty entries — trailing commas, lone commas, whitespace — are ignored.
  expect(parseDisallowedTools(["bash,", ",", "  ", "read"])).toEqual({ bash: false, read: false })
  // An all-empty value yields an empty map (the CLI turns that into a usage error).
  expect(parseDisallowedTools([",", ""])).toEqual({})
  expect(parseDisallowedTools([])).toEqual({})
})

test("buildAddDirRules emits one external_directory allow rule per directory", () => {
  expect(buildAddDirRules(["/tmp/agent-files", "/var/data/"])).toEqual([
    { permission: "external_directory", pattern: "/tmp/agent-files/*", action: "allow" },
    { permission: "external_directory", pattern: "/var/data/*", action: "allow" },
  ])
  // Windows separators are normalized and repeated trailing slashes collapse;
  // a single `/*` suffix covers subdirectories because the permission matcher
  // treats `*` as `.*` across `/`.
  expect(buildAddDirRules(["C:\\agent\\files\\\\"])).toEqual([
    { permission: "external_directory", pattern: "C:/agent/files/*", action: "allow" },
  ])
  expect(buildAddDirRules([])).toEqual([])
})

test("RUN_BUILTIN_TOOL_IDS covers the core tool surface", () => {
  for (const id of [
    "bash",
    "read",
    "write",
    "edit",
    "multiedit",
    "apply_patch",
    "glob",
    "grep",
    "list",
    "webfetch",
    "websearch",
    "task",
    "todowrite",
    "todoread",
    "question",
    "skill",
  ]) {
    expect(RUN_BUILTIN_TOOL_IDS.has(id)).toBe(true)
  }
  // Not built-in: these only ever match dynamic MCP tool ids.
  expect(RUN_BUILTIN_TOOL_IDS.has("mcp__figma__get_file")).toBe(false)
  expect(RUN_BUILTIN_TOOL_IDS.has("codesearch")).toBe(false)
})
