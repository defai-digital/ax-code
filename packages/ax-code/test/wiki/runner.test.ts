import { describe, expect, test } from "vitest"
import { buildOpenWikiArgs } from "../../src/wiki"

describe("wiki/runner", () => {
  test("buildOpenWikiArgs uses non-interactive code update", () => {
    expect(buildOpenWikiArgs("generate")).toEqual(["code", "--update", "--print"])
    expect(buildOpenWikiArgs("update")).toEqual(["code", "--update", "--print"])
    expect(buildOpenWikiArgs("update", ["--extra"])).toEqual(["code", "--update", "--print", "--extra"])
  })
})
