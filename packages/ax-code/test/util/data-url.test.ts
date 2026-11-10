import { describe, expect, test } from "vitest"
import { decodeDataUrl, decodeDataUrlBytes } from "../../src/util/data-url"

describe("decodeDataUrl", () => {
  test("decodes base64 data URLs", () => {
    const body = '{\n  "ok": true\n}\n'
    const url = `data:text/plain;base64,${Buffer.from(body).toString("base64")}`
    expect(decodeDataUrl(url)).toBe(body)
  })

  test("returns an empty string for invalid base64 data URLs", () => {
    expect(decodeDataUrl("data:text/plain;base64,not base64!!")).toBe("")
  })

  test("decodes plain data URLs", () => {
    expect(decodeDataUrl("data:text/plain,hello%20world")).toBe("hello world")
  })

  test.each([
    ["DATA:text/plain;BASE64,SGVsbG8=", "Hello"],
    ["data:text/plain;base64,SGVsbG8%3D", "Hello"],
    ["data:text/plain;base64=disabled,SGVsbG8=", "SGVsbG8="],
    ["data:text/plain;base64mode=off,SGVsbG8=", "SGVsbG8="],
  ])("decodes text from %s", (url, expected) => {
    expect(decodeDataUrl(url)).toBe(expected)
  })

  test.each([
    ["data:,hello+world,100%25", "hello+world,100%"],
    ["data:,%2520", "%20"],
    ["data:,文字%E2%9C%93", "文字✓"],
    ["data:text/plain;charset=utf-8;BASE64,5paH5a2X", "文字"],
    ["data:,", ""],
  ])("preserves payload content in %s", (url, expected) => {
    expect(decodeDataUrlBytes(url)).toEqual(Buffer.from(expected))
    expect(decodeDataUrl(url)).toBe(expected)
  })

  test.each([
    "data:,trailing%",
    "data:,%A",
    "data:,%GG",
    "data:text/plain;base64,SGVsbG8%3",
    "data:text/plain;base64,%FF",
    "data:text/plain;base64,not base64!!",
    "data:text/plain",
    "https://example.com/hello,world",
  ])("rejects malformed data URL %s", (url) => {
    expect(decodeDataUrlBytes(url)).toBeUndefined()
    expect(decodeDataUrl(url)).toBe("")
  })
})
