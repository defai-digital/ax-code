import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const pluginEntrypoint = readFileSync("packages/plugin/src/index.ts", "utf8")

describe("plugin SDK naming", () => {
  test("uses AX Code SDK client naming for plugin context types", () => {
    expect(pluginEntrypoint).toContain("AxCodeClient")
    expect(pluginEntrypoint).not.toContain("createOpencodeClient")
    expect(pluginEntrypoint).not.toContain("OpencodeClient")
  })
})
