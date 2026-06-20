import { describe, expect, test } from "vitest"
import { RefactorApplyTool } from "../../src/tool/refactor_apply"

describe("RefactorApplyTool", () => {
  test("accepts documented command overrides in the public schema", async () => {
    const tool = await RefactorApplyTool.init()
    const parsed = tool.parameters.parse({
      planId: "plan_test",
      patch: "diff --git a/a.ts b/a.ts\n",
      commands: {
        typecheck: "cargo check",
        lint: null,
        test: "cargo test -p demo",
      },
    })

    expect(parsed.commands).toEqual({
      typecheck: "cargo check",
      lint: null,
      test: "cargo test -p demo",
    })
  })

  test("rejects empty command override strings", async () => {
    const tool = await RefactorApplyTool.init()

    expect(() =>
      tool.parameters.parse({
        planId: "plan_test",
        commands: {
          typecheck: "",
        },
      }),
    ).toThrow()
  })
})
