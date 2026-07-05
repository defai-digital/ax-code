import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

const betaScript = readFileSync("script/beta.ts", "utf8")

describe("beta sync script", () => {
  test("uses AX Code resolver defaults instead of a hard-coded legacy CLI", () => {
    expect(betaScript).toContain('AX_CODE_BETA_RESOLVER_COMMAND ?? "ax-code"')
    expect(betaScript).toContain("AX_CODE_BETA_RESOLVER_MODEL")
    expect(betaScript).toContain("CONFLICT_RESOLVER_COMMAND")
    expect(betaScript).not.toContain('sh("opencode"')
    expect(betaScript).not.toContain("with opencode")
  })
})
