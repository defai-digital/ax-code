import { describe, expect, test } from "bun:test"
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
})
