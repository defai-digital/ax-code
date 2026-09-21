import { describe, expect, test, vi } from "vitest"
import { createGrepCollector } from "../../src/tool/grep-collector"

const frame = (file: string, line: number, text = `line ${line}\n`) =>
  JSON.stringify({ type: "match", data: { path: { text: file }, line_number: line, lines: { text } } })

describe("streamed grep selection", () => {
  test.each([1, 2, 100])("matches stable full sort with limit %i without retaining all matches", (limit) => {
    for (const order of ["ascending", "descending", "mixed", "ties"]) {
      const times = Array.from({ length: 1200 }, (_, i) =>
        order === "ascending" ? i : order === "descending" ? -i : order === "mixed" ? (i * 71) % 23 : 42,
      )
      const mtime = vi.fn((file: string) => times[Number(file)])
      const collector = createGrepCollector({ limit, isFile: false, mtime })
      const expected = times.flatMap((modTime, i) =>
        [1, 2].map((lineNum) => ({ path: String(i), modTime, lineNum, lineText: `line ${lineNum}` })),
      )
      for (const item of expected) {
        collector.onLine(frame(item.path, item.lineNum))
        expect(collector.result.matches.length).toBeLessThanOrEqual(limit)
      }
      collector.onLine('{"type":"summary"}')
      expect(collector.result.matches).toEqual(expected.sort((a, b) => b.modTime - a.modTime).slice(0, limit))
      expect(collector.result.totalMatches).toBe(expected.length)
      expect(collector.result.summarySeen).toBe(true)
      expect(mtime).toHaveBeenCalledTimes(times.length)
    }
  })

  test("counts only readable paths and caches missing metadata", () => {
    const mtime = vi.fn((file: string) => (file === "good" ? 1 : undefined))
    const collector = createGrepCollector({ limit: 1, isFile: false, mtime })
    for (const file of ["missing", "good", "missing", "good"]) collector.onLine(frame(file, 1))
    collector.onLine(
      JSON.stringify({
        type: "match",
        data: { path: { bytes: "/w==" }, line_number: 1, lines: { text: "bad path" } },
      }),
    )
    expect(collector.result.totalMatches).toBe(2)
    expect(collector.result.matches).toHaveLength(1)
    expect(collector.result.skippedRecords).toBe(true)
    expect(mtime).toHaveBeenCalledTimes(2)
  })

  test.each([true, false])("preserves byte text, whitespace and binary summary flags (file=%s)", (isFile) => {
    const collector = createGrepCollector({ limit: 100, isFile, mtime: () => 1 })
    collector.onLine(" \r")
    collector.onLine('{"type":"begin"}')
    collector.onLine(
      JSON.stringify({
        type: "match",
        data: {
          path: { bytes: Buffer.from("file.ts").toString("base64") },
          line_number: 1,
          lines: { bytes: Buffer.from("line 🦋\r\n").toString("base64") },
        },
      }),
    )
    collector.onLine('{"type":"end","data":{"binary_offset":10}}')
    collector.onLine('{"type":"summary"}')
    expect(collector.result.matches[0].lineText).toBe("line 🦋")
    expect(collector.result.binaryStopped).toBe(!isFile)
    expect(collector.result.summarySeen).toBe(true)
    expect(collector.result.failure).toBeUndefined()
  })

  test("retains the first protocol failure without silently accepting later records", () => {
    const collector = createGrepCollector({ limit: 1, isFile: false, mtime: () => 1 })
    collector.onLine(frame("good", 1))
    collector.onLine("{invalid json}")
    collector.onLine(frame("good", 2))
    expect(collector.result.failure?.error).toBeInstanceOf(SyntaxError)
    expect(collector.result.totalMatches).toBe(1)
  })
})
