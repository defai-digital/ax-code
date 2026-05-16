import { describe, expect, test } from "bun:test"
import { directoryRequestHeaders } from "../../../src/cli/cmd/tui/util/request-headers"

describe("tui request headers", () => {
  test("includes accept and content-type when requested", () => {
    expect(
      directoryRequestHeaders({
        accept: "application/json",
        contentType: "application/json",
      }),
    ).toEqual({
      accept: "application/json",
      "content-type": "application/json",
    })
  })

  test("mirrors workspace directory across both header names", () => {
    expect(
      directoryRequestHeaders({
        directory: "/repo",
        accept: "application/json",
      }),
    ).toEqual({
      accept: "application/json",
      "x-ax-code-directory": "/repo",
      "x-opencode-directory": "/repo",
    })
  })

  test("percent-encodes non-ascii workspace directories", () => {
    expect(
      directoryRequestHeaders({
        directory: "/tmp/\u6E2C\u8A66",
      }),
    ).toEqual({
      "x-ax-code-directory": "%2Ftmp%2F%E6%B8%AC%E8%A9%A6",
      "x-opencode-directory": "%2Ftmp%2F%E6%B8%AC%E8%A9%A6",
    })
  })
})
