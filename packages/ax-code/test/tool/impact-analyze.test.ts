import { afterEach, expect, test, vi } from "vitest"
import { DebugEngine } from "@ax-code/ax-code-reason"
import { ImpactAnalyzeTool } from "../../src/tool/impact_analyze"
import { CodeIntelligence } from "../../src/code-intelligence"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import type { Tool } from "../../src/tool/tool"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

test("impact tool forwards its abort signal and refuses a late report before annotations", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const controller = new AbortController()
      const reason = new Error("tool cancelled")
      const analyze = vi.spyOn(DebugEngine, "analyzeImpact").mockImplementation(async (_project, _input, signal) => {
        expect(signal).toBe(controller.signal)
        controller.abort(reason)
        return {
          seeds: [],
          affectedSymbols: [],
          affectedFiles: [],
          apiBoundariesHit: 0,
          riskScore: 0,
          riskLabel: "low",
          truncated: false,
          explain: DebugEngine.buildExplain("analyze-impact", [], []),
        }
      })
      const note = vi.spyOn(CodeIntelligence, "recordNote")
      const ctx: Tool.Context = {
        sessionID: SessionID.ascending(),
        messageID: MessageID.ascending(),
        agent: "build",
        abort: controller.signal,
        messages: [],
        metadata() {},
        async ask() {},
      }
      const tool = await ImpactAnalyzeTool.init()
      await expect(tool.execute({ changes: [{ kind: "file", path: "fixture.ts" }] }, ctx)).rejects.toBe(reason)
      expect(analyze).toHaveBeenCalledTimes(1)
      expect(note).not.toHaveBeenCalled()
    },
  })
})
