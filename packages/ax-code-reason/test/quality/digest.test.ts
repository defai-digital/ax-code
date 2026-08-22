import { describe, expect, test } from "vitest"
import { sha256Hex, sha256JsonHex } from "../../src/quality/digest"

describe("sha256Hex", () => {
  test("matches the well-known sha256 vector for 'abc'", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  test("is deterministic and input-sensitive", () => {
    expect(sha256Hex("payload")).toBe(sha256Hex("payload"))
    expect(sha256Hex("payload")).not.toBe(sha256Hex("payloaD"))
  })
})

describe("sha256JsonHex", () => {
  test("hashes the JSON serialization", () => {
    expect(sha256JsonHex({ a: 1 })).toBe(sha256Hex(JSON.stringify({ a: 1 })))
    expect(sha256JsonHex({ a: 1 })).toBe(sha256JsonHex({ a: 1 }))
  })

  test("current behavior: key insertion order changes the hash (no canonicalization)", () => {
    // Unlike computeEnvelopeId (which canonicalizes), sha256JsonHex hashes
    // raw JSON.stringify output.
    expect(sha256JsonHex({ a: 1, b: 2 })).not.toBe(sha256JsonHex({ b: 2, a: 1 }))
  })

  test("rejects values JSON.stringify cannot serialize", () => {
    expect(() => sha256JsonHex(undefined)).toThrow(TypeError)
    expect(() => sha256JsonHex(undefined)).toThrow("Cannot hash a non-JSON value")
    expect(() => sha256JsonHex(() => 1)).toThrow("Cannot hash a non-JSON value")
    expect(() => sha256JsonHex(Symbol("x"))).toThrow("Cannot hash a non-JSON value")
  })
})
