import type { ModelsDev } from "../../../src/provider/models"
import { HubModel } from "../../../src/provider/ax-engine/hub-model"

export function hubFixture(overrides: Partial<HubModel> = {}): HubModel {
  return HubModel.parse({
    id: "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit-MTP",
    sha: "a".repeat(40),
    pipeline_tag: "text-generation",
    library_name: "mlx",
    tags: ["mlx", "quantized"],
    cardData: { base_model: "Qwen/Qwen3.8-27B", base_model_relation: "quantized" },
    siblings: [
      { rfilename: "config.json", size: 100 },
      { rfilename: "model.safetensors", size: 10_000 },
    ],
    textConfig: { max_position_embeddings: 262_144, num_hidden_layers: 32, num_key_value_heads: 4, head_dim: 128 },
    ...overrides,
  })
}

export function productCatalog(): Record<string, ModelsDev.Provider> {
  return {
    fixture: {
      id: "fixture",
      name: "Fixture",
      env: [],
      models: {
        "Qwen/Qwen3.8-27B": {
          id: "Qwen/Qwen3.8-27B",
          name: "Qwen3.8 27B",
          release_date: "2026-01-01",
          attachment: false,
          reasoning: true,
          temperature: true,
          tool_call: true,
          limit: { context: 262_144, output: 32_000 },
          modalities: { input: ["text"], output: ["text"] },
        },
      },
    },
  }
}
