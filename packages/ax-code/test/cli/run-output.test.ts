import { expect, test } from "vitest"
import path from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import {
  extractRunFinalAssistantText,
  handleRunStructuredOutput,
  parseFinalJson,
  resolveRunOutputFile,
  resolveRunOutputPath,
  validateJsonSchema,
} from "../../src/cli/cmd/run-output"

test("run structured output resolves relative paths from caller cwd", async () => {
  await using tmp = await tmpdir()

  expect(resolveRunOutputPath(tmp.path, "out/report.json")).toBe(path.join(tmp.path, "out", "report.json"))
  expect(resolveRunOutputPath(tmp.path, "/tmp/report.json")).toBe("/tmp/report.json")
})

test("run structured output rejects conflicting output file aliases", () => {
  expect(resolveRunOutputFile({ outputFile: "a.json", outputLastMessage: "a.json" })).toBe("a.json")
  expect(() => resolveRunOutputFile({ outputFile: "a.json", outputLastMessage: "b.json" })).toThrow(
    "--output-file and --output-last-message must not point to different files",
  )
})

test("run structured output allows aliases that resolve to the same path", async () => {
  await using tmp = await tmpdir()

  expect(resolveRunOutputFile({ outputFile: "result.json", outputLastMessage: "./result.json" }, tmp.path)).toBe(
    "result.json",
  )
  expect(resolveRunOutputFile({ outputFile: "nested/../result.json", outputLastMessage: "result.json" }, tmp.path)).toBe(
    "nested/../result.json",
  )
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
