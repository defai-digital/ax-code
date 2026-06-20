import { describe, expect, test } from "vitest"
import { decodePrViewJson, decodePrViewValue } from "../../src/quality/pr-diff"

describe("quality pr diff", () => {
  test("decodes already-parsed gh pr view values", () => {
    expect(
      decodePrViewValue({
        number: 123,
        title: "Fix the boundary",
        baseRefName: "main",
        headRefName: "feature",
        headRefOid: "abc123",
      }),
    ).toEqual({
      ok: true,
      data: {
        number: 123,
        title: "Fix the boundary",
        baseRefName: "main",
        headRefName: "feature",
        headRefOid: "abc123",
      },
    })
  })

  test("decodes gh pr view JSON separately from command execution", () => {
    expect(
      decodePrViewJson(
        JSON.stringify({
          number: 123,
          title: "Fix the boundary",
          baseRefName: "main",
          headRefName: "feature",
          headRefOid: "abc123",
        }),
      ),
    ).toEqual({
      ok: true,
      data: {
        number: 123,
        title: "Fix the boundary",
        baseRefName: "main",
        headRefName: "feature",
        headRefOid: "abc123",
      },
    })
  })

  test("reports malformed or shape-invalid gh pr view JSON as decode failures", () => {
    expect(decodePrViewJson("{not json")).toMatchObject({ ok: false })
    expect(decodePrViewJson(JSON.stringify({ number: "123" }))).toMatchObject({ ok: false })
  })
})
