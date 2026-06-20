import { describe, expect, test } from "vitest"
import z from "zod"
import { CodeIntelligenceTool } from "../../src/tool/code-intelligence"
import { DedupScanTool } from "../../src/tool/dedup_scan"
import { EditTool } from "../../src/tool/edit"
import { MultiEditTool } from "../../src/tool/multiedit"
import { RefactorApplyTool } from "../../src/tool/refactor_apply"
import { SCAN_TOOL_COMMON_PARAMETERS } from "../../src/tool/scan-coverage"
import { ToolBoolean } from "../../src/tool/schema"

describe("tool boolean schemas", () => {
  test("coerce string booleans without treating false as truthy", async () => {
    const edit = await EditTool.init()
    expect(
      edit.parameters.parse({
        filePath: "src/file.ts",
        oldString: "before",
        newString: "after",
        replaceAll: "false",
      }).replaceAll,
    ).toBe(false)

    const multiedit = await MultiEditTool.init()
    expect(
      multiedit.parameters.parse({
        filePath: "src/file.ts",
        edits: [{ filePath: "src/file.ts", oldString: "before", newString: "after", replaceAll: "true" }],
      }).edits[0]?.replaceAll,
    ).toBe(true)

    const refactorApply = await RefactorApplyTool.init()
    const refactorParams = refactorApply.parameters.parse({
      planId: "plan_123",
      mode: "aggressive",
      skipLint: "false",
      skipTests: "true",
    })
    expect(refactorParams.skipLint).toBe(false)
    expect(refactorParams.skipTests).toBe(true)

    const codeIntelligence = await CodeIntelligenceTool.init()
    expect(
      codeIntelligence.parameters.parse({
        operation: "buildContext",
        query: "summarize this change",
        includeImpact: "0",
      }).includeImpact,
    ).toBe(false)

    const dedup = await DedupScanTool.init()
    expect(dedup.parameters.parse({ excludeTests: "1" }).excludeTests).toBe(true)

    const scanCommon = z.object(SCAN_TOOL_COMMON_PARAMETERS).parse({ excludeTests: "false" })
    expect(scanCommon.excludeTests).toBe(false)
  })

  test("rejects non-boolean strings", () => {
    expect(() => ToolBoolean.parse("yes")).toThrow()
  })
})
