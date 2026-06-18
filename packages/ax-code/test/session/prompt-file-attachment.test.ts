import { describe, expect, test } from "bun:test"
import { normalizeDocumentSymbolEnvelopeData } from "../../src/session/prompt-file-attachment"

describe("prompt file attachment", () => {
  test("normalizes malformed document symbol envelope payloads to an empty list", () => {
    expect(normalizeDocumentSymbolEnvelopeData(undefined)).toEqual([])
    expect(normalizeDocumentSymbolEnvelopeData(null)).toEqual([])
    expect(normalizeDocumentSymbolEnvelopeData({ name: "symbol" })).toEqual([])
  })

  test("preserves document symbol arrays for range expansion", () => {
    const symbols = [{ name: "symbol", range: { start: { line: 1 }, end: { line: 3 } } }]
    expect(normalizeDocumentSymbolEnvelopeData(symbols)).toEqual(symbols)
  })
})
