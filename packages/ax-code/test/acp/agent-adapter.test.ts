import { describe, expect, test } from "vitest"
import path from "path"
import { pathToFileURL } from "url"
import { parseUri } from "../../src/acp/agent-adapter"

describe("ACP agent adapter", () => {
  test("decodes file URI escapes when deriving attachment filenames", () => {
    const file = path.join("/tmp", "space # name.ts")
    const uri = pathToFileURL(file).href

    expect(parseUri(uri)).toEqual({
      type: "file",
      url: uri,
      filename: "space # name.ts",
      mime: "text/plain",
    })
  })

  test("decodes file URIs case-insensitively", () => {
    const file = path.join("/tmp", "space # name.ts")
    const uri = pathToFileURL(file).href.replace(/^file:/, "FILE:")

    expect(parseUri(uri)).toEqual({
      type: "file",
      url: uri,
      filename: "space # name.ts",
      mime: "text/plain",
    })
  })

  test("decodes zed URIs case-insensitively", () => {
    expect(parseUri("ZED://open?path=/tmp/space%20name.ts")).toEqual({
      type: "file",
      url: pathToFileURL("/tmp/space name.ts").href,
      filename: "space name.ts",
      mime: "text/plain",
    })
  })
})
