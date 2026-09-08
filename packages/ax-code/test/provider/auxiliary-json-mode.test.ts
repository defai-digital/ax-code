import { beforeEach, expect, test, vi } from "vitest"

vi.mock("ai", () => ({ generateObject: vi.fn() }))
vi.mock("@/config/config", () => ({ Config: { get: vi.fn(async () => ({ routing: { llm: true } })) } }))
vi.mock("@/provider/provider", () => ({
  Provider: {
    resolveRequestedModel: vi.fn(async (model) => model),
    getModel: vi.fn(async () => ({})),
    getLanguage: vi.fn(async () => ({})),
    getSmallModel: vi.fn(async () => ({})),
  },
}))

import { generateObject } from "ai"
import { Critic } from "@/quality/critic"
import { providerReplanGenerator } from "@/planner/replan-llm"
import { classifyComplexity } from "@/agent/router"
import { ProviderID, ModelID } from "@/provider/schema"

const model = { providerID: ProviderID.make("gateway"), modelID: ModelID.make("qwen") }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(generateObject).mockImplementation(async (request: any) => {
    if (!request.messages.some((message: any) => /\bjson\b/i.test(message.content))) {
      throw new Error("response_format json_object requires json in the prompt")
    }
    return {
      object: { overallAssessment: "review complete", findings: [], phases: [{ name: "retry" }], complexity: "high" },
    } as any
  })
})

test("critic provides JSON instructions and the output schema", async () => {
  expect(
    await Critic.review({ model, phaseId: "phase", phaseDescription: "Review change", diff: "-unsafe\n+safe" }),
  ).toEqual({
    overallAssessment: "review complete",
    findings: [],
  })
  expect(vi.mocked(generateObject).mock.calls[0][0].messages?.[0].content).toContain("overallAssessment")
})

test("replanner provides JSON instructions and the phase schema", async () => {
  const result = await providerReplanGenerator({ model })({
    goal: "Repair failure",
    failed: { name: "build" } as any,
    error: "failed",
    depth: 1,
  })
  expect(result).toEqual([{ name: "retry" }])
  expect(vi.mocked(generateObject).mock.calls[0][0].messages?.[0].content).toContain("phases")
})

test("routing classifier requests an object rather than a bare enum", async () => {
  expect(
    await classifyComplexity("Investigate the boundary across these modules and find the defect", model.providerID),
  ).toEqual({ complexity: "high" })
  expect(vi.mocked(generateObject).mock.calls[0][0].messages?.[0].content).toContain('"complexity"')
})
