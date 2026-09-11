import { describe, expect, test } from "vitest"
import {
  defaultModelIDForProvider,
  IMPLICIT_DEFAULT_MODEL_SKUS,
  pickImplicitDefaultModel,
  preferredDefaultSkuForProvider,
} from "../../src/provider/implicit-default"

const tool = { tool_call: true as const }

describe("implicit default model selection", () => {
  test("prefers vendor SKUs for connected providers", () => {
    expect(preferredDefaultSkuForProvider("zai")).toBe("glm-5.3-flash")
    expect(preferredDefaultSkuForProvider("zai-coding-plan")).toBe("glm-5.3-flash")
    expect(preferredDefaultSkuForProvider("zhipuai")).toBe("glm-5.3-flash")
    expect(preferredDefaultSkuForProvider("deepseek")).toBe("deepseek-flash")
    expect(preferredDefaultSkuForProvider("alibaba-token-plan")).toBe("qwen3.8-flash")
    expect(preferredDefaultSkuForProvider("alibaba-coding-plan")).toBe("qwen3-coder-plus")
    expect(preferredDefaultSkuForProvider("alibaba-coding-plan-cn")).toBe("qwen3-coder-plus")
    expect(preferredDefaultSkuForProvider("minimax-coding-plan")).toBe("MiniMax-M3")
    expect(preferredDefaultSkuForProvider("minimax-cn-coding-plan")).toBe("MiniMax-M3")
    expect(preferredDefaultSkuForProvider("meta")).toBe("muse-spark-1.3")
    expect(preferredDefaultSkuForProvider("google")).toBe("gemini-3.8-flash")
    expect(preferredDefaultSkuForProvider("groq")).toBe("openai/gpt-oss-20b")
    expect(preferredDefaultSkuForProvider("ax-engine")).toBeUndefined()
  })

  test("picks provider catalog defaults when the preferred SKU is present", () => {
    expect(
      defaultModelIDForProvider("alibaba-coding-plan", {
        "qwen3-coder-plus": tool,
        "qwen3.7-plus": tool,
      }),
    ).toBe("qwen3-coder-plus")
    expect(
      defaultModelIDForProvider("minimax-coding-plan", {
        "MiniMax-M2.7": tool,
        "MiniMax-M3": tool,
      }),
    ).toBe("MiniMax-M3")
    expect(
      defaultModelIDForProvider("meta", {
        "muse-spark-1.3": tool,
        "muse-spark-1.3-contributor": tool,
      }),
    ).toBe("muse-spark-1.3")
    expect(
      defaultModelIDForProvider("google", {
        "gemini-3.8-flash": tool,
        "gemma-4-31b-it": tool,
      }),
    ).toBe("gemini-3.8-flash")
    expect(
      defaultModelIDForProvider("groq", {
        "openai/gpt-oss-120b": tool,
        "openai/gpt-oss-20b": tool,
        "qwen/qwen3.8-27b": tool,
      }),
    ).toBe("openai/gpt-oss-20b")
  })

  test("does not default AX Engine models", () => {
    expect(
      defaultModelIDForProvider("ax-engine", {
        "qwen3.8-27b-axq-6bit": tool,
      }),
    ).toBeUndefined()
  })

  test("picks glm-5.3-flash on Z.AI catalogs", () => {
    expect(
      defaultModelIDForProvider("zai", {
        "glm-5.3": tool,
        "glm-5.3-flash": tool,
        "glm-5.3[1m]": tool,
      }),
    ).toBe("glm-5.3-flash")
  })

  test("walks the implicit SKU chain across connected providers", () => {
    expect(IMPLICIT_DEFAULT_MODEL_SKUS).toEqual([
      "deepseek-flash",
      "MiniMax-M3",
      "glm-5.3-flash",
      "qwen3.8-flash",
      "muse-spark-1.3",
    ])
    expect(
      pickImplicitDefaultModel([
        { id: "minimax-coding-plan", models: { "MiniMax-M3": tool, "MiniMax-M2.7": tool } },
        { id: "deepseek", models: { "deepseek-flash": tool, "deepseek-v4-pro": tool } },
      ]),
    ).toEqual({ providerID: "deepseek", modelID: "deepseek-flash" })
    expect(
      pickImplicitDefaultModel([{ id: "minimax-coding-plan", models: { "MiniMax-M3": tool, "MiniMax-M2.7": tool } }]),
    ).toEqual({ providerID: "minimax-coding-plan", modelID: "MiniMax-M3" })
    expect(pickImplicitDefaultModel([{ id: "zai", models: { "glm-5.3-flash": tool, "glm-5.3": tool } }])).toEqual({
      providerID: "zai",
      modelID: "glm-5.3-flash",
    })
    expect(
      pickImplicitDefaultModel([{ id: "alibaba-token-plan", models: { "qwen3.8-flash": tool, "qwen3.8-max": tool } }]),
    ).toEqual({ providerID: "alibaba-token-plan", modelID: "qwen3.8-flash" })
    expect(pickImplicitDefaultModel([{ id: "meta", models: { "muse-spark-1.3": tool } }])).toEqual({
      providerID: "meta",
      modelID: "muse-spark-1.3",
    })
  })

  test("never uses AX Engine in the implicit chain", () => {
    expect(
      pickImplicitDefaultModel([
        { id: "ax-engine", models: { "qwen3.8-27b-axq-6bit": tool, "deepseek-flash": tool } },
        { id: "groq", models: { "qwen/qwen3.8-27b": tool } },
      ]),
    ).toBeUndefined()
  })

  test("skips non-toolcall SKUs", () => {
    expect(
      pickImplicitDefaultModel([{ id: "deepseek", models: { "deepseek-flash": { tool_call: false } } }]),
    ).toBeUndefined()
  })
})
