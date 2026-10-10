import { expect, test } from "vitest"
import { Readable } from "node:stream"
import {
  createDownloadJsonParser,
  readDownloadLines,
  createDownloadTranscript,
  DOWNLOAD_OUTPUT_LIMIT,
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
