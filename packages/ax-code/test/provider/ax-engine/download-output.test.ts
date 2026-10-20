import { expect, test } from "vitest"
import { Readable } from "node:stream"
import {
  createDownloadJsonParser,
  readDownloadLines,
  createDownloadTranscript,
  DOWNLOAD_OUTPUT_LIMIT,
  downloadFailureMessage,
} from "../../../src/provider/ax-engine/download-output"

test("download output preserves UTF-8 across byte chunks", async () => {
  const lines: string[] = []
  await readDownloadLines(Readable.from([Buffer.from([0xe2, 0x82]), Buffer.from([0xac, 0x0a])]), (line) =>
    lines.push(line),
  )
  expect(lines).toEqual(["€"])
})

test.each(["{ broken", '{"event":"progress","done":0,"total":0}'])(
  "a malformed download object does not hide later progress: %s",
  (broken) => {
    const events: unknown[] = []
    const consume = createDownloadJsonParser((event) => events.push(event))
    consume(broken)
    consume('{"event":"progress","done":1,"total":2}')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: "progress", event: { done: 1, total: 2 } })
  },
)

test("pretty-printed summaries still parse", () => {
  const events: unknown[] = []
  const consume = createDownloadJsonParser((event) => events.push(event))
  for (const line of ["{", '  "path": "model",', '  "nested": {', '    "complete": true', "  }", "}"]) consume(line)
  expect(events).toEqual([{ kind: "summary", value: { path: "model", nested: { complete: true } } }])
})

test("oversized output lines are discarded before the next progress event", async () => {
  const lines: string[] = []
  const valid = '{"event":"progress","done":1,"total":2}'
  await readDownloadLines(
    Readable.from([Buffer.alloc(DOWNLOAD_OUTPUT_LIMIT + 1, 97), Buffer.from(`\n${valid}\n`)]),
    (line) => lines.push(line),
  )
  expect(lines).toEqual([valid])
})

test("diagnostic transcripts retain at most one MiB even for a single oversized chunk", () => {
  const transcript = createDownloadTranscript()
  transcript.append(Buffer.alloc(DOWNLOAD_OUTPUT_LIMIT * 2, 97))
  transcript.append(Buffer.from("tail"))
  expect(Buffer.byteLength(transcript.text())).toBe(DOWNLOAD_OUTPUT_LIMIT)
  expect(transcript.text().endsWith("tail")).toBe(true)
})

test("diagnostic transcript also respects the line count", () => {
  const transcript = createDownloadTranscript(2)
  for (const line of ["one\n", "two\n", "three\n"]) transcript.append(Buffer.from(line))
  expect(transcript.text()).toBe("two\nthree\n")
})

test("oversized pretty summary accumulation recovers at the next standalone event", () => {
  const events: unknown[] = []
  const consume = createDownloadJsonParser((event) => events.push(event))
  consume("{")
  consume("a".repeat(DOWNLOAD_OUTPUT_LIMIT))
  consume('{"event":"progress","done":1,"total":2}')
  expect(events).toHaveLength(1)
})

test("a nested empty object does not replace its enclosing pretty summary", () => {
  const events: unknown[] = []
  const consume = createDownloadJsonParser((event) => events.push(event))
  for (const line of ["{", '  "items": [', "    {}", "  ]", "}"]) consume(line)
  expect(events).toEqual([{ kind: "summary", value: { items: [{}] } }])
})

test("structured failures win over HF warnings for direct and MTP downloads", () => {
  for (const summary of [
    { status: "download_failed", errors: ["HTTP 429: retry after 30 seconds"] },
    { status: "failed", download: { errors: ["HTTP 429: retry after 30 seconds"] } },
  ]) {
    expect(
      downloadFailureMessage({
        code: 1,
        stdout: "",
        stderr: "Warning: unauthenticated HF request",
        lastSummary: summary,
      }),
    ).toBe("HTTP 429: retry after 30 seconds")
  }
})

test("legacy pretty summaries retain their failure when stderr contains only a warning", () => {
  expect(
    downloadFailureMessage({
      code: 1,
      stdout: JSON.stringify({ errors: ["Disk full"] }, null, 2),
      stderr: "Warning: anonymous",
    }),
  ).toBe("Disk full")
})

test("a successful download may emit stderr warnings, but a failed summary cannot report success", () => {
  expect(
    downloadFailureMessage({
      code: 0,
      stdout: "",
      stderr: "Warning: anonymous",
      lastSummary: { status: "ready", errors: [] },
    }),
  ).toBeUndefined()
  expect(
    downloadFailureMessage({
      code: 0,
      stdout: "",
      stderr: "",
      lastSummary: { status: "failed", errors: ["Incomplete model"] },
    }),
  ).toBe("Incomplete model")
})

test("missing and malformed summaries preserve a useful bounded fallback", () => {
  expect(downloadFailureMessage({ code: 2, stdout: "{invalid", stderr: "unknown download option" })).toContain(
    "unknown download option",
  )
  expect(downloadFailureMessage({ code: 2, stdout: "", stderr: "" })).toContain("code 2")
  expect(downloadFailureMessage({ code: 1, stdout: "x".repeat(20_000), stderr: "" })!.length).toBeLessThanOrEqual(8_192)
})

test("job diagnostics redact HF credentials and signed URL secrets before persistence", () => {
  const token = "hf_" + "a".repeat(32)
  const message = downloadFailureMessage({
    code: 1,
    stdout: "",
    stderr: "",
    lastSummary: { errors: [`Invalid token ${token}; https://example.com/model?token=private-query-value`] },
  })
  expect(message).not.toContain(token)
  expect(message).not.toContain("private-query-value")
  expect(message).toContain("redacted")
})

test("a terminal failure status is not replaced by warnings when errors are missing", () => {
  expect(
    downloadFailureMessage({
      code: 1,
      stdout: "",
      stderr: "Warning: anonymous",
      lastSummary: { status: "manifest_missing", errors: [] },
    }),
  ).toBe("ax-engine reported manifest_missing")
})

test("legacy error fields and classified failures survive warning-only stderr", () => {
  expect(
    downloadFailureMessage({ code: 1, stdout: "", stderr: "Warning: anonymous", lastSummary: { error: "Disk full" } }),
  ).toBe("Disk full")
  expect(
    downloadFailureMessage({
      code: 1,
      stdout: "",
      stderr: "Warning: anonymous",
      lastSummary: { errors: ["Slow down"], failure: { code: "RATE_LIMITED", retryable: true, http_status: 429 } },
    }),
  ).toBe("[RATE_LIMITED] Slow down")
})

test("unknown protocols retain stdout and stderr without treating a warning as the headline", () => {
  const error = downloadFailureMessage({
    code: 2,
    stdout: "Actual helper failure",
    stderr: "Warning: anonymous",
    lastSummary: { status: { toString: null, valueOf: null } },
  })
  expect(error).toContain("code 2")
  expect(error).toContain("Actual helper failure")
  expect(error).toContain("Warning: anonymous")
})

test("fallback redaction covers authorization headers, URL userinfo and signed query values", () => {
  const error = downloadFailureMessage({
    code: 2,
    stdout: "Authorization: Bearer synthetic-secret-value",
    stderr:
      "https://user:private-password@example.com/model?X-Amz-Signature=signature-secret&X-Goog-Credential=credential-secret",
  })
  for (const secret of ["synthetic-secret-value", "private-password", "signature-secret", "credential-secret"])
    expect(error).not.toContain(secret)
})
