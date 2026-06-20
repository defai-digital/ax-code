import { describe, expect, test } from "vitest"
import { parseShellArgs } from "../../src/util/shell-args"

describe("parseShellArgs", () => {
  test("splits ordinary whitespace separated arguments", () => {
    expect(parseShellArgs("node server.js --stdio")).toEqual(["node", "server.js", "--stdio"])
  })

  test("preserves quoted argument groups", () => {
    expect(parseShellArgs("node server.js --root \"My Project\" --name='local mcp'")).toEqual([
      "node",
      "server.js",
      "--root",
      "My Project",
      "--name=local mcp",
    ])
  })

  test("preserves empty quoted arguments", () => {
    expect(parseShellArgs('cmd "" "non empty"')).toEqual(["cmd", "", "non empty"])
  })

  test("handles escaped spaces and trailing backslashes", () => {
    expect(parseShellArgs("cmd one\\ two path\\")).toEqual(["cmd", "one two", "path\\"])
  })
})
