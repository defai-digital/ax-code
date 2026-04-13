import { describe, expect, test } from "bun:test"
import { LSP } from "../../src/lsp"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// Semantic Trust v2 §S3: cross-server diagnostics aggregation with
// dedup + severity normalization. Tested against the pure kernel
// (aggregateDiagnosticsForTest) so the test doesn't need a live LSP.

const now = 10_000_000_000

function diag(
  range: { startLine: number; startCol: number; endLine: number; endCol: number },
  message: string,
  severity?: number,
  extra: Partial<{ source: string; code: string | number }> = {},
): any {
  return {
    range: {
      start: { line: range.startLine, character: range.startCol },
      end: { line: range.endLine, character: range.endCol },
    },
    severity,
    message,
    ...extra,
  }
}

function makeMap(entries: Array<[string, any[]]>): Map<string, any> {
  return new Map(entries)
}

describe("LSP.aggregateDiagnosticsForTest", () => {
  test("empty inputs yields empty envelope", () => {
    const env = LSP.aggregateDiagnosticsForTest([], { now })
    expect(env.completeness).toBe("empty")
    expect(env.data).toEqual([])
    expect(env.serverIDs).toEqual([])
    expect(env.degraded).toBe(false)
    expect(env.timestamp).toBe(now)
  })

  test("single server single file passes through with severity normalization", () => {
    const env = LSP.aggregateDiagnosticsForTest(
      [
        {
          serverID: "typescript",
          diagnostics: makeMap([
            [
              "/a.ts",
              [
                diag({ startLine: 0, startCol: 0, endLine: 0, endCol: 3 }, "bad thing", 1),
                diag({ startLine: 1, startCol: 0, endLine: 1, endCol: 3 }, "medium thing", 2),
                diag({ startLine: 2, startCol: 0, endLine: 2, endCol: 3 }, "mild thing", 3),
                diag({ startLine: 3, startCol: 0, endLine: 3, endCol: 3 }, "hint thing", 4),
                diag({ startLine: 4, startCol: 0, endLine: 4, endCol: 3 }, "unlabeled"),
              ],
            ],
          ]),
        },
      ],
      { now },
    )
    expect(env.completeness).toBe("full")
    expect(env.serverIDs).toEqual(["typescript"])
    expect(env.data.map((d) => d.severity)).toEqual(["error", "warning", "info", "hint", "info"])
  })

  test("dedup merges identical (range, message) across servers", () => {
    const same = diag({ startLine: 0, startCol: 0, endLine: 0, endCol: 10 }, "unused import", 2)
    const env = LSP.aggregateDiagnosticsForTest(
      [
        { serverID: "typescript", diagnostics: makeMap([["/a.ts", [same]]]) },
        { serverID: "eslint", diagnostics: makeMap([["/a.ts", [same]]]) },
      ],
      { now },
    )
    expect(env.data).toHaveLength(1)
    expect(env.data[0].serverIDs.sort()).toEqual(["eslint", "typescript"])
    // Both servers are listed as participating, even though only one
    // diagnostic shows in the output after dedup.
    expect(env.serverIDs.sort()).toEqual(["eslint", "typescript"])
  })

  test("different messages at same range are NOT deduped", () => {
    const r = { startLine: 0, startCol: 0, endLine: 0, endCol: 10 }
    const env = LSP.aggregateDiagnosticsForTest(
      [
        { serverID: "ts", diagnostics: makeMap([["/a.ts", [diag(r, "type mismatch", 1)]]]) },
        { serverID: "es", diagnostics: makeMap([["/a.ts", [diag(r, "no-unused-vars", 2)]]]) },
      ],
      { now },
    )
    expect(env.data).toHaveLength(2)
  })

  test("file filter returns only diagnostics for that file", () => {
    const env = LSP.aggregateDiagnosticsForTest(
      [
        {
          serverID: "ts",
          diagnostics: makeMap([
            ["/a.ts", [diag({ startLine: 0, startCol: 0, endLine: 0, endCol: 1 }, "A err", 1)]],
            ["/b.ts", [diag({ startLine: 0, startCol: 0, endLine: 0, endCol: 1 }, "B err", 1)]],
          ]),
        },
      ],
      { file: "/a.ts", now },
    )
    expect(env.data).toHaveLength(1)
    expect(env.data[0].path).toBe("/a.ts")
  })

  test("file filter with no matching diagnostics returns empty-completeness envelope", () => {
    // A server exists but hasn't published for the requested file.
    const env = LSP.aggregateDiagnosticsForTest(
      [
        {
          serverID: "ts",
          diagnostics: makeMap([["/other.ts", [diag({ startLine: 0, startCol: 0, endLine: 0, endCol: 1 }, "x", 1)]]]),
        },
      ],
      { file: "/not-indexed.ts", now },
    )
    // Server exists but didn't contribute to this file — participating = 0.
    expect(env.data).toEqual([])
    expect(env.serverIDs).toEqual([])
    // Bug hunt v2: completeness now matches runWithEnvelope's
    // convention — zero contributors means "empty", not "full".
    expect(env.completeness).toBe("empty")
  })

  test("ordering is stable across calls", () => {
    const inputs = [
      {
        serverID: "ts",
        diagnostics: makeMap([
          [
            "/z.ts",
            [diag({ startLine: 5, startCol: 0, endLine: 5, endCol: 1 }, "later", 2)],
          ],
        ]),
      },
      {
        serverID: "es",
        diagnostics: makeMap([
          [
            "/a.ts",
            [
              diag({ startLine: 5, startCol: 0, endLine: 5, endCol: 1 }, "B", 1),
              diag({ startLine: 2, startCol: 3, endLine: 2, endCol: 4 }, "A", 1),
            ],
          ],
        ]),
      },
    ]
    const first = LSP.aggregateDiagnosticsForTest(inputs, { now })
    const second = LSP.aggregateDiagnosticsForTest(inputs, { now })
    expect(first.data).toEqual(second.data)
    // First three: /a.ts line 2, /a.ts line 5, /z.ts line 5
    expect(first.data.map((d) => d.path)).toEqual(["/a.ts", "/a.ts", "/z.ts"])
    expect(first.data.map((d) => d.message)).toEqual(["A", "B", "later"])
  })

  test("code and source fields pass through", () => {
    const env = LSP.aggregateDiagnosticsForTest(
      [
        {
          serverID: "ts",
          diagnostics: makeMap([
            [
              "/a.ts",
              [
                diag({ startLine: 0, startCol: 0, endLine: 0, endCol: 1 }, "msg", 1, {
                  source: "ts",
                  code: "TS2322",
                }),
              ],
            ],
          ]),
        },
      ],
      { now },
    )
    expect(env.data[0].source).toBe("ts")
    expect(env.data[0].code).toBe("TS2322")
  })

  test("freshness helper reads the envelope's timestamp", () => {
    const env = LSP.aggregateDiagnosticsForTest([], { now })
    // `env.timestamp = now`; freshness at `now` is fresh.
    expect(LSP.envelopeFreshness(env, now)).toBe("fresh")
    // Older: warm.
    expect(LSP.envelopeFreshness(env, now + 60_000)).toBe("warm")
  })

  // Regression for v2 bug hunt: clients present but all diagnostic
  // maps empty → completeness must be "empty", not "full".
  test("connected clients with empty diagnostic maps produce empty completeness", () => {
    const env = LSP.aggregateDiagnosticsForTest(
      [
        { serverID: "ts", diagnostics: makeMap([]) },
        { serverID: "es", diagnostics: makeMap([]) },
      ],
      { now },
    )
    expect(env.data).toEqual([])
    expect(env.serverIDs).toEqual([])
    expect(env.completeness).toBe("empty")
  })
})
