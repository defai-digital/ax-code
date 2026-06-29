import { describe, expect, test } from "vitest"

import { getSafeMarkdownHref } from "./markdownLinks"

describe("getSafeMarkdownHref", () => {
  test("preserves safe external markdown links", () => {
    expect(getSafeMarkdownHref("https://example.com/docs")).toBe("https://example.com/docs")
    expect(getSafeMarkdownHref("mailto:support@example.com")).toBe("mailto:support@example.com")
  })

  test("removes unsafe markdown hrefs before rendering anchors", () => {
    expect(getSafeMarkdownHref("javascript:alert(1)")).toBeUndefined()
    expect(getSafeMarkdownHref("file:///Users/test/secret.txt")).toBeUndefined()
    expect(getSafeMarkdownHref("https://user:pass@example.com/docs")).toBeUndefined()
    expect(getSafeMarkdownHref(undefined)).toBeUndefined()
  })
})
