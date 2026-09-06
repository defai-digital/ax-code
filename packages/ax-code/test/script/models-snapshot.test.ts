import { describe, expect, test } from "vitest"
import { formatModelsSnapshot, modelsSnapshotChanged } from "../../script/models-snapshot"

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

  test("formats updates in existing key order and appends new keys deterministically", () => {
    const existing = {
      zebra: { models: { second: { id: "second", name: "Old" }, first: { id: "first" } }, id: "zebra" },
      alpha: { id: "alpha", models: {} },
    }
    const fetched = {
      beta: { models: {}, id: "beta" },
      alpha: { models: {}, id: "alpha" },
      zebra: {
        id: "zebra",
        models: {
          added: { name: "Added", id: "added" },
          first: { id: "first" },
          second: { name: "New", id: "second" },
        },
      },
    }

    const formatted = JSON.parse(formatModelsSnapshot(fetched, existing))
    expect(Object.keys(formatted)).toEqual(["zebra", "alpha", "beta"])
    expect(Object.keys(formatted.zebra)).toEqual(["models", "id"])
    expect(Object.keys(formatted.zebra.models)).toEqual(["second", "first", "added"])
    expect(Object.keys(formatted.zebra.models.second)).toEqual(["id", "name"])
    expect(Object.keys(formatted.zebra.models.added)).toEqual(["id", "name"])
  })
})
