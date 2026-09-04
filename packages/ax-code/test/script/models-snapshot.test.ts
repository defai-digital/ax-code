import { describe, expect, test } from "vitest"
import { modelsSnapshotChanged } from "../../script/models-snapshot"

describe("models snapshot helpers", () => {
  test("ignores object key order while preserving array order", () => {
    const existing = {
      provider: {
        id: "provider",
        models: {
          alpha: { id: "alpha", modalities: { input: ["text", "image"] } },
        },
      },
    }
    const reordered = {
      provider: {
        models: {
          alpha: { modalities: { input: ["text", "image"] }, id: "alpha" },
        },
        id: "provider",
      },
    }
    const changedArray = {
      provider: {
        id: "provider",
        models: {
          alpha: { id: "alpha", modalities: { input: ["image", "text"] } },
        },
      },
    }

    expect(modelsSnapshotChanged(existing, reordered)).toBe(false)
    expect(modelsSnapshotChanged(existing, changedArray)).toBe(true)
  })
})
