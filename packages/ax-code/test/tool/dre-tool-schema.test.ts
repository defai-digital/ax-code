import { describe, expect, test } from "bun:test"
import { DebugRepairFromEnvelopeTool } from "../../src/tool/debug_repair_from_envelope"
import { DedupScanTool } from "../../src/tool/dedup_scan"
import { ImpactAnalyzeTool } from "../../src/tool/impact_analyze"

describe("DRE tool schemas", () => {
  test("dedup_scan coerces numeric limit parameters from string values", async () => {
    const tool = await DedupScanTool.init()

    const parsed = tool.parameters.parse({
      minSignatureLength: "12",
      similarityThreshold: "0.75",
      maxCandidates: "25",
    })

    expect(parsed.minSignatureLength).toBe(12)
    expect(parsed.similarityThreshold).toBe(0.75)
    expect(parsed.maxCandidates).toBe(25)
  })

  test("impact_analyze coerces numeric traversal parameters from string values", async () => {
    const tool = await ImpactAnalyzeTool.init()

    const parsed = tool.parameters.parse({
      changes: [{ kind: "file", path: "src/index.ts" }],
      depth: "2",
      maxVisited: "25",
    })

    expect(parsed.depth).toBe(2)
    expect(parsed.maxVisited).toBe(25)
  })

  test("debug_repair_from_envelope coerces maxFailures from string values", async () => {
    const tool = await DebugRepairFromEnvelopeTool.init()

    const parsed = tool.parameters.parse({
      envelopeId: "1234567890abcdef",
      maxFailures: "4",
    })

    expect(parsed.maxFailures).toBe(4)
  })
})
