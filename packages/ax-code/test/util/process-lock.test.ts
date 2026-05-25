import { describe, expect, test } from "bun:test"
import { decodeProcessLockBody, parseProcessLockBody } from "../../src/util/process-lock"

describe("util.process-lock", () => {
  test("decodeProcessLockBody decodes already-parsed lock bodies", () => {
    expect(decodeProcessLockBody<{ token: string }>({ pid: 123, startedAt: 456, host: "host", token: "t" })).toEqual({
      pid: 123,
      startedAt: 456,
      host: "host",
      token: "t",
    })
  })

  test("parseProcessLockBody decodes valid lock bodies and preserves extra fields", () => {
    expect(
      parseProcessLockBody<{ token: string }>(
        JSON.stringify({ pid: 123, startedAt: 456, host: "host", token: "t" }),
      ),
    ).toEqual({
      pid: 123,
      startedAt: 456,
      host: "host",
      token: "t",
    })
  })

  test("parseProcessLockBody rejects invalid JSON and non-record values", () => {
    expect(parseProcessLockBody("{not json")).toBeUndefined()
    expect(parseProcessLockBody("[]")).toBeUndefined()
    expect(parseProcessLockBody("null")).toBeUndefined()
  })

  test("parseProcessLockBody rejects malformed required fields", () => {
    expect(parseProcessLockBody(JSON.stringify({ pid: "123", startedAt: 456, host: "host" }))).toBeUndefined()
    expect(parseProcessLockBody(JSON.stringify({ pid: 123, startedAt: Number.NaN, host: "host" }))).toBeUndefined()
    expect(parseProcessLockBody(JSON.stringify({ pid: 123, startedAt: 456, host: null }))).toBeUndefined()
  })
})
