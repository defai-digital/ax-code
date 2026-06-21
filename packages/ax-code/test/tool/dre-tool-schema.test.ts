import { describe, expect, test } from "vitest"
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

  test("dedup_scan rejects non-decimal numeric strings", async () => {
    const tool = await DedupScanTool.init()

    expect(() => tool.parameters.parse({ minSignatureLength: "0x10" })).toThrow()
    expect(() => tool.parameters.parse({ similarityThreshold: "1e-1" })).toThrow()
    expect(() => tool.parameters.parse({ maxCandidates: "1e3" })).toThrow()
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

  test("impact_analyze rejects non-decimal numeric strings", async () => {
    const tool = await ImpactAnalyzeTool.init()
    const changes = [{ kind: "file" as const, path: "src/index.ts" }]

    expect(() => tool.parameters.parse({ changes, depth: "0x2" })).toThrow()
    expect(() => tool.parameters.parse({ changes, maxVisited: "1e3" })).toThrow()
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
