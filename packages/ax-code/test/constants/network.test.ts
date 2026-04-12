import { describe, expect, test } from "bun:test"
import {
  AX_CODE_INTERNAL_HOST,
  AX_CODE_INTERNAL_ORIGIN,
  LEGACY_OPENCODE_INTERNAL_HOST,
  isInternalFetchHost,
} from "../../src/constants/network"

describe("network constants", () => {
  test("uses AX Code as the primary in-process fetch origin", () => {
    expect(AX_CODE_INTERNAL_HOST).toBe("ax-code.internal")
    expect(AX_CODE_INTERNAL_ORIGIN).toBe("http://ax-code.internal")
  })

  test("allows internal and compatibility fetch hosts only", () => {
    expect(isInternalFetchHost(AX_CODE_INTERNAL_HOST)).toBe(true)
    expect(isInternalFetchHost(LEGACY_OPENCODE_INTERNAL_HOST)).toBe(true)
    expect(isInternalFetchHost("localhost")).toBe(true)
    expect(isInternalFetchHost("127.0.0.1")).toBe(true)
    expect(isInternalFetchHost("[::1]")).toBe(true)
    expect(isInternalFetchHost("example.com")).toBe(false)
  })
})
