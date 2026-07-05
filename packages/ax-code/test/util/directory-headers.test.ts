import { describe, expect, test } from "vitest"
import { requestHeadersToRecord, withDirectoryHeaders } from "../../src/util/directory-headers"

describe("util.directory-headers", () => {
  test("normalizes fetch headers into a record", () => {
    expect(requestHeadersToRecord(new Headers({ Authorization: "Basic token" }))).toEqual({
      authorization: "Basic token",
    })
    expect(requestHeadersToRecord([["x-test", "value"]])).toEqual({ "x-test": "value" })
    expect(requestHeadersToRecord({ Authorization: "Basic token" })).toEqual({ Authorization: "Basic token" })
  })

  test("copies plain header objects before adding directory headers", () => {
    const input = { Authorization: "Basic token" }
    const headers = requestHeadersToRecord(input)

    withDirectoryHeaders(headers, "/tmp/\u6E2C\u8A66")

    expect(headers).toEqual({
      Authorization: "Basic token",
      "x-ax-code-directory": "%2Ftmp%2F%E6%B8%AC%E8%A9%A6",
      "x-opencode-directory": "%2Ftmp%2F%E6%B8%AC%E8%A9%A6",
    })
    expect(input).toEqual({ Authorization: "Basic token" })
  })
})
