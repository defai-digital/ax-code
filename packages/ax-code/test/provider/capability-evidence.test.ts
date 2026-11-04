import { describe, expect, test } from "vitest"
import { modelCapabilityEvidence, withCapabilityEvidence } from "../../src/provider/capability-evidence"
import { getModelCapabilities } from "../../src/provider/model-capabilities"
import { cloneModelData } from "../../src/provider/model-snapshot"
import { resolveModel } from "../../src/provider/resolved-model"
import type { Provider } from "../../src/provider/provider"

describe("capability evidence", () => {
  test("missing declarations stay unknown through snapshots and serialization", () => {
    const flags = withCapabilityEvidence({ toolcall: false, reasoning: false }, {}, "deployment")
    expect(modelCapabilityEvidence(cloneModelData(flags, true)).toolCalling).toEqual({
      state: "unknown",
      source: "unknown",
    })
    expect(JSON.stringify(flags)).toBe('{"toolcall":false,"reasoning":false}')
    expect(Object.getOwnPropertySymbols(flags)).toHaveLength(1)
  })

  test("explicit deployment restrictions override positive registry heuristics", () => {
    const model = {
      id: "alias",
      providerID: "deepseek",
      api: { id: "deepseek-flash", url: "https://example.test/v1", npm: "@ai-sdk/openai-compatible" },
      capabilities: withCapabilityEvidence(
        { reasoning: false, toolcall: false },
        { thinking: false, toolCalling: false },
        "deployment",
      ),
      limit: { context: 32000, output: 4000 },
      status: "active",
    } as unknown as Provider.Model
    const resolved = resolveModel(model)
    expect(resolved.capabilities.toolCalling).toEqual({ state: "unsupported", source: "deployment" })
    expect(resolved.capabilities.thinking).toEqual({ state: "unsupported", source: "deployment" })
    const policy = getModelCapabilities("deepseek-flash", "deepseek", { thinking: false, toolCalling: false })
    expect(policy.thinking).toBe("blocked")
    expect(policy.toolCalling).toBe("blocked")
    expect(policy.preserveThinking).toBe("blocked")
  })

  test("unknown models do not inherit tools or JSON support from a default", () => {
    const result = getModelCapabilities("unregistered-deployment", "unregistered-provider")
    expect(result.toolCalling).toBe("unknown")
    expect(result.structuredOutput).toBe("unknown")
  })
})
