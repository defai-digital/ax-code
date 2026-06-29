import { describe, expect, test } from "vitest"

import { getSafeToolFetchHref } from "./toolFetchLinks"

describe("getSafeToolFetchHref", () => {
  test("preserves safe fetch URLs", () => {
    expect(getSafeToolFetchHref(" https://example.com/docs ")).toBe("https://example.com/docs")
    expect(getSafeToolFetchHref("http://127.0.0.1:3000/health")).toBe("http://127.0.0.1:3000/health")
  })

  test("rejects unsafe or credential-bearing fetch URLs", () => {
    expect(getSafeToolFetchHref("javascript:alert(1)")).toBeUndefined()
    expect(getSafeToolFetchHref("file:///Users/test/secret.txt")).toBeUndefined()
    expect(getSafeToolFetchHref("https://user:pass@example.com/docs")).toBeUndefined()
    expect(getSafeToolFetchHref("")).toBeUndefined()
  })
})
