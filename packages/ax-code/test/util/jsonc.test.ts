import { describe, expect, test } from "vitest"
import { changedJsoncPatch, JSONC_UNCHANGED, parseJsoncResult, patchJsonc } from "../../src/util/jsonc"

describe("util.jsonc", () => {
  test("parseJsoncResult accepts comments and trailing commas", () => {
    const parsed = parseJsoncResult(`{
  // sandbox off
  "isolation": {
    "mode": "full-access",
    "network": true,
  },
}`)
    expect(parsed).toEqual({
      ok: true,
      value: {
        isolation: {
          mode: "full-access",
          network: true,
        },
      },
    })
  })

  test("parseJsoncResult reports syntax errors", () => {
    const parsed = parseJsoncResult("{not json")
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain("line 1")
  })

  test("patchJsonc updates a nested key without stripping comments", () => {
    const input = `{
  // keep this comment
  "isolation": {
    "mode": "workspace-write",
    "network": false
  }
}
`
    const updated = patchJsonc(input, { isolation: { mode: "full-access", network: true } })
    expect(updated).toContain("// keep this comment")
    expect(updated).toContain('"mode": "full-access"')
    expect(updated).toContain('"network": true')
  })

  test("changedJsoncPatch returns only mutated leaves", () => {
    expect(
      changedJsoncPatch(
        { model: "a", isolation: { mode: "workspace-write", network: false } },
        { model: "a", isolation: { mode: "full-access", network: false } },
      ),
    ).toEqual({ isolation: { mode: "full-access" } })
    expect(changedJsoncPatch({ model: "a" }, { model: "a" })).toBe(JSONC_UNCHANGED)
  })
})
