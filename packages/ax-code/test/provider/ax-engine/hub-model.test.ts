import { describe, expect, test } from "vitest"
import { evaluateHubModel, hubModelDefinition, hubModelID } from "../../../src/provider/ax-engine/hub-model"
import { AxEngineModelIDSchema } from "../../../src/provider/ax-engine/constants"
import { normalizeModelID, normalizeQuantization } from "../../../src/provider/ax-engine/model-cache"
import { AxEnginePaths } from "../../../src/provider/ax-engine/paths"
import { modelSelectableForProvider } from "../../../src/provider/model-selectability"
import { parseAxEngineModelContracts, requireAxEngineCodingContract } from "../../../src/provider/ax-engine/model-card"
import { pinnedDownloadVersionBlocker } from "../../../src/provider/ax-engine/dependency"
import { hubFixture, productCatalog } from "./hub-fixture"

describe("AutomatosX product admission", () => {
  test("joins a quantized artifact to its exact supported source independently of architecture", () => {
    const model = hubFixture({ config: { model_type: "qwen3_5" } })
    const decision = evaluateHubModel(model, productCatalog())
    expect(decision).toMatchObject({ policy: "eligible", baseModel: "Qwen/Qwen3.8-27B" })
    expect(hubModelDefinition(model, decision)).toMatchObject({
      id: hubModelID(model),
      revision: model.sha,
      contextTokens: 32768,
      outputTokens: 8192,
      toolcall: false,
      reasoning: false,
      estimatedResources: true,
      defaultQuantization: "mlx",
    })
  })

  test.each(["image-text-to-text", "text-generation"])(
    "accepts %s candidates for later native verification",
    (pipeline_tag) => {
      expect(evaluateHubModel(hubFixture({ pipeline_tag }), productCatalog()).policy).toBe("eligible")
    },
  )

  test.each(["ASR", "Embedding", "GenRM", "Reward", "Reranker", "OCR"])(
    "excludes %s despite an accepted base model",
    (task) => {
      expect(evaluateHubModel(hubFixture({ id: `AutomatosX/AX-Qwen-${task}-MLX-4bit` }), productCatalog()).policy).toBe(
        "excluded",
      )
    },
  )

  test.each(["finetune", "adapter", "merge"])(
    "does not transfer support through a %s relationship",
    (base_model_relation) => {
      const model = hubFixture({ cardData: { base_model: "Qwen/Qwen3.8-27B", base_model_relation } })
      expect(evaluateHubModel(model, productCatalog()).policy).toBe("unknown")
    },
  )

  test("does not reduce unrecognized instruction or reward variants to a supported family", () => {
    for (const base of [
      "Qwen/Qwen3.8-27B-Custom",
      "another-owner/Qwen3.8-27B",
      "nvidia/Qwen3-Nemotron-32B-GenRM-Principle",
    ]) {
      expect(
        evaluateHubModel(
          hubFixture({ cardData: { base_model: base, base_model_relation: "quantized" } }),
          productCatalog(),
        ).policy,
      ).not.toBe("eligible")
    }
  })

  test("keeps missing, multiple, and conflicting source metadata unverified", () => {
    for (const model of [
      hubFixture({ cardData: {} }),
      hubFixture({ cardData: { base_model: ["Qwen/Qwen3.8-27B", "other/model"] } }),
      hubFixture({ provenanceBase: "other/model" }),
    ]) {
      expect(evaluateHubModel(model, productCatalog()).policy).toBe("unknown")
    }
  })

  test("requires explicit product tool and text metadata", () => {
    const catalog = productCatalog()
    catalog.fixture.models["Qwen/Qwen3.8-27B"].tool_call = false
    expect(evaluateHubModel(hubFixture(), catalog).policy).toBe("unknown")
    catalog.fixture.models["Qwen/Qwen3.8-27B"].tool_call = true
    catalog.fixture.models["Qwen/Qwen3.8-27B"].modalities = undefined
    expect(evaluateHubModel(hubFixture(), catalog).policy).toBe("unknown")
  })

  test("does not override a declared non-MLX library with an MLX tag", () => {
    expect(evaluateHubModel(hubFixture({ library_name: "transformers", tags: ["mlx"] }), productCatalog()).policy).toBe(
      "excluded",
    )
  })

  test("rejects contexts that cannot fit the coding-agent prompt and tools", () => {
    expect(
      evaluateHubModel(hubFixture({ textConfig: { max_position_embeddings: 8192 } }), productCatalog()).policy,
    ).toBe("excluded")
  })

  test("applies provider policy to recognized sources", () => {
    const catalog = productCatalog()
    catalog.fixture.models["vendor/gpt-5.5"] = { ...catalog.fixture.models["Qwen/Qwen3.8-27B"], id: "vendor/gpt-5.5" }
    expect(
      evaluateHubModel(
        hubFixture({ cardData: { base_model: "vendor/gpt-5.5", base_model_relation: "quantized" } }),
        catalog,
      ).policy,
    ).toBe("excluded")
  })

  test("does not infer native compatibility from weight files or a native manifest", () => {
    const model = hubFixture({
      siblings: [
        { rfilename: "model.safetensors", size: 100 },
        { rfilename: "model-manifest.json", size: 20 },
      ],
    })
    const definition = hubModelDefinition(model, evaluateHubModel(model, productCatalog()))!
    expect(definition.toolcall).toBe(false)
    expect(definition.minMemoryBytes).toBeGreaterThan(4 * 1024 ** 3)
    expect(
      hubModelDefinition(
        hubFixture({ siblings: [{ rfilename: "model.safetensors" }] }),
        evaluateHubModel(model, productCatalog()),
      ),
    ).toBeUndefined()
  })
})

describe("managed Hub references", () => {
  test("keeps package precision and revision identities separate", () => {
    const first = hubModelID(hubFixture())
    const second = hubModelID(hubFixture({ sha: "b".repeat(40) }))
    expect(normalizeModelID(first)).toBe(first)
    expect(normalizeQuantization(undefined, first)).toBe("mlx")
    expect(() => normalizeQuantization("mlx6bit", first)).toThrow("does not support")
    expect(AxEnginePaths.managedModelDir(first, "mlx")).not.toBe(AxEnginePaths.managedModelDir(second, "mlx"))
  })

  test.each([
    "unknown",
    "AutomatosX/AX-Test@main",
    `Other/AX-Test@${"a".repeat(40)}`,
    `AutomatosX/../escape@${"a".repeat(40)}`,
    null,
    "",
  ])("rejects explicit invalid ID %s instead of choosing the default", (id) => {
    expect(AxEngineModelIDSchema.safeParse(id).success).toBe(false)
    expect(() => normalizeModelID(id)).toThrow("unknown AX Engine model ID")
  })

  test("allows candidate selection without inventing native tool support", () => {
    const model = { capabilities: { toolcall: false }, options: { axEngineCandidate: true } }
    expect(modelSelectableForProvider("ax-engine", model)).toBe(true)
    expect(modelSelectableForProvider("openai", model)).toBe(false)
    expect(
      modelSelectableForProvider("ax-engine", { ...model, capabilities: { toolcall: false, output: { text: false } } }),
    ).toBe(false)
  })

  test.each([undefined, false])("blocks native activation when tool support is %s", (toolcall) => {
    const cards = parseAxEngineModelContracts({ data: [{ id: "candidate", capabilities: { toolcall } }] })
    expect(() => requireAxEngineCodingContract(cards, "candidate")).toThrow("AX_ENGINE_TOOLCALL_UNSUPPORTED")
  })

  test("blocks non-text models even when structured tools are advertised", () => {
    const cards = parseAxEngineModelContracts({
      data: [{ id: "candidate", capabilities: { toolcall: true, output: { text: false } } }],
    })
    expect(() => requireAxEngineCodingContract(cards, "candidate")).toThrow("AX_ENGINE_TOOLCALL_UNSUPPORTED")
  })

  test("requires a known downloader version with pinned-reference support", () => {
    expect(pinnedDownloadVersionBlocker(undefined)).toContain("6.13.1")
    expect(pinnedDownloadVersionBlocker("6.11.0")).toContain("6.13.1")
    expect(pinnedDownloadVersionBlocker("ax-engine 7.2.1")).toBeUndefined()
  })

  test.each([undefined, {}, { image: true }])("requires explicit live text support for Hub candidates: %s", (input) => {
    const cards = parseAxEngineModelContracts({
      data: [{ id: "candidate", capabilities: { toolcall: true, input, output: { text: true } } }],
    })
    expect(() => requireAxEngineCodingContract(cards, "candidate", { requireText: true })).toThrow(
      "AX_ENGINE_TOOLCALL_UNSUPPORTED",
    )
  })
})
