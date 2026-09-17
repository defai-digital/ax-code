import { describe, expect, test } from "vitest"
import "../harness"
import { RubyLsp } from "../../src/server-defs"
import { BuiltinServerProfiles } from "../../src/server-profile"

describe("ruby-lsp server definition", () => {
  test("uses Shopify ruby-lsp, defers prewarm, and does not claim ERB", () => {
    expect(RubyLsp.id).toBe("ruby-lsp")
    expect(RubyLsp.extensions).toEqual([".rb", ".rake", ".gemspec", ".ru"])
    expect(RubyLsp.extensions).not.toContain(".erb")
    expect(BuiltinServerProfiles["ruby-lsp"]?.prewarm).toBe(false)
  })
})
