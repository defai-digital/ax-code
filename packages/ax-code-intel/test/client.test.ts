import { describe, expect, test } from "vitest"
import { computeIncrementalChanges, textDocumentSyncKind, textDocumentSyncSettings } from "../src/client"

describe("text document synchronization", () => {
  test("accepts only protocol sync kinds", () => {
    expect(textDocumentSyncKind({ textDocumentSync: 2 })).toBe(2)
    expect(textDocumentSyncKind({ textDocumentSync: { change: 1 } })).toBe(1)
    expect(textDocumentSyncKind({ textDocumentSync: 3 })).toBeUndefined()
    expect(textDocumentSyncKind({ textDocumentSync: { change: -1 } })).toBeUndefined()
  })

  test("keeps the compatibility fallback for undeclared servers", () => {
    expect(textDocumentSyncSettings(undefined)).toEqual({
      openClose: true,
      change: 1,
      save: { enabled: false, includeText: false },
    })
  })

  test("honors explicit None and every options-object field", () => {
    expect(textDocumentSyncSettings({ textDocumentSync: 0 })).toEqual({
      openClose: false,
      change: 0,
      save: { enabled: false, includeText: false },
    })
    expect(
      textDocumentSyncSettings({
        textDocumentSync: { openClose: false, change: 2, save: { includeText: true } },
      }),
    ).toEqual({
      openClose: false,
      change: 2,
      save: { enabled: true, includeText: true },
    })
    expect(textDocumentSyncSettings({ textDocumentSync: { save: true } })).toEqual({
      openClose: false,
      change: 0,
      save: { enabled: true, includeText: false },
    })
  })

  test("computes bounded ranged changes and falls back for a full replacement", () => {
    expect(computeIncrementalChanges("one\ntwo\n", "one\nthree\n")).toEqual([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 2, character: 0 },
        },
        text: "three\n",
      },
    ])
    expect(computeIncrementalChanges("x", "y")).toBeNull()
  })
})
