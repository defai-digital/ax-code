import { describe, expect, test } from "bun:test"
import { groupFilesByLanguage } from "../../src/cli/cmd/index-graph"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// groupFilesByLanguage is the helper the LSP pre-flight probe uses to
// build its "N files in language X" readiness table. Tested here
// because the full probe path requires a running LSP server.

describe("groupFilesByLanguage", () => {
  test("groups files by detected language id", () => {
    const groups = groupFilesByLanguage([
      "/p/a.ts",
      "/p/b.ts",
      "/p/c.tsx",
      "/p/main.go",
      "/p/lib.rs",
      "/p/README.md",
    ])

    expect(groups.get("typescript")).toEqual(["/p/a.ts", "/p/b.ts"])
    expect(groups.get("typescriptreact")).toEqual(["/p/c.tsx"])
    expect(groups.get("go")).toEqual(["/p/main.go"])
    expect(groups.get("rust")).toEqual(["/p/lib.rs"])
    expect(groups.get("markdown")).toEqual(["/p/README.md"])
  })

  test("collapses unmapped extensions into 'unknown'", () => {
    const groups = groupFilesByLanguage(["/p/weird.xyz", "/p/unknown.foobar"])
    expect(groups.get("unknown")).toEqual(["/p/weird.xyz", "/p/unknown.foobar"])
  })

  test("empty input returns empty map", () => {
    expect(groupFilesByLanguage([])).toEqual(new Map())
  })
})
