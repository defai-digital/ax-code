import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "vitest"

const example = readFileSync(resolve(import.meta.dirname, "../example/example.ts"), "utf8")

describe("@ax-code/sdk examples", () => {
  test("use AX Code HTTP helper names", () => {
    expect(example).toContain("createAxCodeClient")
    expect(example).toContain("createAxCodeServer")
    expect(example).not.toContain("createOpencodeClient")
    expect(example).not.toContain("createOpencodeServer")
  })
})
